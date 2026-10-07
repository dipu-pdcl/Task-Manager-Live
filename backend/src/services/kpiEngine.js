import { db } from '../db.js';

/**
 * KPI Engine - Centralized KPI calculation engine.
 * All KPI rules are read from the kpi_config table.
 * This module provides pure functions that can be tested in isolation.
 */

/** Safe integer conversion with fallback. */
function saneInt(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/** Get all KPI config rules as a map keyed by rule_key. */
export function getKpiConfig() {
  const rows = db.prepare(`
    SELECT rule_key, rule_name, rule_category, points, enabled
    FROM kpi_config
    WHERE enabled = 1
  `).all();
  const map = {};
  for (const r of rows) {
    map[r.rule_key] = { ...r, points: saneInt(r.points) };
  }
  return map;
}

/** Get a single KPI rule value by key. */
export function getKpiRule(ruleKey) {
  const row = db.prepare('SELECT points, enabled FROM kpi_config WHERE rule_key = ?').get(ruleKey);
  if (!row || row.enabled !== 1) return 0;
  return saneInt(row.points);
}

/**
 * Record a KPI transaction with full audit trail.
 * @param {Object} params
 * @param {number} params.userId - User receiving the points
 * @param {number|null} params.taskId - Related task (if any)
 * @param {string} params.ruleKey - KPI rule key (e.g., 'self_task')
 * @param {string} params.ruleName - Human-readable rule name
 * @param {number} params.points - Points awarded (can be negative)
 * @param {number} params.configValue - The configured point value at time of award
 * @param {number} params.configEnabled - Whether the rule was enabled at time of award
 * @param {string} params.reason - Human-readable reason for the award
 * @param {number|null} params.createdBy - User who triggered the award (e.g., completer)
 */
export function recordKpiTransaction({
  userId,
  taskId = null,
  ruleKey,
  ruleName,
  points,
  configValue,
  configEnabled = 1,
  reason = '',
  createdBy = null,
}) {
  if (!userId || !ruleKey || points === 0) return null;

  // Get user info for denormalized fields
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId);
  const task = taskId ? db.prepare('SELECT title, task_code FROM tasks WHERE id = ?').get(taskId) : null;
  const creator = createdBy ? db.prepare('SELECT name FROM users WHERE id = ?').get(createdBy) : null;

  const stmt = db.prepare(`
    INSERT INTO kpi_transactions (
      user_id, user_name, user_email, task_id, task_title, task_code,
      rule_key, rule_name, points, config_value, config_enabled, reason, created_by, created_by_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    userId,
    user?.name || '',
    user?.email || '',
    taskId,
    task?.title || '',
    task?.task_code || '',
    ruleKey,
    ruleName,
    points,
    configValue,
    configEnabled,
    reason,
    createdBy,
    creator?.name || ''
  );
  return result.lastInsertRowid;
}

/**
 * Get the point value for a rule, returning 0 if disabled.
 */
export function getRulePoints(ruleKey) {
  return getKpiRule(ruleKey);
}

/**
 * Calculate KPI points for a task completion (PURE FUNCTION - no DB writes).
 * Returns an object with points for each participant.
 * 
 * @param {Object} task - Task object with is_self_task, created_by, etc.
 * @param {number} completerId - User who completed the task
 * @param {number[]} assigneeIds - Current assignees of the task
 * @returns {Object} { creatorPoints, assigneePointsMap, selfTaskPoints, adminBonus }
 */
export function calculateTaskCompletionKpi(task, completerId, assigneeIds) {
  const config = getKpiConfig();
  const result = {
    creatorPoints: 0,
    assigneePointsMap: {},
    selfTaskPoints: 0,
    adminBonus: 0,
  };

  // Self Task: user created and completed their own task
  if (task.is_self_task) {
    const points = config.self_task?.points ?? 0;
    result.selfTaskPoints = points;
    return result;
  }

  // Regular task: Creator gets create_task points when they complete
  // Assignees get assignee_task points when they complete
  const isCreator = completerId === task.created_by;

  if (isCreator) {
    const points = config.create_task?.points ?? 0;
    result.creatorPoints = points;
  }

  // Assignee points for the completer (if they are an assignee)
  const isAssignee = assigneeIds.includes(completerId);
  if (isAssignee) {
    const points = config.assignee_task?.points ?? 0;
    result.assigneePointsMap[completerId] = points;
  }

  // Admin Bonus: If task was created by an admin, the completer gets a bonus
  if (isAssignee || isCreator) {
    // Check if task was created by an admin
    const creatorIsAdmin = db.prepare(`
      SELECT 1 FROM users WHERE id = ? AND role IN ('admin', 'super_admin', 'sub_admin')
    `).get(task.created_by);

    if (creatorIsAdmin) {
      const bonusPoints = config.admin_bonus?.points ?? 0;
      if (bonusPoints > 0) {
        result.adminBonus = bonusPoints;
        if (completerId === task.created_by) {
          result.creatorPoints += bonusPoints;
        } else {
          result.assigneePointsMap[completerId] = (result.assigneePointsMap[completerId] || 0) + bonusPoints;
        }
      }
    }
  }

  return result;
}

/**
 * Record KPI transactions for a task completion (DB WRITE).
 * This should only be called ONCE when a task is actually completed.
 * 
 * @param {Object} task - Task object
 * @param {number} completerId - User who completed the task
 * @param {number[]} assigneeIds - Current assignees of the task
 */
export function recordTaskCompletionKpi(task, completerId, assigneeIds) {
  const config = getKpiConfig();

  // Self Task: user created and completed their own task
  if (task.is_self_task) {
    const points = config.self_task?.points ?? 0;
    if (completerId === task.created_by && points !== 0) {
      recordKpiTransaction({
        userId: completerId,
        taskId: task.id,
        ruleKey: 'self_task',
        ruleName: 'Self Task Completion',
        points,
        configValue: points,
        reason: `Completed self task "${task.title}"`,
        createdBy: completerId,
      });
    }
    return;
  }

  // Regular task: Creator gets create_task points when they complete
  const isCreator = completerId === task.created_by;
  if (isCreator) {
    const points = config.create_task?.points ?? 0;
    if (points !== 0) {
      recordKpiTransaction({
        userId: completerId,
        taskId: task.id,
        ruleKey: 'create_task',
        ruleName: 'Create Task Completion (Creator)',
        points,
        configValue: points,
        reason: `Completed own task "${task.title}" as creator`,
        createdBy: completerId,
      });
    }
  }

  // Assignee points for the completer (if they are an assignee)
  const isAssignee = assigneeIds.includes(completerId);
  if (isAssignee) {
    const points = config.assignee_task?.points ?? 0;
    if (points !== 0) {
      recordKpiTransaction({
        userId: completerId,
        taskId: task.id,
        ruleKey: 'assignee_task',
        ruleName: 'Assignee Task Completion',
        points,
        configValue: points,
        reason: `Completed assigned task "${task.title}"`,
        createdBy: completerId,
      });
    }
  }

  // Admin Bonus
  if (isAssignee || isCreator) {
    const creatorIsAdmin = db.prepare(`
      SELECT 1 FROM users WHERE id = ? AND role IN ('admin', 'super_admin', 'sub_admin')
    `).get(task.created_by);

    if (creatorIsAdmin) {
      const bonusPoints = config.admin_bonus?.points ?? 0;
      if (bonusPoints > 0) {
        recordKpiTransaction({
          userId: completerId,
          taskId: task.id,
          ruleKey: 'admin_bonus',
          ruleName: 'Admin Assigned Task Bonus',
          points: bonusPoints,
          configValue: bonusPoints,
          reason: `Admin-assigned task bonus for "${task.title}"`,
          createdBy: completerId,
        });
      }
    }
  }
}

/**
 * Calculate overdue penalty for a user (PURE FUNCTION - no DB writes).
 * @param {number} userId
 * @param {string} startDate - Period start (YYYY-MM-DD)
 * @param {string} endDate - Period end (YYYY-MM-DD)
 * @returns {number} Total penalty points (negative)
 */
export function calculateOverduePenalty(userId, startDate, endDate) {
  const config = getKpiConfig();
  const penaltyPerTask = Math.abs(config.overdue_task?.points ?? 0);
  if (penaltyPerTask === 0) return 0;

  // Count overdue tasks for this user in the period
  const count = db.prepare(`
    SELECT COUNT(*) AS c
    FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ?
      AND t.due_date IS NOT NULL AND t.due_date <> ''
      AND t.due_date >= ? AND t.due_date <= ?
      AND t.status NOT IN ('done', 'cancelled')
  `).get(userId, startDate, endDate);

  const overdueCount = count?.c || 0;
  return -overdueCount * penaltyPerTask;
}

/**
 * Record overdue penalty KPI transaction (DB WRITE).
 * Should be called periodically (e.g., daily cron), not on every KPI view.
 */
export function recordOverduePenalty(userId, startDate, endDate) {
  const config = getKpiConfig();
  const penaltyPerTask = Math.abs(config.overdue_task?.points ?? 0);
  if (penaltyPerTask === 0) return 0;

  const count = db.prepare(`
    SELECT COUNT(*) AS c
    FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ?
      AND t.due_date IS NOT NULL AND t.due_date <> ''
      AND t.due_date >= ? AND t.due_date <= ?
      AND t.status NOT IN ('done', 'cancelled')
  `).get(userId, startDate, endDate);

  const overdueCount = count?.c || 0;
  if (overdueCount === 0) return 0;

  const totalPenalty = -overdueCount * penaltyPerTask;
  recordKpiTransaction({
    userId,
    taskId: null,
    ruleKey: 'overdue_task',
    ruleName: 'Overdue Task Penalty',
    points: totalPenalty,
    configValue: -penaltyPerTask,
    reason: `${overdueCount} overdue task(s) in period`,
    createdBy: null,
  });
  return totalPenalty;
}

/**
 * Calculate daily task KPI for a user (reads from daily_task_awards).
 * @param {number} userId
 * @param {string} startDate - Period start (YYYY-MM-DD)
 * @param {string} endDate - Period end (YYYY-MM-DD)
 * @returns {Object} { points, completed, missed }
 */
export function calculateDailyTaskKpi(userId, startDate, endDate) {
  const config = getKpiConfig();
  const completePoints = config.daily_task_complete?.points ?? 0;
  const overduePoints = config.daily_task_overdue?.points ?? 0;

  // Get daily task awards from the period
  const awards = db.prepare(`
    SELECT COALESCE(SUM(a.points), 0) AS pts,
           COALESCE(SUM(CASE WHEN a.points > 0 THEN 1 ELSE 0 END), 0) AS completed,
           COALESCE(SUM(CASE WHEN a.points < 0 THEN 1 ELSE 0 END), 0) AS missed
    FROM daily_task_awards a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.user_id = ?
      AND t.daily_task_date >= ?
      AND t.daily_task_date <= ?
  `).get(userId, startDate, endDate);

  return {
    points: awards?.pts || 0,
    completed: awards?.completed || 0,
    missed: awards?.missed || 0,
  };
}

/**
 * Calculate total KPI score for a user in a date range.
 * READ-ONLY: Uses existing kpi_transactions, does NOT create new ones.
 * 
 * @param {number} userId
 * @param {string} startIso - Period start (YYYY-MM-DD)
 * @param {string} endIso - Period end (YYYY-MM-DD)
 * @returns {Object} Full KPI breakdown
 */
export function computeUserKpi(userId, startIso, endIso) {
  const start = `${startIso.slice(0, 10)} 00:00:00`;
  const end = `${endIso.slice(0, 10)} 23:59:59`;
  const startDate = startIso.slice(0, 10);
  const endDate = endIso.slice(0, 10);

  // Get all completed task assignee records for this user in the period
  const completed = db.prepare(`
    SELECT t.*, ta.progress, ta.completed_at AS assignee_completed_at
    FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND ta.completed_at IS NOT NULL
      AND ta.completed_at >= ? AND ta.completed_at <= ?
  `).all(userId, start, end);

  // Build assignee map for all completed tasks
  const assigneeMap = new Map();
  if (completed.length) {
    const ids = completed.map((t) => t.id);
    const list = db.prepare(`
      SELECT task_id, user_id FROM task_assignees
      WHERE task_id IN (${ids.map(() => '?').join(',')})
    `).all(...ids);
    for (const row of list) {
      if (!assigneeMap.has(row.task_id)) assigneeMap.set(row.task_id, []);
      assigneeMap.get(row.task_id).push(row.user_id);
    }
  }

  // Calculate points from regular tasks using PURE calculation
  let taskPoints = 0;
  let creatorPoints = 0;
  let assigneePoints = 0;
  let selfTaskPoints = 0;
  let splitTasks = 0;

  for (const t of completed) {
    if (t.daily_task_key) continue; // Daily tasks handled separately

    const assigneeIds = assigneeMap.get(t.id) || [];
    const kpiResult = calculateTaskCompletionKpi(t, userId, assigneeIds);

    taskPoints += kpiResult.creatorPoints + (kpiResult.assigneePointsMap[userId] || 0);
    if (kpiResult.selfTaskPoints > 0) {
      selfTaskPoints += kpiResult.selfTaskPoints;
    }
    if (kpiResult.creatorPoints > 0) creatorPoints += kpiResult.creatorPoints;
    if (kpiResult.assigneePointsMap[userId] > 0) assigneePoints += kpiResult.assigneePointsMap[userId];
    if (assigneeIds.length > 1) splitTasks += 1;
  }

  // Daily task KPI
  const dailyKpi = calculateDailyTaskKpi(userId, startDate, endDate);

  // Overdue penalty (calculated, not recorded)
  const overduePenalty = calculateOverduePenalty(userId, startDate, endDate);

  // On-time/late stats
  const onTimeEligible = completed.filter((t) => !t.daily_task_key && t.due_date);
  const onTime = onTimeEligible.filter((t) => t.assignee_completed_at <= `${t.due_date} 23:59:59`).length;
  const late = onTimeEligible.filter((t) => t.assignee_completed_at > `${t.due_date} 23:59:59`).length;

  // Current overdue count
  const currentOverdue = db.prepare(`
    SELECT COUNT(*) c FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND t.due_date IS NOT NULL AND t.due_date <> ''
      AND t.due_date >= ? AND t.due_date <= ? AND t.status NOT IN ('done','cancelled')
  `).get(userId, startDate, endDate).c;

  const overdueCount = late + currentOverdue;

  // Completion rate
  const totalAssigned = db.prepare(`
    SELECT COUNT(*) c FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND (
      (t.status = 'done' AND t.completed_at >= ? AND t.completed_at <= ?)
      OR (t.status NOT IN ('done','cancelled') AND (t.due_date IS NULL OR (t.due_date >= ? AND t.due_date <= ?)))
    )
  `).get(userId, start, end, startDate, endDate).c;

  const totalDone = db.prepare(`
    SELECT COUNT(*) c FROM task_assignees ta
    WHERE ta.user_id = ? AND ta.completed_at IS NOT NULL AND ta.completed_at >= ? AND ta.completed_at <= ?
  `).get(userId, start, end).c;

  const completionRate = totalAssigned ? Math.round((totalDone / totalAssigned) * 100) : 0;

  // Avg completion hours
  const avgHours = db.prepare(`
    SELECT ROUND(MAX(0, AVG(
      (julianday(ta.completed_at) - julianday(ta.assigned_at)) * 24
    )), 1) v
    FROM task_assignees ta
    WHERE ta.user_id = ? AND ta.completed_at IS NOT NULL AND ta.completed_at >= ? AND ta.completed_at <= ?
  `).get(userId, start, end).v || 0;

  // Total points
  const points = Math.round(taskPoints + dailyKpi.points + overduePenalty);
  const score = Math.max(0, points); // Simple score for now

  return {
    userId,
    completed: completed.length,
    selfCompleted: completed.filter((t) => t.is_self_task).length,
    dailyCompleted: dailyKpi.completed,
    dailyPoints: dailyKpi.points,
    dailyMissed: dailyKpi.missed,
    totalAssigned,
    totalDone,
    completionRate,
    splitTasks,
    onTime,
    late,
    overdueCount,
    avgCompletionHours: avgHours,
    points,
    bonus: 0, // bonuses are now included in taskPoints
    penalty: -overduePenalty,
    rawPenalty: -overduePenalty,
    penaltyCapped: false,
    productivity: Math.round((completionRate / 100) * 20),
    rating: 0,
    score,
    creatorPoints,
    assigneePoints,
    selfTaskPoints,
  };
}

export default {
  getKpiConfig,
  getKpiRule,
  recordKpiTransaction,
  getRulePoints,
  calculateTaskCompletionKpi,
  recordTaskCompletionKpi,
  calculateOverduePenalty,
  recordOverduePenalty,
  calculateDailyTaskKpi,
  computeUserKpi,
};