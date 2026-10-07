import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, UPLOAD_DIR, ATTACHMENT_DIR, DOCUMENT_DIR } from '../db.js';
import { requireAuth, requireAdmin, isAdmin, audit } from '../middleware.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const ALLOWED_EXT = /\.(png|jpe?g|gif|webp|pdf|txt|csv|json|md|zip|xlsx?|docx?)$/i;
const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain|text\/csv|text\/markdown|application\/json|application\/zip|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml)\.document|application\/msword|application\/vnd\.ms-excel)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_EXT.test(path.extname(file.originalname) || '') && ALLOWED_MIME.test(file.mimetype || '')),
});

// Attachment-specific config: JPG/JPEG/PNG/PDF only, 2MB max
const ATTACHMENT_ALLOWED_EXT = /\.(jpe?g|png|pdf)$/i;
const ATTACHMENT_ALLOWED_MIME = /^(image\/jpe?g|image\/png|application\/pdf)$/i;
const ATTACHMENT_MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACHMENT_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
});
const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: ATTACHMENT_MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const isExtValid = ATTACHMENT_ALLOWED_EXT.test(ext);
    const isMimeValid = ATTACHMENT_ALLOWED_MIME.test(file.mimetype || '');
    cb(null, isExtValid && isMimeValid);
  },
});
const avatarUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype || '')),
});

function removeFiles(dir, files) {
  for (const f of files || []) {
    try { fs.unlinkSync(path.join(dir, f.filename)); } catch { /* noop */ }
  }
}

function findFile(storedName, allowSubdir = false) {
  for (const dir of [ATTACHMENT_DIR, UPLOAD_DIR, DOCUMENT_DIR]) {
    if (allowSubdir && storedName.includes('/')) {
      const fp = path.join(dir, storedName);
      if (fs.existsSync(fp)) return fp;
    }
    const fp = path.join(dir, path.basename(storedName));
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

function getFileTypeInfo(storedName, mime) {
  const ext = path.extname(storedName || '').toLowerCase();
  if (/\.jpe?g/i.test(ext) || /^image\/jpe?g$/.test(mime)) return 'image';
  if (/\.png$/i.test(ext) || /^image\/png$/.test(mime)) return 'image';
  if (/\.(gif|webp|bmp|svg)$/i.test(ext) || /^image\/(gif|webp|bmp|svg)$/.test(mime)) return 'image';
  if (/\.pdf$/i.test(ext) || /^application\/pdf$/.test(mime)) return 'pdf';
  if (/\.(docx?)$/i.test(ext) || /^application\/(msword|.*wordprocessingml.*)$/.test(mime)) return 'word';
  if (/\.(xlsx?|csv)$/i.test(ext) || /^application\/(.*spreadsheetml.*|vnd\.ms-excel)$/.test(mime) || mime === 'text/csv') return 'excel';
  if (/\.(txt|md|json|log)$/i.test(ext) || mime?.startsWith('text/')) return 'text';
  return 'other';
}

router.post('/task/:taskId', requireAuth, attachmentUpload.array('files', 10), (req, res) => {
  const taskId = Number(req.params.taskId);
  const files = req.files || [];
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) {
    removeFiles(ATTACHMENT_DIR, files);
    return res.status(404).json({ error: 'Task not found' });
  }
  const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(taskId);
  if (!(isAdmin(req.user) || task.created_by === req.user.id || assignees.some((a) => a.user_id === req.user.id))) {
    removeFiles(ATTACHMENT_DIR, files);
    return res.status(403).json({ error: 'No access to this task' });
  }
  const saved = [];
  const stmt = db.prepare(`
    INSERT INTO task_attachments (task_id, user_id, filename, stored_name, size, mime)
    VALUES (?, ?, ?, ?, ?, ?)`);
  try {
    for (const f of files) {
      const r = stmt.run(taskId, req.user.id, f.originalname, f.filename, f.size, f.mimetype || '');
      saved.push(db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(Number(r.lastInsertRowid)));
    }
  } catch (e) {
    removeFiles(ATTACHMENT_DIR, files);
    return res.status(400).json({ error: 'Failed to save attachment: ' });
  }
  audit(req, 'task.upload', 'task', taskId, `Uploaded ${files.length} attachment(s)`);
  res.json(saved);
});

router.post('/chat/:messageId', requireAuth, attachmentUpload.array('files', 10), (req, res) => {
  const messageId = Number(req.params.messageId);
  const files = req.files || [];
  const senderId = req.user.id;

  const convRow = db.prepare(`SELECT cm.id, cm.sender_id, cm.recipient_id, cm.group_id FROM chat_messages cm WHERE cm.id = ?`).get(messageId);
  if (!convRow) {
    removeFiles(ATTACHMENT_DIR, files);
    return res.status(404).json({ error: 'Message not found' });
  }

  let recipientId = null, groupId = null;
  if (convRow.recipient_id !== null && convRow.recipient_id !== undefined) {
    recipientId = convRow.recipient_id;
  } else if (convRow.group_id) {
    groupId = convRow.group_id;
  }

  let canSend = false;
  if (isAdmin(req.user)) canSend = true;
  else if (convRow.sender_id === senderId) canSend = true;
  if (recipientId === senderId) canSend = true;
  if (groupId) {
    const member = db.prepare('SELECT id FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(groupId, senderId);
    if (member) canSend = true;
  }

  if (!canSend) {
    removeFiles(ATTACHMENT_DIR, files);
    return res.status(403).json({ error: 'No access to this conversation' });
  }

  const saved = [];
  const stmt = db.prepare(`
    INSERT INTO chat_attachments (message_id, sender_id, recipient_id, group_id, filename, stored_name, size, mime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  try {
    for (const f of files) {
      const r = stmt.run(messageId, senderId, recipientId || null, groupId || null, f.originalname, f.filename, f.size, f.mimetype || '');
      saved.push(db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(Number(r.lastInsertRowid)));
    }
  } catch (e) {
    removeFiles(ATTACHMENT_DIR, files);
    return res.status(400).json({ error: 'Failed to save chat attachment: ' });
  }
  audit(req, 'chat.upload', 'chat_message', messageId, `Uploaded ${files.length} chat attachment(s)`);
  res.json(saved);
});

router.post('/avatar', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Only PNG, JPEG, GIF or WebP images up to 50KB are allowed' });
  const url = `/api/uploads/avatar/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, req.user.id);
  audit(req, 'user.avatar', 'user', req.user.id, 'Updated profile picture');
  res.json({ url });
});

router.get('/file/:storedName', requireAuth, (req, res) => {
  const name = req.params.storedName;
  if (name.includes('..') || name.includes('\\')) return res.status(400).json({ error: 'Invalid name' });
  const allowSubdir = name.includes('/');
  const filePath = findFile(name, allowSubdir);
  if (!filePath) return res.status(404).json({ error: 'File not found' });
  let row = db.prepare('SELECT * FROM task_attachments WHERE stored_name = ?').get(name);
  let fileType = 'other';
  if (row) {
    const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(row.task_id);
    const task = db.prepare('SELECT created_by FROM tasks WHERE id = ?').get(row.task_id);
    if (!(isAdmin(req.user) || task?.created_by === req.user.id || assignees.some((a) => a.user_id === req.user.id))) {
      return res.status(403).json({ error: 'No access to this file' });
    }
    fileType = getFileTypeInfo(row.stored_name, row.mime);
  } else {
    row = db.prepare('SELECT * FROM chat_attachments WHERE stored_name = ?').get(name);
    if (row) {
      const msg = db.prepare('SELECT sender_id, recipient_id, group_id FROM chat_messages WHERE id = ?').get(row.message_id);
      let canAccess = isAdmin(req.user);
      if (msg?.sender_id === req.user.id || msg?.recipient_id === req.user.id) canAccess = true;
      if (msg?.group_id) {
        const member = db.prepare('SELECT id FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(msg.group_id, req.user.id);
        if (member) canAccess = true;
      }
      if (!canAccess) return res.status(403).json({ error: 'No access to this file' });
      fileType = getFileTypeInfo(row.stored_name, row.mime);
    } else {
      row = db.prepare('SELECT * FROM documents WHERE stored_name = ?').get(name);
      if (row) {
        if (!row.access_permission || row.access_permission === 'private') {
          const docAccess = db.prepare('SELECT 1 FROM document_permissions WHERE document_id = ? AND (user_id = ? OR team_id IN (SELECT team_id FROM users WHERE id = ?) OR department_id IN (SELECT department_id FROM users WHERE id = ?))').get(row.id, req.user.id, req.user.id, req.user.id);
          if (!(isAdmin(req.user) || row.uploaded_by === req.user.id || docAccess)) {
            return res.status(403).json({ error: 'No access to this file' });
          }
        }
        fileType = getFileTypeInfo(row.stored_name, row.mime);
      }
    }
  }
  res.setHeader('Content-Type', row?.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row?.filename || name)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.get('/file/:storedName/download', requireAuth, (req, res) => {
  const name = req.params.storedName;
  if (name.includes('..') || name.includes('\\')) return res.status(400).json({ error: 'Invalid name' });
  const allowSubdir = name.includes('/');
  const filePath = findFile(name, allowSubdir);
  if (!filePath) return res.status(404).json({ error: 'File not found' });
  let row = db.prepare('SELECT * FROM task_attachments WHERE stored_name = ?').get(name);
  if (row) {
    const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(row.task_id);
    const task = db.prepare('SELECT created_by FROM tasks WHERE id = ?').get(row.task_id);
    if (!(isAdmin(req.user) || task?.created_by === req.user.id || assignees.some((a) => a.user_id === req.user.id))) {
      return res.status(403).json({ error: 'No access to this file' });
    }
  } else {
    row = db.prepare('SELECT * FROM chat_attachments WHERE stored_name = ?').get(name);
    if (row) {
      const msg = db.prepare('SELECT sender_id, recipient_id, group_id FROM chat_messages WHERE id = ?').get(row.message_id);
      let canAccess = isAdmin(req.user);
      if (msg?.sender_id === req.user.id || msg?.recipient_id === req.user.id) canAccess = true;
      if (msg?.group_id) {
        const member = db.prepare('SELECT id FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(msg.group_id, req.user.id);
        if (member) canAccess = true;
      }
      if (!canAccess) return res.status(403).json({ error: 'No access to this file' });
    } else {
      row = db.prepare('SELECT * FROM documents WHERE stored_name = ?').get(name);
      if (row) {
        if (!row.access_permission || row.access_permission === 'private') {
          const docAccess = db.prepare('SELECT 1 FROM document_permissions WHERE document_id = ? AND (user_id = ? OR team_id IN (SELECT team_id FROM users WHERE id = ?) OR department_id IN (SELECT department_id FROM users WHERE id = ?))').get(row.id, req.user.id, req.user.id, req.user.id);
          if (!(isAdmin(req.user) || row.uploaded_by === req.user.id || docAccess)) {
            return res.status(403).json({ error: 'No access to this file' });
          }
        }
      }
    }
  }
  res.setHeader('Content-Type', row?.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row?.filename || name)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.get('/avatar/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return res.status(400).json({ error: 'Invalid name' });
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'image/*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

// Admin: list all attachments for management
router.get('/attachments', requireAuth, requireAdmin, (req, res) => {
  const { q, task_id } = req.query;
  let sql = `SELECT * FROM task_attachments`;
  const params = [];
  if (q) {
    sql += ` WHERE filename LIKE ?`;
    params.push(`%${q}%`);
  }
  if (task_id) {
    sql += `${params.length ? ' AND' : ' WHERE'} task_id = ?`;
    params.push(Number(task_id));
  }
  sql += ` ORDER BY uploaded_at DESC`;
  const rows = db.prepare(sql).all(...params);
  const result = rows.map((r) => ({
    ...r,
    file_type: getFileTypeInfo(r.stored_name, r.mime),
    file_path: r.stored_name,
  }));
  res.json(result);
});

// Admin: delete attachment record and file (users cannot delete saved attachments)
router.delete('/:attachmentId', requireAuth, requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  try {
    const fp = findFile(a.stored_name);
    if (fp) fs.unlinkSync(fp);
  } catch { /* noop */ }
  db.prepare('DELETE FROM task_attachments WHERE id = ?').run(a.id);
  audit(req, 'task.attachment_delete', 'task', a.task_id, `Admin deleted attachment ${a.filename}`);
  res.json({ ok: true });
});

// Admin: list all chat attachments for management
router.get('/chat-attachments', requireAuth, requireAdmin, (req, res) => {
  const { q, message_id } = req.query;
  let sql = `SELECT ca.*, cm.sender_id AS msg_sender_id, cm.recipient_id AS msg_recipient_id, cm.group_id AS msg_group_id FROM chat_attachments ca JOIN chat_messages cm ON ca.message_id = cm.id`;
  const params = [];
  if (q) {
    sql += ` WHERE ca.filename LIKE ?`;
    params.push(`%${q}%`);
  }
  if (message_id) {
    sql += `${params.length ? ' AND' : ' WHERE'} ca.message_id = ?`;
    params.push(Number(message_id));
  }
  sql += ` ORDER BY ca.uploaded_at DESC`;
  const rows = db.prepare(sql).all(...params);
  const result = rows.map((r) => ({
    ...r,
    file_type: getFileTypeInfo(r.stored_name, r.mime),
    file_path: r.stored_name,
  }));
  res.json(result);
});

export default router;
