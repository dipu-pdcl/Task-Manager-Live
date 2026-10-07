import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, audit, notify } from '../middleware.js';

const router = Router();
router.use(requireAuth);

function teamRows() {
  return db.prepare(`
    SELECT t.*, u.name AS lead_name,
      (SELECT COUNT(*) FROM users x WHERE x.team_id = t.id) AS member_count,
      (SELECT COUNT(*) FROM tasks x WHERE x.team_id = t.id) AS task_count,
      (SELECT COUNT(*) FROM tasks x WHERE x.team_id = t.id AND x.status = 'done') AS done_count
    FROM teams t LEFT JOIN users u ON u.id = t.lead_id
    ORDER BY t.name
  `).all();
}

router.get('/', (req, res) => res.json(teamRows()));

router.post('/', requirePermission('teams.manage'), (req, res) => {
  const { name, description, lead_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Team name is required' });
  const exists = db.prepare('SELECT id FROM teams WHERE lower(name) = lower(?)').get(name);
  if (exists) return res.status(400).json({ error: 'Team already exists' });
  const r = db.prepare('INSERT INTO teams (name, description, lead_id) VALUES (?, ?, ?)')
    .run(name, description || '', lead_id || null);
  audit(req, 'team.create', 'team', Number(r.lastInsertRowid), `Created team ${name}`);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

router.put('/:id', requirePermission('teams.manage'), (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Team not found' });
  const { name, description, lead_id } = req.body || {};
  db.prepare('UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description), lead_id = ? WHERE id = ?')
    .run(name ?? null, description ?? null, lead_id || null, id);
  audit(req, 'team.update', 'team', id, `Updated team ${name || t.name}`);
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('teams.manage'), (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Team not found' });
  db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  audit(req, 'team.delete', 'team', id, `Deleted team ${t.name}`);
  res.json({ ok: true });
});

export default router;
