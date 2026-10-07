import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission } from '../middleware.js';
import { audit } from '../middleware.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/kpi/config
 * Returns all KPI configuration rules.
 * Accessible by users with kpi.view or kpi.manage permission.
 */
router.get('/config', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const rules = db.prepare(`
    SELECT id, rule_key, rule_name, rule_category, points, enabled, description, created_at, updated_at
    FROM kpi_config
    ORDER BY rule_category, rule_name
  `).all();
  res.json({ rules });
});

/**
 * GET /api/kpi/config/:ruleKey
 * Returns a single KPI configuration rule by key.
 */
router.get('/config/:ruleKey', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const rule = db.prepare(`
    SELECT id, rule_key, rule_name, rule_category, points, enabled, description, created_at, updated_at
    FROM kpi_config
    WHERE rule_key = ?
  `).get(req.params.ruleKey);
  if (!rule) return res.status(404).json({ error: 'KPI rule not found' });
  res.json({ rule });
});

/**
 * PUT /api/kpi/config/:ruleKey
 * Updates a single KPI configuration rule.
 * Requires kpi.manage permission.
 */
router.put('/config/:ruleKey', requirePermission('kpi.manage'), (req, res) => {
  const ruleKey = req.params.ruleKey;
  const { points, enabled, description } = req.body || {};

  const existing = db.prepare('SELECT * FROM kpi_config WHERE rule_key = ?').get(ruleKey);
  if (!existing) return res.status(404).json({ error: 'KPI rule not found' });

  const updatePoints = points !== undefined ? Number(points) : existing.points;
  const updateEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;
  const updateDescription = description !== undefined ? String(description) : existing.description;

  if (!Number.isInteger(updatePoints)) {
    return res.status(400).json({ error: 'points must be an integer' });
  }

  db.prepare(`
    UPDATE kpi_config
    SET points = ?, enabled = ?, description = ?, updated_at = datetime('now','+6 hours')
    WHERE rule_key = ?
  `).run(updatePoints, updateEnabled, updateDescription, ruleKey);

  audit(req, 'kpi.config_update', 'kpi_config', null, `Updated KPI rule ${ruleKey}: points=${updatePoints}, enabled=${updateEnabled}`);
  res.json({ ok: true, rule: { ...existing, points: updatePoints, enabled: updateEnabled, description: updateDescription } });
});

/**
 * POST /api/kpi/config/reset
 * Resets all KPI configuration rules to system defaults.
 * Requires kpi.manage permission.
 */
router.post('/config/reset', requirePermission('kpi.manage'), (req, res) => {
  const defaults = [
    { rule_key: 'self_task', rule_name: 'Self Task Completion', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded when a user completes a self-created task' },
    { rule_key: 'create_task', rule_name: 'Create Task Completion (Creator)', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded to the task creator when they complete the task' },
    { rule_key: 'assignee_task', rule_name: 'Assignee Task Completion', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded to an assigned user when they complete their assigned work' },
    { rule_key: 'overdue_task', rule_name: 'Overdue Task Penalty', rule_category: 'penalty', points: -3, enabled: 1, description: 'Negative points applied when a task is not completed by its due date' },
    { rule_key: 'daily_task_complete', rule_name: 'Daily Task Completion', rule_category: 'daily', points: 2, enabled: 1, description: 'Points awarded for completing a daily task' },
    { rule_key: 'daily_task_overdue', rule_name: 'Daily Task Overdue Penalty', rule_category: 'penalty', points: -1, enabled: 1, description: 'Negative points applied when a daily task is missed on a past day' },
    { rule_key: 'admin_bonus', rule_name: 'Admin Assigned Task Bonus', rule_category: 'bonus', points: 1, enabled: 1, description: 'Bonus point when an Admin assigns a task and the assignee completes it' },
  ];

  const stmt = db.prepare(`
    UPDATE kpi_config
    SET points = ?, enabled = ?, description = ?, updated_at = datetime('now','+6 hours')
    WHERE rule_key = ?
  `);
  for (const d of defaults) {
    stmt.run(d.points, d.enabled, d.description, d.rule_key);
  }

  audit(req, 'kpi.config_reset', 'kpi_config', null, 'Reset all KPI configuration rules to system defaults');
  res.json({ ok: true, message: 'All KPI rules reset to system defaults' });
});

/**
 * GET /api/kpi/transactions
 * Returns KPI transaction history with filtering.
 * Accessible by users with kpi.view or kpi.manage permission.
 */
router.get('/transactions', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const { userId, taskId, ruleKey, from, to, limit = 100, offset = 0 } = req.query;

  let sql = `
    SELECT kt.*, u.name AS user_name, u.email AS user_email,
           t.title AS task_title, t.task_code AS task_code,
           cu.name AS created_by_name
    FROM kpi_transactions kt
    LEFT JOIN users u ON u.id = kt.user_id
    LEFT JOIN tasks t ON t.id = kt.task_id
    LEFT JOIN users cu ON cu.id = kt.created_by
    WHERE 1=1
  `;
  const params = [];

  if (userId) {
    sql += ' AND kt.user_id = ?';
    params.push(Number(userId));
  }
  if (taskId) {
    sql += ' AND kt.task_id = ?';
    params.push(Number(taskId));
  }
  if (ruleKey) {
    sql += ' AND kt.rule_key = ?';
    params.push(ruleKey);
  }
  if (from) {
    sql += ' AND date(kt.created_at) >= date(?)';
    params.push(String(from));
  }
  if (to) {
    sql += ' AND date(kt.created_at) <= date(?)';
    params.push(String(to));
  }

  sql += ' ORDER BY kt.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const transactions = db.prepare(sql).all(...params);
  res.json({ transactions });
});

/**
 * GET /api/kpi/transactions/summary
 * Returns KPI transaction summary for a user.
 */
router.get('/transactions/summary', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const { userId, from, to } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  let sql = `
    SELECT
      kt.rule_key,
      kt.rule_name,
      SUM(kt.points) AS total_points,
      COUNT(*) AS count
    FROM kpi_transactions kt
    WHERE kt.user_id = ?
  `;
  const params = [Number(userId)];

  if (from) {
    sql += ' AND date(kt.created_at) >= date(?)';
    params.push(String(from));
  }
  if (to) {
    sql += ' AND date(kt.created_at) <= date(?)';
    params.push(String(to));
  }

  sql += ' GROUP BY kt.rule_key, kt.rule_name ORDER BY total_points DESC';
  const summary = db.prepare(sql).all(...params);

  const total = summary.reduce((sum, r) => sum + (r.total_points || 0), 0);
  res.json({ summary, total });
});

export default router;