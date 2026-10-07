import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission } from '../middleware.js';
import { dateRangeFromKey, bdNow } from '../utils.js';
import { computeUserKpi } from '../services/kpiEngine.js';

export { computeUserKpi };

const router = Router();
router.use(requireAuth);

function rangeFromQuery(q) {
  const r = dateRangeFromKey(q.dateKey || 'month', q.dateKey === 'custom' ? { from: q.from, to: q.to } : null);
  return r;
}

function buildKpiForUsers(start, end) {
  const users = db.prepare(`
    SELECT u.id, u.name, u.role, u.avatar, t.name AS team_name, d.name AS department_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.is_active = 1 ORDER BY u.name`).all();
  return users.map((u) => ({ ...computeUserKpi(u.id, start, end), ...u }));
}

router.get('/me', (req, res) => {
  const r = rangeFromQuery(req.query);
  const profile = db.prepare(`
    SELECT u.id, u.name, u.role, u.avatar, t.name AS team_name, d.name AS department_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?`).get(req.user.id);
  res.json({ ...computeUserKpi(req.user.id, r.start, r.end), ...profile });
});

router.get('/overview', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const r = rangeFromQuery(req.query);
  const list = buildKpiForUsers(r.start, r.end);
  const active = list.filter((u) => u.totalAssigned > 0 || u.completed > 0);
  const sorted = [...active].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 10);
  const lowest = [...sorted].reverse().slice(0, 10);

  const teamRank = {};
  for (const u of list) {
    const key = u.team_name || 'Unassigned';
    teamRank[key] = teamRank[key] || { name: key, score: 0, completed: 0, count: 0 };
    teamRank[key].score += u.score;
    teamRank[key].completed += u.completed;
    teamRank[key].count += 1;
  }
  const deptRank = {};
  for (const u of list) {
    const key = u.department_name || 'Unassigned';
    deptRank[key] = deptRank[key] || { name: key, score: 0, completed: 0, count: 0 };
    deptRank[key].score += u.score;
    deptRank[key].completed += u.completed;
    deptRank[key].count += 1;
  }

  const months = [];
  const nowBd = bdNow();
  const curY = nowBd.getUTCFullYear();
  const curM = nowBd.getUTCMonth();
  for (let i = 11; i >= 0; i--) {
    let y = curY, m = curM - i;
    while (m < 0) { m += 12; y -= 1; }
    const label = new Date(Date.UTC(y, m, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' });
    const s = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const e = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, '0')}`;
    const listMonth = buildKpiForUsers(s, e);
    const avg = listMonth.length ? Math.round(listMonth.reduce((a, b) => a + b.score, 0) / listMonth.length) : 0;
    months.push({ month: label, avgScore: avg, totalCompleted: listMonth.reduce((a, b) => a + b.completed, 0) });
  }

  const years = [];
  for (let i = 3; i >= 0; i--) {
    const y = curY - i;
    const s = `${y}-01-01`;
    const e = `${y}-12-31`;
    const listYear = buildKpiForUsers(s, e);
    years.push({
      year: String(y),
      avgScore: listYear.length ? Math.round(listYear.reduce((a, b) => a + b.score, 0) / listYear.length) : 0,
      totalCompleted: listYear.reduce((a, b) => a + b.completed, 0),
    });
  }

  res.json({ top, lowest, teamRank: Object.values(teamRank).sort((a, b) => b.score - a.score), deptRank: Object.values(deptRank).sort((a, b) => b.score - a.score), monthly: months, yearly: years, period: { start: r.start, end: r.end } });
});

router.get('/users', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const r = rangeFromQuery(req.query);
  res.json(buildKpiForUsers(r.start, r.end));
});

export default router;