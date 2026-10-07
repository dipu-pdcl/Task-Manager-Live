import fs from 'node:fs';
import path from 'node:path';
import { db, DOCUMENT_DIR, UPLOAD_DIR } from '../db.js';
import { isoNow } from '../utils.js';

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

const ALLOWED_EXT = /\.(pdf|jpe?g|png|gif|webp|bmp|svg|txt|csv|json|md|log|docx?|xlsx?|pptx?)$/i;

function getFileInfo(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const mime = MIME_TYPE_MAP[ext] || 'application/octet-stream';
  const fileType = ext.startsWith('.') ? ext.slice(1) : ext;
  return { fileType: fileType || 'unknown', mime };
}

function getFolderByPath(folderPath, parentRef = null) {
  if (!folderPath) return null;
  const parent = parentRef ? parentRef : db.prepare('SELECT id, name, parent_id, "path" FROM document_folders WHERE parent_id IS NULL AND "path" = ?').get(folderPath);
  return parent;
}

function findOrCreateFolder(folderName, parentPath) {
  let dbFolder = null;
  const cleanName = folderName.replace(/\.dms$/i, '');
  const folderSlug = `${parentPath}/${cleanName.toLowerCase().replace(/\s+/g, '-')}`;

  dbFolder = db.prepare('SELECT id, name, parent_id, "path" FROM document_folders WHERE "path" = ?').get(folderSlug);
  if (dbFolder) return dbFolder;

  const insertStmt = db.prepare('INSERT INTO document_folders (name, parent_id, "path", created_by) VALUES (?, ?, ?, ?)');
  const parentRow = parentPath ? db.prepare('SELECT id FROM document_folders WHERE "path" = ?').get(parentPath) : null;
  const result = insertStmt.run(cleanName, parentRow ? parentRow.id : null, folderSlug, 1);
  return db.prepare('SELECT id, name, parent_id, "path" FROM document_folders WHERE id = ?').get(result.lastInsertRowid);
}

function findFolderForSubdir(subdirRelPath) {
  const normalized = subdirRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return null;
  return db.prepare('SELECT id, name, parent_id, "path" FROM document_folders WHERE "path" = ?').get(normalized);
}

export function resolveFolderIdForFilePath(storedName) {
  let file_rel = '';
  let file_base = '';
  if (storedName.includes('/')) {
    const idx = storedName.lastIndexOf('/');
    file_rel = storedName.slice(0, idx);
    file_base = storedName.slice(idx + 1);
  } else {
    file_base = storedName;
  }

  if (!file_rel) return null;

  const relPathNormalized = file_rel.replace(/\\/g, '/');
  const folder = db.prepare('SELECT id FROM document_folders WHERE "path" = ?').get(relPathNormalized);
  return folder ? folder.id : null;
}

function walkDirectory(dir, baseDir) {
  const results = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push(...walkDirectory(fullPath, baseDir));
    } else if (entry.isFile() && ALLOWED_EXT.test(path.extname(entry.name))) {
      results.push({ fullPath, relPath, entry });
    }
  }
  return results;
}

export function indexDocuments() {
  if (!fs.existsSync(DOCUMENT_DIR)) {
    return { indexed: 0, updated: 0, deleted: 0, foldersCreated: 0, errors: 0, message: 'DOCUMENT_DIR does not exist' };
  }

  let indexed = 0;
  let updated = 0;
  let deleted = 0;
  let foldersCreated = 0;
  let errors = 0;

  try {
    db.exec('BEGIN IMMEDIATE');

    const allFiles = walkDirectory(DOCUMENT_DIR, DOCUMENT_DIR);

    const fileRecords = {};
    const folderPathsOnDisk = new Set();

    for (const { fullPath, relPath, entry } of allFiles) {
      const dirPart = path.dirname(relPath).replace(/\\/g, '/');
      const baseName = entry.name;
      const isOnRoot = dirPart === '.' || dirPart === '';

      if (!isOnRoot) {
        folderPathsOnDisk.add(dirPart);
      }

      const stat = fs.statSync(fullPath);
      const storedName = relPath;
      const { fileType, mime } = getFileInfo(baseName);

      let existing = db.prepare('SELECT id, stored_name, size, mime, file_type, folder_id FROM documents WHERE stored_name = ?').get(storedName);

      if (existing) {
        let needsUpdate = false;
        if (existing.size !== stat.size) needsUpdate = true;
        if (existing.mime !== mime) needsUpdate = true;
        if (existing.file_type !== fileType) needsUpdate = true;
        const folderIdForFile = resolveFolderIdForFilePath(storedName);
        if (existing.folder_id !== folderIdForFile) needsUpdate = true;

        if (needsUpdate) {
          const file_path = `documents/${storedName}`;
          db.prepare(`
            UPDATE documents SET
              filename = ?, original_name = ?, file_type = ?, mime = ?, size = ?, file_path = ?,
              folder_id = ?, last_updated = datetime('now','+6 hours')
            WHERE id = ?
          `).run(baseName, baseName, fileType, mime, stat.size, file_path, folderIdForFile, existing.id);
          updated++;
        }
      } else {
        const folderIdForFile = resolveFolderIdForFilePath(storedName);
        const now = isoNow();
        try {
          const r = db.prepare(`
            INSERT INTO documents (filename, stored_name, original_name, file_type, mime, size, file_path, uploaded_by, folder_id, tags, description, vendor_name, version, access_permission, upload_date, last_updated, is_active, view_count, download_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, '[]', '', '', '1.0', 'authenticated', datetime('now','+6 hours'), datetime('now','+6 hours'), 1, 0, 0)
          `).run(
            baseName, storedName, baseName, fileType, mime, stat.size,
            `documents/${storedName}`, folderIdForFile
          );
          if (r.lastInsertRowid) {
            indexed++;
          }
        } catch (e) {
          errors++;
        }
      }
    }

    for (const folderPath of folderPathsOnDisk) {
      let existing = findFolderForSubdir(folderPath);
      if (!existing) {
        const parts = folderPath.split('/');
        let parentPath = '';
        for (let i = 0; i < parts.length; i++) {
          const seg = parts[i];
          const created = findOrCreateFolder(seg, parentPath);
          if (created) {
            if (!existing || (i === parts.length - 1 && !existing)) {
              foldersCreated++;
            }
            parentPath = created.path;
            if (i === parts.length - 1) existing = created;
          }
        }
      }
    }

    const allDbDocs = db.prepare('SELECT id, stored_name FROM documents WHERE is_active = 1').all();
    for (const doc of allDbDocs) {
      const filePath = path.join(DOCUMENT_DIR, doc.stored_name);
      if (!fs.existsSync(filePath)) {
        db.prepare('UPDATE documents SET is_active = 0 WHERE id = ?').run(doc.id);
        deleted++;
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    errors++;
  }

  return { indexed, updated, deleted, foldersCreated, errors };
}

let scanInterval = null;

export function startBackgroundIndexer(intervalMinutes = 10) {
  indexDocuments();
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(() => {
    try { indexDocuments(); } catch (e) { console.error('Background document indexer error:', e); }
  }, intervalMinutes * 60 * 1000);
  return scanInterval;
}

export function stopBackgroundIndexer() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
}

export default { indexDocuments, startBackgroundIndexer, stopBackgroundIndexer, resolveFolderIdForFilePath };
