import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, audit } from '../middleware.js';
import { dateRangeFromKey } from '../utils.js';

const router = Router();
router.use(requireAuth, requirePermission('audit.view'));

router.get('/', (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.search) { where.push('(a.action LIKE ? OR a.details LIKE ? OR a.user_name LIKE ?)'); const l = `%${q.search}%`; params.push(l, l, l); }
  if (q.user_id) { where.push('a.user_id = ?'); params.push(q.user_id); }
  if (q.action) { where.push('a.action LIKE ?'); params.push(`%${q.action}%`); }
  if (q.dateKey) {
    const range = dateRangeFromKey(q.dateKey);
    where.push('a.created_at >= ? AND a.created_at <= ?');
    params.push(range.start, range.end);
  }
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.created_at DESC LIMIT 1000`).all(...params);
  res.json(rows);
});

router.get('/actions', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
  res.json(rows.map((r) => r.action));
});

router.get('/count', requirePermission('audit.clear'), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
  const oldest = db.prepare('SELECT MIN(created_at) AS d FROM audit_logs').get().d;
  const newest = db.prepare('SELECT MAX(created_at) AS d FROM audit_logs').get().d;
  res.json({ ok: true, total, oldest, newest });
});

// Permanently clear the entire audit trail. Requires the audit.clear permission.
router.delete('/', requirePermission('audit.clear'), (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
    db.prepare('DELETE FROM audit_logs').run();
    // Written after the delete so the clear itself leaves a permanent trace.
    audit(req, 'audit.clear_all', 'audit_logs', null, `Cleared the entire audit trail: ${count} log entries deleted`);
    res.json({ ok: true, deleted: count });
  } catch (err) {
    console.error('[Audit] Clear API error:', err);
    res.status(500).json({ error: 'Failed to clear the audit log. No entries were deleted.' });
  }
});

export default router;
