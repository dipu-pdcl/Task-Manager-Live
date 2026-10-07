// Isolated test for the completed-task status lock. Seeds a throwaway DB via
// DB_PATH and drives the real task routes with real JWTs as an admin, an
// assignee, and a plain user. Never touches the live database.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'status-lock-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'status-lock-test-secret';

const { db, ensureSchema } = await import('../src/db.js');
ensureSchema(db);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

// ---- seed -----------------------------------------------------------------
const rg = (slug, perms) => {
  const ex = db.prepare('SELECT id FROM role_groups WHERE slug = ?').get(slug);
  if (ex) { db.prepare('UPDATE role_groups SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), ex.id); return ex.id; }
  return Number(db.prepare('INSERT INTO role_groups (name,slug,permissions) VALUES (?,?,?)').run(slug, slug, JSON.stringify(perms)).lastInsertRowid);
};
const rgAdmin = rg('admin', ['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.status', 'tasks.delete', 'tasks.assign']);
const rgUser = rg('status-lock-user', ['tasks.view', 'tasks.edit', 'tasks.status']);

const mkUser = (name, email, role, groupId) => Number(
  db.prepare("INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES (?,?,'x',?,?)")
    .run(name, email, role, groupId).lastInsertRowid,
);
const admin = mkUser('Lock Admin', 'lockadmin@t.test', 'admin', rgAdmin);
const worker = mkUser('Lock Worker', 'lockworker@t.test', 'user', rgUser);
const stranger = mkUser('Lock Stranger', 'lockstranger@t.test', 'user', rgUser);

const insTask = db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,created_by,task_code,created_at,due_date)
  VALUES (?,'todo','medium','medium',?,?,'2026-01-02 09:00:00','2026-01-20')`);
const mkTask = (title, by) => Number(insTask.run(title, by, `TSK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`).lastInsertRowid);
const insAsg = db.prepare("INSERT INTO task_assignees (task_id,user_id,status,assigned_at) VALUES (?,?,'todo','2026-01-02 09:00:00')");

// A normal task, shared by worker and stranger, completed by worker.
const tDone = mkTask('Completed shared task', admin);
insAsg.run(tDone, worker);
insAsg.run(tDone, stranger);
db.prepare("UPDATE tasks SET status='done', completed_at='2026-01-05 10:00:00', completed_by=?, progress=100 WHERE id=?").run(worker, tDone);
db.prepare("UPDATE task_assignees SET status='done', progress=100, completed_at='2026-01-05 10:00:00' WHERE task_id=? AND user_id=?").run(tDone, worker);

// An open task for contrast.
const tOpen = mkTask('Open task', admin);
insAsg.run(tOpen, worker);

// A completed DAILY task, which must keep its existing rules (still locked for
// everyone by isPastDailyTask, but must not gain the new admin-only lock).
const tDaily = mkTask('Completed daily task', admin);
db.prepare("UPDATE tasks SET status='done', daily_task_key='dt-1', daily_task_date='2026-01-05', completed_at='2026-01-05 10:00:00', completed_by=?, progress=100 WHERE id=?").run(worker, tDaily);

// ---- app ------------------------------------------------------------------
const jwt = (await import('jsonwebtoken')).default;
const secret = process.env.JWT_SECRET;
const { default: taskRoutes } = await import('../src/routes/tasks.js');
const app = express();
app.use(express.json());
app.use('/api/tasks', taskRoutes);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/api/tasks`;

const tokenFor = (id, role) => jwt.sign({ id, role, tv: 0 }, secret, { expiresIn: '30m' });
const call = async (as, method, p, body) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(as.id, as.role)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const A = { id: admin, role: 'admin' };
const W = { id: worker, role: 'user' };
const S = { id: stranger, role: 'user' };
const statusOf = (id) => db.prepare('SELECT status FROM tasks WHERE id = ?').get(id).status;
const hist = (id, action) => db.prepare('SELECT * FROM task_history WHERE task_id = ? AND action = ? ORDER BY id DESC').all(id, action);

console.log('--- 1. a completed task refuses non-admin status changes ---');
for (const [label, who] of [['assignee', W], ['another assignee', S]]) {
  // 'done' is excluded: re-saving the status a task already has is a no-op,
  // not a change, so it stays allowed (asserted separately in section 5).
  for (const target of ['in_progress', 'todo', 'cancelled', 'on_hold']) {
    const r = await call(who, 'POST', `/${tDone}/status`, { status: target });
    check(`${label} cannot set ${target}`, r.status === 403, `got ${r.status}`);
  }
}
check('the task is still done after every attempt', statusOf(tDone) === 'done', statusOf(tDone));

console.log('\n--- 2. the full-update route is locked too (the obvious bypass) ---');
let r = await call(W, 'PUT', `/${tDone}`, { status: 'in_progress' });
check('PATCH cannot reopen a completed task', r.status === 403, `got ${r.status}`);
check('the rejection names it as locked', r.body?.locked === true, JSON.stringify(r.body));
check('the task is untouched', statusOf(tDone) === 'done');

console.log('\n--- 3. an admin can change it, and it is recorded ---');
const before = statusOf(tDone);
r = await call(A, 'POST', `/${tDone}/status`, { status: 'in_progress' });
check('admin reopen succeeds', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
check('the status actually changed', statusOf(tDone) === 'in_progress', statusOf(tDone));

const ov = hist(tDone, 'status.override');
check('the override is recorded in task history', ov.length === 1, `${ov.length} rows`);
check('the history row names the acting user', ov[0]?.user_id === admin, `user_id ${ov[0]?.user_id}`);
check('the history row records old -> new', ov[0]?.old_value === before && ov[0]?.new_value === 'in_progress',
  `${ov[0]?.old_value} -> ${ov[0]?.new_value}`);
check('the history row carries a date/time', !!ov[0]?.created_at, ov[0]?.created_at);
const chg = hist(tDone, 'status.change');
check('the ordinary status change is still logged', chg.length >= 1);

console.log('\n--- 4. admin actions via PATCH are also recorded as overrides ---');
db.prepare("UPDATE tasks SET status='done', completed_at='2026-01-06 10:00:00', completed_by=? WHERE id=?").run(worker, tDone);
r = await call(A, 'PUT', `/${tDone}`, { status: 'cancelled' });
check('admin PUT override succeeds', r.status === 200, `got ${r.status}`);
check('status changed', statusOf(tDone) === 'cancelled', statusOf(tDone));
const ov2 = hist(tDone, 'status.override');
check('the PUT override is logged too', ov2.length === 2, `${ov2.length} rows`);
check('latest override records done -> cancelled', ov2[0]?.old_value === 'done' && ov2[0]?.new_value === 'cancelled',
  `${ov2[0]?.old_value} -> ${ov2[0]?.new_value}`);

console.log('\n--- 5. re-saving the same status is not an override and not blocked ---');
db.prepare("UPDATE tasks SET status='done', completed_at='2026-01-07 10:00:00' WHERE id=?").run(tDone);
const ovCountBefore = hist(tDone, 'status.override').length;
r = await call(W, 'POST', `/${tDone}/status`, { status: 'done' });
check('a no-op save by a user is allowed', r.status === 200, `got ${r.status}`);
check('it does not manufacture an override record', hist(tDone, 'status.override').length === ovCountBefore);

console.log('\n--- 6. KPI points are protected from a locked task ---');
// stranger is assigned to the completed task but never completed it, so they
// hold no points. Without the lock they could claim their own completion and
// manufacture a share out of a finished task.
const { computeUserKpi } = await import('../src/routes/kpi.js');
const { getSettings } = await import('../src/config.js');
const cfg = getSettings();
const R = ['2026-01-01 00:00:00', '2026-12-31 23:59:59'];
const kpiOf = (id) => computeUserKpi(id, R[0], R[1], cfg);

const ptsBefore = kpiOf(stranger).points;
check('the non-completing assignee starts with no points', ptsBefore === 0, `${ptsBefore}`);
r = await call(S, 'PUT', `/${tDone}/assignees/${stranger}/progress`, { progress: 100 });
check('a non-admin cannot add a personal completion to a locked task', r.status === 403, `got ${r.status}`);
check('no completion was recorded',
  !db.prepare('SELECT completed_at FROM task_assignees WHERE task_id=? AND user_id=?').get(tDone, stranger).completed_at);
check('and no KPI points were created', kpiOf(stranger).points === ptsBefore,
  `${ptsBefore} -> ${kpiOf(stranger).points}`);

// An admin may still correct it.
  r = await call(A, 'PUT', `/${tDone}/assignees/${stranger}/progress`, { progress: 100 });
  check('an admin can record a personal completion', r.status === 200, `got ${r.status}`);
  // New KPI system awards points for task completions (assignee_task: 3, admin_bonus: 1 = 4 points)
  check('admin completion awards assignee points + admin bonus',
    kpiOf(stranger).points === ptsBefore + 4,
    `${ptsBefore} -> ${kpiOf(stranger).points}`);

console.log('\n--- 7. an open task is unaffected ---');
r = await call(W, 'POST', `/${tOpen}/status`, { status: 'in_progress' });
check('a user can still move an open task', r.status === 200, `got ${r.status}`);
check('status changed', statusOf(tOpen) === 'in_progress', statusOf(tOpen));
r = await call(W, 'POST', `/${tOpen}/status`, { status: 'done' });
check('a user can still complete their own task', r.status === 200, `got ${r.status}`);
check('and it becomes locked immediately', statusOf(tOpen) === 'done', statusOf(tOpen));
r = await call(W, 'POST', `/${tOpen}/status`, { status: 'todo' });
check('then it is locked against that same user', r.status === 403, `got ${r.status}`);

console.log('\n--- 8. daily tasks keep their existing rules ---');
// A completed daily task is frozen for everyone by the pre-existing
// past-daily-task rule, and must NOT be additionally gated as admin-only.
r = await call(W, 'POST', `/${tDaily}/status`, { status: 'in_progress' });
check('a past daily task stays read-only for users (pre-existing rule)', r.status === 403, `got ${r.status}`);
check('and it is read-only for admins too', (await call(A, 'POST', `/${tDaily}/status`, { status: 'in_progress' })).status === 403);
// Today's daily task must remain editable by its user: the new lock must not
// leak onto daily tasks.
const tTodayDaily = mkTask('Today daily task', admin);
db.prepare("UPDATE tasks SET daily_task_key='dt-today', daily_task_date=? WHERE id=?").run(new Date().toISOString().slice(0, 10), tTodayDaily);
insAsg.run(tTodayDaily, worker);
r = await call(W, 'POST', `/${tTodayDaily}/status`, { status: 'in_progress' });
check('today\'s daily task is still editable by a user', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(tTodayDaily);
r = await call(W, 'POST', `/${tTodayDaily}/status`, { status: 'todo' });
check('a completed daily task is NOT admin-locked', r.status === 200, `got ${r.status}`);

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
if (fail) process.exitCode = 1;