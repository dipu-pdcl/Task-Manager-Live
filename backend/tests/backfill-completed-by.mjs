import { DatabaseSync } from 'node:sqlite';

// Conservative backfill: only attribute a historical task to a user when the
// history is unambiguous.
//   - skip tasks with completed_at but no matching history entry
//   - among entries near completed_at, require they all name the SAME user
//   - require the nearest entry to sit within 60s of completed_at
// Anything ambiguous is left NULL rather than guessed at.
const d = new DatabaseSync('data/taskflow.db');
d.exec('PRAGMA busy_timeout = 10000');

const cols = d.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
if (!cols.includes('completed_by')) {
  console.log('completed_by column missing -- run the server once to migrate, then re-run');
  process.exit(1);
}

const candidates = d.prepare(`
  SELECT t.id,
         th.user_id,
         ABS(julianday(th.created_at) - julianday(t.completed_at)) * 86400 AS delta
  FROM tasks t
  JOIN task_history th
    ON th.task_id = t.id
   AND th.action = 'status.change'
   AND th.new_value = 'done'
  WHERE t.completed_at IS NOT NULL AND t.completed_by IS NULL
  ORDER BY t.id, delta`).all();

const byTask = new Map();
for (const c of candidates) {
  if (!byTask.has(c.id)) byTask.set(c.id, []);
  byTask.get(c.id).push(c);
}

let set = 0, skippedNoHistory = 0, skippedAmbiguous = 0, skippedFar = 0;
const upd = d.prepare('UPDATE tasks SET completed_by = ? WHERE id = ?');
const undo = [];

for (const [taskId, rows] of byTask) {
  const near = rows.filter((r) => r.delta <= 60);
  if (!near.length) { skippedFar++; continue; }
  const users = new Set(near.map((r) => r.user_id).filter((u) => u != null));
  if (users.size !== 1) { skippedAmbiguous++; continue; }
  const uid = [...users][0];
  upd.run(uid, taskId);
  undo.push([uid, taskId]);
  set++;
}

// Tasks that are done but have no history row at all.
const noHist = d.prepare(`
  SELECT COUNT(*) c FROM tasks t WHERE t.completed_at IS NOT NULL AND t.completed_by IS NULL
  AND NOT EXISTS (SELECT 1 FROM task_history th WHERE th.task_id=t.id AND th.action='status.change' AND th.new_value='done')`).get().c;

console.log(`backfilled completed_by on ${set} task(s)`);
console.log(`  left NULL, multiple different users in history: ${skippedAmbiguous}`);
console.log(`  left NULL, nearest history entry >60s away:     ${skippedFar}`);
console.log(`  left NULL, no history entry at all:             ${noHist}`);

const still = d.prepare("SELECT COUNT(*) c FROM tasks WHERE status='done' AND completed_by IS NOT NULL").get().c;
const doneNoBy = d.prepare("SELECT COUNT(*) c FROM tasks WHERE status='done' AND completed_at IS NOT NULL AND completed_by IS NULL").get().c;
console.log(`\ntasks with a recorded completer: ${still}`);
console.log(`completed tasks still missing a completer: ${doneNoBy}`);
d.close();