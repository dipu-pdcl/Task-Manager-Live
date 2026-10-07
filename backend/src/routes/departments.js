import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, audit } from '../middleware.js';

const router = Router();
router.use(requireAuth);

function deptRows() {
  return db.prepare(`
    SELECT d.*, u.name AS head_name,
      (SELECT COUNT(*) FROM users x WHERE x.department_id = d.id) AS member_count,
      (SELECT COUNT(*) FROM tasks x WHERE x.department_id = d.id) AS task_count,
      (SELECT COUNT(*) FROM tasks x WHERE x.department_id = d.id AND x.status = 'done') AS done_count
    FROM departments d LEFT JOIN users u ON u.id = d.head_id
    ORDER BY d.id ASC
  `).all();
}

router.get('/', (req, res) => res.json(deptRows()));

router.post('/', requirePermission('departments.manage'), (req, res) => {
  const { id, name, description, head_id, hotline, hotline_ext, manager_name, manager_ext } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Branch name is required' });
  const exists = db.prepare('SELECT id FROM departments WHERE lower(name) = lower(?)').get(name);
  if (exists) return res.status(400).json({ error: 'Branch already exists' });

  // Hotline value without any extension
  let hotlineVal = hotline !== undefined ? String(hotline).trim() : (hotline_ext ? String(hotline_ext).trim() : '');
  if (hotlineVal) {
    hotlineVal = hotlineVal.split(/,\s*Ext:\s*/i)[0].trim();
  }
  const managerNameVal = manager_name !== undefined ? String(manager_name).trim() : '';
  const managerExtVal = manager_ext !== undefined ? String(manager_ext).trim() : '';

  let branchId;
  if (id) {
    const idNum = Number(id);
    const idExists = db.prepare('SELECT id FROM departments WHERE id = ?').get(idNum);
    if (idExists) return res.status(400).json({ error: `Branch ID ${idNum} already exists` });
    db.prepare('INSERT INTO departments (id, name, description, head_id, hotline, ext, hotline_ext, manager_name, manager_ext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(idNum, name, description || '', head_id || null, hotlineVal, '', hotlineVal, managerNameVal, managerExtVal);
    branchId = idNum;
  } else {
    const r = db.prepare('INSERT INTO departments (name, description, head_id, hotline, ext, hotline_ext, manager_name, manager_ext) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, description || '', head_id || null, hotlineVal, '', hotlineVal, managerNameVal, managerExtVal);
    branchId = Number(r.lastInsertRowid);
  }
  audit(req, 'department.create', 'department', branchId, `Created branch ${name} (ID: ${branchId})`);
  res.json({ ok: true, id: branchId });
});

router.put('/:id', requirePermission('departments.manage'), (req, res) => {
  const id = Number(req.params.id);
  const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!d) return res.status(404).json({ error: 'Branch not found' });
  const { name, description, head_id, hotline, hotline_ext, manager_name, manager_ext } = req.body || {};

  let newHotline = hotline !== undefined ? String(hotline).trim() : (hotline_ext !== undefined ? String(hotline_ext).trim() : d.hotline || '');
  if (newHotline) {
    newHotline = newHotline.split(/,\s*Ext:\s*/i)[0].trim();
  }
  const newManagerName = manager_name !== undefined ? String(manager_name).trim() : (d.manager_name || '');
  const newManagerExt = manager_ext !== undefined ? String(manager_ext).trim() : (d.manager_ext || '');

  db.prepare('UPDATE departments SET name = COALESCE(?, name), description = COALESCE(?, description), head_id = ?, hotline = ?, ext = ?, hotline_ext = ?, manager_name = ?, manager_ext = ? WHERE id = ?')
    .run(name ?? null, description ?? null, head_id !== undefined ? (head_id || null) : d.head_id, newHotline, '', newHotline, newManagerName, newManagerExt, id);
  audit(req, 'department.update', 'department', id, `Updated branch ${name || d.name}`);
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('departments.manage'), (req, res) => {
  const id = Number(req.params.id);
  const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!d) return res.status(404).json({ error: 'Branch not found' });
  db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  audit(req, 'department.delete', 'department', id, `Deleted branch ${d.name}`);
  res.json({ ok: true });
});

export default router;
