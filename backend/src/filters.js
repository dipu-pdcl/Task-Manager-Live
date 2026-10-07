import { dateRangeFromKey, today } from './utils.js';
import { isAdmin } from './middleware.js';

/**
 * Task search across title, description, the permanent Task ID and the task
 * number, so a user can paste either identifier and land on that one task.
 *
 * A bare number (with or without a leading '#') is matched against the task id
 * exactly rather than with LIKE, so typing "#238" finds task 238 instead of
 * every task whose number or title merely contains "238". The code itself is
 * matched with LIKE, so a partial code ("D0S9") still narrows results, and
 * SQLite's LIKE is case-insensitive for ASCII, so "tsk-d0s9" also works.
 */
export function taskSearchClause(term, alias = 't') {
  const raw = String(term || '').trim();
  const like = `%${raw}%`;
  const clauses = [
    `${alias}.title LIKE ?`,
    `${alias}.description LIKE ?`,
    `${alias}.task_code LIKE ?`,
  ];
  const params = [like, like, like];
  const numeric = raw.replace(/^#/, '').trim();
  if (/^\d+$/.test(numeric)) {
    clauses.push(`${alias}.id = ?`);
    params.push(Number(numeric));
  }
  return { sql: `(${clauses.join(' OR ')})`, params };
}

export function buildTaskFilter(q, user) {
  const where = [];
  const params = [];
  const and = (sql, ...vals) => { where.push(sql); params.push(...vals); };

  if (q.search) {
    const s = taskSearchClause(q.search);
    and(s.sql, ...s.params);
  }

  const multi = (key, col) => {
    const list = Array.isArray(q[key]) ? q[key] : q[key] ? [q[key]] : [];
    if (list.length && !list.includes('all')) and(`${col} IN (${list.map(() => '?').join(',')})`, ...list);
  };
  multi('status', 't.status');
  multi('priority', 't.priority');
  multi('difficulty', 't.difficulty');
  multi('team_id', 't.team_id');
  multi('department_id', 't.department_id');
  multi('created_by', 't.created_by');
  multi('reviewer', 't.reviewer_id');
  multi('task_type', 't.task_type');

  const assignee = Array.isArray(q.assignee) ? q.assignee : q.assignee ? [q.assignee] : [];
  if (assignee.length && !assignee.includes('all')) {
    const marks = assignee.map(() => '?').join(',');
    and(`t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id IN (${marks}))`, ...assignee);
  }

  const jsonContains = (key, col) => {
    const list = Array.isArray(q[key]) ? q[key] : q[key] ? [q[key]] : [];
    for (const v of list) and(`${col} LIKE ?`, `%"${v}"%`);
  };
  jsonContains('flag', 't.flags');
  jsonContains('tag', 't.tags');

  if (q.due_from) and('t.due_date >= ?', q.due_from);
  if (q.due_to) and('t.due_date <= ?', q.due_to);
  if (q.completed_from) and('t.completed_at >= ?', q.completed_from);
  if (q.completed_to) and('t.completed_at <= ?', q.completed_to);

  if (q.dateKey || (q.date_from && q.date_to) || (q.from && q.to)) {
    const custom = q.dateKey === 'custom' ? { from: q.date_from || q.from, to: q.date_to || q.to } : null;
    const range = dateRangeFromKey(q.dateKey, custom);
    and('t.created_at >= ? AND t.created_at <= ?', range.start, range.end);
  }

  const toggles = {
    overdueOnly: [`t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('done','cancelled')`, today()],
    pendingOnly: [`t.status IN ('todo','discussion')`],
    completedOnly: [`t.status = 'done'`],
    highPriority: [`t.priority IN ('high','critical')`],
    criticalOnly: [`t.priority = 'critical'`],
    archived: [`t.archived = 1`],
    active: [`t.archived = 0`],
    is_blocked: [`t.is_blocked = 1`],
    recurring: [`t.is_recurring = 1`],
    myTasks: [`t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)`, user.id],
  };
  for (const [flag, sql] of Object.entries(toggles)) {
    if (q[flag] === 'true' || q[flag] === '1' || q[flag] === true) and(...sql);
  }

  if (!isAdmin(user)) {
    and('(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))', user.id, user.id);
  }
  if (q.archived !== 'true' && q.archived !== '1') and('t.archived = 0');

  return { where, params };
}

/**
 * Daily tasks are stored in the tasks table but belong to the separate
 * "My Daily Task" module, so they are excluded from dashboard statistics.
 * They remain fully reachable through /api/daily-task.
 */
export function notDailyTaskSql(alias = 't') {
  return `(${alias}.daily_task_key = '' OR ${alias}.daily_task_key IS NULL)`;
}

export function scopeSql(f, alias = 't') {
  const notDaily = notDailyTaskSql(alias);
  return f.where.length ? `${f.where.join(' AND ')} AND ${notDaily}` : notDaily;
}
