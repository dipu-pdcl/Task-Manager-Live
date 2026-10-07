// Isolated test for deleting a daily task template. The point that matters is
// what deletion must NOT destroy: completed days and their KPI awards are
// history. Seeds a throwaway DB via DB_PATH. Never touches the live database.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'daily-template-delete.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'daily-template-delete-secret';

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
const rgAdmin = roleGroup('admin', ['daily_task.manage', 'tasks.view']);
const rgUser = roleGroup('daily-user', ['tasks.view']);

const adminId = Number(db.prepare(
  "INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES ('Daily Admin','dadm@t.test','x','admin',?)"
).run(rgAdmin).lastInsertRowid);
const memberId = Number(db.prepare(
  "INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES ('Daily Member','dmem@t.test','x','user',?)"
).run(rgUser).lastInsertRowid);

db.prepare('INSERT INTO daily_task_members (user_id) VALUES (?)').run(memberId);

const mkTemplate = (name, key, enabled = 1) => Number(db.prepare(
  'INSERT INTO daily_task_templates (key,name,description,enabled,points,sort_order) VALUES (?,?,?,?,2,?)'
).run(key, name, '', enabled, 0).lastInsertRowid);

const tplDoomed = mkTemplate('Doomed Task', 'doomed_task');
const tplKept = mkTemplate('Kept Task', 'kept_task');

// A generated task on a PAST day that was completed, with a KPI award. This is
// history and must survive.
const pastDone = Number(db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,created_by,task_code,daily_task_key,daily_task_date,progress,created_at,completed_at,completed_by)
  VALUES ('Old done','done','medium','medium',?,'TSK-OLD001','doomed_task',?,100,'2026-01-02 09:00:00','2026-01-02 18:00:00',?)`)
  .run(adminId, '2026-01-02', memberId).lastInsertRowid);
db.prepare('INSERT INTO task_assignees (task_id,user_id,status,progress,completed_at,assigned_at) VALUES (?,?,\'done\',100,\'2026-01-02 18:00:00\',\'2026-01-02 09:00:00\')').run(pastDone, memberId);
db.prepare('INSERT INTO daily_task_awards (task_id,user_id,points,awarded_at) VALUES (?,?,3,\'2026-01-02 18:00:00\')').run(pastDone, memberId);

const { today } = await import('../src/utils.js');
const todayStr = today();

// A generated task for today that nobody has finished.
const todayOpen = Number(db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,created_by,task_code,daily_task_key,daily_task_date,progress,created_at)
  VALUES ('Today open','todo','medium','medium',?,'TSK-TOD001','doomed_task',?,0,'2026-01-02 09:00:00')`)
  .run(adminId, todayStr).lastInsertRowid);
db.prepare("INSERT INTO task_assignees (task_id,user_id,status,assigned_at) VALUES (?,?,'todo','2026-01-02 09:00:00')").run(todayOpen, memberId);
// An award row can exist for an unfinished task if it was completed then
// reopened; it should not outlive the task.
db.prepare('INSERT INTO daily_task_awards (task_id,user_id,points,awarded_at) VALUES (?,?,3,?)').run(todayOpen, memberId, todayStr);

const { default: jwt } = await import('jsonwebtoken');
const token = (id, role) => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '30m' });
const { default: dailyRoutes } = await import('../src/routes/dailyTasks.js');
const app = express();
app.use(express.json());
app.use('/api/daily-task', dailyRoutes);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/api/daily-task`;

const asAdmin = { Authorization: `Bearer ${token(adminId, 'admin')}` };
const asUser = { Authorization: `Bearer ${token(memberId, 'user')}` };
const del = async (id, headers) => {
  const res = await fetch(`${BASE}/templates/${id}`, { method: 'DELETE', headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tplRow = (id) => db.prepare('SELECT * FROM daily_task_templates WHERE id = ?').get(id);
const taskRow = (id) => db.prepare('SELECT status, daily_task_key FROM tasks WHERE id = ?').get(id);
const awardRows = (taskId) => db.prepare('SELECT * FROM daily_task_awards WHERE task_id = ?').all(taskId);

console.log('--- 1. an admin can delete a template ---');
let r = await del(tplDoomed, asAdmin);
check('delete is accepted', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error || '')}`);
check('the template row is gone', tplRow(tplDoomed) === undefined);
check('other templates are untouched', !!tplRow(tplKept));
check('the response returns the refreshed list',
  Array.isArray(r.body?.templates) && !r.body.templates.some((t) => t.id === tplDoomed),
  `${r.body?.templates?.length} templates`);
check('and it contains the surviving one',
  r.body?.templates?.some((t) => t.id === tplKept) === true);

console.log('\n--- 2. completed history and its KPI award survive ---');
check("a past completed task still exists", !!taskRow(pastDone), JSON.stringify(taskRow(pastDone)));
check('still marked done', taskRow(pastDone)?.status === 'done', taskRow(pastDone)?.status);
check('its KPI award is intact', awardRows(pastDone).length === 1, `${awardRows(pastDone).length}`);
check('with the original points', awardRows(pastDone)[0]?.points === 3, `${awardRows(pastDone)[0]?.points}`);

console.log('\n--- 3. today\'s unfinished copy is tidied away, not left live ---');
check('today\'s task still exists rather than vanishing', !!taskRow(todayOpen));
check('but is cancelled so it cannot be completed', taskRow(todayOpen)?.status === 'cancelled', taskRow(todayOpen)?.status);
check('and its stale award is removed', awardRows(todayOpen).length === 0, `${awardRows(todayOpen).length}`);

console.log('\n--- 4. permissions and bad input ---');
r = await del(tplKept, asUser);
check('an ordinary member cannot delete a template', r.status === 403, `${r.status}`);
check('and it still exists', !!tplRow(tplKept));
r = await del(999999, asAdmin);
check('deleting a template that does not exist is a 404', r.status === 404, `${r.status}`);
r = await del('not-a-number', asAdmin);
check('a non-numeric id is a 404, not a crash', r.status === 404, `${r.status}`);

console.log('\n--- 5. it is audited ---');
const auditRows = db.prepare("SELECT * FROM audit_logs WHERE action = 'daily_task.template_delete'").all();
check('the deletion is recorded in the audit log', auditRows.length === 1, `${auditRows.length} rows`);
check('naming the acting user', auditRows[0]?.user_id === adminId, `${auditRows[0]?.user_id}`);
check('and naming the template', /Doomed Task/.test(auditRows[0]?.details || ''), auditRows[0]?.details);

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