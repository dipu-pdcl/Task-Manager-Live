import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, hasPermission, audit, notify } from '../middleware.js';
import { today } from '../utils.js';
import {
  getTemplates,
  getMembers,
  reconcileDailyTaskAwards,
  ensureDailyTasks,
  invalidateGenerationCache,
  isPastDailyTask,
  getDailyMissPenalty,
  templatePoints,
} from '../services/dailyTaskService.js';

const router = Router();
router.use(requireAuth);

const canManage = requirePermission('daily_task.manage');

function parseBodyDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : today();
}

/** Everything the page needs for a given day, scoped to the caller. */
function buildOverview(dateStr, userId) {
  const templates = getTemplates();
  const templatesById = new Map(templates.map((t) => [t.key, t]));
  const dayStr = today();
  const readOnly = dateStr < dayStr;

  const rows = db.prepare(`
    SELECT dt.id, dt.task_code, dt.title, dt.status, dt.priority, dt.due_date, dt.completed_at,
           dt.template_key AS daily_task_key, dt.task_date AS daily_task_date, dt.user_id,
           a.points AS awarded_points,
           (SELECT COUNT(*) FROM daily_task_comments dc WHERE dc.task_id = dt.id) AS comments_count
    FROM daily_tasks dt
    LEFT JOIN daily_task_awards a ON a.task_id = dt.id AND a.user_id = dt.user_id
    WHERE dt.task_date = ?
    ORDER BY dt.user_id, (SELECT sort_order FROM daily_task_templates tpl WHERE tpl.key = dt.template_key)
  `).all(dateStr);

  const pointsFor = (t) => (t.awarded_points != null ? t.awarded_points : templatesById.get(t.daily_task_key)?.points ?? templatePoints());

  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, { user_id: r.user_id, tasks: [], done: 0, missed: 0, points: 0 });
    }
    const bucket = byUser.get(r.user_id);
    const done = r.status === 'done';
    const missed = !done && dateStr < dayStr;
    // Net contribution: +template points when completed, -1 when a past day
    // was left unfinished, 0 while the day is still open.
    const points = done ? pointsFor(r) : missed ? getDailyMissPenalty() : 0;
    bucket.tasks.push({
      id: r.id,
      title: r.title,
      key: r.daily_task_key,
      status: r.status,
      due_date: r.due_date,
      completed_at: r.completed_at,
      done,
      missed,
      readOnly,
      comments_count: r.comments_count || 0,
      points,
    });
    if (done) bucket.done++;
    else if (missed) bucket.missed++;
    bucket.points += points;
  }

  return { byUser, rows, templates };
}

// --- Viewer: my daily tasks -------------------------------------------------

router.get('/me', (req, res) => {
  const dateStr = parseBodyDate(req.query.date);
  const dayStr = today();
  const readOnly = dateStr < dayStr;
  const { rows, templates } = buildOverview(dateStr, req.user.id);
  const mine = rows.filter((r) => r.user_id === req.user.id);
  const enabled = templates.filter((t) => t.enabled);
  const done = mine.filter((r) => r.status === 'done');
  const pointsFor = (r) => {
    const award = r.awarded_points;
    if (award != null) return award;
    return templates.find((t) => t.key === r.daily_task_key)?.points ?? templatePoints();
  };
  res.json({
    ok: true,
    date: dateStr,
    readOnly,
    isMember: getMembers().some((m) => m.user_id === req.user.id),
    tasks: mine.map((r) => {
      const isDone = r.status === 'done';
      const isMissed = !isDone && readOnly;
      return {
        id: r.id,
        task_code: r.task_code,
        title: r.title,
        key: r.daily_task_key,
        status: r.status,
        due_date: r.due_date,
        completed_at: r.completed_at,
        done: isDone,
        missed: isMissed,
        readOnly,
        comments_count: r.comments_count || 0,
        points: isDone ? pointsFor(r) : isMissed ? getDailyMissPenalty() : 0,
      };
    }),
    total: enabled.length,
    completed: done.length,
    points: mine.reduce((s, r) => s + (r.status === 'done' ? pointsFor(r) : readOnly ? getDailyMissPenalty() : 0), 0),
    maxPoints: enabled.reduce((s, t) => s + (t.points ?? templatePoints()), 0),
  });
});

// --- Admin: group membership ------------------------------------------------

router.get('/members', canManage, (req, res) => {
  res.json({ ok: true, members: getMembers() });
});

router.get('/candidates', canManage, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.title, u.is_active,
           t.name AS team_name, d.name AS department_name
    FROM users u
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.name
  `).all();
  res.json({ ok: true, users: rows });
});

router.post('/members', canManage, (req, res) => {
  const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [req.body?.user_id];
  const clean = [...new Set(ids.map(Number).filter(Number.isFinite))];
  if (clean.length === 0) return res.status(400).json({ error: 'user_ids is required' });

  const users = db.prepare(`SELECT id, name FROM users WHERE id IN (${clean.map(() => '?').join(',')})`).all(...clean);
  if (users.length !== clean.length) return res.status(400).json({ error: 'One or more users were not found' });

  const add = db.prepare('INSERT OR IGNORE INTO daily_task_members (user_id, added_by) VALUES (?, ?)');
  let added = 0;
  for (const u of users) {
    const r = add.run(u.id, req.user.id);
    if (r.changes > 0) {
      added++;
      notify(u.id, 'task', 'Added to Daily Task group', 'You will now receive the daily tasks automatically', '/daily-task');
    }
  }
  if (added > 0) {
    invalidateGenerationCache();
    ensureDailyTasks();
  }
  audit(req, 'daily_task.members_add', 'daily_task_members', null, `Added ${added} user(s) to the Daily Task group`);
  res.json({ ok: true, added, members: getMembers() });
});

router.delete('/members/:userId', canManage, (req, res) => {
  const userId = Number(req.params.userId);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const r = db.prepare('DELETE FROM daily_task_members WHERE user_id = ?').run(userId);
  audit(req, 'daily_task.members_remove', 'daily_task_members', userId, `Removed ${u.name} from the Daily Task group`);
  res.json({ ok: true, removed: r.changes, members: getMembers() });
});

// --- Admin: templates -------------------------------------------------------

router.get('/templates', canManage, (req, res) => {
  res.json({ ok: true, templates: getTemplates() });
});

/** Slugify a template name into a stable unique key. */
function slugifyKey(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'task';
  let key = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM daily_task_templates WHERE key = ?').get(key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

router.post('/templates', canManage, (req, res) => {
  const name = (req.body?.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'Task name is required' });
  const description = (req.body?.description ?? '').toString();
  const points = Math.max(0, Math.min(100, Number(req.body?.points ?? templatePoints()) || 0));
  const enabled = req.body?.enabled === undefined ? 1 : (req.body.enabled ? 1 : 0);
  const key = slugifyKey(name);

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM daily_task_templates').get().m;
  const r = db.prepare(`
    INSERT INTO daily_task_templates (key, name, description, enabled, points, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(key, name, description, enabled, points, maxOrder + 1);

  if (enabled) {
    invalidateGenerationCache();
    ensureDailyTasks();
  }
  reconcileDailyTaskAwards();
  const template = db.prepare('SELECT * FROM daily_task_templates WHERE id = ?').get(Number(r.lastInsertRowid));
  audit(req, 'daily_task.template_create', 'daily_task_template', template.id, `Created daily task "${name}" (points=${points}, enabled=${enabled})`);
  res.status(201).json({ ok: true, template, templates: getTemplates() });
});

router.put('/templates/:id', canManage, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM daily_task_templates WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Template not found' });

  const name = (req.body?.name ?? t.name).toString().trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const description = req.body?.description ?? t.description;
  const enabled = req.body?.enabled === undefined ? t.enabled : (req.body.enabled ? 1 : 0);
  const points = req.body?.points === undefined ? t.points : Math.max(0, Math.min(100, Number(req.body.points) || 0));

  db.prepare(`
    UPDATE daily_task_templates
    SET name = ?, description = ?, enabled = ?, points = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ?
  `).run(name, description, enabled, points, id);

  if (enabled !== t.enabled) {
    invalidateGenerationCache();
    ensureDailyTasks();
    if (!enabled) {
      db.prepare(`
        DELETE FROM daily_task_awards WHERE task_id IN (
          SELECT id FROM daily_tasks WHERE template_key = ? AND task_date = ? AND status <> 'done'
        )
      `).run(t.key, today());
      db.prepare(`
        UPDATE daily_tasks SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
        WHERE template_key = ? AND task_date = ? AND status <> 'done'
      `).run(t.key, today());
    } else {
      // Re-enabling must restore today's tasks. The unique constraint means the row
      // still exists from before the disable, so generation alone will not
      // recreate it; lift the cancellation instead.
      db.prepare(`
        UPDATE daily_tasks SET status = 'todo', updated_at = datetime('now', '+6 hours')
        WHERE template_key = ? AND task_date = ? AND status = 'cancelled'
      `).run(t.key, today());
    }
  }
  reconcileDailyTaskAwards();
  audit(req, 'daily_task.template_update', 'daily_task_template', id, `Updated daily task "${name}" (enabled=${enabled}, points=${points})`);
  res.json({ ok: true, template: db.prepare('SELECT * FROM daily_task_templates WHERE id = ?').get(id) });
});

// Deleting a template removes it from future generation only. Tasks it already
// generated are real work records, and their KPI awards are history, so they
// are deliberately left in place: today still shows them, marked cancelled if
// they were never finished. Only today's unfinished ones are tidied away, the
// same way disabling a template does, so nobody is left with a live task that
// can no longer be completed.
router.delete('/templates/:id', canManage, (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM daily_task_templates WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Template not found' });

  const day = today();
  db.prepare(`
    DELETE FROM daily_task_awards WHERE task_id IN (
      SELECT id FROM daily_tasks WHERE template_key = ? AND task_date = ? AND status <> 'done'
    )
  `).run(t.key, day);
  db.prepare(`
    UPDATE daily_tasks SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE template_key = ? AND task_date = ? AND status <> 'done'
  `).run(t.key, day);

  db.prepare('DELETE FROM daily_task_templates WHERE id = ?').run(id);

  invalidateGenerationCache();
  reconcileDailyTaskAwards();
  audit(req, 'daily_task.template_delete', 'daily_task_template', id,
    `Deleted daily task "${t.name}" (key=${t.key}); completed history kept`);
  res.json({ ok: true, templates: getTemplates() });
});

// --- Admin: monitoring ------------------------------------------------------

router.get('/overview', canManage, (req, res) => {
  const dateStr = parseBodyDate(req.query.date);
  const { byUser } = buildOverview(dateStr, null);
  const members = getMembers();
  const summary = { assigned: 0, done: 0, missed: 0, points: 0 };

  const rows = members.map((m) => {
    const b = byUser.get(m.user_id) || { tasks: [], done: 0, missed: 0, points: 0 };
    summary.assigned += b.tasks.length;
    summary.done += b.done;
    summary.missed += b.missed;
    summary.points += b.points;
    return {
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      is_active: m.is_active,
      done: b.done,
      missed: b.missed,
      pending: b.tasks.length - b.done - b.missed,
      points: b.points,
      tasks: b.tasks,
    };
  });

  res.json({ ok: true, date: dateStr, summary, users: rows, templates: getTemplates() });
});

// --- Comments ----------------------------------------------------------------

/**
 * Comments live in the dedicated daily_task_comments table.
 * Past-day daily tasks are readable but not writable.
 */
function loadDailyTaskForComments(req, res, next) {
  const t = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Daily task not found' });
  const member = db.prepare('SELECT 1 FROM daily_task_members WHERE user_id = ?').get(req.user.id);
  const owns = t.user_id === req.user.id;
  if (!owns && !member) {
    return res.status(403).json({ error: 'You can only comment on your own daily tasks' });
  }
  req.dailyTask = t;
  next();
}

router.get('/:id/comments', loadDailyTaskForComments, (req, res) => {
  const rows = db.prepare(`
    SELECT dc.id, dc.content, dc.created_at, u.id AS user_id, u.name AS user_name, u.avatar
    FROM daily_task_comments dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.task_id = ?
    ORDER BY dc.created_at ASC, dc.id ASC
  `).all(req.params.id);
  res.json({ ok: true, readOnly: isPastDailyTask(req.dailyTask), comments: rows });
});

router.post('/:id/comments', loadDailyTaskForComments, (req, res) => {
  const t = req.dailyTask;
  // "Previous task comments remain visible but cannot be edited."
  if (isPastDailyTask(t)) {
    return res.status(403).json({
      error: `This daily task is read-only. Only the current day's daily task can be commented on (task date ${t.task_date}).`,
    });
  }
  const content = (req.body?.content || '').toString().trim();
  if (!content) return res.status(400).json({ error: 'Comment content is required' });
  if (content.length > 2000) return res.status(400).json({ error: 'Comment is too long (max 2000 characters)' });

  const r = db.prepare('INSERT INTO daily_task_comments (task_id, user_id, content, mentions) VALUES (?, ?, ?, ?)')
    .run(t.id, req.user.id, content, '[]');
  db.prepare('INSERT INTO daily_task_history (task_id, user_id, action, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.id, req.user.id, 'comment.add', 'comment', '', content.slice(0, 100));

  const row = db.prepare(`
    SELECT dc.id, dc.content, dc.created_at, u.id AS user_id, u.name AS user_name, u.avatar
    FROM daily_task_comments dc JOIN users u ON u.id = dc.user_id WHERE dc.id = ?
  `).get(Number(r.lastInsertRowid));
  res.status(201).json({ ok: true, readOnly: false, comment: row });
});

// --- Complete / reopen --------------------------------------------------------

/**
 * Mark the current day's daily task done, or reopen it. The assignee
 * may change their own task; daily_task.manage may change anyone's.
 * Past days are frozen: only the current day's task can be changed.
 */
router.post('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Daily task not found' });

  if (isPastDailyTask(t)) {
    return res.status(403).json({
      error: `This daily task is read-only. Only the current day's daily task can be changed (task date ${t.task_date}).`,
    });
  }

  const isOwner = t.user_id === req.user.id;
  const canManage = hasPermission(req.user, 'daily_task.manage');
  if (!isOwner && !canManage) {
    return res.status(403).json({ error: 'You can only change your own daily tasks' });
  }

  const status = (req.body?.status || '').toString();
  if (!['todo', 'in_progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'status must be one of todo, in_progress, done' });
  }

  if (status === 'done') {
    db.prepare(`
      UPDATE daily_tasks SET status = 'done', progress = 100,
        completed_at = datetime('now', '+6 hours'), completed_by = ?,
        updated_at = datetime('now', '+6 hours')
      WHERE id = ?
    `).run(req.user.id, id);
    db.prepare(`
      INSERT INTO daily_task_history (task_id, user_id, action, field, old_value, new_value)
      VALUES (?, ?, 'daily_task.complete', 'status', ?, 'done')
    `).run(id, req.user.id, t.status);
  } else {
    db.prepare(`
      UPDATE daily_tasks SET status = ?, progress = 0,
        completed_at = NULL, completed_by = NULL,
        updated_at = datetime('now', '+6 hours')
      WHERE id = ?
    `).run(status, id);
    db.prepare(`
      INSERT INTO daily_task_history (task_id, user_id, action, field, old_value, new_value)
      VALUES (?, ?, 'daily_task.reopen', 'status', ?, ?)
    `).run(id, req.user.id, t.status, status);
  }

  // Awards are a pure function of completion state, so reconciling
  // after every change keeps them in step: completing earns the
  // template points, reopening removes them again.
  reconcileDailyTaskAwards();

  const updated = db.prepare(`
    SELECT dt.*,
      (SELECT COUNT(*) FROM daily_task_comments dc WHERE dc.task_id = dt.id) AS comments_count,
      a.points AS awarded_points
    FROM daily_tasks dt
    LEFT JOIN daily_task_awards a ON a.task_id = dt.id AND a.user_id = dt.user_id
    WHERE dt.id = ?
  `).get(id);

  audit(req, 'daily_task.status', 'daily_tasks', id, `Daily task "${t.title}" status -> ${status}`);
  res.json({ ok: true, task: updated });
});

export default router;
