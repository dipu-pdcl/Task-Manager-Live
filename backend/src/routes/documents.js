import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, DOCUMENT_DIR, UPLOAD_DIR, ATTACHMENT_DIR } from '../db.js';
import { requireAuth, requireAdmin, requirePermission, isAdmin, audit } from '../middleware.js';
import { isoNow } from '../utils.js';
import { indexDocuments } from '../services/documentIndexer.js';

const router = Router();
router.use(requireAuth);

router.get('/folders', requirePermission('documents.view'), (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const folders = isUserAdmin
    ? db.prepare('SELECT * FROM document_folders ORDER BY "path", name').all()
    : db.prepare('SELECT * FROM document_folders WHERE created_by = ? ORDER BY "path", name').all(userId);
  const result = folders.map((f) => ({
    ...f,
    children: db.prepare('SELECT * FROM document_folders WHERE parent_id = ? ORDER BY name').all(f.id),
    document_count: db.prepare('SELECT COUNT(*) AS c FROM documents WHERE folder_id = ?').get(f.id)?.c || 0,
    child_folder_count: db.prepare('SELECT COUNT(*) AS c FROM document_folders WHERE parent_id = ?').get(f.id)?.c || 0,
  }));
  res.json({ folders: result });
});

router.get('/folders/tree', requirePermission('documents.view'), (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const allFolders = isUserAdmin
    ? db.prepare('SELECT * FROM document_folders ORDER BY "path", name').all()
    : db.prepare('SELECT * FROM document_folders WHERE created_by = ? ORDER BY "path", name').all(userId);

  function buildTree(folders, parentId = null) {
    return folders.filter((f) => (parentId === null ? !f.parent_id : f.parent_id === parentId)).map((f) => ({
      ...f,
      children: buildTree(folders, f.id),
      document_count: db.prepare('SELECT COUNT(*) AS c FROM documents WHERE folder_id = ?').get(f.id)?.c || 0,
    }));
  }
  res.json({ tree: buildTree(allFolders) });
});

router.post('/folders', requirePermission('documents.manage'), (req, res) => {
  const { name, parent_id = null } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Folder name is required' });
  const folderName = String(name).trim();
  const existing = db.prepare('SELECT id FROM document_folders WHERE parent_id = ? AND name = ?').get(parent_id ? Number(parent_id) : null, folderName);
  if (existing) return res.status(400).json({ error: 'A folder with this name already exists in this location' });

  let path = '';
  if (parent_id) {
    const parent = db.prepare('SELECT id, "path", name FROM document_folders WHERE id = ?').get(Number(parent_id));
    if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
    path = `${parent.path || ''}/${folderName.toLowerCase().replace(/\s+/g, '-')}`;
  } else {
    path = folderName.toLowerCase().replace(/\s+/g, '-');
  }

  const r = db.prepare('INSERT INTO document_folders (name, parent_id, "path", created_by) VALUES (?, ?, ?, ?)').run(folderName, parent_id ? Number(parent_id) : null, path, req.user.id);
  audit(req, 'document.folder_create', 'document_folder', Number(r.lastInsertRowid), `Created folder "${folderName}"`);
  res.status(201).json({ id: Number(r.lastInsertRowid), name: folderName, parent_id: parent_id ? Number(parent_id) : null, path, created_by: req.user.id });
});

router.put('/folders/:id', requirePermission('documents.manage'), (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  const folder = db.prepare('SELECT * FROM document_folders WHERE id = ?').get(Number(id));
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  if (!isAdmin(req.user) && folder.created_by !== req.user.id) return res.status(403).json({ error: 'No access to this folder' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Folder name is required' });
  const folderName = String(name).trim();
  const sibling = db.prepare('SELECT id FROM document_folders WHERE parent_id = ? AND name = ? AND id != ?').get(folder.parent_id, folderName, folder.id);
  if (sibling) return res.status(400).json({ error: 'A folder with this name already exists in this location' });

  let newPath = folder.path;
  if (folder.parent_id) {
    const parent = db.prepare('SELECT name FROM document_folders WHERE id = ?').get(folder.parent_id);
    const parentPath = parent?.path || '';
    newPath = `${parentPath}/${folderName.toLowerCase().replace(/\s+/g, '-')}`;
  } else {
    newPath = folderName.toLowerCase().replace(/\s+/g, '-');
  }

  // Update path of all descendants
  const oldPath = folder.path;
  const now = db.prepare("SELECT datetime('now','+6 hours') AS now").get().now;
  db.prepare('UPDATE document_folders SET name = ?, "path" = ?, updated_at = ? WHERE id = ?')
    .run(folderName, newPath, now, folder.id);
  if (newPath !== oldPath) {
    db.prepare('UPDATE document_folders SET "path" = ? || SUBSTR("path", LENGTH(?) + 1), updated_at = ? WHERE "path" LIKE ?')
      .run(newPath, oldPath, now, oldPath + '%');
  }
  audit(req, 'document.folder_rename', 'document_folder', folder.id, `Renamed folder "${folder.name}" to "${folderName}"`);
  const updated = db.prepare('SELECT * FROM document_folders WHERE id = ?').get(folder.id);
  res.json(updated);
});

router.delete('/folders/:id', requirePermission('documents.manage'), (req, res) => {
  const { id } = req.params;
  const folder = db.prepare('SELECT * FROM document_folders WHERE id = ?').get(Number(id));
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  if (!isAdmin(req.user) && folder.created_by !== req.user.id) return res.status(403).json({ error: 'No access to this folder' });

  // Check for non-empty folder (has children or documents)
  const childCount = db.prepare('SELECT COUNT(*) AS c FROM document_folders WHERE parent_id = ?').get(folder.id)?.c || 0;
  const docCount = db.prepare('SELECT COUNT(*) AS c FROM documents WHERE folder_id = ?').get(folder.id)?.c || 0;
  if (childCount > 0 || docCount > 0) {
    return res.status(400).json({ error: `Cannot delete non-empty folder. Move ${childCount} subfolder(s) and ${docCount} document(s) first.` });
  }

  db.prepare('DELETE FROM document_folders WHERE id = ?').run(folder.id);
  audit(req, 'document.folder_delete', 'document_folder', folder.id, `Deleted folder "${folder.name}"`);
  res.json({ ok: true });
});

router.post('/folders/move', requirePermission('documents.manage'), (req, res) => {
  const { documentId, folderId } = req.body || {};
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(documentId));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canManageDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to move this document' });

  if (folderId !== null && folderId !== undefined && folderId !== '') {
    const target = db.prepare('SELECT id FROM document_folders WHERE id = ?').get(Number(folderId));
    if (!target) return res.status(404).json({ error: 'Target folder not found' });
  }

  const oldFolderId = doc.folder_id;
  db.prepare('UPDATE documents SET folder_id = ? WHERE id = ?').run(folderId ? Number(folderId) : null, doc.id);
  db.prepare('INSERT INTO document_history (document_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
    .run(doc.id, req.user.id, 'move', 'folder_id', String(oldFolderId || ''), String(folderId || ''));
  audit(req, 'document.move', 'document', doc.id, `Moved document "${doc.filename}" to folder ${folderId || '(root)'}`);
  res.json({ ok: true, old_folder_id: oldFolderId, new_folder_id: folderId ? Number(folderId) : null });
});

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
const MAX_DOC_SIZE = 50 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOCUMENT_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_DOC_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ALLOWED_EXT.test(ext));
  },
});

function getFileInfo(filename, storedName, mime) {
  const ext = path.extname(storedName || filename || '').toLowerCase();
  const fileType = ext.startsWith('.') ? ext.slice(1) : ext;
  if (!mime) mime = MIME_TYPE_MAP[ext] || 'application/octet-stream';
  return { fileType: fileType || 'unknown', mime };
}

function canManageDocument(doc, userId, isUserAdmin) {
  if (isUserAdmin) return true;
  if (doc.uploaded_by === userId) return true;
  if (doc.project_id) {
    const project = db.prepare('SELECT created_by FROM projects WHERE id = ?').get(doc.project_id);
    if (project && (project.created_by === userId || db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, userId))) return true;
  }
  if (doc.team_id) {
    const member = db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id = ?').get(userId, doc.team_id);
    if (member) return true;
  }
  if (doc.department_id) {
    const deptMember = db.prepare('SELECT 1 FROM users WHERE id = ? AND department_id = ?').get(userId, doc.department_id);
    if (deptMember) return true;
  }
  const perm = db.prepare('SELECT 1 FROM document_permissions WHERE document_id = ? AND (user_id = ? OR team_id IN (SELECT team_id FROM users WHERE id = ?) OR department_id IN (SELECT department_id FROM users WHERE id = ?))').get(doc.id, userId, userId, userId);
  if (perm) return true;
  return false;
}

function canViewDocument(doc, userId, isUserAdmin) {
  if (doc.is_active === 0) return false;
  if (canManageDocument(doc, userId, isUserAdmin)) return true;
  if (doc.access_permission === 'public') return true;
  if (doc.access_permission === 'authenticated') return true;
  const perm = db.prepare('SELECT permission FROM document_permissions WHERE document_id = ? AND (user_id = ? OR team_id IN (SELECT team_id FROM users WHERE id = ?) OR department_id IN (SELECT department_id FROM users WHERE id = ?))').get(doc.id, userId, userId, userId);
  return !!perm;
}

function enrichDocument(doc) {
  const uploader = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(doc.uploaded_by);
  let projectName = null, deptName = null, teamName = null;
  if (doc.project_id) {
    const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(doc.project_id);
    if (p) projectName = p.name;
  }
  if (doc.department_id) {
    const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(doc.department_id);
    if (d) deptName = d.name;
  }
   if (doc.team_id) {
    const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(doc.team_id);
    if (t) teamName = t.name;
  }
  let folder = null;
  if (doc.folder_id) {
    const f = db.prepare('SELECT id, name, parent_id, "path" FROM document_folders WHERE id = ?').get(doc.folder_id);
    if (f) folder = { id: f.id, name: f.name, parent_id: f.parent_id, path: f.path };
  }
  let tags = [];
  try { tags = JSON.parse(doc.tags || '[]'); } catch { tags = []; }
  return {
    ...doc,
    file_type: getFileInfo(doc.filename, doc.stored_name, doc.mime).fileType,
    uploader: uploader ? { id: uploader.id, name: uploader.name, avatar: uploader.avatar } : null,
     project_name: projectName,
     department_name: deptName,
     team_name: teamName,
     folder: folder,
     tags: Array.isArray(tags) ? tags : [],
  };
}

router.get('/search', requirePermission('documents.view'), (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { q, file_type, project_id, team_id, department_id, user_id, tags, access_permission, date_from, date_to, limit = 50, folder_id } = req.query;

  const params = [];
  const conditions = [];

  if (q) {
    conditions.push(`(d.filename LIKE ? OR d.original_name LIKE ? OR d.description LIKE ? OR d.vendor_name LIKE ? OR d.file_type LIKE ? OR d.tags LIKE ?)`);
    const likeQ = `%${String(q)}%`;
    params.push(likeQ, likeQ, likeQ, likeQ, likeQ, likeQ);
  }
  if (file_type) {
    const ft = String(file_type).toLowerCase();
    const extMap = {
      image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
      word: ['doc', 'docx'],
      excel: ['xls', 'xlsx', 'csv'],
      text: ['txt', 'md', 'log', 'json'],
      pdf: ['pdf'],
    };
    if (extMap[ft]) {
      conditions.push(`(${extMap[ft].map((e) => `d.file_type = ?`).join(' OR ')})`);
      extMap[ft].forEach((e) => params.push(e));
    } else {
      conditions.push(`d.file_type = ?`);
      params.push(ft);
    }
  }
  if (project_id) { conditions.push(`d.project_id = ?`); params.push(Number(project_id)); }
  if (team_id) { conditions.push(`d.team_id = ?`); params.push(Number(team_id)); }
  if (department_id) { conditions.push(`d.department_id = ?`); params.push(Number(department_id)); }
  if (user_id) { conditions.push(`d.uploaded_by = ?`); params.push(Number(user_id)); }
  if (access_permission) { conditions.push(`d.access_permission = ?`); params.push(String(access_permission)); }
  if (tags) {
    const tagArr = Array.isArray(tags) ? tags : [tags];
    const tagConditions = tagArr.map(() => `d.tags LIKE ?`);
    conditions.push(`(${tagConditions.join(' OR ')})`);
    tagArr.forEach(t => params.push(`%${String(t).trim()}%`));
  }

  // Permission filtering
  if (!isUserAdmin) {
    const myTeams = db.prepare('SELECT id FROM teams WHERE lead_id = ?').all(userId).map(r => r.id);
    const myTeamStr = myTeams.length ? myTeams.join(',') : '0';
    const myDept = db.prepare('SELECT department_id FROM users WHERE id = ?').get(userId)?.department_id;
    const permIds = db.prepare(
      `SELECT DISTINCT dp.document_id FROM document_permissions dp
       JOIN documents d2 ON d2.id = dp.document_id
       WHERE (dp.user_id = ? OR dp.team_id IN (${myTeamStr}) OR dp.department_id = ?) AND d2.is_active = 1`
    ).all(userId, myDept).map(r => r.document_id);
    const permStr = permIds.length ? permIds.join(',') : '0';
    conditions.push(`(d.uploaded_by = ? OR d.project_id IN (${permStr}) OR d.team_id IN (${myTeamStr}) OR d.department_id = ? OR d.access_permission IN ('public','authenticated'))`);
    params.push(userId, myDept);
  }

  if (folder_id !== undefined) { conditions.push(`d.folder_id ${folder_id ? '= ?' : 'IS NULL'}`); if (folder_id) params.push(Number(folder_id)); }
  if (date_from) { conditions.push(`d.upload_date >= ?`); params.push(String(date_from)); }
  if (date_to) { conditions.push(`d.upload_date <= ?`); params.push(String(date_to)); }
  conditions.push('d.is_active = 1');
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const sql = `SELECT d.* FROM documents d ${whereClause} ORDER BY d.last_updated DESC LIMIT ${Number(limit) || 50}`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(enrichDocument));
});

router.get('/', requirePermission('documents.view'), (req, res) => {
  const { project_id, team_id, department_id, access_permission, q, limit = 100 } = req.query;
  const params = [];
  const conditions = [];

  if (!isAdmin(req.user)) {
    conditions.push(`(uploaded_by = ? OR access_permission IN ('public','authenticated'))`);
    params.push(req.user.id);
  }
  if (project_id) { conditions.push(`project_id = ?`); params.push(Number(project_id)); }
  if (team_id) { conditions.push(`team_id = ?`); params.push(Number(team_id)); }
  if (department_id) { conditions.push(`department_id = ?`); params.push(Number(department_id)); }
  if (access_permission) { conditions.push(`access_permission = ?`); params.push(String(access_permission)); }
  if (q) { conditions.push(`(filename LIKE ? OR original_name LIKE ? OR description LIKE ?)`); params.push(`%${String(q)}%`, `%${String(q)}%`, `%${String(q)}%`); }
  if (!isAdmin(req.user)) conditions.push('is_active = 1');

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const sql = `SELECT * FROM documents ${whereClause} ORDER BY last_updated DESC LIMIT ${Number(limit) || 100}`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(enrichDocument));
});

router.get('/:id', requirePermission('documents.view'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canViewDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to this document' });
  db.prepare('UPDATE documents SET view_count = view_count + 1 WHERE id = ?').run(doc.id);
  db.prepare(
    'INSERT INTO document_history (document_id, user_id, action, ip) VALUES (?, ?, ?, ?)'
  ).run(doc.id, req.user.id, 'view', req.ip || '');
  res.json(enrichDocument(doc));
});

router.get('/:id/permissions', requirePermission('documents.view'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canViewDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to this document' });
  const perms = db.prepare(
    `SELECT dp.*, u.name AS user_name, t.name AS team_name, d.name AS department_name
     FROM document_permissions dp
     LEFT JOIN users u ON u.id = dp.user_id
     LEFT JOIN teams t ON t.id = dp.team_id
     LEFT JOIN departments d ON d.id = dp.department_id
     WHERE dp.document_id = ?`
  ).all(doc.id);
  res.json({ permissions: perms });
});

router.post('/', requirePermission('documents.upload'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid file uploaded. Supported: PDF, images, Word, Excel, CSV, text, markdown' });
  const { filename, file_type, description = '', vendor_name = '', tags = '[]', version = '1.0', access_permission = 'authenticated', project_id, team_id, department_id, folder_id } = req.body;
  const { fileType: inferredType, mime } = getFileInfo(req.file.originalname, req.file.filename, req.file.mimetype);
  const fileType = file_type || inferredType;

  try {
    const r = db.prepare(`
      INSERT INTO documents (filename, stored_name, original_name, file_type, mime, size, file_path, uploaded_by, project_id, department_id, team_id, folder_id, tags, description, vendor_name, version, access_permission)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      filename || req.file.originalname,
      req.file.filename,
      req.file.originalname,
      String(fileType),
      mime,
      req.file.size,
      `documents/${req.file.filename}`,
      req.user.id,
      project_id ? Number(project_id) : null,
       department_id ? Number(department_id) : null,
       team_id ? Number(team_id) : null,
       folder_id ? Number(folder_id) : null,
       Array.isArray(tags) ? JSON.stringify(tags) : (tags || '[]'),
       description || '',
       vendor_name || '',
       version || '1.0',
      access_permission || 'authenticated',
    );

    const docId = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO document_history (document_id, user_id, action, field, new_value) VALUES (?, ?, ?, ?, ?)')
      .run(docId, req.user.id, 'upload', 'file', `${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);
    audit(req, 'document.upload', 'document', docId, `Uploaded document "${req.file.originalname}"`);

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
    res.status(201).json(enrichDocument(doc));
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    res.status(400).json({ error: 'Failed to save document: ' });
  }
});

router.put('/:id', requirePermission('documents.manage'), upload.single('file'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canManageDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to edit this document' });

  const { filename, file_type, description = '', vendor_name, tags = '[]', version, access_permission, project_id, team_id, department_id, folder_id, replace_file } = req.body;

  try {
    if (req.file) {
      // Replace file
      try { fs.unlinkSync(path.join(DOCUMENT_DIR, doc.stored_name)); } catch { /* noop */ }
      const { fileType: inferredType, mime } = getFileInfo(req.file.originalname, req.file.filename, req.file.mimetype);
      db.prepare(`
        UPDATE documents SET
          filename = ?, stored_name = ?, original_name = ?, file_type = ?, mime = ?, size = ?,
          file_path = ?, last_updated = datetime('now','+6 hours')
        WHERE id = ?
      `).run(
        filename || req.file.originalname,
        req.file.filename,
        req.file.originalname,
        file_type || inferredType,
        mime,
        req.file.size,
        `documents/${req.file.filename}`,
        doc.id,
      );
      db.prepare('INSERT INTO document_history (document_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
        .run(doc.id, req.user.id, 'replace_file', 'stored_name', doc.stored_name, req.file.filename);
    }

    const updates = [];
    const params = [];
    if (filename && filename !== doc.filename) { updates.push('filename = ?'); params.push(filename); }
    if (file_type) { updates.push('file_type = ?'); params.push(String(file_type)); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (vendor_name !== undefined && vendor_name !== null) { updates.push('vendor_name = ?'); params.push(vendor_name); }
    if (tags) { updates.push('tags = ?'); params.push(Array.isArray(tags) ? JSON.stringify(tags) : tags); }
    if (version) { updates.push('version = ?'); params.push(version); }
    if (access_permission) { updates.push('access_permission = ?'); params.push(access_permission); }
    if (project_id !== undefined) { updates.push('project_id = ?'); params.push(project_id ? Number(project_id) : null); }
    if (team_id !== undefined) { updates.push('team_id = ?'); params.push(team_id ? Number(team_id) : null); }
    if (department_id !== undefined) { updates.push('department_id = ?'); params.push(department_id ? Number(department_id) : null); }
    if (folder_id !== undefined) { updates.push('folder_id = ?'); params.push(folder_id ? Number(folder_id) : null); }

    if (updates.length > 0) {
      updates.push("last_updated = datetime('now','+6 hours')");
      params.push(doc.id);
      db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      db.prepare('INSERT INTO document_history (document_id, user_id, action, field, new_value) VALUES (?, ?, ?, ?, ?)')
        .run(doc.id, req.user.id, 'update', 'metadata', 'document metadata updated');
    }

    audit(req, 'document.update', 'document', doc.id, 'Document updated');
    const updated = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id);
    res.json(enrichDocument(updated));
  } catch (e) {
    res.status(400).json({ error: 'Failed to update document: ' });
  }
});

router.delete('/:id', requirePermission('documents.manage'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canManageDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to delete this document' });

  try { fs.unlinkSync(path.join(DOCUMENT_DIR, doc.stored_name)); } catch { /* noop */ }
  db.prepare('DELETE FROM document_permissions WHERE document_id = ?').run(doc.id);
  db.prepare('DELETE FROM document_history WHERE document_id = ?').run(doc.id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);

  audit(req, 'document.delete', 'document', doc.id, `Deleted document "${doc.filename}"`);
  res.json({ ok: true });
});

router.post('/:id/permissions', requirePermission('documents.manage'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canManageDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to manage permissions' });

  const { user_id, team_id, department_id, permission = 'view' } = req.body;
  if (!user_id && !team_id && !department_id) return res.status(400).json({ error: 'user_id, team_id, or department_id is required' });

  db.prepare(`
    INSERT INTO document_permissions (document_id, user_id, team_id, department_id, permission, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(doc.id, user_id ? Number(user_id) : null, team_id ? Number(team_id) : null, department_id ? Number(department_id) : null, permission, req.user.id);
  audit(req, 'document.permission_grant', 'document', doc.id, `Granted ${permission} to user/team/dept`);
  res.json({ ok: true });
});

router.delete('/:id/permissions/:permId', requirePermission('documents.manage'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canManageDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to manage permissions' });
  db.prepare('DELETE FROM document_permissions WHERE id = ? AND document_id = ?').run(Number(req.params.permId), doc.id);
  res.json({ ok: true });
});

router.get('/:id/history', requirePermission('documents.view'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canViewDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to this document' });
  const history = db.prepare(
    `SELECT h.*, u.name AS user_name FROM document_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.document_id = ? ORDER BY h.created_at DESC`
  ).all(doc.id);
  res.json({ history });
});

router.get('/:id/download', requirePermission('documents.view'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!canViewDocument(doc, req.user.id, isAdmin(req.user))) return res.status(403).json({ error: 'No access to this document' });
  const filePath = path.join(DOCUMENT_DIR, doc.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  db.prepare('UPDATE documents SET download_count = download_count + 1 WHERE id = ?').run(doc.id);
  db.prepare('INSERT INTO document_history (document_id, user_id, action) VALUES (?, ?, ?)').run(doc.id, req.user.id, 'download');
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`);
  fs.createReadStream(filePath).pipe(res);
});

function walkDocsDir(dir, baseDir) {
  const results = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (entry.name.includes('..')) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push(...walkDocsDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push({ relPath, fullPath });
    }
  }
  return results;
}

router.get('/admin/backup-files', requireAdmin, requirePermission('documents.admin'), (req, res) => {
  try {
    if (!fs.existsSync(DOCUMENT_DIR)) {
      return res.status(404).json({ error: 'Document storage directory not found' });
    }
    const files = walkDocsDir(DOCUMENT_DIR, DOCUMENT_DIR);
    const fileEntries = files.map((f) => {
      const stat = fs.statSync(f.fullPath);
      return { name: f.relPath, size: stat.size };
    });
    const totalSize = fileEntries.reduce((sum, f) => sum + f.size, 0);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify({ files: fileEntries, total_files: fileEntries.length, total_size: totalSize }));
  } catch (e) {
    res.status(500).json({ error: 'Failed to list document files: ' });
  }
});

router.get('/admin/backup', requireAdmin, requirePermission('documents.admin'), async (req, res) => {
  try {
    if (!fs.existsSync(DOCUMENT_DIR)) {
      return res.status(404).json({ error: 'Document storage directory not found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="pdcl-ict-documents-${isoNow().slice(0, 19).replace(/[:T]/g, '-')}.zip"`);

    const { default: archiver } = await import('archiver');
    const archive = archiver('zip', { gzip: false });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to create document backup archive' });
    });
    archive.pipe(res);

    const files = walkDocsDir(DOCUMENT_DIR, DOCUMENT_DIR);
    for (const f of files) {
      const stat = fs.statSync(f.fullPath);
      if (stat.isFile()) {
        archive.file(f.fullPath, { name: f.relPath });
      }
    }
    archive.finalize();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate document backup: ' });
    }
  }
});

router.post('/admin/sync', requireAdmin, requirePermission('documents.admin'), (req, res) => {
  try {
    const result = indexDocuments();
    audit(req, 'document.sync', 'document', null, `Indexed documents: ${result.indexed} new, ${result.updated} updated, ${result.deleted} deleted, ${result.foldersCreated} folders created`);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Sync failed: ' });
  }
});

export default router;
