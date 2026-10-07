import { db } from '../db.js';
import { today, BD_OFFSET_MS } from '../utils.js';
import { generateTaskCode } from './taskCodeService.js';
import { getKpiRule } from './kpiEngine.js';

/**
 * Daily Task service.
 *
 * Generates the configured daily task templates as real task rows assigned to
 * every member of the Daily Task group, and keeps the KPI award table in sync
 * with completion state.
 *
 * Idempotency: a partial unique index on
 * tasks(daily_task_key, daily_task_date, daily_task_user_id) guarantees at most
 * one task per template/day/user, so re-running generation can never duplicate.
 *
 * KPI: daily_task_awards has UNIQUE(task_id, user_id). Awards are reconciled to
 * "the set of daily tasks that are currently done", which makes double counting
 * structurally impossible: a task that is reopened loses its award, and can only
 * regain it by being completed again.
 */

let generating = false;
let reconciling = false;

/** Default points for daily task completion (can be overridden per template) */
const DEFAULT_DAILY_POINTS = 2;

/** Default penalty for missed daily task */
const DEFAULT_MISS_PENALTY = -1;

/** Get the daily task completion points from KPI config. */
export function getDailyTaskPoints() {
  return getKpiRule('daily_task_complete');
}

/** Get the daily task miss penalty from KPI config. */
export function getDailyMissPenalty() {
  return getKpiRule('daily_task_overdue');
}

/** Get the default points for a daily task template (fallback when not specified) */
export function templatePoints(points) {
  return points == null || points === '' ? getDailyTaskPoints() : points;
}

export function isDailyTaskRow(t) {
  return !!(t && t.daily_task_key && t.daily_task_key !== '');
}

/**
 * A daily task is frozen once its date has passed: only the current day's task
 * may be edited. Everything else about it (status, fields, comments) is
 * read-only from midnight onwards.
 */
export function isPastDailyTask(t) {
  return isDailyTaskRow(t) && !!t.daily_task_date && t.daily_task_date < today();
}

export function getTemplates() {
  return db.prepare(`
    SELECT id, key, name, description, enabled, points, sort_order
    FROM daily_task_templates
    ORDER BY sort_order, id
  `).all();
}

export function getMemberIds() {
  return db.prepare('SELECT user_id FROM daily_task_members ORDER BY user_id').all().map((r) => r.user_id);
}

export function getMembers() {
  return db.prepare(`
    SELECT m.user_id, m.added_by, m.created_at,
           u.name, u.email, u.role, u.title, u.is_active
    FROM daily_task_members m
    JOIN users u ON u.id = m.user_id
    ORDER BY u.name
  `).all();
}

/**
 * Create today's task rows for every enabled template and every group member.
 * @param {string} dateStr YYYY-MM-DD (BD timezone), defaults to today
 */
export function generateDailyTasks(dateStr = today()) {
  if (generating) return { skipped: true, reason: 'already running' };
  generating = true;
  let created = 0;
  try {
    const templates = db.prepare(`
      SELECT key, name, description, points FROM daily_task_templates
      WHERE enabled = 1 ORDER BY sort_order, id
    `).all();
    const members = db.prepare(`
      SELECT m.user_id, u.name, u.team_id, u.department_id
      FROM daily_task_members m
      JOIN users u ON u.id = m.user_id
      WHERE u.is_active = 1
    `).all();

    const insert = db.prepare(`
      INSERT OR IGNORE INTO tasks (
        title, description, status, priority, difficulty, task_type, flags, tags,
        estimated_hours, due_date, start_date, created_by, team_id, department_id,
        progress, is_recurring, recurring_rule, project_id, task_code,
        daily_task_key, daily_task_date, daily_task_user_id
      ) VALUES (?, ?, 'todo', 'medium', 'medium', 'task', '[]', '["daily"]',
        0, ?, ?, 1, ?, ?, 0, 1, 'daily', NULL, ?, ?, ?, ?)
    `);
    const addAssignee = db.prepare(`
      INSERT OR IGNORE INTO task_assignees (task_id, user_id, progress, status)
      VALUES (?, ?, 0, 'todo')
    `);
    const addHistory = db.prepare(`
      INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
      VALUES (?, 1, 'daily_task.generate', 'title', '', ?)
    `);
    const exists = db.prepare(`
      SELECT id FROM tasks
      WHERE daily_task_key = ? AND daily_task_date = ? AND daily_task_user_id = ?
    `);

    for (const t of templates) {
      for (const m of members) {
        if (exists.get(t.key, dateStr, m.user_id)) continue;
        // Minted per row, only for genuinely new tasks, so the daily generator
        // (up to ~100 rows/day) does not waste codes on already-existing ones.
        const res = insert.run(
          t.name,
          t.description || '',
          dateStr,
          dateStr,
          m.team_id ?? null,
          m.department_id ?? null,
          generateTaskCode('TSK'),
          t.key,
          dateStr,
          m.user_id,
        );
        if (res.changes > 0) {
          created++;
          const taskId = Number(res.lastInsertRowid);
          addAssignee.run(taskId, m.user_id);
          addHistory.run(taskId, t.name);
        }
      }
    }
    if (created > 0) console.log(`[DailyTask] Generated ${created} task(s) for ${dateStr}`);
  } finally {
    generating = false;
  }
  return { created, date: dateStr };
}

/**
 * Reconcile KPI awards against completion state.
 *
 * Awards are a pure function of completion state, which is what makes double
 * counting impossible:
 *   - done today or later  -> award the template's points
 *   - done on a past day   -> award the template's points (completed_at date)
 *   - not done, past day   -> award the configured miss penalty
 *   - not done, today/future -> no award at all (still chance to earn it)
 *
 * Reopening a task removes its award; completing it restores the award. A task
 * that rolls into "past day" without being done is granted exactly one negative
 * award, because UNIQUE(task_id, user_id) blocks a second one.
 */
export function reconcileDailyTaskAwards() {
  if (reconciling) return { skipped: true, reason: 'already running' };
  reconciling = true;
  let granted = 0;
  let revoked = 0;
  let penalised = 0;
  try {
    const pointsFor = new Map(
      db.prepare('SELECT key, points FROM daily_task_templates').all().map((r) => [r.key, r.points ?? getDailyTaskPoints()]),
    );
    const todayStr = today();

    const upsert = db.prepare(`
      INSERT INTO daily_task_awards (task_id, user_id, template_key, points)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id, user_id) DO UPDATE SET points = excluded.points
    `);

    // 1. Completed daily tasks earn their template points.
    const done = db.prepare(`
      SELECT t.id AS task_id, t.daily_task_key, t.daily_task_user_id AS user_id
      FROM tasks t
      WHERE t.daily_task_key <> ''
        AND t.daily_task_user_id IS NOT NULL
        AND t.status = 'done'
        AND t.completed_at IS NOT NULL
    `).all();

    const hasAward = db.prepare('SELECT id FROM daily_task_awards WHERE task_id = ? AND user_id = ?');
    for (const d of done) {
      const pts = pointsFor.get(d.daily_task_key) ?? getDailyTaskPoints();
      if (hasAward.get(d.task_id, d.user_id)) {
        // Keep an existing penalty in step if the task was completed after the
        // day had already rolled over.
        const cur = db.prepare('SELECT points FROM daily_task_awards WHERE task_id = ? AND user_id = ?')
          .get(d.task_id, d.user_id);
        if (cur && cur.points < 0) { upsert.run(d.task_id, d.user_id, d.daily_task_key, pts); revoked++; }
        continue;
      }
      const res = upsert.run(d.task_id, d.user_id, d.daily_task_key, pts);
      if (res.changes > 0) granted++;
    }

    // 2. Past days left unfinished incur the miss penalty.
    const missed = db.prepare(`
      SELECT t.id AS task_id, t.daily_task_key, t.daily_task_user_id AS user_id
      FROM tasks t
      WHERE t.daily_task_key <> ''
        AND t.daily_task_user_id IS NOT NULL
        AND t.status <> 'done'
        AND t.daily_task_date IS NOT NULL
        AND t.daily_task_date < ?
        AND NOT EXISTS (
          SELECT 1 FROM daily_task_awards a WHERE a.task_id = t.id AND a.user_id = t.daily_task_user_id
        )
    `).all(todayStr);
    for (const d of missed) {
      const res = upsert.run(d.task_id, d.user_id, d.daily_task_key, getDailyMissPenalty());
      if (res.changes > 0) penalised++;
    }

    // 3. Drop awards that are no longer valid: the task is gone, or it was
    //    reopened and had earned positive points. Penalties for still-missed
    //    past days are deliberately kept, otherwise step 2 would undo itself.
    const stale = db.prepare(`
      SELECT a.id FROM daily_task_awards a
      LEFT JOIN tasks t ON t.id = a.task_id
      WHERE t.id IS NULL
         OR (t.status <> 'done' AND a.points > 0)
    `).all();
    if (stale.length > 0) {
      const del = db.prepare('DELETE FROM daily_task_awards WHERE id = ?');
      for (const s of stale) { del.run(s.id); revoked++; }
    }
  } finally {
    reconciling = false;
  }
  if (granted > 0 || revoked > 0 || penalised > 0) {
    console.log(`[DailyTask] KPI awards reconciled: +${granted} granted, -${revoked} revoked, ${penalised} missed-penalty`);
  }
  return { granted, revoked, penalised };
}

let intervalId = null;
let midnightId = null;
let lastGeneratedDate = null;

/**
 * Ensure a given day has tasks. Cheap to call repeatedly: it skips work once
 * the day is done unless a member is added or a template is enabled.
 */
export function ensureDailyTasks(dateStr = today(), { force = false } = {}) {
  if (!force && lastGeneratedDate === dateStr) return { skipped: true, reason: 'already generated today' };
  const res = generateDailyTasks(dateStr);
  lastGeneratedDate = dateStr;
  return res;
}

/** Called when membership or template enablement changes, so the day regenerates. */
export function invalidateGenerationCache() {
  lastGeneratedDate = null;
}

/** Milliseconds from now until the next 00:00 in the BD business timezone. */
function msUntilNextMidnight() {
  const nowMs = Date.now();
  const current = bdDateStr(nowMs);
  // Walk forward in one-minute steps to the first minute whose business date
  // differs from today's. Robust to DST arithmetic and to any offset-based or
  // offset-free timezone configuration.
  for (let i = 1; i <= 24 * 60; i++) {
    if (bdDateStr(nowMs + i * 60 * 1000) !== current) return i * 60 * 1000;
  }
  return 60 * 60 * 1000;
}

function bdDateStr(ms) {
  return new Date(ms + BD_OFFSET_MS).toISOString().slice(0, 10);
}

function scheduleMidnight() {
  if (midnightId) clearTimeout(midnightId);
  midnightId = setTimeout(() => {
    midnightId = null;
    try {
      const res = generateDailyTasks(today());
      lastGeneratedDate = today();
      console.log(`[DailyTask] Midnight generation for ${lastGeneratedDate}: ${res.created} created`);
    } catch (err) {
      console.error('[DailyTask] Midnight generation failed:', err);
    }
    reconcileDailyTaskAwards();
    scheduleMidnight();
  }, msUntilNextMidnight());
  midnightId.unref?.();
}

export function startDailyTaskService(intervalMinutes = 15) {
  if (intervalId) clearInterval(intervalId);
  const tick = () => {
    try {
      ensureDailyTasks();
      reconcileDailyTaskAwards();
    } catch (err) {
      console.error('[DailyTask] Service error:', err);
    }
  };
  tick();
  intervalId = setInterval(tick, intervalMinutes * 60 * 1000);
  intervalId.unref?.();
  scheduleMidnight();
  return intervalId;
}

export function stopDailyTaskService() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  if (midnightId) { clearTimeout(midnightId); midnightId = null; }
}