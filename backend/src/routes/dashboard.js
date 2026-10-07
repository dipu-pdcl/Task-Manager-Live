import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, isAdmin } from '../middleware.js';
import { dateRangeFromKey, today, dateDaysAgo, bdNow } from '../utils.js';
import { getSettings } from '../config.js';
import { computeUserKpi } from './kpi.js';
import { buildTaskFilter, scopeSql, notDailyTaskSql } from '../filters.js';

const router = Router();
router.use(requireAuth);

function series(days, key = 'day') {
  const out = [];
  const base = bdNow();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({
      day: key === 'month' ? d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) : d.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      date: d.toISOString().slice(0, 10),
    });
  }
  return out;
}

function statusDist(scope, params = []) {
  const cfg = getSettings();
  const rows = db.prepare(`
    SELECT status, COUNT(*) c FROM tasks t WHERE ${scope} GROUP BY status
  `).all(...params);
  const counts = {};
  for (const r of rows) counts[r.status] = r.c;
  return cfg.taskStatuses.map((s) => ({ status: s.id, name: s.name, color: s.color, count: counts[s.id] || 0 }));
}

function prioDist(scope, params = []) {
  const cfg = getSettings();
  const rows = db.prepare(`SELECT priority, COUNT(*) c FROM tasks t WHERE ${scope} GROUP BY priority`).all(...params);
  const counts = {};
  for (const r of rows) counts[r.priority] = r.c;
  return cfg.priorities.map((p) => ({ priority: p.id, name: p.name, color: p.color, count: counts[p.id] || 0 }));
}

router.get('/', (req, res) => {
  const admin = isAdmin(req.user);
  const uid = req.user.id;
  const cfg = getSettings();
  const f = buildTaskFilter(req.query, req.user);
  const scope = scopeSql(f);
  const P = () => [...f.params];

  const num = (sql) => db.prepare(`SELECT COUNT(*) c FROM tasks t WHERE ${scope} AND ${sql}`).get(...P()).c;

  const todayStr = today();

  const dailyMap = new Map();
  series(14).forEach((d) => dailyMap.set(d.date, { ...d, added: 0, done: 0 }));
  db.prepare(`
    SELECT date(t.created_at) AS d, COUNT(*) AS c FROM tasks t WHERE ${scope} AND t.created_at >= date('${todayStr}', '-13 day') GROUP BY d
  `).all(...P()).forEach((r) => { if (dailyMap.has(r.d)) dailyMap.get(r.d).added = r.c; });
  db.prepare(`
    SELECT date(t.completed_at) AS d, COUNT(*) AS c FROM tasks t WHERE ${scope} AND t.completed_at >= date('${todayStr}', '-13 day') AND t.completed_at IS NOT NULL GROUP BY d
  `).all(...P()).forEach((r) => { if (dailyMap.has(r.d)) dailyMap.get(r.d).done = r.c; });
  const daily = Array.from(dailyMap.values());

  const monthlyMap = new Map();
  series(12, 'month').forEach((m) => monthlyMap.set(m.date.slice(0, 7), { ...m, added: 0, done: 0 }));
  db.prepare(`
    SELECT strftime('%Y-%m', t.created_at) AS m, COUNT(*) AS c FROM tasks t WHERE ${scope} AND t.created_at >= date('${todayStr}', '-12 month') GROUP BY m
  `).all(...P()).forEach((r) => { if (monthlyMap.has(r.m)) monthlyMap.get(r.m).added = r.c; });
  db.prepare(`
    SELECT strftime('%Y-%m', t.completed_at) AS m, COUNT(*) AS c FROM tasks t WHERE ${scope} AND t.completed_at >= date('${todayStr}', '-12 month') AND t.completed_at IS NOT NULL GROUP BY m
  `).all(...P()).forEach((r) => { if (monthlyMap.has(r.m)) monthlyMap.get(r.m).done = r.c; });
  const monthly = Array.from(monthlyMap.values());

  const completionMap = new Map();
  series(14).forEach((d) => completionMap.set(d.date, { ...d, completed: 0 }));
  db.prepare(`
    SELECT date(t.completed_at) AS d, COUNT(*) AS c FROM tasks t WHERE ${scope} AND t.completed_at >= date('${todayStr}', '-13 day') AND t.completed_at IS NOT NULL GROUP BY d
  `).all(...P()).forEach((r) => { if (completionMap.has(r.d)) completionMap.get(r.d).completed = r.c; });
  const completionTrend = Array.from(completionMap.values());

  const overdueMap = new Map();
  series(14).forEach((d) => overdueMap.set(d.date, { ...d, overdue: 0 }));
  db.prepare(`
    SELECT date(t.due_date) AS d, COUNT(*) AS c FROM tasks t WHERE ${scope}
    AND t.due_date IS NOT NULL AND t.due_date <= date('${todayStr}') AND t.due_date >= date('${todayStr}', '-13 day')
    AND t.status NOT IN ('done','cancelled') GROUP BY d
  `).all(...P()).forEach((r) => { if (overdueMap.has(r.d)) overdueMap.get(r.d).overdue = r.c; });
  const overdueTrend = Array.from(overdueMap.values());

  const teamPerf = db.prepare(`
    SELECT te.name AS name, te.id, COUNT(t.id) AS total,
      SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
    FROM teams te LEFT JOIN tasks t ON t.team_id = te.id AND ${scope}
    GROUP BY te.id ORDER BY done DESC
  `).all(...P());

  const deptPerf = db.prepare(`
    SELECT d.name AS name, d.id, COUNT(t.id) AS total,
      SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
    FROM departments d LEFT JOIN tasks t ON t.department_id = d.id AND ${scope}
    GROUP BY d.id ORDER BY done DESC
  `).all(...P());

  const userPerf = db.prepare(`
    SELECT u.id, u.name, u.avatar, COUNT(ta.task_id) AS assigned,
      SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    JOIN tasks t ON t.id = ta.task_id
    WHERE ${scope}
    GROUP BY u.id ORDER BY done DESC LIMIT 12
  `).all(...P());

  const recentTasks = db.prepare(`
    SELECT t.*, u.name AS creator_name, te.name AS team_name, d.name AS department_name,
      (SELECT GROUP_CONCAT(au.name, ', ') FROM task_assignees ta
         JOIN users au ON au.id = ta.user_id WHERE ta.task_id = t.id) AS assigned_names
    FROM tasks t
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN teams te ON te.id = t.team_id
    LEFT JOIN departments d ON d.id = t.department_id
    WHERE ${scope} ORDER BY t.updated_at DESC LIMIT 8
  `).all(...P());

  const activities = db.prepare(`
    SELECT th.*, u.name AS user_name FROM task_history th
    JOIN tasks t ON t.id = th.task_id
    LEFT JOIN users u ON u.id = th.user_id
    WHERE ${scope} ORDER BY th.created_at DESC LIMIT 10
  `).all(...P());

  const myNotifications = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 6
  `).all(uid);

  const summaryRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date < '${todayStr}' AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN status IN ('todo','discussion') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
      SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) AS inReview,
      SUM(CASE WHEN due_date = '${todayStr}' AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS dueToday,
      SUM(CASE WHEN due_date >= '${todayStr}' AND due_date <= date('${todayStr}', '+7 day') AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS dueWeek,
      SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN priority = 'critical' AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN status='done' AND date(completed_at) = '${todayStr}' THEN 1 ELSE 0 END) AS doneToday,
      COALESCE(SUM(budget),0) AS budget,
      COALESCE(SUM(estimated_hours),0) AS hours
    FROM tasks t WHERE ${scope}
  `).get(...P());

  const summary = {
    total: summaryRow?.total || 0,
    open: summaryRow?.open || 0,
    done: summaryRow?.done || 0,
    cancelled: summaryRow?.cancelled || 0,
    overdue: summaryRow?.overdue || 0,
    pending: summaryRow?.pending || 0,
    inProgress: summaryRow?.inProgress || 0,
    inReview: summaryRow?.inReview || 0,
    dueToday: summaryRow?.dueToday || 0,
    dueWeek: summaryRow?.dueWeek || 0,
    blocked: summaryRow?.blocked || 0,
    critical: summaryRow?.critical || 0,
    doneToday: summaryRow?.doneToday || 0,
    activeUsers: admin ? db.prepare(`SELECT COUNT(*) c FROM users WHERE is_active=1`).get().c
      : db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM task_assignees ta JOIN tasks t ON t.id=ta.task_id WHERE t.status NOT IN ('done','cancelled') AND ${notDailyTaskSql()}`).get().c,
    budgetUtil: { budget: Number(summaryRow?.budget || 0), hours: Number(summaryRow?.hours || 0) },
  };
  summary.completionRate = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
  const avgH = db.prepare(`
    SELECT ROUND(AVG((julianday(completed_at) - julianday(created_at)) * 24),1) v
    FROM tasks t WHERE status='done' AND completed_at IS NOT NULL AND ${scope}`).get(...P()).v;
  summary.avgCompletionHours = avgH || 0;

  const r = dateRangeFromKey(req.query.dateKey || '30d', req.query.dateKey === 'custom' ? { from: req.query.date_from || req.query.from, to: req.query.date_to || req.query.to } : null);
  let kpi = null;
  if (admin) {
    const list = db.prepare(`
      SELECT u.id, u.name, u.avatar FROM users u WHERE u.is_active=1 ORDER BY u.name`).all()
      .map((u) => ({ ...computeUserKpi(u.id, r.start, r.end, cfg), ...u }))
      .sort((a, b) => b.score - a.score);
    kpi = list;
  } else {
    const me = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(uid);
    kpi = [{ ...computeUserKpi(uid, r.start, r.end, cfg), ...me }];
  }

  const calendar = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.status, t.priority FROM tasks t
    WHERE ${scope} AND t.due_date IS NOT NULL AND t.status NOT IN ('done','cancelled')
    ORDER BY t.due_date LIMIT 200
  `).all(...P());

  res.json({
    summary,
    daily,
    monthly,
    completionTrend,
    overdueTrend,
    teamPerf,
    deptPerf,
    userPerf,
    statusDist: statusDist(scope, f.params),
    prioDist: prioDist(scope, f.params),
    recentTasks,
    activities,
    notifications: myNotifications,
    kpi,
    calendar,
  });
});

export default router;
