import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, requireAdmin, isAdmin, hasPermission, audit, logHistory, notify } from '../middleware.js';
import { dateRangeFromKey, today, now, checkUserAvailability } from '../utils.js';
import { getStatusById, getPriorityById, getDifficultyById } from '../config.js';
import { updateProjectProgressForTask } from './projects.js';
import { isPastDailyTask, isDailyTaskRow } from '../services/dailyTaskService.js';
import { generateTaskCode } from '../services/taskCodeService.js';
import { taskSearchClause } from '../filters.js';
import { calculateTaskKpi, recordKpiTransaction } from '../services/kpiEngine.js';

const router = Router();
router.use(requireAuth);

function canViewTask(user, task, assignees) {
  if (isAdmin(user)) return true;
  if (task.created_by === user.id) return true;
  return (assignees || []).some((a) => a.user_id === user.id);
}

/**
 * A role can be limited to status-only updates by holding tasks.status
 * without tasks.edit (for example Branch Asst.). Such a user may move a task
 * through its workflow and log their own progress/time, but must not be able
 * to rewrite task details, checklists, dependencies, approvals, or assignees.
 * loadTask only checks assigneeship, so without this the write routes below
 * would stay reachable for any assignee regardless of their permissions.
 */
function isStatusOnly(user) {
  return hasPermission(user, 'tasks.status') && !hasPermission(user, 'tasks.edit');
}

// Status, own progress and own time logs.
const requireTaskWrite = requirePermission('tasks.edit', 'tasks.status');
// Full task detail editing: title, description, checklists, dependencies, approvals.
const requireTaskDetailWrite = requirePermission('tasks.edit');
// Changing who is on the task. tasks.edit is accepted because roles that could
// always reassign their own tasks keep that ability.
const requireTaskAssign = requirePermission('tasks.assign', 'tasks.edit');

/**
 * A completed task is locked: once it is done, only an admin may move it again.
 * This deliberately excludes daily tasks, which keep their own existing
 * current-date/previous-date freeze in isPastDailyTask() instead.
 */
function isLockedCompleted(t) {
  return !!t && t.status === 'done' && !isDailyTaskRow(t);
}

// 403 unless the caller may change a completed task's status. Kept in one place
// so the two status routes cannot drift apart in what they allow.
function canUnlockStatus(user, task) {
  if (!isLockedCompleted(task)) return true;
  if (isAdmin(user)) return true;
  return false;
}

// The creator of a task cannot mark it Done/Completed. The completion
// option locks for the creator automatically, while they may still
// assign users, edit task details, and update other task information.
// Self-tasks are exempt (the creator is the assignee), and admins keep
// an override so they can correct records.
function isCreatorLocked(user, task) {
  if (!user || !task) return false;
  if (isAdmin(user)) return false;
  if (task.is_self_task === 1) return false;
  return task.created_by === user.id;
}

function creatorLockedMessage() {
  return 'You created this task, so you cannot mark it as Done or Completed. Only an assigned user can complete it.';
}

function statusLockedMessage(task) {
  return 'This task is completed and its status is locked. Only an administrator can reopen, cancel or otherwise change it.';
}

function loadTask(req, res, next) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  // Past daily tasks are frozen. Reads (GET /:id) do not go through loadTask,
  // so their history and comments stay visible while every mutation is blocked.
  if (isPastDailyTask(t)) {
    return res.status(403).json({
      error: `This daily task is read-only. Only the current day's daily task can be changed (task date ${t.daily_task_date}).`,
    });
  }
  const assignees = fetchAssignees(t.id);
  if (!canViewTask(req.user, t, assignees)) return res.status(403).json({ error: 'No access to this task' });
  req.task = t;
  req.taskAssignees = assignees;
  next();
}

function safeParse(s, fallback) {
  try { return JSON.parse(s || '[]'); } catch { return fallback; }
}

function fetchAssignees(taskId) {
  return db.prepare(`
    SELECT ta.*, u.name AS user_name, u.avatar, u.team_id
    FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ? ORDER BY ta.assigned_at
  `).all(taskId);
}

function taskJson(t, withAssignees = true, counts = {}, assigneesMap = {}, mentionsSet = null) {
  const assignees = withAssignees ? (assigneesMap[t.id] || []) : [];
  const commentsCount = counts.comments?.[t.id] || 0;
  const checkCount = counts.checklist?.[t.id] || { c: 0, d: 0 };
  const attCount = counts.attachments?.[t.id] || 0;
  return {
    ...t,
    flags: safeParse(t.flags, []),
    tags: safeParse(t.tags, []),
    assignees,
    // Lets the UI mark the admin's own tasks without re-reading every comment.
    mentioned_me: mentionsSet ? (mentionsSet.has(t.id) ? 1 : 0) : 0,
    comments_count: commentsCount,
    checklist: { total: checkCount.c, done: checkCount.d || 0 },
    attachments_count: attCount,
    status_meta: getStatusById(t.status),
    priority_meta: getPriorityById(t.priority),
    difficulty_meta: getDifficultyById(t.difficulty),
  };
}

const sortMap = {
  due_date: 't.due_date',
  priority: 't.priority',
  status: 't.status',
  created: 't.created_at',
  updated: 't.updated_at',
  title: 't.title',
};

router.get('/', (req, res) => {
  const q = req.query;
  const role = req.user.role;
  const isAdminUser = isAdmin(req.user);

  const where = [];
  const params = [];
  const and = (sql, ...vals) => { where.push(sql); params.push(...vals); };

  if (q.search) {
    // Shared with the dashboard filter so both search Task ID and task #.
    const s = taskSearchClause(q.search);
    and(s.sql, ...s.params);
  }
  if (q.status) {
    const list = Array.isArray(q.status) ? q.status : [q.status];
    if (list.length && !list.includes('all')) {
      and(`t.status IN (${list.map(() => '?').join(',')})`, ...list);
    }
  }
  if (q.priority) {
    const list = Array.isArray(q.priority) ? q.priority : [q.priority];
    if (list.length && !list.includes('all')) and(`t.priority IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.difficulty) {
    const list = Array.isArray(q.difficulty) ? q.difficulty : [q.difficulty];
    if (list.length && !list.includes('all')) and(`t.difficulty IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.team_id) {
    const list = Array.isArray(q.team_id) ? q.team_id : [q.team_id];
    if (list.length && !list.includes('all')) and(`t.team_id IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.department_id) {
    const list = Array.isArray(q.department_id) ? q.department_id : [q.department_id];
    if (list.length && !list.includes('all')) and(`t.department_id IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.assignee) {
    const list = Array.isArray(q.assignee) ? q.assignee : [q.assignee];
    if (list.length && !list.includes('all')) {
      const marks = list.map(() => '?').join(',');
      and(`t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id IN (${marks}))`, ...list);
    }
  }
  if (q.created_by) {
    const list = Array.isArray(q.created_by) ? q.created_by : [q.created_by];
    if (list.length && !list.includes('all')) and(`t.created_by IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.reviewer) {
    const list = Array.isArray(q.reviewer) ? q.reviewer : [q.reviewer];
    if (list.length && !list.includes('all')) and(`t.reviewer_id IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.task_type) {
    const list = Array.isArray(q.task_type) ? q.task_type : [q.task_type];
    if (list.length && !list.includes('all')) and(`t.task_type IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.due_from) and('t.due_date >= ?', q.due_from);
  if (q.due_to) and('t.due_date <= ?', q.due_to);
  if (q.completed_from) and('t.completed_at >= ?', q.completed_from);
  if (q.completed_to) and('t.completed_at <= ?', q.completed_to);

  if (q.dateKey || (q.date_from && q.date_to)) {
    const range = dateRangeFromKey(q.dateKey, q.dateKey === 'custom' ? { from: q.date_from, to: q.date_to } : null);
    and('t.created_at >= ? AND t.created_at <= ?', range.start, range.end);
  }

  const truthy = ['overdueOnly', 'pendingOnly', 'completedOnly', 'highPriority', 'criticalOnly', 'archived', 'active', 'is_blocked', 'recurring', 'myTasks'];
  for (const flag of truthy) {
    if (q[flag] === 'true' || q[flag] === '1' || q[flag] === true) {
      if (flag === 'overdueOnly') and('t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN (\'done\',\'cancelled\')', today());
      if (flag === 'pendingOnly') and('t.status IN (\'todo\',\'discussion\')');
      if (flag === 'completedOnly') and('t.status = \'done\'');
      if (flag === 'highPriority') and('t.priority IN (\'high\',\'critical\')');
      if (flag === 'criticalOnly') and('t.priority = \'critical\'');
      if (flag === 'archived') and('t.archived = 1');
      if (flag === 'active') and('t.archived = 0');
      if (flag === 'is_blocked') and('t.is_blocked = 1');
      if (flag === 'recurring') and('t.is_recurring = 1');
      if (flag === 'myTasks') and('t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)', req.user.id);
    }
  }

  if (!isAdminUser) {
    and('(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))', req.user.id, req.user.id);
  }
  if (q.archived !== 'true' && q.archived !== '1') {
    and('t.archived = 0');
  }

  // Daily tasks are stored in the tasks table but belong to the separate
  // "My Daily Task" module, so they never appear in the main task list. They
  // stay fully reachable through /api/daily-task.
  and("(t.daily_task_key = '' OR t.daily_task_key IS NULL)");

  const sortCol = sortMap[q.sort] || 't.updated_at';
  const sortDir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(q.limit || '500'), 1000);

  let rows;
  try {
    rows = db.prepare(`
      SELECT t.*, c.name AS created_by_name, c.avatar AS creator_avatar,
        r.name AS reviewer_name, te.name AS team_name, d.name AS department_name,
        cb.name AS completed_by_name, cb.avatar AS completed_by_avatar,
        u2.name AS assigned_names
      FROM tasks t
      LEFT JOIN users c ON c.id = t.created_by
      LEFT JOIN users r ON r.id = t.reviewer_id
      LEFT JOIN users cb ON cb.id = t.completed_by
      LEFT JOIN teams te ON te.id = t.team_id
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN (SELECT ta.task_id, GROUP_CONCAT(u.name, ', ') AS name
        FROM task_assignees ta JOIN users u ON u.id = ta.user_id GROUP BY ta.task_id) u2 ON u2.task_id = t.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit}
    `).all(...params);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid filter combination' });
  }

  const flags = Array.isArray(q.flag) ? q.flag : q.flag ? [q.flag] : [];
  const tags = Array.isArray(q.tag) ? q.tag : q.tag ? [q.tag] : [];

  const ids = rows.map((r) => r.id);
  const counts = {
    comments: {},
    checklist: {},
    attachments: {},
  };
  const assigneesMap = {};
  const mentionsSet = new Set();

  if (ids.length) {
    const inIds = ids.map(() => '?').join(',');
    const comments = db.prepare(`SELECT task_id, COUNT(*) AS c FROM task_comments WHERE task_id IN (${inIds}) GROUP BY task_id`).all(...ids);
    comments.forEach((c) => { counts.comments[c.task_id] = c.c; });

    const checklist = db.prepare(`SELECT task_id, COUNT(*) AS c, COALESCE(SUM(done),0) AS d FROM task_checklist WHERE task_id IN (${inIds}) GROUP BY task_id`).all(...ids);
    checklist.forEach((c) => { counts.checklist[c.task_id] = { c: c.c, d: c.d }; });

    const attachments = db.prepare(`SELECT task_id, COUNT(*) AS c FROM task_attachments WHERE task_id IN (${inIds}) GROUP BY task_id`).all(...ids);
    attachments.forEach((a) => { counts.attachments[a.task_id] = a.c; });

    const assignees = db.prepare(`SELECT ta.*, u.name AS user_name, u.avatar, u.team_id FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id IN (${inIds}) ORDER BY ta.assigned_at`).all(...ids);
    assignees.forEach((a) => {
      if (!assigneesMap[a.task_id]) assigneesMap[a.task_id] = [];
      assigneesMap[a.task_id].push(a);
    });

    // Which of these tasks mention the current user in a comment. mentions holds
    // a JSON array of ids such as "[3,7]", so the brackets and spaces are
    // stripped and the result is comma-padded before a LIKE test. That keeps the
    // match on whole ids, so user 2 is not reported for a comment mentioning 29.
    // The pattern is bound as a whole string: concatenating a bound parameter
    // with || does not yield text in SQLite, so the match silently fails.
    const mentions = db.prepare(`
      SELECT DISTINCT task_id FROM task_comments
      WHERE task_id IN (${inIds})
        AND mentions IS NOT NULL AND mentions <> '' AND mentions <> '[]'
        AND (',' || REPLACE(REPLACE(REPLACE(mentions, '[', ''), ']', ''), ' ', '') || ',') LIKE ?
    `).all(...ids, `%,${req.user.id},%`);
    for (const m of mentions) mentionsSet.add(m.task_id);
  }

  let result = rows.map((t) => taskJson(t, true, counts, assigneesMap, mentionsSet));
  if (flags.length) {
    result = result.filter((t) => t.flags.some((f) => flags.includes(f)));
  }
  if (tags.length) {
    result = result.filter((t) => t.tags.some((f) => tags.includes(f)));
  }
  res.json(result);
});

router.get('/overview', (req, res) => {
  const isAdminUser = isAdmin(req.user);
  const uid = req.user.id;
  // Daily tasks are excluded here too, so the overview counts match the list.
  const scope = `${isAdminUser ? '1=1' : `(created_by = ${uid} OR id IN (SELECT task_id FROM task_assignees WHERE user_id = ${uid}))`} AND (daily_task_key = '' OR daily_task_key IS NULL)`;
  const num = (sql) => db.prepare(`SELECT COUNT(*) c FROM tasks t WHERE ${scope} AND ${sql}`).get().c;
  const data = {
    total: num('1=1'),
    open: num(`status NOT IN ('done','cancelled')`),
    done: num(`status = 'done'`),
    cancelled: num(`status = 'cancelled'`),
    overdue: num(`due_date IS NOT NULL AND due_date < '${today()}' AND status NOT IN ('done','cancelled')`),
    pending: num(`status IN ('todo','discussion')`),
    inProgress: num(`status = 'in_progress'`),
    inReview: num(`status = 'in_review'`),
    dueToday: num(`due_date = '${today()}' AND status NOT IN ('done','cancelled')`),
    blocked: num(`is_blocked = 1`),
    critical: num(`priority = 'critical' AND status NOT IN ('done','cancelled')`),
    completionRate: 0,
    doneToday: num(`status = 'done' AND date(completed_at) = '${today()}'`),
    avgCompletionHours: 0,
  };
  data.completionRate = data.total ? Math.round((data.done / data.total) * 100) : 0;
  const avg = db.prepare(`
    SELECT ROUND(AVG((julianday(completed_at) - julianday(created_at)) * 24), 1) v
    FROM tasks WHERE status = 'done' AND ${scope} AND completed_at IS NOT NULL
  `).get().v;
  data.avgCompletionHours = avg || 0;
  res.json(data);
});

router.get('/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, c.name AS created_by_name, c.avatar AS creator_avatar, r.name AS reviewer_name,
      te.name AS team_name, d.name AS department_name,
      cb.name AS completed_by_name, cb.avatar AS completed_by_avatar
    FROM tasks t
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN users r ON r.id = t.reviewer_id
    LEFT JOIN users cb ON cb.id = t.completed_by
    LEFT JOIN teams te ON te.id = t.team_id
    LEFT JOIN departments d ON d.id = t.department_id
    WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const assignees = fetchAssignees(t.id);
  if (!canViewTask(req.user, t, assignees)) return res.status(403).json({ error: 'No access to this task' });
  const comments = db.prepare(`
    SELECT tc.*, u.name AS user_name, u.avatar FROM task_comments tc
    JOIN users u ON u.id = tc.user_id WHERE tc.task_id = ? ORDER BY tc.created_at DESC
  `).all(t.id).map((c) => ({ ...c, mentions: safeParse(c.mentions, []) }));
  // The comments are already loaded here, so "am I mentioned" is a local test
  // rather than another query.
  const mentionsSet = new Set(
    comments.filter((c) => (c.mentions || []).some((m) => Number(m) === req.user.id)).map((c) => c.task_id),
  );
  const checklistItems = db.prepare('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY id').all(t.id);
  const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY uploaded_at DESC').all(t.id);
  const history = db.prepare(`
    SELECT th.*, u.name AS user_name FROM task_history th
    LEFT JOIN users u ON u.id = th.user_id WHERE th.task_id = ? ORDER BY th.created_at DESC LIMIT 100
  `).all(t.id);
  const deps = db.prepare(`
    SELECT td.depends_on, tt.title AS title, tt.status FROM task_dependencies td
    JOIN tasks tt ON tt.id = td.depends_on WHERE td.task_id = ?`).all(t.id);
  const dependents = db.prepare(`
    SELECT td.task_id, tt.title AS title FROM task_dependencies td
    JOIN tasks tt ON tt.id = td.task_id WHERE td.depends_on = ?`).all(t.id);
  const approvals = db.prepare(`
    SELECT a.*, u.name AS requester_name, u2.name AS approver_name FROM approvals a
    LEFT JOIN users u ON u.id = a.requester_id LEFT JOIN users u2 ON u2.id = a.approver_id
    WHERE a.task_id = ? ORDER BY a.created_at DESC`).all(t.id);
  const time = db.prepare(`
    SELECT te.*, u.name AS user_name FROM time_entries te
    JOIN users u ON u.id = te.user_id WHERE te.task_id = ? ORDER BY te.date DESC`).all(t.id);

  // The assignees are already loaded above for the access check, so hand them
  // to taskJson. Without this the detail payload always carried assignees: []
  // because taskJson only reads the map it is given.
  res.json({ ...taskJson(t, true, {}, { [t.id]: assignees }, mentionsSet), comments, checklist_items: checklistItems, attachments, history, dependencies: deps, dependents, approvals, time_entries: time });
});

router.post('/', requirePermission('tasks.create'), (req, res) => {
  const b = req.body || {};
  const required = ['title', 'status', 'priority'];
  for (const f of required) if (!b[f]) return res.status(400).json({ error: `${f} is required` });

  const flags = JSON.stringify(Array.isArray(b.flags) ? b.flags : []);
  const tags = JSON.stringify(Array.isArray(b.tags) ? b.tags : []);
  const isSelfTask = b.is_self_task ? 1 : 0;
  const assigneeIds = Array.isArray(b.assignees) ? [...new Set(b.assignees.map(Number).filter((n) => Number.isFinite(n)))] : [];
  const checklist = Array.isArray(b.checklist) ? b.checklist : [];
  if (isSelfTask) {
    assigneeIds.length = 0;
    assigneeIds.push(req.user.id);
  } else {
    // Prevent self-assignment: users cannot assign tasks to themselves
    if (assigneeIds.includes(req.user.id)) {
      return res.status(400).json({ error: 'You cannot assign a task to yourself' });
    }
  }

  // The Task ID is minted once here and never regenerated. A client-supplied
  // task_code is deliberately ignored so it cannot be chosen or reused.
  const taskCode = generateTaskCode('TSK');

  const r = db.prepare(`
    INSERT INTO tasks (
      title, description, status, priority, difficulty, task_type, flags, tags,
      budget, estimated_hours, due_date, start_date, created_by, reviewer_id, team_id, department_id,
      parent_task_id, progress, is_blocked, is_recurring, recurring_rule, is_self_task, project_id, task_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.title, b.description || '', b.status, b.priority, b.difficulty || 'medium', b.task_type || 'task',
    flags, tags, b.budget || 0, b.estimated_hours || 0, b.due_date || null, b.start_date || null,
    req.user.id, b.reviewer_id || null, b.team_id || null, b.department_id || null,
    b.parent_task_id || null, b.progress || 0, b.is_blocked ? 1 : 0, b.is_recurring ? 1 : 0, b.recurring_rule || '',
    isSelfTask,
    b.project_id || null,
    taskCode,
  );
  const taskId = Number(r.lastInsertRowid);

  // A task can be created straight into 'done'. Stamp the completion here too,
  // otherwise those tasks sit at done with no completer and no date -- the
  // status-change handlers never run for them.
  // The creator cannot complete a task they created (self-tasks
  // exempt, since the creator is the assignee).
  if (b.status === 'done' && !isSelfTask) {
    return res.status(403).json({ error: creatorLockedMessage(), creator_locked: true });
  }
  if (b.status === 'done') {
    db.prepare("UPDATE tasks SET completed_at = datetime('now','+6 hours'), completed_by = ?, progress = 100 WHERE id = ?").run(req.user.id, taskId);
    logHistory(taskId, req.user.id, 'task.completed', 'completed_by', '', req.user.name || String(req.user.id));
  }

  const addAssignee = db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, progress, status) VALUES (?, ?, ?, ?)
  `);
  for (const uid of assigneeIds) {
    // Check if user is available (not on leave or weekend)
    const availability = checkUserAvailability(uid, today());
    if (!availability.available) {
      return res.status(400).json({ error: availability.reason });
    }
    addAssignee.run(taskId, uid, b.status === 'done' ? 100 : (b.progress || 0), b.status);
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
    notify(uid, 'task', 'Task assigned to you', b.title, `/tasks/${taskId}`);
    logHistory(taskId, req.user.id, 'assignee.add', 'assignee', '', u?.name || '');
  }
  const addCheck = db.prepare('INSERT INTO task_checklist (task_id, title, created_by) VALUES (?, ?, ?)');
  for (const c of checklist) addCheck.run(taskId, c, req.user.id);

  audit(req, 'task.create', 'task', taskId, `Created task "${b.title}" (${taskCode})`);
  logHistory(taskId, req.user.id, 'task.create', 'title', '', b.title);
  res.json(taskJson(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)));
});

router.put('/:id', loadTask, requireTaskWrite, (req, res) => {
  const id = Number(req.params.id);
  const t = req.task;
  const b = req.body || {};
  const oldStatus = t.status;
  const oldDue = t.due_date;

  // task_code is the permanent identifier. It is absent from `updatable` below
  // so it can never be written, but reject it explicitly as well so a caller
  // gets a clear error instead of a silently ignored field.
  if (b.task_code !== undefined && b.task_code !== t.task_code) {
    return res.status(400).json({ error: 'Task ID cannot be changed' });
  }

  // Status-only roles may move a task through its workflow but must not send
  // any other field. Reject the whole request rather than silently dropping
  // fields, so a stale client cannot believe its edit was applied.
  if (isStatusOnly(req.user)) {
    const attempted = Object.keys(b).filter((k) => k !== 'status');
    if (attempted.length) {
      return res.status(403).json({
        error: `You can only update the task status. Not permitted: ${attempted.join(', ')}.`,
        required_permissions: ['tasks.status'],
      });
    }
    if (!b.status) return res.status(400).json({ error: 'status required' });
  }

  const updatable = ['title', 'description', 'status', 'priority', 'difficulty', 'task_type', 'flags', 'tags',
    'budget', 'estimated_hours', 'due_date', 'start_date', 'reviewer_id', 'team_id', 'department_id',
    'parent_task_id', 'is_blocked', 'is_recurring', 'recurring_rule', 'archived', 'project_id'];

  // The lock has to be enforced here as well as in POST /:id/status, because
  // PATCH can set status directly and would otherwise be an easy way around it.
  const patchStatus = b.status;
  const patchOverridesLock = patchStatus !== undefined
    && patchStatus !== t.status
    && !canUnlockStatus(req.user, t);
  if (patchOverridesLock) {
    return res.status(403).json({ error: statusLockedMessage(t), locked: true });
  }
  // The creator cannot mark a task they created as Done/Completed.
  // Self-tasks are exempt (the creator is the assignee). Admins may override.
  if (patchStatus === 'done' && isCreatorLocked(req.user, t)) {
    return res.status(403).json({ error: creatorLockedMessage(), creator_locked: true });
  }

  const sets = [];
  const params = [];
  for (const f of updatable) {
    if (b[f] !== undefined) {
      sets.push(`${f} = ?`);
      const raw = b[f];
      params.push(
        f === 'flags' || f === 'tags'
          ? JSON.stringify(Array.isArray(raw) ? raw : [])
          : typeof raw === 'object' && raw !== null
            ? JSON.stringify(raw)
            : typeof raw === 'boolean'
              ? (raw ? 1 : 0)
              : raw
      );
      if (f === 'status' && b[f] !== oldStatus) {
        logHistory(id, req.user.id, 'status.change', 'status', oldStatus, b[f]);
        // Same distinct override trail as POST /:id/status.
        if (isLockedCompleted(t)) {
          logHistory(id, req.user.id, 'status.override', 'status', oldStatus, b[f]);
          audit(req, 'task.status_override', 'task', id,
            `Admin overrode the completed-task lock: ${oldStatus} -> ${b[f]}`);
        }
        if (b[f] === 'done') {
          db.prepare('UPDATE tasks SET completed_at = datetime(\'now\',\'+6 hours\'), completed_by = ? WHERE id = ?').run(req.user.id, id);
          // Credit only this person, matching POST /:id/status. Editing the
          // status field must not pay out the whole pool to every assignee.
          db.prepare(`UPDATE task_assignees SET progress = 100, status = 'done', completed_at = datetime('now','+6 hours')
            WHERE task_id = ? AND user_id = ?`).run(id, req.user.id);
          logHistory(id, req.user.id, 'task.completed', 'completed_by', '', req.user.name || String(req.user.id));
        } else if (oldStatus === 'done') {
          db.prepare('UPDATE tasks SET completed_at = NULL, completed_by = NULL WHERE id = ?').run(id);
          db.prepare('UPDATE task_assignees SET completed_at = NULL, progress = 0, status = ? WHERE task_id = ? AND completed_at IS NOT NULL')
            .run(b[f], id);
        }
      }
      if (f === 'due_date' && b[f] !== oldDue) logHistory(id, req.user.id, 'due.change', 'due_date', oldDue, b[f]);
    }
  }
  if (b.assignees !== undefined) {
    const current = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((x) => x.user_id);
    const next = [...new Set((Array.isArray(b.assignees) ? b.assignees : []).map(Number).filter((n) => Number.isFinite(n)))];
    
    // Prevent self-assignment
    if (next.includes(req.user.id)) {
      return res.status(400).json({ error: 'You cannot assign a task to yourself' });
    }
    
    const toAdd = next.filter((x) => !current.includes(x));
    const toRemove = current.filter((x) => !next.includes(x));
    const del = db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?');
    for (const uid of toRemove) {
      del.run(id, uid);
      logHistory(id, req.user.id, 'assignee.remove', 'assignee', String(uid), '');
    }
    const add = db.prepare('INSERT INTO task_assignees (task_id, user_id, status) VALUES (?, ?, ?)');
    for (const uid of toAdd) {
      // Check if user is available (not on leave or weekend)
      const availability = checkUserAvailability(uid, today());
      if (!availability.available) {
        return res.status(400).json({ error: availability.reason });
      }
      add.run(id, uid, t.status);
      const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
      notify(uid, 'task', 'Task assigned to you', t.title, `/tasks/${id}`);
      logHistory(id, req.user.id, 'assignee.add', 'assignee', '', u?.name || '');
    }
  }

  sets.push('updated_at = datetime(\'now\',\'+6 hours\')');
  if (sets.length) db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (b.status !== undefined && b.status !== oldStatus) {
    try { updateProjectProgressForTask(id); } catch {}
  }
  audit(req, 'task.update', 'task', id, `Updated task "${b.title || t.title}"`);
  res.json(taskJson(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
});

router.delete('/:id', requirePermission('tasks.delete'), (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (isPastDailyTask(t)) {
    return res.status(403).json({
      error: `This daily task is read-only and cannot be deleted (task date ${t.daily_task_date}).`,
    });
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  audit(req, 'task.delete', 'task', id, `Deleted task "${t.title}"`);
  res.json({ ok: true });
});

router.post('/:id/assignees', loadTask, requireTaskAssign, (req, res) => {
  const id = Number(req.params.id);
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  
  // Prevent self-assignment
  if (user_id === req.user.id) {
    return res.status(400).json({ error: 'You cannot assign a task to yourself' });
  }
  
  // Check if user is available (not on leave or weekend)
  const availability = checkUserAvailability(user_id, today());
  if (!availability.available) {
    return res.status(400).json({ error: availability.reason });
  }
  db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(id, user_id);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(user_id);
  notify(user_id, 'task', 'Task assigned to you', db.prepare('SELECT title FROM tasks WHERE id=?').get(id).title, `/tasks/${id}`);
  audit(req, 'task.assignee_add', 'task', id, `Assigned ${u?.name} to task`);
  res.json({ ok: true });
});

router.delete('/:id/assignees/:userId', loadTask, requireTaskAssign, (req, res) => {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

router.post('/:id/assignees/add', loadTask, requireTaskAssign, (req, res) => {
  const id = Number(req.params.id);
  const { user_ids } = req.body || {};
  const ids = Array.isArray(user_ids) ? [...new Set(user_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))] : [];
  if (!ids.length) return res.status(400).json({ error: 'user_ids array required' });

  const isAssignee = (req.taskAssignees || []).some((a) => a.user_id === req.user.id);
  if (!isAssignee && !isAdmin(req.user) && req.task.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only assigned users or admins can add assignees' });
  }

  // Prevent self-assignment
  if (ids.includes(req.user.id)) {
    return res.status(400).json({ error: 'You cannot assign a task to yourself' });
  }

  const current = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((x) => x.user_id);
  const added = [];
  const add = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)');
  for (const uid of ids) {
    if (current.includes(uid)) continue;
    // Check if user is available (not on leave or weekend)
    const availability = checkUserAvailability(uid, today());
    if (!availability.available) {
      return res.status(400).json({ error: availability.reason });
    }
    add.run(id, uid);
    added.push(uid);
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
    notify(uid, 'task', 'Task assigned to you', req.task.title, `/tasks/${id}`);
    logHistory(id, req.user.id, 'assignee.add', 'assignee', '', u?.name || String(uid));
  }
  audit(req, 'task.assignee_add', 'task', id, `Added assignees: ${added.join(',')}`);
  res.json({ ok: true, added });
});

router.post('/:id/assignees/transfer', loadTask, requireTaskAssign, (req, res) => {
  const id = Number(req.params.id);
  const { user_ids } = req.body || {};
  const ids = Array.isArray(user_ids) ? [...new Set(user_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))] : [];
  if (!ids.length) return res.status(400).json({ error: 'user_ids array required' });

  // Prevent self-transfer: users cannot transfer tasks to themselves
  if (ids.includes(req.user.id)) {
    return res.status(400).json({ error: 'You cannot transfer a task to yourself' });
  }

  const isAssignee = (req.taskAssignees || []).some((a) => a.user_id === req.user.id);
  if (!isAssignee && !isAdmin(req.user) && req.task.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only assigned users or admins can transfer this task' });
  }

  const current = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((x) => x.user_id);
  const removed = [...current];
  db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(id);
  const add = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
  for (const uid of ids) {
    // Check if user is available (not on leave or weekend)
    const availability = checkUserAvailability(uid, today());
    if (!availability.available) {
      return res.status(400).json({ error: availability.reason });
    }
    add.run(id, uid);
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
    notify(uid, 'task', 'Task transferred to you', req.task.title, `/tasks/${id}`);
    logHistory(id, req.user.id, 'assignee.transfer', 'assignee', removed.join(','), u?.name || String(uid));
  }
  audit(req, 'task.assignee_transfer', 'task', id, `Transferred to ${ids.join(',')}`);
  res.json({ ok: true, transferred: ids, removed });
});

router.put('/:id/assignees/:userId/progress', loadTask, requireTaskWrite, (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  // A personal completion is what earns a share of the task's points, so
  // it is just as protected as the status itself: once the task is done, only
  // an admin may add or clear personal completions. Otherwise the lock could be
  // side-stepped and points could still be awarded on a completed task.
  if (isLockedCompleted(req.task) && !isAdmin(req.user)) {
    return res.status(403).json({ error: statusLockedMessage(req.task), locked: true });
  }
  const { progress } = req.body || {};
  // The creator cannot complete a task they created (self-tasks
  // exempt, since the creator is the assignee). Admins may override.
  const requested = Math.max(0, Math.min(100, Number(progress) || 0));
  if (requested >= 100 && isCreatorLocked(req.user, req.task)) {
    return res.status(403).json({ error: creatorLockedMessage(), creator_locked: true });
  }
  const a = db.prepare('SELECT * FROM task_assignees WHERE task_id = ? AND user_id = ?').get(id, userId);
  if (!a) return res.status(404).json({ error: 'Assignee not found' });
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  const newStatus = p >= 100 ? 'done' : a.status;
  db.prepare(`UPDATE task_assignees SET progress = ?, status = ?, completed_at = ? WHERE id = ?`)
    .run(p, newStatus, p >= 100 ? now() : null, a.id);
  db.prepare('UPDATE tasks SET updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?').run(id);
  if (p >= 100 && a.status !== 'done') {
    logHistory(id, req.user.id, 'assignee.complete', 'progress', a.progress, 100);
    notify(db.prepare('SELECT created_by FROM tasks WHERE id=?').get(id).created_by, 'task', 'Assignee completed task', `Progress for task updated`, `/tasks/${id}`);

    // Record KPI for assignee completion
    try {
      const t = req.task;
      const assigneeIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((r) => r.user_id);
      const kpiResult = calculateTaskKpi(t, userId, assigneeIds);
      for (const tx of kpiResult.transactions) {
        if (tx.userId === userId) {
          recordKpiTransaction({
            userId: tx.userId,
            userName: '',
            userEmail: '',
            taskId: id,
            taskTitle: t.title,
            taskCode: t.task_code,
            ruleKey: tx.ruleKey,
            ruleName: tx.ruleName,
            points: tx.points,
            configValue: tx.configValue,
            configEnabled: tx.configEnabled,
            reason: tx.reason,
            createdBy: req.user.id,
            createdByName: req.user.name,
          });
        }
      }
    } catch (err) {
      console.error('[KPI] Failed to record assignee completion KPI:', err);
    }
  } else {
    logHistory(id, req.user.id, 'progress.change', 'progress', a.progress, p);
  }
  res.json({ ok: true, progress: p, status: newStatus });
});

router.post('/:id/status', loadTask, requireTaskWrite, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const t = req.task;
  if (!status) return res.status(400).json({ error: 'status required' });
  // A completed task is locked against everyone but an admin. Checked before
  // any write so a rejected change cannot leave a half-applied task.
  if (status !== t.status && !canUnlockStatus(req.user, t)) {
    return res.status(403).json({ error: statusLockedMessage(t), locked: true });
  }
  // The creator cannot mark a task they created as Done/Completed.
  // Self-tasks are exempt (the creator is the assignee). Admins may override.
  if (status === 'done' && isCreatorLocked(req.user, t)) {
    return res.status(403).json({ error: creatorLockedMessage(), creator_locked: true });
  }
  const overridingLocked = isLockedCompleted(t) && status !== t.status;
  db.prepare('UPDATE tasks SET status = ?, updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?').run(status, id);
  db.prepare('UPDATE task_assignees SET status = ? WHERE task_id = ? AND status != \'done\'').run(status, id);
  // Only a genuine move to done stamps a completion. Re-saving a task that
  // is already done must not rewrite completed_at or re-credit the requester:
  // that would backdate an on-time completion to "now" (turning it into an
  // overdue one for KPI) and pay the completion bonus a second time.
  if (status === 'done' && t.status !== 'done') {
    db.prepare('UPDATE tasks SET completed_at = datetime(\'now\',\'+6 hours\'), completed_by = ?, progress = 100 WHERE id = ?').run(req.user.id, id);
    // Only the person who actually flipped the status is credited with having
    // completed their share. Completing every assignee here would give each of
    // them a personal completion, and points are paid per personal completion,
    // so the pool would be paid out once per assignee instead of once in total.
    db.prepare(`UPDATE task_assignees SET progress = 100, status = 'done', completed_at = datetime('now','+6 hours')
      WHERE task_id = ? AND user_id = ?`).run(id, req.user.id);
    logHistory(id, req.user.id, 'task.completed', 'completed_by', '', req.user.name || String(req.user.id));

    // Record KPI transactions for task completion
    try {
      const assigneeIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((r) => r.user_id);
      const kpiResult = calculateTaskKpi(t, req.user.id, assigneeIds);
      for (const tx of kpiResult.transactions) {
        recordKpiTransaction({
          userId: tx.userId,
          userName: '',
          userEmail: '',
          taskId: id,
          taskTitle: t.title,
          taskCode: t.task_code,
          ruleKey: tx.ruleKey,
          ruleName: tx.ruleName,
          points: tx.points,
          configValue: tx.configValue,
          configEnabled: tx.configEnabled,
          reason: tx.reason,
          createdBy: req.user.id,
          createdByName: req.user.name,
        });
      }
    } catch (err) {
      console.error('[KPI] Failed to record task completion KPI:', err);
    }
  } else if (status !== 'done') {
    // Reopening clears the completer too, otherwise the task would keep
    // claiming someone finished it. A no-op re-save of an already-done
    // task falls through here untouched.
    db.prepare('UPDATE tasks SET completed_at = NULL, completed_by = NULL WHERE id = ?').run(id);
    // A reopened task must also stop paying anyone who had completed it,
    // otherwise the points would stay standing against undone work.
    db.prepare('UPDATE task_assignees SET completed_at = NULL, progress = 0, status = ? WHERE task_id = ? AND completed_at IS NOT NULL')
      .run(status, id);
  }
  logHistory(id, req.user.id, 'status.change', 'status', t.status, status);
  // An admin moving an already-completed task is a deliberate override, not an
  // ordinary status change, so it gets its own trail. task_history records the
  // acting user and a created_at timestamp, which is the user/date/time audit.
  if (overridingLocked) {
    logHistory(id, req.user.id, 'status.override', 'status', t.status, status);
    audit(req, 'task.status_override', 'task', id,
      `Admin overrode the completed-task lock: ${t.status} -> ${status}`);
  }
  audit(req, 'task.status_change', 'task', id, `Moved task "${t.title}" to ${status}`);
  try { updateProjectProgressForTask(id); } catch {}
  res.json({ ok: true });
});

router.post('/:id/comments', loadTask, (req, res) => {
  const id = Number(req.params.id);
  const { content, mentions } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Comment content required' });
  
  // Prevent self-mention: users cannot mention themselves
  const mentionIds = Array.isArray(mentions) ? mentions.map(Number).filter((n) => Number.isFinite(n)) : [];
  if (mentionIds.includes(req.user.id)) {
    return res.status(400).json({ error: 'You cannot mention yourself' });
  }
  
  const r = db.prepare('INSERT INTO task_comments (task_id, user_id, content, mentions) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, content, JSON.stringify(Array.isArray(mentions) ? mentions : []));
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  logHistory(id, req.user.id, 'comment.add', 'comment', '', content.slice(0, 100));
  const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id);
  const seen = new Set();
  for (const a of [...assignees, ...(Array.isArray(mentions) ? mentions.map((m) => ({ user_id: m })) : [])]) {
    if (a.user_id === req.user.id || seen.has(a.user_id)) continue;
    seen.add(a.user_id);
    notify(a.user_id, 'comment', 'New comment on task', `${req.user.name}: ${content.slice(0, 80)}`, `/tasks/${id}`);
  }
  audit(req, 'task.comment', 'task', id, `Commented on "${t.title}"`);
  const row = db.prepare('SELECT tc.*, u.name AS user_name, u.avatar FROM task_comments tc JOIN users u ON u.id = tc.user_id WHERE tc.id = ?').get(Number(r.lastInsertRowid));
  res.json({ ...row, mentions: mentions || [] });
});

router.post('/:id/checklist', loadTask, requireTaskDetailWrite, (req, res) => {
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO task_checklist (task_id, title, created_by) VALUES (?, ?, ?)')
    .run(req.params.id, title, req.user.id);
  res.json(db.prepare('SELECT * FROM task_checklist WHERE id = ?').get(Number(r.lastInsertRowid)));
});

router.put('/:id/checklist/:cid', loadTask, requireTaskDetailWrite, (req, res) => {
  const c = db.prepare('SELECT * FROM task_checklist WHERE id = ?').get(req.params.cid);
  if (!c) return res.status(404).json({ error: 'Checklist item not found' });
  const { done, title } = req.body || {};
  db.prepare('UPDATE task_checklist SET done = ?, title = COALESCE(?, title) WHERE id = ?')
    .run(done !== undefined ? (done ? 1 : 0) : c.done, title ?? null, c.id);
  const total = db.prepare('SELECT COUNT(*) c FROM task_checklist WHERE task_id = ?').get(c.task_id).c;
  const d = db.prepare('SELECT COALESCE(SUM(done),0) c FROM task_checklist WHERE task_id = ?').get(c.task_id).c;
  const pct = total ? Math.round((d / total) * 100) : 0;
  db.prepare('UPDATE tasks SET progress = ?, updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ? AND status NOT IN (\'done\',\'cancelled\')').run(pct, c.task_id);
  res.json(db.prepare('SELECT * FROM task_checklist WHERE id = ?').get(c.id));
});

router.delete('/:id/checklist/:cid', loadTask, requireTaskDetailWrite, (req, res) => {
  db.prepare('DELETE FROM task_checklist WHERE id = ?').run(req.params.cid);
  res.json({ ok: true });
});

router.post('/:id/dependencies', loadTask, requireTaskDetailWrite, (req, res) => {
  const { depends_on } = req.body || {};
  if (!depends_on) return res.status(400).json({ error: 'depends_on required' });
  db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)').run(req.params.id, depends_on);
  res.json({ ok: true });
});

router.delete('/:id/dependencies/:dep', loadTask, requireTaskDetailWrite, (req, res) => {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?').run(req.params.id, req.params.dep);
  res.json({ ok: true });
});

router.post('/:id/approvals', loadTask, requireTaskDetailWrite, (req, res) => {
  const { approver_id, comment } = req.body || {};
  if (!approver_id) return res.status(400).json({ error: 'approver_id required' });
  const r = db.prepare('INSERT INTO approvals (task_id, requester_id, approver_id, comment) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.user.id, approver_id, comment || '');
  db.prepare('UPDATE tasks SET approval_status = \'pending\' WHERE id = ?').run(req.params.id);
  notify(approver_id, 'approval', 'Approval requested', `Your approval is requested for a task`, `/tasks/${req.params.id}`);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

router.post('/:id/approvals/:aid', loadTask, requireTaskDetailWrite, (req, res) => {
  const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(req.params.aid);
  if (!a) return res.status(404).json({ error: 'Approval not found' });
  if (a.task_id !== Number(req.params.id)) return res.status(400).json({ error: 'Approval does not belong to this task' });
  const { status, comment } = req.body || {};
  db.prepare('UPDATE approvals SET status = ?, comment = COALESCE(?, comment), updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?')
    .run(status || 'approved', comment ?? null, a.id);
  const pending = db.prepare('SELECT COUNT(*) c FROM approvals WHERE task_id = ? AND status = \'pending\'').get(a.task_id).c;
  db.prepare('UPDATE tasks SET approval_status = ?, updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?')
    .run(pending ? 'pending' : (status || 'approved'), a.task_id);
  notify(a.requester_id, 'approval', 'Approval updated', `Your approval request was ${status}`, `/tasks/${a.task_id}`);
  res.json({ ok: true });
});

router.post('/:id/time', loadTask, requireTaskWrite, (req, res) => {
  const { hours, note, date } = req.body || {};
  if (hours === undefined || hours === null || isNaN(Number(hours))) return res.status(400).json({ error: 'hours required' });
  const r = db.prepare('INSERT INTO time_entries (task_id, user_id, hours, note, date) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.id, Number(hours), note || '', date || today());
  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(Number(r.lastInsertRowid)));
});

export default router;
