// Isolated KPI point-distribution test. Seeds a throwaway DB via DB_PATH with a
// known set of tasks and assignees, then drives the real computeUserKpi and the
// real task status/assignee routes. Never touches the live database.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'kpi-split-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'kpi-split-test-secret';

const { db, ensureSchema } = await import('../src/db.js');
ensureSchema(db);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };
const round2 = (n) => Math.round(n * 100) / 100;

// ---- seed -----------------------------------------------------------------
const mkUser = (name) => Number(
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,'x','user')")
    .run(name, `${name.toLowerCase()}@t.test`).lastInsertRowid,
);
const mkAdmin = (name) => Number(
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,'x','admin')")
    .run(name, `${name.toLowerCase()}@t.test`).lastInsertRowid,
);
const admin = mkAdmin('Adam');
const anna = mkUser('Anna');   // creator, and an assignee
const ben = mkUser('Ben');
const cara = mkUser('Cara');
const dan = mkUser('Dan');     // never assigned

// A task worth exactly 10 points: the pinned flat rate for critical difficulty.
const insTask = db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,created_by,task_code,created_at,due_date)
  VALUES (?,'todo','medium','critical',?,?,'2026-01-02 09:00:00','2026-01-20')`);
const mkTask = (title, by, code) => Number(insTask.run(title, by, code).lastInsertRowid);

const insAsg = db.prepare("INSERT INTO task_assignees (task_id,user_id,status,assigned_at) VALUES (?,?,'todo','2026-01-02 09:00:00')");
const assign = (task, ...users) => { for (const u of users) insAsg.run(task, u); };
// Record a personal completion the way the progress endpoint does.
const completeAs = (task, u, at) => db.prepare(
  "UPDATE task_assignees SET progress = 100, status = 'done', completed_at = ? WHERE task_id = ? AND user_id = ?",
).run(at, task, u);
const setTaskDone = (task, by, at) => db.prepare(
  "UPDATE tasks SET status='done', completed_at=?, completed_by=?, progress=100 WHERE id=?",
).run(at, by, task);

// Task A: 10 points, 2 assignees (creator Anna + Ben).
const taskA = mkTask('Shared by two', anna, 'TSK-AAAAAA01');
assign(taskA, anna, ben);

// Task B: 10 points, 4 assignees.
const taskB = mkTask('Shared by four', anna, 'TSK-BBBBBB01');
assign(taskB, anna, ben, cara, dan);

// Task C: solo task, creator is NOT an assignee (proves creator gets nothing
// merely for having created it).
const taskC = mkTask('Assigned away from creator', anna, 'TSK-CCCCCC01');
assign(taskC, ben);

// KPI Point Management now sets a flat rate per difficulty, so the fixture
// pins critical to 10 to keep every fixture task worth exactly 10 points.
// Decoupling the tests from the shipped default rates means changing those
// defaults later cannot silently halve every expected share.
const { getSettings, setSetting } = await import('../src/config.js');
setSetting('difficulties', getSettings().difficulties.map((d) => (
  d.id === 'critical' ? { ...d, enabled: true, points: 10 } : { ...d, enabled: true }
)));
// The bonus is likewise pinned (5) so the "base + bonus pool" arithmetic below
// stays independent of whatever KPI Point Management ships as the default.
setSetting('kpi', { onTimeBonus: 5, selfTaskPoints: 10 });

const { computeUserKpi } = await import('../src/routes/kpi.js');
const cfg = getSettings();
const kpi = (uid) => computeUserKpi(uid, '2026-01-01 00:00:00', '2026-12-31 23:59:59', cfg);

console.log('--- 1. nobody has completed anything yet ---');
check('Anna scored 0', kpi(anna).points === 0, `${kpi(anna).points}`);
check('Ben scored 0', kpi(ben).points === 0, `${kpi(ben).points}`);
check('an unassigned user scored 0', kpi(dan).points === 0);

console.log('\n--- 2. the documented example: 10 points across 2 assignees ---');
// Only Anna completes her share. The task itself stays open until both are in.
completeAs(taskA, anna, '2026-01-05 10:00:00');
setTaskDone(taskA, anna, '2026-01-05 10:00:00');
check('the completer receives half', kpi(anna).points === 5, `${kpi(anna).points}`);
check('the co-assignee who did not complete receives nothing', kpi(ben).points === 0, `${kpi(ben).points}`);
check('the shared task is reported as a split', kpi(anna).splitTasks === 1, `${kpi(anna).splitTasks}`);

console.log('\n--- 3. 10 points across 4 assignees ---');
completeAs(taskB, ben, '2026-01-06 10:00:00');
setTaskDone(taskB, ben, '2026-01-06 10:00:00');
// Ben has not completed task A yet, so this is his only task so far.
check('one of four gets 2.5', round2(kpi(ben).points) === 2.5, `${kpi(ben).points}`);
check('the other three get nothing', kpi(anna).points === 5 && kpi(cara).points === 0 && kpi(dan).points === 0,
  `anna=${kpi(anna).points} cara=${kpi(cara).points} dan=${kpi(dan).points}`);

console.log('\n--- 4. the creator is a participant even when not assigned ---');
// Task C was created by Anna but assigned only to Ben. Anna is still a
// participant, so Ben completing it splits the pool with her rather than
// taking all of it. Anna herself is paid nothing: she never completed an
// assignment, and points are only ever awarded for personal completion.
completeAs(taskC, ben, '2026-01-07 10:00:00');
setTaskDone(taskC, ben, '2026-01-07 10:00:00');
check('the creator gains nothing for merely having created it', kpi(anna).points === 5, `${kpi(anna).points}`);
// Ben: 2.5 (task B) + 5 (task C, halved against the creator).
check('the sole assignee is now halved against the unassigned creator',
  round2(kpi(ben).points) === 7.5, `${kpi(ben).points}`);
check('the two of them split task C exactly', round2(kpi(anna).points - 5 + kpi(ben).points - 2.5) === 5,
  `task C base paid ${round2(kpi(anna).points - 5 + kpi(ben).points - 2.5)}`);

console.log('\n--- 5. a second completer on a shared task earns their own share ---');
completeAs(taskA, ben, '2026-01-08 10:00:00');
// Ben now also completes task A: 2.5 (task B) + 5 (task C) + 5 (task A) = 12.5.
check('both 2-way participants are now paid 5 each',
  kpi(anna).points === 5 && round2(kpi(ben).points) === 12.5,
  `anna=${kpi(anna).points} ben=${kpi(ben).points}`);
// Ben's other two tasks total 2.5 + 5 = 7.5, so the rest is task A.
check('task A paid out exactly 10 of base across its two completers',
  round2(kpi(anna).points + (kpi(ben).points - 7.5)) === 10,
  `task A base paid ${round2(kpi(anna).points + (kpi(ben).points - 7.5))}`);
check('and its on-time bonus was shared, not paid twice', kpi(anna).bonus === 2.5,
  `anna bonus ${kpi(anna).bonus}`);

console.log('\n--- 6. transfer re-bases the shares automatically ---');
// Add Cara to task A. Anna is the creator and already a participant, so the
// pool now covers three people and each base share drops to 3.33.
insAsg.run(taskA, cara);
check('adding an assignee lowers everyone\'s existing share',
  round2(kpi(anna).points) === 3.33, `${kpi(anna).points}`);
// Ben's task A base share is re-based to 3.33: 2.5 + 5 + 3.33 = 10.83.
check('Ben\'s task A share is re-based too', round2(kpi(ben).points) === 10.83, `${kpi(ben).points}`);

// Remove Anna from task A. She is no longer assigned, so she has no assignment
// row to have completed, and points are awarded only for a personal completion
// she can no longer evidence -- being the creator does not by itself pay.
db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(taskA, anna);
check('a removed assignee loses their points', kpi(anna).points === 0, `${kpi(anna).points}`);
// Ben and Cara remain on task A, and Anna is still a participant as its creator,
// so Ben keeps a third of the re-based pool: 2.5 + 5 + 3.33 = 10.83.
check('the remaining completer still takes a third of the re-based pool',
  round2(kpi(ben).points) === 10.83, `ben ${kpi(ben).points}`);
check('the added-but-not-completed assignee gets nothing', kpi(cara).points === 0, `${kpi(cara).points}`);

console.log('\n--- 7. re-running the calculation cannot drift ---');
const snap = [kpi(anna).points, kpi(ben).points, kpi(cara).points, kpi(dan).points];
for (let i = 0; i < 5; i++) [kpi(anna).points, kpi(ben).points, kpi(cara).points, kpi(dan).points];
check('scores are stable across repeated calls',
  JSON.stringify(snap) === JSON.stringify([kpi(anna).points, kpi(ben).points, kpi(cara).points, kpi(dan).points]),
  JSON.stringify(snap));

console.log('\n--- 8. marking the task done credits only who completed it ---');
// Drive the real route: marking done must not blanket-complete assignees.
const jwt = (await import('jsonwebtoken')).default;
const secret = process.env.JWT_SECRET?.trim()
  || db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get()?.value;
check('a JWT signing secret is available for the route test', !!secret, secret ? '' : 'none found');
const adminRow = db.prepare("SELECT id FROM users WHERE role='super_admin' LIMIT 1").get();
const token = jwt.sign({ id: adminRow.id, role: 'super_admin', tv: 0 }, secret, { expiresIn: '30m' });

const { default: taskRoutes } = await import('../src/routes/tasks.js');
const app = express();
app.use(express.json());
app.use('/api/tasks', taskRoutes);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/api/tasks`;
const post = async (p, body) => {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const taskD = mkTask('Marked done by an admin', anna, 'TSK-DDDDDD01');
assign(taskD, anna, ben, cara);
const beforeAnna = kpi(anna).points;
const beforeBen = kpi(ben).points;
const beforeCara = kpi(cara).points;
let r = await post(`/${taskD}/status`, { status: 'done' });
check('status change accepted', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

// An admin who is not an assignee has not personally completed anybody's
// share, so nobody is credited. Previously this stamped all three, paying the
// whole pool out three times over.
const rows = db.prepare('SELECT user_id, progress, status, completed_at FROM task_assignees WHERE task_id = ? ORDER BY user_id').all(taskD);
check('an admin closing the task credits nobody',
  rows.every((x) => !x.completed_at), `${rows.filter((x) => x.completed_at).length} credited`);
check('the task itself is still recorded as done with a completer',
  db.prepare("SELECT status, completed_by FROM tasks WHERE id = ?").get(taskD).status === 'done');
check('no assignee scores for work they did not do',
  kpi(anna).points === beforeAnna && kpi(ben).points === beforeBen && kpi(cara).points === beforeCara,
  `anna ${beforeAnna}->${kpi(anna).points}, ben ${beforeBen}->${kpi(ben).points}`);

// Now the same task closed by one of its own assignees: exactly that person is
// credited, and gets one share of the 10-point pool across 3 assignees.
const annaToken = jwt.sign({ id: anna, role: 'user', tv: 0 }, secret, { expiresIn: '30m' });
const postAs = async (p, body) => {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${annaToken}` },
    body: JSON.stringify(body),
  });
  return { status: res.status };
};
const adminToken = jwt.sign({ id: admin, role: 'admin', tv: 0 }, secret, { expiresIn: '30m' });
const postAsAdmin = async (p, body) => {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });
  return { status: res.status };
};
db.prepare('UPDATE tasks SET status = ?, completed_at = NULL, completed_by = NULL WHERE id = ?').run('in_progress', taskD);
const preAnna = kpi(anna).points;
const preBen = kpi(ben).points;
const preCara = kpi(cara).points;
r = await postAs(`/${taskD}/status`, { status: 'done' });
check('an assignee closing the task is accepted', r.status === 200, `${r.status}`);

const rows2 = db.prepare('SELECT user_id, completed_at FROM task_assignees WHERE task_id = ? ORDER BY user_id').all(taskD);
check('exactly one assignee is credited with completion',
  rows2.filter((x) => x.completed_at).length === 1, `${rows2.filter((x) => x.completed_at).length} of 3`);
check('the other two stay incomplete', rows2.filter((x) => !x.completed_at).length === 2);
check('the completer gains one share of 10 across 3 people',
  round2(kpi(anna).points - preAnna) === 3.34, `gained ${round2(kpi(anna).points - preAnna)}`);
check('the non-completing assignees gain nothing',
  round2(kpi(ben).points - preBen) === 0 && round2(kpi(cara).points - preCara) === 0,
  `ben +${round2(kpi(ben).points - preBen)} cara +${round2(kpi(cara).points - preCara)}`);

console.log('\n--- 9. reopening stops the payment ---');
const afterOpen = kpi(anna).points;
// The task is now completed, so a plain user may not reopen it: that is the
// completed-task lock, and it is what stops points being recycled at will.
r = await postAs(`/${taskD}/status`, { status: 'in_progress' });
check('an ordinary user cannot reopen a completed task', r.status === 403, `got ${r.status}`);
check('and so their points are untouched', round2(kpi(anna).points - afterOpen) === 0,
  `${afterOpen} -> ${kpi(anna).points}`);
r = await postAsAdmin(`/${taskD}/status`, { status: 'in_progress' });
check('an administrator can', r.status === 200, `got ${r.status}`);
check('the points are withdrawn on reopen', kpi(anna).points < afterOpen,
  `${afterOpen} -> ${kpi(anna).points}`);
check('the personal completion is cleared too',
  db.prepare('SELECT COUNT(*) c FROM task_assignees WHERE task_id = ? AND completed_at IS NOT NULL').get(taskD).c === 0);
check('the task no longer claims a completion time',
  db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(taskD).completed_at === null);

console.log('\n--- 10. the backfill migration credits historic completers ---');
{
  // Simulate a pre-migration row: a task recorded as done, but the assignee
  // row never stamped. That is the shape of every completion from before the
  // per-assignee column existed.
  const legacy = mkTask('Legacy completed task', anna, 'TSK-EEEEEE01');
  insAsg.run(legacy, anna);
  setTaskDone(legacy, anna, '2026-01-09 10:00:00');
  db.prepare("UPDATE task_assignees SET completed_at = NULL, progress = 0, status = 'todo' WHERE task_id = ?").run(legacy);
  check('before the backfill the historic completion is invisible',
    db.prepare('SELECT completed_at FROM task_assignees WHERE task_id = ?').get(legacy).completed_at === null);

  // Run the migration body exactly as migrate() would, against the same handle.
  const backfilled = db.prepare(`
    UPDATE task_assignees SET completed_at = (
      SELECT t.completed_at FROM tasks t
      WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL
    )
    WHERE completed_at IS NULL
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL)
      AND (
        EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id AND t.completed_by = task_assignees.user_id)
        OR 1 = (SELECT COUNT(*) FROM task_assignees x WHERE x.task_id = task_assignees.task_id)
      )
  `).run();
  const row = db.prepare('SELECT completed_at FROM task_assignees WHERE task_id = ?').get(legacy);
  check('the backfill credits the sole assignee of a historic done task',
    row.completed_at === '2026-01-09 10:00:00', JSON.stringify(row));
  check('that historic completion now scores its full 10',
    round2(kpi(anna).points) === 10, `${kpi(anna).points}`);

  // Re-running must not double-credit or drift.
  db.prepare(`
    UPDATE task_assignees SET completed_at = (
      SELECT t.completed_at FROM tasks t
      WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL
    )
    WHERE completed_at IS NULL
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL)
      AND (
        EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id AND t.completed_by = task_assignees.user_id)
        OR 1 = (SELECT COUNT(*) FROM task_assignees x WHERE x.task_id = task_assignees.task_id)
      )
  `).run();
  check('re-running the backfill changes nothing', round2(kpi(anna).points) === 10, `${kpi(anna).points}`);

  // An ambiguous historic task: two assignees, and the recorded completer is
  // not one of them. It must NOT be credited to the wrong person.
  const ambiguous = mkTask('Ambiguous legacy task', anna, 'TSK-FFFFFF01');
  insAsg.run(ambiguous, cara);
  insAsg.run(ambiguous, dan);
  setTaskDone(ambiguous, anna, '2026-01-10 10:00:00'); // completer is anna, not an assignee
  const caraBefore = kpi(cara).points;
  db.prepare(`
    UPDATE task_assignees SET completed_at = (
      SELECT t.completed_at FROM tasks t
      WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL
    )
    WHERE completed_at IS NULL
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL)
      AND (
        EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id AND t.completed_by = task_assignees.user_id)
        OR 1 = (SELECT COUNT(*) FROM task_assignees x WHERE x.task_id = task_assignees.task_id)
      )
  `).run();
  check('an ambiguous legacy task credits nobody rather than the wrong person',
    kpi(cara).points === caraBefore && kpi(dan).points === 0,
    `cara ${caraBefore} -> ${kpi(cara).points}, dan ${kpi(dan).points}`);
}

console.log('\n--- 11. the specified example: creator + 2 assignees, bonus included ---');
// Eve creates a 10-point task and assigns Ben and Cara, so the participant set
// is the three of them with no other way in. Base 10 plus the 5-point on-time
// bonus makes 15, and 15 / 3 is 5 each.
const eve = mkUser('Eve');
const taskE = mkTask('Eve delegates to two', eve, 'TSK-GGGGGG01');
assign(taskE, eve, ben, cara);
// Measured as deltas so this section stays independent of what the earlier
// sections happened to leave Ben and Cara with.
const preEveKpi = kpi(eve).points + kpi(eve).bonus;
const preBenKpi = kpi(ben).points + kpi(ben).bonus;
const preCaraKpi = kpi(cara).points + kpi(cara).bonus;
completeAs(taskE, eve, '2026-01-11 10:00:00');   // on time: due 2026-01-20
completeAs(taskE, ben, '2026-01-11 11:00:00');
completeAs(taskE, cara, '2026-01-11 12:00:00');
setTaskDone(taskE, eve, '2026-01-11 12:00:00');

const eveKpi = kpi(eve), benKpi = kpi(ben), caraKpi = kpi(cara);
const eveGain = round2(eveKpi.points + eveKpi.bonus - preEveKpi);
const benGain = round2(benKpi.points + benKpi.bonus - preBenKpi);
const caraGain = round2(caraKpi.points + caraKpi.bonus - preCaraKpi);
check('the creator is one of the three participants', eveGain === 5, `${eveGain}`);
check('the first assignee gets the same 5', benGain === 5, `${benGain}`);
check('the second assignee gets the same 5', caraGain === 5, `${caraGain}`);
check('the three shares add up to the full 15', round2(eveGain + benGain + caraGain) === 15,
  `${eveGain} + ${benGain} + ${caraGain}`);
check('each of them was credited a bonus share rather than the whole 5',
  round2(eveKpi.bonus) === 1.67 && round2(caraKpi.bonus) === 1.67,
  `eve ${round2(eveKpi.bonus)} cara ${round2(caraKpi.bonus)}`);

server.close();
db.close();

if (process.env.KEEP_DB) {
  console.log(`\nkept test db at ${ISO}`);
} else {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = ISO + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
// Exit on the natural event loop instead of forcing process.exit, which races
// the still-open server socket on Windows and trips a libuv assertion.
if (fail) process.exitCode = 1;