import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';
import { addSSEClient, removeSSEClient, broadcastToUser } from '../sse.js';

const router = Router();
router.use(requireAuth);

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const userId = req.user.id;
  addSSEClient(userId, res);

  const unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(userId)?.c || 0;
  res.write(': connected\n\n');
  res.write(`event: unread-count\ndata: ${JSON.stringify({ count: unreadCount })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    removeSSEClient(userId, res);
  });
});

router.get('/', (req, res) => {
  const { unreadOnly } = req.query;
  let sql = `SELECT n.*, u.name AS user_name FROM notifications n LEFT JOIN users u ON u.id = n.user_id
    WHERE n.user_id = ?`;
  if (unreadOnly === 'true') sql += ' AND n.read = 0';
  sql += ' ORDER BY n.created_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(req.user.id));
});

router.get('/unread-count', (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).c });
});

router.put('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  const count = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id)?.c || 0;
  broadcastToUser(req.user.id, 'unread-count', { count });
  broadcastToUser(req.user.id, 'read-status', { id: Number(req.params.id), read: 1 });
  res.json({ ok: true });
});

router.put('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  broadcastToUser(req.user.id, 'unread-count', { count: 0 });
  broadcastToUser(req.user.id, 'read-status', { all: true });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  const count = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id)?.c || 0;
  broadcastToUser(req.user.id, 'unread-count', { count });
  broadcastToUser(req.user.id, 'delete', { id: Number(req.params.id) });
  res.json({ ok: true });
});

export default router;
