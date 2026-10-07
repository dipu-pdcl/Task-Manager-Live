// Isolated test for assignee visibility. The requirement is that assigned
// person names show up on a task everywhere it appears: the list, the detail
// page, the reports and every export format. Seeds a throwaway DB via DB_PATH.
// Never touches the live database.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'assignee-visibility-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'assignee-visibility-test-secret';

const { db, ensureSchema } = await import('../src/db.js');
ensureSchema(db);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

// ---- seed -----------------------------------------------------------------
const roleGroup = (slug, perms) => {
  const existing = db.prepare('SELECT id FROM role_groups WHERE slug = ?').get(slug);
  if (existing) {
    db.prepare('UPDATE role_groups SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), existing.id);
    return existing.id;
  }
  return Number(db.prepare('INSERT INTO role_groups (name,slug,permissions) VALUES (?,?,?)')
    .run(slug, slug, JSON.stringify(perms)).lastInsertRowid);
};
const rgAdmin = roleGroup('admin', [
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.status', 'tasks.assign',
  'reports.view', 'reports.export', 'dashboard.view',
]);
const rgUser = roleGroup('assignee-user', ['tasks.view', 'reports.view']);

const mkUser = (name, email, rg) => Number(
  db.prepare("INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES (?,?,'x','user',?)")
    .run(name, email, rg).lastInsertRowid,
);
const adminId = Number(db.prepare(
  "INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES ('Assignee Admin','aadmin@t.test','x','admin',?)"
).run(rgAdmin).lastInsertRowid);
const owner = mkUser('Task Owner', 'owner@t.test', rgUser);
const one = mkUser('Assignee One', 'one@t.test', rgUser);
const two = mkUser('Assignee Two', 'two@t.test', rgUser);

const insTask = db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,created_by,task_code,created_at,due_date)
  VALUES (?,'todo','medium','medium',?,?,'2026-01-02 09:00:00','2026-01-20')`);
const mkTask = (title, by) => Number(insTask.run(title, by, `TSK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`).lastInsertRowid);
const insAsg = db.prepare("INSERT INTO task_assignees (task_id,user_id,status,assigned_at) VALUES (?,?,'todo','2026-01-02 09:00:00')");

// Three assignees, so an "all names" assertion is meaningful.
const taskShared = mkTask('Task with three assignees', owner);
insAsg.run(taskShared, one);
insAsg.run(taskShared, two);
insAsg.run(taskShared, owner);

// A task with nobody on it, to prove the unassigned case is reported as such
// rather than silently blank.
const taskNone = mkTask('Task with no assignees', owner);

// A self task, which is the only kind the Self Task Report covers, carrying the
// same three assignees so the column has something to show.
const taskSelf = mkTask('Self task with three assignees', owner);
db.prepare('UPDATE tasks SET is_self_task = 1 WHERE id = ?').run(taskSelf);
insAsg.run(taskSelf, one);
insAsg.run(taskSelf, two);
insAsg.run(taskSelf, owner);

const { default: jwt } = await import('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const token = (id) => jwt.sign({ id, role: 'user', tv: 0 }, JWT_SECRET, { expiresIn: '30m' });

const { default: taskRoutes } = await import('../src/routes/tasks.js');
const { default: reportRoutes } = await import('../src/routes/reports.js');
const { default: dashboardRoutes } = await import('../src/routes/dashboard.js');

const app = express();
app.use(express.json());
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const ROOT = `http://127.0.0.1:${server.address().port}`;

const auth = { Authorization: `Bearer ${token(adminId)}` };
const getJson = async (p) => {
  const res = await fetch(ROOT + p, { headers: auth });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const getText = async (p) => {
  const res = await fetch(ROOT + p, { headers: auth });
  return { status: res.status, text: await res.text(), res };
};

console.log('--- 1. the task list carries every assignee ---');
const list = await getJson('/api/tasks');
const listRows = Array.isArray(list.body) ? list.body : list.body?.data || [];
const sharedRow = listRows.find((t) => t.id === taskShared);
check('the shared task is in the list', !!sharedRow, `list status ${list.status}`);
check('it has three assignees', sharedRow?.assignees?.length === 3, `${sharedRow?.assignees?.length}`);
const listNames = (sharedRow?.assignees || []).map((a) => a.user_name).sort();
check('all three names are present', JSON.stringify(listNames) === JSON.stringify(['Assignee One', 'Assignee Two', 'Task Owner']),
  JSON.stringify(listNames));
check('an unassigned task reports an empty list rather than being absent',
  listRows.find((t) => t.id === taskNone)?.assignees?.length === 0);

console.log('\n--- 2. the task detail page carries them too (regression) ---');
// taskJson only reads the assignee map it is handed, and the detail route used
// to call it without one, which silently returned assignees: [].
const detail = await getJson(`/api/tasks/${taskShared}`);
check('detail returns 200', detail.status === 200, `${detail.status}`);
check('detail carries all three assignees', detail.body?.assignees?.length === 3, `${detail.body?.assignees?.length}`);
const detailNames = (detail.body?.assignees || []).map((a) => a.user_name).sort();
check('with all three names', JSON.stringify(detailNames) === JSON.stringify(['Assignee One', 'Assignee Two', 'Task Owner']),
  JSON.stringify(detailNames));
check('each assignee still exposes the progress and status the detail page uses',
  detail.body?.assignees?.every((a) => typeof a.progress === 'number' && typeof a.status === 'string'));
const noneDetail = await getJson(`/api/tasks/${taskNone}`);
check('an unassigned task reports none on the detail page', noneDetail.body?.assignees?.length === 0);

console.log('\n--- 3. the dashboard task feed names them ---');
const dash = await getJson('/api/dashboard');
const recent = (dash.body?.recentTasks || []).find((t) => t.id === taskShared);
check('the shared task is in recentTasks', !!recent, `dashboard status ${dash.status}`);
check('it carries a comma-joined assignee string',
  /Assignee One/.test(recent?.assigned_names || '') && /Task Owner/.test(recent?.assigned_names || ''),
  recent?.assigned_names);
check('and the team/branch names the page renders are now populated',
  'team_name' in (recent || {}), Object.keys(recent || {}).length);

console.log('\n--- 4. the tasks report JSON names them ---');
const rep = await getJson('/api/reports/tasks');
const repRows = Array.isArray(rep.body) ? rep.body : rep.body?.data || [];
const repRow = repRows.find((t) => t.id === taskShared);
check('the report row is present', !!repRow, `report status ${rep.status}`);
check('it carries all three names',
  /Assignee One/.test(repRow?.assigned_names || '')
  && /Assignee Two/.test(repRow?.assigned_names || '')
  && /Task Owner/.test(repRow?.assigned_names || ''),
  repRow?.assigned_names);
check('an unassigned task yields an empty string, not undefined',
  repRows.find((t) => t.id === taskNone)?.assigned_names === null || repRows.find((t) => t.id === taskNone)?.assigned_names === '',
  String(repRows.find((t) => t.id === taskNone)?.assigned_names));

console.log('\n--- 5. every tasks export format carries the column ---');
const csv = await getText('/api/reports/export?type=tasks&format=csv');
check('CSV export succeeds', csv.status === 200, `${csv.status}`);
check('CSV has an Assigned To header', /Assigned To/.test(csv.text));
check('CSV lists all three names', /Assignee One/.test(csv.text) && /Task Owner/.test(csv.text));

for (const fmt of ['xlsx', 'pdf']) {
  const res = await fetch(`${ROOT}/api/reports/export?type=tasks&format=${fmt}`, { headers: auth });
  const buf = Buffer.from(await res.arrayBuffer());
  check(`${fmt.toUpperCase()} export succeeds`, res.status === 200, `${res.status}`);
  check(`${fmt.toUpperCase()} export is a real file, not an empty or error body`,
    buf.length > 500 && res.headers.get('content-type') !== 'application/json',
    `${buf.length} bytes, ${res.headers.get('content-type')}`);
}

console.log('\n--- 6. the self task report names them, on screen and in exports ---');
// Scoped to the seed's own dates, otherwise the default period yields no rows
// and an empty export has no headers at all.
const RANGE = 'dateKey=custom&date_from=2026-01-01&date_to=2026-12-31';
const selfJson = await getJson(`/api/reports/self-tasks?${RANGE}`);
const selfRows = Array.isArray(selfJson.body) ? selfJson.body : selfJson.body?.rows || [];
const selfRow = selfRows.find((r) => r.id === taskSelf);
check('the self task row is present', !!selfRow, `status ${selfJson.status} rows ${selfRows.length}`);
check('it carries the assignee names',
  /Assignee One/.test(selfRow?.assigned_names || ''), selfRow?.assigned_names);

const selfCsv = await getText(`/api/reports/export?type=selftasks&format=csv&${RANGE}`);
check('the self task CSV export succeeds', selfCsv.status === 200, `${selfCsv.status}`);
check('it has an Assigned To header', /Assigned To/.test(selfCsv.text));
check('and the names in the row', /Assignee One/.test(selfCsv.text));

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