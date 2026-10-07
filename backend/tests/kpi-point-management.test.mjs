// Isolated test for KPI Point Management: scoring is a flat per-difficulty value,
// priority is ignored entirely, self tasks have their own rate, and every rule is
// read from settings so a change recalculates history retroactively.
// Seeds a throwaway DB via DB_PATH. Never touches the live database.
import fs from 'node:fs';
import path from 'node:path';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'kpi-point-management.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'kpi-point-management-secret';

const { db, ensureSchema } = await import('../src/db.js');
ensureSchema(db);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

const { getSettings, setSetting, getDifficultyById } = await import('../src/config.js');
const scoring = await import('../src/services/kpiScoring.js');
// The scoring helpers take the kpi block, exactly as computeUserKpi passes it.
const K = () => getSettings().kpi;

setSetting('difficulties', [
  { id: 'easy', name: 'Easy', points: 1, enabled: true },
  { id: 'medium', name: 'Medium', points: 2, enabled: true },
  { id: 'hard', name: 'Hard', points: 4, enabled: true },
  { id: 'critical', name: 'Critical', points: 9, enabled: true },
]);
setSetting('kpi', { selfTaskPoints: 3, onTimeBonus: 2, overduePenalty: 4 });

console.log('--- 1. difficulty points are flat and ignore priority ---');
for (const priority of ['low', 'medium', 'high', 'urgent']) {
  const pts = scoring.basePointsForTask({ difficulty: 'hard', priority }, K());
  check(`hard is 4 pts at ${priority} priority`, pts === 4, `${pts}`);
}
check('the stored priority weight plays no part in scoring',
  getSettings().priorities.find((p) => p.id === 'high')?.weight !== 4);

console.log('\n--- 2. each difficulty pays its own configured rate ---');
for (const [id, want] of [['easy', 1], ['medium', 2], ['hard', 4], ['critical', 9]]) {
  const pts = scoring.basePointsForTask({ difficulty: id, priority: 'medium' }, K());
  check(`${id} pays ${want}`, pts === want, `${pts}`);
}

console.log('\n--- 3. a disabled difficulty pays nothing ---');
setSetting('difficulties', getSettings().difficulties.map((d) => (d.id === 'hard' ? { ...d, enabled: false } : d)));
check('hard is worth 0 once disabled',
  scoring.basePointsForTask({ difficulty: 'hard', priority: 'urgent' }, K()) === 0);
check('the configured rate survives disabling',
  getDifficultyById('hard').points === 4 && getDifficultyById('hard').enabled === false);
check('other difficulties are unaffected',
  scoring.basePointsForTask({ difficulty: 'medium', priority: 'low' }, K()) === 2);
setSetting('difficulties', getSettings().difficulties.map((d) => (d.id === 'hard' ? { ...d, enabled: true } : d)));
check('re-enabling restores the rate',
  scoring.basePointsForTask({ difficulty: 'hard', priority: 'urgent' }, K()) === 4);

console.log('\n--- 4. self tasks use their own rate ---');
check('a self task pays selfTaskPoints',
  scoring.basePointsForTask({ is_self_task: 1, difficulty: 'critical', priority: 'urgent' }, K()) === 3);
check('the self rate applies even on the easiest difficulty',
  scoring.basePointsForTask({ is_self_task: 1, difficulty: 'easy', priority: 'low' }, K()) === 3);
check('an empty self flag is not a self task',
  scoring.basePointsForTask({ is_self_task: 0, difficulty: 'critical', priority: 'urgent' }, K()) === 9);
check('a missing self flag is not a self task',
  scoring.basePointsForTask({ difficulty: 'easy', priority: 'low' }, K()) === 1);

console.log('\n--- 5. an unknown difficulty falls back without crashing ---');
let unknown = null;
try { unknown = scoring.basePointsForTask({ difficulty: 'nope', priority: 'high' }, K()); } catch (e) { unknown = `threw ${e.message}`; }
check('an unknown difficulty yields a number, not an exception',
  typeof unknown === 'number' && Number.isFinite(unknown), String(unknown));

console.log('\n--- 6. the on-time bonus is flat, not proportional ---');
const due = { due_date: '2026-03-10', assignee_completed_at: '2026-03-09 18:00:00' };
check('finished before the due date earns the bonus',
  scoring.onTimeBonusForTask(due, K()) === 2);
check('the hardest task earns the same bonus',
  scoring.onTimeBonusForTask({ ...due, difficulty: 'critical', priority: 'urgent' }, K()) === 2);
check('finished on the due date still counts as on time',
  scoring.onTimeBonusForTask({ ...due, assignee_completed_at: '2026-03-10 17:00:00' }, K()) === 2);
check('finished after the due date earns nothing',
  scoring.onTimeBonusForTask({ ...due, assignee_completed_at: '2026-03-11 09:00:00' }, K()) === 0);
check('a task with no due date can never be on time',
  scoring.onTimeBonusForTask({ assignee_completed_at: '2026-03-09 18:00:00' }, K()) === 0);
check('an unfinished task earns nothing',
  scoring.onTimeBonusForTask({ due_date: '2026-03-10' }, K()) === 0);

console.log('\n--- 7. overdue penalty accepts either sign ---');
setSetting('kpi', { overduePenalty: 4 });
check('a positive setting deducts 4', scoring.overduePenaltyPerTask(K()) === 4);
setSetting('kpi', { overduePenalty: -6 });
check('a value typed as -6 still deducts 6', scoring.overduePenaltyPerTask(K()) === 6);

console.log('\n--- 8. settings changes are retroactive ---');
setSetting('kpi', { overduePenalty: 4 });
const before = scoring.basePointsForTask({ difficulty: 'medium', priority: 'medium' }, K());
setSetting('difficulties', getSettings().difficulties.map((d) => (d.id === 'medium' ? { ...d, points: 20 } : d)));
const after = scoring.basePointsForTask({ difficulty: 'medium', priority: 'medium' }, K());
check('changing a rate changes scoring immediately', before === 2 && after === 20, `${before} -> ${after}`);
check('no migration or backfill is needed for it to apply', after === 20);
check('a task completed before the change scores at the new rate, by design',
  scoring.basePointsForTask({ difficulty: 'medium', completed_at: '2026-01-01 10:00:00' }, K()) === 20);

console.log('\n--- 9. daily task rules come from settings ---');
setSetting('kpi', { dailyTaskPoints: 6, dailyTaskMissPenalty: -3 });
check('new templates default to dailyTaskPoints', scoring.defaultDailyTaskPoints(K()) === 6);
check('the miss penalty is read from settings', scoring.dailyTaskMissPenalty(K()) === -3);
setSetting('kpi', { dailyTaskMissPenalty: 2 });
check('a miss penalty typed positive is still a deduction', scoring.dailyTaskMissPenalty(K()) === -2);
setSetting('kpi', { dailyTaskMissPenalty: -3 });
const { missPenalty, templatePoints } = await import('../src/services/dailyTaskService.js');
check('the service reads the configured miss penalty', missPenalty() === -3);
check('an explicit template override survives', templatePoints(15) === 15);
check('a template with no override falls back to the default', templatePoints(null) === 6);

console.log('\n--- 10. the panel lists every rule that actually scores ---');
const ids = scoring.kpiRuleRows().map((r) => r.id);
for (const id of ['selfTaskPoints', 'onTimeBonus', 'overduePenalty', 'dailyTaskPoints', 'dailyTaskMissPenalty',
  'difficulty.easy', 'difficulty.medium', 'difficulty.hard', 'difficulty.critical']) {
  check(`${id} is editable in the panel`, ids.includes(id));
}
check('no duplicate rule rows', new Set(ids).size === ids.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);