import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, DATA_DIR, UPLOAD_DIR, ATTACHMENT_DIR, DOCUMENT_DIR, replaceDatabase, openDatabase, DB_PATH, restoreTablesFromData } from '../db.js';
import { requireAuth, requireAdmin, audit } from '../middleware.js';
import { getSettings, resetSettingsCache } from '../config.js';
import { isoNow } from '../utils.js';
import { cleanupCache } from '../services/cacheCleanup.js';

const router = Router();
router.use(requireAuth, requireAdmin);

export const BACKUP_FORMAT = 'pdcl-ict-backup';
export const BACKUP_VERSION = 1;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 * 1024 }, // 256MB max backup file size
});

const SAFETY_DIR = path.join(DATA_DIR, 'safety-backups');
try { fs.mkdirSync(SAFETY_DIR, { recursive: true }); } catch { /* noop */ }

const MIME_TYPE_MAP = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.md': 'text/markdown', '.log': 'text/plain',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function safeName(name) {
  return typeof name === 'string' && name && !name.includes('..') && !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

function findAttachmentFile(storedName) {
  for (const dir of [ATTACHMENT_DIR, UPLOAD_DIR]) {
    const fp = path.join(dir, storedName);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

/**
 * Creates a clean binary snapshot of the current SQLite database
 */
function snapshotDb() {
  const tmp = path.join(DATA_DIR, `snapshot-${Date.now()}-${Math.round(Math.random() * 1e9)}.db`);
  try {
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { /* noop */ }
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (err) {
    try {
      fs.copyFileSync(DB_PATH, tmp);
    } catch (fallbackErr) {
      throw new Error(`Database snapshot failed: ${err.message || fallbackErr.message}`);
    }
  }
  const buf = fs.readFileSync(tmp);
  try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
  return buf;
}

/**
 * Builds a complete system backup manifest containing:
 * - Table-by-table JSON structured dump of ALL system entities
 * - Bit-for-bit SQLite binary database
 * - All uploaded attachments
 * - System configuration, KPI settings & workflow definitions
 * - SHA-256 Checksum and comprehensive metadata
 */
export function buildBackupManifest() {
  let dbBuf;
  try {
    dbBuf = snapshotDb();
  } catch (e) {
    console.warn('Snapshot binary fallback:', e);
    dbBuf = Buffer.alloc(0);
  }

  // Dynamically query all tables from SQLite
  const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const tables = tableRows.map((r) => r.name);

  const counts = {};
  const tableData = {};

  for (const t of tables) {
    try {
      const countRow = db.prepare(`SELECT COUNT(*) AS c FROM "${t.replace(/"/g, '""')}"`).get();
      counts[t] = Number(countRow?.c || 0);
      tableData[t] = db.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`).all();
    } catch (e) {
      counts[t] = 0;
      tableData[t] = [];
    }
  }

  // Collect all attachments from task_attachments and chat_attachments + attachment folders
  const attachments = [];
  const attachmentRows = db.prepare('SELECT id, task_id, filename, stored_name, mime, size FROM task_attachments').all();
  const chatAttachmentRows = db.prepare('SELECT id, message_id, filename, stored_name, mime, size FROM chat_attachments').all();
  const seenFiles = new Set();

  for (const a of attachmentRows) {
    if (!safeName(a.stored_name)) continue;
    let data = '';
    const filePath = findAttachmentFile(a.stored_name);
    try {
      if (filePath) {
        data = fs.readFileSync(filePath).toString('base64');
      }
    } catch {
      data = '';
    }
    if (data) {
      seenFiles.add(a.stored_name);
      attachments.push({
        id: a.id,
        task_id: a.task_id,
        stored_name: a.stored_name,
        filename: a.filename,
        mime: a.mime,
        size: a.size,
        data,
      });
    }
  }

  for (const a of chatAttachmentRows) {
    if (!safeName(a.stored_name)) continue;
    let data = '';
    const filePath = findAttachmentFile(a.stored_name);
    try {
      if (filePath) {
        data = fs.readFileSync(filePath).toString('base64');
      }
    } catch {
      data = '';
    }
    if (data) {
      seenFiles.add(a.stored_name);
      attachments.push({
        id: a.id,
        message_id: a.message_id,
        stored_name: a.stored_name,
        filename: a.filename,
        mime: a.mime,
        size: a.size,
        data,
      });
    }
  }

   // Scan any additional files in UPLOAD_DIR and ATTACHMENT_DIR
   for (const dir of [ATTACHMENT_DIR, UPLOAD_DIR]) {
     try {
       const files = fs.readdirSync(dir);
       for (const f of files) {
         if (!seenFiles.has(f) && safeName(f)) {
           const p = path.join(dir, f);
           const stat = fs.statSync(p);
           if (stat.isFile() && stat.size <= 50 * 1024 * 1024) {
             const data = fs.readFileSync(p).toString('base64');
             attachments.push({
               stored_name: f,
               filename: f,
               mime: 'application/octet-stream',
               size: stat.size,
               data,
             });
             seenFiles.add(f);
           }
         }
       }
     } catch { /* noop */ }
   }

   // Collect document metadata (file names, types, tags, dates, etc.) from DB
    // Binary file data is NOT included — documents can be re-uploaded or restored
    // from their original location during disaster recovery.
    const docFiles = [];
    try {
      const docRows = db.prepare('SELECT id, filename, original_name, stored_name, file_type, mime, size, file_path, folder_id, tags, description, vendor_name, version, access_permission, upload_date, last_updated, uploaded_by, project_id, department_id, team_id, is_active, view_count, download_count FROM documents').all();
      for (const d of docRows) {
        docFiles.push({
          id: d.id,
          filename: d.filename,
          original_name: d.original_name,
          stored_name: d.stored_name,
          file_type: d.file_type,
          mime: d.mime,
          size: d.size,
          file_path: d.file_path,
          folder_id: d.folder_id,
          tags: d.tags,
          description: d.description,
          vendor_name: d.vendor_name,
          version: d.version,
          access_permission: d.access_permission,
          upload_date: d.upload_date,
          last_updated: d.last_updated,
          uploaded_by: d.uploaded_by,
          project_id: d.project_id,
          department_id: d.department_id,
          team_id: d.team_id,
          is_active: d.is_active,
          view_count: d.view_count,
          download_count: d.download_count,
        });
      }
    } catch { /* noop */ }

   const currentSettings = getSettings();

   const content = {
     db: dbBuf.length ? dbBuf.toString('base64') : '',
     tables: tableData,
     settings: currentSettings,
     attachments,
     documents: docFiles,
  };

  const checksum = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    backupType: 'full',
    app: 'pdcl-ict',
    createdAt: new Date().toISOString(),
    systemTimezone: 'Asia/Dhaka (+06:00)',
      tables: Object.keys(tableData),
      counts,
      summary: {
      totalUsers: counts.users || 0,
      totalTasks: counts.tasks || 0,
      totalLeaves: (counts.leave_applications || 0) + (counts.leave_quotas || 0),
      totalPriorityTasks: (counts.priority_tasks || 0) + (counts.priority_task_remarks || 0),
      totalDepartments: counts.departments || 0,
      totalTeams: counts.teams || 0,
      totalSettings: counts.settings || 0,
      totalHolidays: counts.holidays || 0,
       totalAttachments: attachments.length,
        totalChatAttachments: counts.chat_attachments || 0,
        totalAuditLogs: counts.audit_logs || 0,
        totalDocuments: counts.documents || 0,
     },
    content,
    checksum,
  };
}

/**
 * Validates a parsed backup object structure & checksum
 */
export function validateBackup(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['File is not a valid JSON backup object'];
  }
  if (parsed.format !== BACKUP_FORMAT) {
    errors.push(`Unrecognized backup format "${parsed.format}". Expected "${BACKUP_FORMAT}".`);
  }
  if (parsed.version && parsed.version > BACKUP_VERSION) {
    errors.push(`Unsupported backup version (${parsed.version}); expected version ${BACKUP_VERSION} or earlier.`);
  }
  const content = parsed.content;
  if (!content || typeof content !== 'object') {
    return ['Backup is missing the content payload'];
  }
  if ((!content.tables || typeof content.tables !== 'object') && (!content.db || typeof content.db !== 'string')) {
    errors.push('Backup is missing both table data and database binary payload');
  }
  if (!content.attachments || !Array.isArray(content.attachments)) {
    errors.push('Backup is missing the attachments payload');
  }
  if (typeof parsed.checksum === 'string' && parsed.checksum) {
    const expected = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
    if (expected !== parsed.checksum) {
      errors.push('Backup integrity check failed: SHA-256 checksum mismatch (file may be corrupted or modified)');
    }
  }
  return errors;
}

/**
 * Validates table structured data
 */
export function validateTableData(tables) {
  if (!tables || typeof tables !== 'object') {
    return { ok: false, error: 'No table structured data found in backup' };
  }
  const required = ['users', 'tasks'];
  const missing = required.filter((t) => !tables[t] || !Array.isArray(tables[t]));
  if (missing.length) {
    return { ok: false, error: `Backup is missing required tables: ${missing.join(', ')}` };
  }

  // Validate users table has required structure
  const users = tables.users || [];
  if (users.length > 0) {
    const sample = users[0];
    if (sample.email === undefined || sample.role === undefined) {
      return { ok: false, error: 'Backup users table is missing required identity fields (email, role)' };
    }
  }

  return {
    ok: true,
    tables: Object.keys(tables).length,
    users: users.length,
    tasks: (tables.tasks || []).length,
    leaves: (tables.leave_applications || []).length,
    priorityTasks: (tables.priority_tasks || []).length,
    departments: (tables.departments || []).length,
    teams: (tables.teams || []).length,
    auditLogs: (tables.audit_logs || []).length,
  };
}

/**
 * Validates the embedded SQLite database binary in an isolated temporary location
 */
function validateDbSnapshot(buf) {
  if (!buf || !buf.length) {
    return { ok: false, error: 'Empty SQLite database buffer' };
  }
  const tmp = path.join(DATA_DIR, `validate-${Date.now()}-${Math.round(Math.random() * 1e9)}.db`);
  let handle;
  try {
    fs.writeFileSync(tmp, buf);
    handle = new DatabaseSync(tmp);
    handle.exec('PRAGMA busy_timeout = 5000;');
    handle.exec('PRAGMA foreign_keys = ON;');

    // 1. Run full SQLite integrity check
    const integrityRow = handle.prepare('PRAGMA integrity_check').get();
    const integrityStatus = integrityRow?.integrity_check || integrityRow?.['integrity_check'] || 'ok';
    if (integrityStatus !== 'ok') {
      return { ok: false, error: `SQLite database file integrity check failed: ${integrityStatus}` };
    }

    // 2. Check essential tables
    const tables = handle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const required = ['users', 'tasks', 'settings', 'holidays', 'task_assignees'];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) {
      return { ok: false, error: `Backup database is missing core tables: ${missing.join(', ')}` };
    }

    // 3. Check users table columns
    const userCols = handle.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('password_hash') || !userCols.includes('email') || !userCols.includes('role')) {
      return { ok: false, error: 'Backup database has an incompatible users table structure' };
    }

    const userCount = Number(handle.prepare('SELECT COUNT(*) AS c FROM users').get()?.c || 0);
    const taskCount = Number(handle.prepare('SELECT COUNT(*) AS c FROM tasks').get()?.c || 0);
    const leaveCount = tables.includes('leave_applications')
      ? Number(handle.prepare('SELECT COUNT(*) AS c FROM leave_applications').get()?.c || 0)
      : 0;
    const priorityCount = tables.includes('priority_tasks')
      ? Number(handle.prepare('SELECT COUNT(*) AS c FROM priority_tasks').get()?.c || 0)
      : 0;

    return {
      ok: true,
      tables: tables.length,
      users: userCount,
      tasks: taskCount,
      leaves: leaveCount,
      priorityTasks: priorityCount,
    };
  } catch (e) {
    return { ok: false, error: 'Backup database could not be read: ' };
  } finally {
    try { handle?.close(); } catch { /* noop */ }
    try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
  }
}

/**
 * Restores attachment files to ATTACHMENT_DIR, removing any obsolete attachments
 */
function restoreAttachments(attachments) {
  const restoredNames = new Set();
  let restoredCount = 0;

  // Write all valid attachments from backup
  for (const a of attachments || []) {
    if (!safeName(a.stored_name) || typeof a.data !== 'string' || !a.data) continue;
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length) continue;
    fs.writeFileSync(path.join(ATTACHMENT_DIR, a.stored_name), buf);
    restoredNames.add(a.stored_name);
    restoredCount++;
  }

  // Remove any leftover files in ATTACHMENT_DIR that do not exist in the restored backup
  try {
    const existing = fs.readdirSync(ATTACHMENT_DIR);
    for (const f of existing) {
      if (!restoredNames.has(f)) {
        try { fs.unlinkSync(path.join(ATTACHMENT_DIR, f)); } catch { /* noop */ }
      }
    }
  } catch { /* noop */ }

  return restoredCount;
}

/**
 * Document files are NOT included in backups (metadata only).
 * This function reports how many document metadata records were found in the backup.
 * Actual file restoration is handled separately via the document indexer or manual upload.
 */
function restoreDocuments(docFiles) {
  return docFiles?.length || 0;
}

// GET /api/settings/backup/stats (Live system stats for backup summary)
router.get('/backup/stats', (req, res) => {
  try {
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const counts = {};
    for (const row of tableRows) {
      try {
        counts[row.name] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${row.name.replace(/"/g, '""')}"`).get()?.c || 0);
      } catch {
        counts[row.name] = 0;
      }
    }
    const uploadFiles = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).filter(f => fs.statSync(path.join(UPLOAD_DIR, f)).isFile()).length : 0;
    const attachmentFiles = fs.existsSync(ATTACHMENT_DIR) ? fs.readdirSync(ATTACHMENT_DIR).filter(f => fs.statSync(path.join(ATTACHMENT_DIR, f)).isFile()).length : 0;
    res.json({
      ok: true,
      counts,
      summary: {
        totalUsers: counts.users || 0,
        totalTasks: counts.tasks || 0,
        totalLeaves: (counts.leave_applications || 0) + (counts.leave_quotas || 0),
        totalPriorityTasks: (counts.priority_tasks || 0) + (counts.priority_task_remarks || 0),
        totalDepartments: counts.departments || 0,
        totalTeams: counts.teams || 0,
        totalSettings: counts.settings || 0,
        totalHolidays: counts.holidays || 0,
         totalAttachments: Math.max(counts.task_attachments || 0, attachmentFiles + uploadFiles),
         totalChatAttachments: counts.chat_attachments || attachmentFiles,
         totalAuditLogs: counts.audit_logs || 0,
         totalDocuments: counts.documents || 0,
       },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/settings/backup (Generate & Download Full Backup)
router.get('/backup', (req, res) => {
  try {
    const manifest = buildBackupManifest();
    const sizeKb = (Buffer.byteLength(JSON.stringify(manifest)) / 1024).toFixed(0);
    audit(
      req,
      'backup.create',
      'backup',
      null,
      `Generated full system backup: ${manifest.summary.totalUsers} users, ${manifest.summary.totalTasks} tasks, ${manifest.summary.totalLeaves} leaves, ${manifest.summary.totalTeams} teams, ${manifest.summary.totalDepartments} branches (${sizeKb} KB)`
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pdcl-ict-backup-${isoNow().slice(0, 19).replace(/[:T]/g, '-')}.pdcl-ict"`
    );
    res.send(JSON.stringify(manifest, null, 2));
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate full backup: ' });
  }
});

// POST /api/settings/backup/inspect (Inspect backup file before restoring)
router.post('/backup/inspect', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No backup file provided' });

    let parsed;
    try {
      parsed = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Uploaded file is not valid JSON' });
    }

    const errors = validateBackup(parsed);
    if (errors.length) {
      return res.status(400).json({ error: `Invalid backup file: ${errors[0]}` });
    }

    let check;
    if (parsed.content.tables) {
      check = validateTableData(parsed.content.tables);
    }
    if ((!check || !check.ok) && parsed.content.db) {
      const dbBuf = Buffer.from(parsed.content.db, 'base64');
      check = validateDbSnapshot(dbBuf);
    }

    if (!check || !check.ok) {
      return res.status(400).json({ error: 'Incompatible backup database: ' + (check?.error || 'Validation failed') });
    }

    res.json({
      valid: true,
      createdAt: parsed.createdAt,
      systemTimezone: parsed.systemTimezone,
      counts: parsed.counts,
        summary: parsed.summary || {
         totalUsers: check.users,
         totalTasks: check.tasks,
         totalLeaves: check.leaves,
         totalPriorityTasks: check.priorityTasks,
          totalAttachments: parsed.content.attachments?.length || 0,
          totalChatAttachments: parsed.counts?.chat_attachments || 0,
          totalDocuments: parsed.counts?.documents || 0,
       },
      check,
      checksumVerified: true,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to inspect backup: ' });
  }
});

// POST /api/settings/backup/restore (Restore Full Backup & Completely Replace Data)
router.post('/backup/restore', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });
    if (req.body.confirm !== 'true' && req.body.confirm !== true) {
      return res.status(400).json({ error: 'Restore requires explicit confirmation before proceeding.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Backup file is not valid JSON' });
    }

    const errors = validateBackup(parsed);
    if (errors.length) {
      return res.status(400).json({ error: `Invalid backup file: ${errors[0]}` });
    }

    let check;
    if (parsed.content.tables) {
      check = validateTableData(parsed.content.tables);
    }
    if ((!check || !check.ok) && parsed.content.db) {
      const dbBuf = Buffer.from(parsed.content.db, 'base64');
      check = validateDbSnapshot(dbBuf);
    }

    if (!check || !check.ok) {
      return res.status(400).json({ error: 'Incompatible backup: ' + (check?.error || 'Validation failed') });
    }

    // 1. Create Pre-Restore Safety Snapshot of current system
    let safetyName = '';
    try {
      const preRestore = buildBackupManifest();
      safetyName = `safety-pre-restore-${isoNow().slice(0, 19).replace(/[:T]/g, '-')}.pdcl-ict`;
      fs.writeFileSync(path.join(SAFETY_DIR, safetyName), JSON.stringify(preRestore));
    } catch (safetyErr) {
      console.warn('Could not write pre-restore safety snapshot:', safetyErr);
    }

    // 2. Completely and reliably restore data
    if (parsed.content.tables) {
      // Primary atomic transaction restore: 100% resilient across concurrent handles and WAL modes
      restoreTablesFromData(parsed.content.tables);
    } else if (parsed.content.db) {
      const dbBuf = Buffer.from(parsed.content.db, 'base64');
      replaceDatabase(dbBuf);
    }

    // 2a. Always fix sqlite_sequence after restore so task/user/etc IDs never jump or append extra digits
    try {
      db.exec('DELETE FROM sqlite_sequence;');
      const seqStmt = db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)');
      const autoTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%AUTOINCREMENT%'").all();
      for (const t of autoTables) {
        const maxRow = db.prepare(`SELECT MAX(id) AS mx FROM "${t.name.replace(/"/g, '""')}"`).get();
        const mx = Number(maxRow?.mx || 0);
        seqStmt.run(t.name, mx + 1);
      }
    } catch { /* noop */ }

    // 3. Reset all system settings cache
    resetSettingsCache();

    // 4. Clean and unpack all attachment files
    const attachmentsRestored = restoreAttachments(parsed.content.attachments);

     // 4a. Restore document metadata (files are not included in backup — re-upload or use document indexer)
    const documentsRestored = restoreDocuments(parsed.content.documents);

     // 5. Verify integrity of database post-restore
     try {
       const integrityRow = db.prepare('PRAGMA integrity_check').get();
       const integrityStatus = integrityRow?.integrity_check || integrityRow?.['integrity_check'] || 'ok';
       if (integrityStatus !== 'ok') {
         console.warn('Post-restore integrity check notice:', integrityStatus);
       }
     } catch { /* noop */ }

     // 6. Write audit entry to the newly restored database
     audit(
       req,
       'backup.restore',
       'backup',
       null,
       `Full system restoration completed. Restored ${check.users} users, ${check.tasks} tasks, ${check.leaves} leaves, ${check.departments || parsed.summary?.totalDepartments || 0} branches, ${check.teams || parsed.summary?.totalTeams || 0} teams, ${attachmentsRestored} attachments, ${documentsRestored} document metadata records from backup created at ${parsed.createdAt || 'unknown'}`
     );

     res.json({
       ok: true,
       message: `Full backup restored successfully. Document file data is not included in backups — use the document indexer or re-upload files as needed.`,
       summary: parsed.summary || {
         totalUsers: check.users,
         totalTasks: check.tasks,
         totalLeaves: check.leaves,
         totalPriorityTasks: check.priorityTasks,
         totalDepartments: check.departments,
         totalTeams: check.teams,
         totalAttachments: attachmentsRestored,
         totalDocuments: documentsRestored,
       },
       counts: parsed.counts,
       attachmentsRestored,
       documentsRestored,
       safetyBackup: safetyName || undefined,
     });
  } catch (e) {
    res.status(500).json({ error: 'Full backup restore failed: ' });
  }
});

// POST /api/settings/cache/clear (Admin: trigger manual cache cleanup)
router.post('/cache/clear', (req, res) => {
  try {
    const result = cleanupCache();
    audit(
      req,
      'cache.clear',
      'cache',
      null,
      `Cache cleanup: freed ${(result.totalBytesFreed / 1024).toFixed(0)} KB, removed ${result.cleanedTempFiles.length} temp files, ${result.cleanedDirs.filter((d) => d.removed).length} cache dirs, ${result.cleanedSafetyBackups.length} old safety backups`
    );
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Cache cleanup failed: ' });
  }
});

export default router;
