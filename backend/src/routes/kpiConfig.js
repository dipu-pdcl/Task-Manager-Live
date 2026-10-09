import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission } from '../middleware.js';
import { audit } from '../middleware.js';
import { invalidateKpiConfigCache, invalidateTaskKpiCache } from '../services/kpiEngine.js';
import { calculateAllUsersKpiForPeriod, calculateUserKpiForPeriod } from '../services/kpiEngine.js';
import { dateRangeFromKey } from '../utils.js';

const router = Router();
router.use(requireAuth);

router.get('/config', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const rules = db.prepare(`
    SELECT id, rule_key, rule_name, rule_category, points, enabled, description, created_at, updated_at
    FROM kpi_config
    ORDER BY rule_category, rule_name
  `).all();
  res.json({ rules });
});

router.get('/config/:ruleKey', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const rule = db.prepare(`
    SELECT id, rule_key, rule_name, rule_category, points, enabled, description, created_at, updated_at
    FROM kpi_config
    WHERE rule_key = ?
  `).get(req.params.ruleKey);
  if (!rule) return res.status(404).json({ error: 'KPI rule not found' });
  res.json({ rule });
});

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
  invalidateKpiConfigCache();
  invalidateTaskKpiCache();
  res.json({ ok: true, rule: { ...existing, points: updatePoints, enabled: updateEnabled, description: updateDescription } });
});

router.post('/config/reset', requirePermission('kpi.manage'), (req, res) => {
  const defaults = [
    { rule_key: 'self_task', rule_name: 'Self Task Completion', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded when a user completes a self-created task' },
    { rule_key: 'create_task', rule_name: 'Create New Task', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded to whoever creates a task' },
    { rule_key: 'assignee_task', rule_name: 'Task Completion (Assignee)', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded to an assigned user when they complete their assigned work' },
    { rule_key: 'create_task_bonus', rule_name: 'Task Creation', rule_category: 'bonus', points: 1, enabled: 1, description: 'Bonus points for creating a task' },
    { rule_key: 'assign_task_bonus', rule_name: 'Task Assignment', rule_category: 'bonus', points: 1, enabled: 1, description: 'Bonus points for assigning a task to another user' },
    { rule_key: 'overdue_task', rule_name: 'Overdue Task Penalty', rule_category: 'penalty', points: -3, enabled: 1, description: 'Negative points applied when a task is not completed by its due date' },
    { rule_key: 'incomplete_task', rule_name: 'Incomplete Task Penalty', rule_category: 'penalty', points: -1, enabled: 1, description: 'Penalty for tasks left incomplete' },
    { rule_key: 'daily_task_complete', rule_name: 'Daily Task Completion', rule_category: 'daily', points: 2, enabled: 1, description: 'Points awarded for completing a daily task' },
    { rule_key: 'daily_task_overdue', rule_name: 'Daily Task Miss Penalty', rule_category: 'penalty', points: -1, enabled: 1, description: 'Negative points applied when a daily task is missed on a past day' },
    { rule_key: 'task_bonus', rule_name: 'Task Completion Bonus', rule_category: 'bonus', points: 1, enabled: 1, description: 'Bonus point when a task is completed' },
    { rule_key: 'create_project', rule_name: 'Project Creation', rule_category: 'project', points: 5, enabled: 1, description: 'Points awarded for creating a new project' },
    { rule_key: 'project_task_complete', rule_name: 'Project Task Completion', rule_category: 'project', points: 3, enabled: 1, description: 'Points awarded for completing a project task' },
    { rule_key: 'project_overdue', rule_name: 'Project Overdue Penalty', rule_category: 'penalty', points: -3, enabled: 1, description: 'Negative points applied when a project task is not completed by its due date' },
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
  invalidateKpiConfigCache();
  invalidateTaskKpiCache();
  res.json({ ok: true, message: 'All KPI rules reset to system defaults' });
});

router.get('/dashboard', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const period = req.query.period || 'month';
  const range = dateRangeFromKey(period);
  const users = calculateAllUsersKpiForPeriod(period);
  res.json({ period, range, users });
});

router.get('/me', (req, res) => {
  const period = req.query.period || 'month';
  const range = dateRangeFromKey(period);
  const kpi = calculateUserKpiForPeriod(req.user.id, period);
  res.json({ period, range, kpi });
});

export default router;