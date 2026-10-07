import { getSettings, getDifficultyById } from '../config.js';

/**
 * Every KPI point value in the application is read through here.
 *
 * The point of this module is that "KPI Point Management" in the admin panel is
 * the only place points are defined. Before it existed the same values were
 * spread across computeUserKpi, dailyTaskService and the settings defaults, so
 * an admin changing a number had no way to be sure it had been picked up
 * everywhere -- and the daily miss penalty was a hardcoded constant that no
 * amount of configuration could reach.
 *
 * Nothing here reads the database directly: callers pass the settings object
 * they already hold, which keeps the calculation pure and testable.
 */

/** Trimmed, non-negative integer used for point values the admin can type. */
function saneInt(value, fallback) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Points for finishing one task, before the pool is split between the creator
 * and the assignees.
 *
 * Self tasks pay their own configured rate. Everything else pays the rate of its
 * difficulty, and priority deliberately does not contribute: difficulty is a
 * flat value chosen in the panel rather than a multiplier, so "Hard" means the
 * same number of points whatever priority the task was given.
 *
 * A difficulty whose rule is switched off awards nothing. That is deliberate --
 * an inactive rule cannot award points -- but it means disabling every
 * difficulty would zero out task points, which the panel warns about.
 */
export function basePointsForTask(task, kpi) {
  const k = kpi || {};
  if (task.is_self_task) return saneInt(k.selfTaskPoints, 2);
  const difficulty = getDifficultyById(task.difficulty);
  if (difficulty.enabled === false) return 0;
  return saneInt(difficulty.points, 0);
}

/**
 * Points for finishing a task before its due date, or 0 when it does not apply.
 *
 * Requires a due date and is measured against this person's own completion time,
 * so a task with no deadline can never be "on time". Daily tasks are excluded by
 * the caller: they score from their own awards and would otherwise be paid this
 * bonus twice.
 */
export function onTimeBonusForTask(task, kpi) {
  const k = kpi || {};
  if (!task.due_date || !task.assignee_completed_at) return 0;
  return task.assignee_completed_at <= `${task.due_date} 23:59:59`
    ? saneInt(k.onTimeBonus, 3)
    : 0;
}

/** Points deducted per overdue or late task. Stored as a magnitude. */
export function overduePenaltyPerTask(kpi) {
  const k = kpi || {};
  // Accept either sign so a value typed as "-1" in the panel still deducts.
  return Math.abs(saneInt(k.overduePenalty, 1));
}

/** Points awarded for completing one daily task, when the template has none set. */
export function defaultDailyTaskPoints(kpi) {
  return saneInt((kpi || {}).dailyTaskPoints, 2);
}

/** Points deducted for a daily task left unfinished on a past day. */
export function dailyTaskMissPenalty(kpi) {
  const v = saneInt((kpi || {}).dailyTaskMissPenalty, -1);
  return v > 0 ? -v : v;
}

/** The live KPI settings block, or {} when it has never been saved. */
export function kpiSettings() {
  return getSettings().kpi || {};
}

/**
 * The rule rows shown in the panel, each paired with the value actually in
 * force. The panel renders from this so a value can never drift from the
 * calculation: if a row is not listed here, it does not affect scoring.
 */
export function kpiRuleRows() {
  const k = kpiSettings();
  const diff = (id) => getDifficultyById(id);
  const rows = [
    { id: 'selfTaskPoints', name: 'Self Task', kind: 'number', points: saneInt(k.selfTaskPoints, 2) },
    { id: 'onTimeBonus', name: 'Bonus Point', kind: 'number', points: saneInt(k.onTimeBonus, 3), help: 'Awarded when finished on or before the due date, then shared out with the task pool.' },
    { id: 'overduePenalty', name: 'Overdue / Missed Task', kind: 'number', points: overduePenaltyPerTask(k), help: 'Deducted per overdue or late task, capped as before.' },
    { id: 'dailyTaskPoints', name: 'Daily Task Completion', kind: 'number', points: defaultDailyTaskPoints(k), help: 'Default for new daily tasks. Each daily task keeps its own value once created.' },
    { id: 'dailyTaskMissPenalty', name: 'Daily Task Overdue', kind: 'number', points: dailyTaskMissPenalty(k), help: 'Deducted when a daily task is left unfinished on a past day.' },
  ];
  for (const id of ['easy', 'medium', 'hard', 'critical']) {
    const d = diff(id);
    rows.push({
      id: `difficulty.${id}`,
      name: `${d.name} Task`,
      kind: 'difficulty',
      difficultyId: id,
      points: saneInt(d.points, 0),
      enabled: d.enabled !== false,
    });
  }
  return rows;
}