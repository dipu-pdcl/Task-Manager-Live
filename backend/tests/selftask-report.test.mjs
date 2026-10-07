// Isolated Self Task Report test. Seeds a throwaway DB via DB_PATH with known
// self tasks, then drives the reports route handlers directly. Never touches the
// live database.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'selftask-report-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
// env.js normally populates this from backend/.env; the test must not depend on
// that file, so pin a throwaway secret before anything reads it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'selftask-report-test-secret';

const { db, ensureSchema } = await import('../src/db.js');
ensureSchema(db);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

// ---- seed -----------------------------------------------------------------
const insTeam = db.prepare("INSERT INTO teams (name) VALUES (?)");
const insDept = db.prepare("INSERT INTO departments (name) VALUES (?)");
const tA = Number(insTeam.run('Alpha Team').lastInsertRowid);
const tB = Number(insTeam.run('Beta Team').lastInsertRowid);
const dA = Number(insDept.run('Alpha Dept').lastInsertRowid);
const dB = Number(insDept.run('Beta Dept').lastInsertRowid);

const insUser = db.prepare("INSERT INTO users (name,email,password_hash,role,team_id,department_id) VALUES (?,?,'x','user',?,?)");
const u1 = Number(insUser.run('Asha', 'asha@t.test', tA, dA).lastInsertRowid);
const u2 = Number(insUser.run('Bilal', 'bilal@t.test', tB, dB).lastInsertRowid);
const u3 = Number(insUser.run('Chen', 'chen@t.test', null, null).lastInsertRowid);

const insTask = db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,due_date,created_by,is_self_task,task_code,created_at,completed_at,completed_by)
  VALUES (?,?,?,?,?,?,1,?,?,?,?)`);
const mk = (title, status, priority, difficulty, due, by, code, created, completed, compBy) =>
  Number(insTask.run(title, status, priority, difficulty, due, by, code, created, completed, compBy).lastInsertRowid);

// Two users' self tasks, deliberately spread across every filter dimension.
mk('Asha task one', 'done', 'high', 'hard', '2026-01-05', u1, 'TSK-AAAAAAA1', '2026-01-02 10:00:00', '2026-01-04 15:30:45', u1);
mk('Asha task two', 'todo', 'low', 'easy', '2026-01-09', u1, 'TSK-AAAAAAA2', '2026-01-03 10:00:00', null, null);
mk('Bilal task one', 'in_progress', 'critical', 'critical', '2026-01-07', u2, 'TSK-BBBBBBB1', '2026-01-02 11:00:00', null, null);
mk('Bilal task two', 'done', 'medium', 'medium', '2026-01-06', u2, 'TSK-BBBBBBB2', '2026-01-02 12:00:00', '2026-01-05 09:05:00', u2);
mk('Chen task one', 'done', 'medium', 'medium', null, u3, 'TSK-CCCCCCC1', '2026-01-04 09:00:00', '2026-01-04 18:00:00', u3);
// A normal task must never leak into a self-task report.
db.prepare(`INSERT INTO tasks (title,status,priority,is_self_task,task_code,created_by,created_at)
  VALUES ('Not a self task','done','high',0,'TSK-DDDDDDD1',?, '2026-01-02 10:00:00')`).run(u1);

// ---- drive the route through a real express app ---------------------------
// Real seeded users and real JWTs, so requireAuth and requirePermission run for
// genuine rather than being stubbed out.
const { default: jwt } = await import('jsonwebtoken');
// middleware.js resolves the signing key from env, else the settings table.
const JWT_SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
  return row?.value;
})();

const roleGroup = (slug, perms) => {
  const existing = db.prepare('SELECT id FROM role_groups WHERE slug = ?').get(slug);
  if (existing) {
    db.prepare('UPDATE role_groups SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), existing.id);
    return existing.id;
  }
  return Number(db.prepare('INSERT INTO role_groups (name,slug,permissions) VALUES (?,?,?)')
    .run(slug, slug, JSON.stringify(perms)).lastInsertRowid);
};
const rgAdmin = roleGroup('admin', ['reports.view', 'reports.export']);
const rgViewer = roleGroup('viewer', ['reports.view']);
const rgNone = roleGroup('noreports', ['tasks.view']);

const mkUser = (name, email, rg) => Number(
  db.prepare("INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES (?,?,'x','user',?)")
    .run(name, email, rg).lastInsertRowid,
);

const adminId = mkUser('Report Admin', 'radmin@t.test', rgAdmin);
const deniedId = mkUser('Report Denied', 'rdenied@t.test', rgNone);

// The viewer is deliberately u1, who owns self tasks, so the scoping assertions
// are about visibility limits rather than an empty result set.
const viewerId = u1;
db.prepare('UPDATE users SET role_group_id = ? WHERE id = ?').run(rgViewer, viewerId);

const token = (id) => jwt.sign({ id, role: 'user', tv: 0 }, JWT_SECRET, { expiresIn: '30m' });

const { default: reportRoutes } = await import('../src/routes/reports.js');
const app = express();
app.use('/api/reports', reportRoutes);
const server = app.listen(0);
await new Promise((res) => server.once('listening', res));
const BASE = `http://127.0.0.1:${server.address().port}/api/reports`;

let headers = { Authorization: `Bearer ${token(adminId)}` };
const as = (id) => { headers = { Authorization: `Bearer ${token(id)}` }; };
const get = async (p) => {
  const res = await fetch(BASE + p, { headers });
  return { status: res.status, body: await res.json().catch(() => null), res };
};

console.log('--- 1. admin sees every user\'s self tasks, consolidated ---');
as(adminId);
let r = await get('/self-tasks?dateKey=year');
check('200 for admin', r.status === 200, `got ${r.status}`);
check('all 5 self tasks returned', r.body.rows.length === 5, `${r.body.rows.length} rows`);
check('the non-self task is excluded', r.body.rows.every((x) => x.task_id !== 'TSK-DDDDDDD1'));
check('every user is represented', new Set(r.body.rows.map((x) => x.user_name)).size === 3,
  [...new Set(r.body.rows.map((x) => x.user_name))].join(', '));

console.log('\n--- 2. required columns are present and shaped correctly ---');
const one = r.body.rows.find((x) => x.task_id === 'TSK-AAAAAAA1');
check('User Name', one.user_name === 'Asha', one.user_name);
check('Task ID uses the permanent code', one.task_id === 'TSK-AAAAAAA1', one.task_id);
check('Task Title', one.title === 'Asha task one', one.title);
check('Status', one.status === 'done', one.status);
check('Priority', one.priority === 'high', one.priority);
check('Due Date', one.due_date === '2026-01-05', one.due_date);
check('Completion Date is split out', one.completion_date === '2026-01-04', one.completion_date);
check('Completion Time is split out', one.completion_time === '15:30:45', one.completion_time);
// Hard is a flat 2 points now that KPI Point Management sets difficulty rates
// directly, instead of difficulty points multiplied by priority weight.
check('Rating/Difficulty resolved', one.difficulty_label === 'Hard' && one.difficulty_points === 2,
  `${one.difficulty_label} ${one.difficulty_points}pts`);
const open = r.body.rows.find((x) => x.task_id === 'TSK-AAAAAAA2');
check('incomplete task has blank completion fields', open.completion_date === '' && open.completion_time === '');

console.log('\n--- 3. filters ---');
r = await get(`/self-tasks?dateKey=year&user_id=${u1}`);
check('User filter', r.body.rows.length === 2 && r.body.rows.every((x) => x.user_name === 'Asha'),
  `${r.body.rows.length} rows`);

r = await get('/self-tasks?dateKey=year&status=done');
check('Status filter', r.body.rows.length === 3 && r.body.rows.every((x) => x.status === 'done'),
  `${r.body.rows.length} done`);

r = await get('/self-tasks?dateKey=year&priority=critical');
check('Priority filter', r.body.rows.length === 1 && r.body.rows[0].priority === 'critical');

r = await get(`/self-tasks?dateKey=year&team_id=${tB}`);
check('Team filter', r.body.rows.length === 2 && r.body.rows.every((x) => x.team_name === 'Beta Team'),
  r.body.rows.map((x) => x.team_name).join(','));

r = await get(`/self-tasks?dateKey=year&department_id=${dA}`);
check('Department filter', r.body.rows.length === 2 && r.body.rows.every((x) => x.department_name === 'Alpha Dept'),
  r.body.rows.map((x) => x.department_name).join(','));

// Team/department fall back to the creator's own when the task has none set,
// which is only observable because ids arrive from the query string as TEXT.
// Inside COALESCE there is no column affinity, so an uncoerced '12' would
// silently match nothing. These guard that specific regression.
r = await get(`/self-tasks?dateKey=year&team_id=${tA}`);
check('team filter works with a TEXT id from the query string', r.body.rows.length === 2,
  `${r.body.rows.length} rows for team ${tA}`);
r = await get(`/self-tasks?dateKey=year&department_id=${dB}`);
check('department filter works with a TEXT id from the query string', r.body.rows.length === 2,
  `${r.body.rows.length} rows for department ${dB}`);

r = await get('/self-tasks?dateKey=year&team_id=notanumber');
check('a non-numeric id is ignored rather than erroring', r.status === 200 && r.body.rows.length === 5,
  `${r.body.rows.length} rows`);

r = await get('/self-tasks?dateKey=year&search=Chen');
check('Search matches the user name', r.body.rows.length === 1 && r.body.rows[0].user_name === 'Chen');

r = await get('/self-tasks?dateKey=year&search=TSK-BBBB');
check('Search matches a Task ID prefix', r.body.rows.length === 2);

r = await get('/self-tasks?dateKey=custom&from=2026-01-04&to=2026-01-06');
check('Custom date range narrows the result', r.body.rows.length === 1
  && r.body.rows[0].task_id === 'TSK-CCCCCCC1',
  `${r.body.rows.length} rows in 04-06 Jan: ${r.body.rows.map((x) => x.task_id).join(',')}`);

r = await get('/self-tasks?dateKey=custom&from=2026-01-01&to=2026-01-03');
check('Custom range spans every seeded day inclusively', r.body.rows.length === 4,
  `${r.body.rows.length} rows in 01-03 Jan`);

r = await get('/self-tasks?dateKey=today');
check('Out-of-range date preset returns nothing', r.body.rows.length === 0);

r = await get('/self-tasks?dateKey=year&status=all&priority=all&team_id=all&department_id=all&user_id=all');
check('"all" values are ignored rather than filtering to nothing', r.body.rows.length === 5,
  `${r.body.rows.length} rows`);

console.log('\n--- 4. summary is a correct at-a-glance rollup ---');
r = await get('/self-tasks?dateKey=year');
const s = r.body.summary;
check('total', s.total === 5, `${s.total}`);
check('done', s.done === 3, `${s.done}`);
check('open', s.open === 2, `${s.open}`);
check('cancelled', s.cancelled === 0);
check('overdue counts open tasks past their due date', s.overdue === 2, `${s.overdue}`);
check('completion rate', s.completionRate === 60, `${s.completionRate}%`);
check('unique users', s.uniqueUsers === 3, `${s.uniqueUsers}`);
r = await get('/self-tasks?dateKey=year&status=cancelled');
check('empty result does not divide by zero', r.body.summary.completionRate === 0);

console.log('\n--- 5. a non-admin is pinned to their own rows ---');
as(viewerId);
r = await get(`/self-tasks?dateKey=year&user_id=${u2}`);
check('200 for a user', r.status === 200);
check('user_id cannot widen the scope', r.body.rows.length === 2 && r.body.rows.every((x) => x.user_name === 'Asha'),
  `asked for user ${u2}, got: ${r.body.rows.map((x) => x.user_name).join(',') || 'nothing'}`);
check('a viewer sees only their own self tasks', (await get('/self-tasks?dateKey=year')).body.rows.length === 2);

console.log('\n--- 6. permissions ---');
as(deniedId);
r = await get('/self-tasks?dateKey=year');
check('reports.view is enforced on the endpoint', r.status === 403, `got ${r.status}`);
check('the 403 names the missing permission', r.body?.required_permissions?.includes('reports.view'));

as(viewerId);
r = await get('/export?type=selftasks&format=csv&dateKey=year');
check('a non-admin cannot export the consolidated report', r.status === 403, `got ${r.status}`);

console.log('\n--- 7. exports ---');
as(adminId);
const grab = async (format) => {
  const res = await fetch(`${BASE}/export?type=selftasks&format=${format}&dateKey=year`, { headers });
  return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) };
};
const csv = await grab('csv');
check('CSV downloads', csv.status === 200 && csv.type.includes('text/csv'), `${csv.status} ${csv.type}`);
const csvText = csv.buf.toString('utf8');
check('CSV has a BOM for Excel', csvText.charCodeAt(0) === 0xFEFF);
// The header row is written unquoted; only data cells are quoted.
check('CSV carries the required headers', ['User Name', 'Task ID', 'Task Title', 'Status', 'Priority',
  'Due Date', 'Completion Date', 'Completion Time', 'Rating/Difficulty'].every((h) => csvText.includes(h)),
  csvText.split('\n')[0]);
check('CSV includes every self task row', csvText.trim().split('\n').length === 6, `${csvText.trim().split('\n').length} lines`);
check('CSV excludes the non-self task', !csvText.includes('Not a self task'));

const xlsx = await grab('xlsx');
check('XLSX downloads as a real workbook', xlsx.status === 200
  && xlsx.type.includes('spreadsheetml') && xlsx.buf.subarray(0, 2).toString() === 'PK',
  `${xlsx.status} ${xlsx.type} magic=${xlsx.buf.subarray(0, 2).toString()}`);

const pdf = await grab('pdf');
check('PDF downloads', pdf.status === 200 && pdf.type === 'application/pdf', `${pdf.status} ${pdf.type}`);
check('PDF is a real document', pdf.buf.subarray(0, 4).toString() === '%PDF');

console.log('\n--- 8. export honours the same filters as the screen ---');
const filt = await fetch(`${BASE}/export?type=selftasks&format=csv&dateKey=year&user_id=${u2}`, { headers });
const filtText = (await filt.text()).replace(/^\uFEFF/, '');
check('filtered export is narrowed the same way', filtText.trim().split('\n').length === 3
  && filtText.includes('Bilal') && !filtText.includes('Asha'),
  `${filtText.trim().split('\n').length} lines`);

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
process.exit(fail ? 1 : 0);