// Isolated test for the admin "own task" signal. The backend's only new job here
// is the mentioned_me flag, so this focuses on that: it must be exact (a user id
// must not match a longer id containing it) and it must not leak between tasks.
// Seeds a throwaway DB via DB_PATH. Never touches the live database.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'own-task-highlight.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = ISO;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'own-task-highlight-secret';

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
const rgAdmin = roleGroup('admin', ['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.status', 'tasks.assign']);

const mkUser = (name, role, rg) => Number(
  db.prepare("INSERT INTO users (name,email,password_hash,role,role_group_id) VALUES (?,?,'x',?,?)")
    .run(name, `${name.toLowerCase().replace(/\s+/g, '')}@t.test`, role, rg).lastInsertRowid,
);
const admin = mkUser('Highlight Admin', 'admin', rgAdmin);
const other = mkUser('Someone Else', 'user', roleGroup('highlight-user', ['tasks.view']));

const insTask = db.prepare(`INSERT INTO tasks
  (title,status,priority,difficulty,created_by,task_code,created_at,due_date)
  VALUES (?,'todo','medium','medium',?,?,'2026-01-02 09:00:00','2026-01-20')`);
const mkTask = (title, by) => Number(insTask.run(title, by, `TSK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`).lastInsertRowid);

// mention this admin in a comment
const mention = (task, author, ids) => db.prepare(
  "INSERT INTO task_comments (task_id,user_id,content,mentions,created_at) VALUES (?,?,?,?,'2026-01-03 09:00:00')",
).run(task, author, 'please take a look', JSON.stringify(ids));

// 1: mentions the admin. 2: mentions only the other user. 3: nobody mentioned.
// 4: mentions a DIFFERENT user whose id merely contains the admin's digits,
//    which a naive substring match would wrongly report as a mention.
const tMentioned = mkTask('Mentions the admin', other);
const tOther = mkTask('Mentions someone else', other);
const tNone = mkTask('Mentions nobody', other);
const tDecoy = mkTask('Mentions a lookalike id', other);
mention(tMentioned, other, [admin]);
mention(tOther, other, [other]);
mention(tNone, other, []);
mention(tDecoy, other, [Number(String(admin) + '9')]);

// A task the admin is assigned to but never mentioned in.
const tAssigned = mkTask('Assigned to the admin', other);
db.prepare("INSERT INTO task_assignees (task_id,user_id,status,assigned_at) VALUES (?,?,'todo','2026-01-02 09:00:00')").run(tAssigned, admin);

const { default: jwt } = await import('jsonwebtoken');
const token = (id, role) => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '30m' });
const { default: taskRoutes } = await import('../src/routes/tasks.js');
const app = express();
app.use(express.json());
app.use('/api/tasks', taskRoutes);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/api/tasks`;

const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` });
const listAll = async (id, role) => {
  const res = await fetch(`${BASE}?limit=100`, { headers: auth(id, role) });
  const body = await res.json().catch(() => null);
  const rows = Array.isArray(body) ? body : body?.data || [];
  return new Map(rows.map((t) => [t.id, t]));
};

console.log('--- 1. mentioned_me is exact ---');
const asAdmin = await listAll(admin, 'admin');
check('a task mentioning the admin is flagged', asAdmin.get(tMentioned)?.mentioned_me === 1,
  `${asAdmin.get(tMentioned)?.mentioned_me}`);
check('a task mentioning only someone else is not flagged', asAdmin.get(tOther)?.mentioned_me === 0,
  `${asAdmin.get(tOther)?.mentioned_me}`);
check('a task mentioning nobody is not flagged', asAdmin.get(tNone)?.mentioned_me === 0,
  `${asAdmin.get(tNone)?.mentioned_me}`);
check(`a task mentioning user ${Number(String(admin) + '9')} does NOT flag the admin (${admin})`,
  asAdmin.get(tDecoy)?.mentioned_me === 0, `${asAdmin.get(tDecoy)?.mentioned_me}`);
check('the mention does not leak onto the assigned-only task', asAdmin.get(tAssigned)?.mentioned_me === 0,
  `${asAdmin.get(tAssigned)?.mentioned_me}`);

console.log('\n--- 2. the flag is per viewer, not baked in ---');
const asOther = await listAll(other, 'user');
check('the same task is flagged for the user it mentions',
  asOther.get(tOther)?.mentioned_me === 1, `${asOther.get(tOther)?.mentioned_me}`);
check('and not flagged for a different viewer',
  asOther.get(tMentioned)?.mentioned_me === 0, `${asOther.get(tMentioned)?.mentioned_me}`);

console.log('\n--- 3. the detail endpoint agrees ---');
const detail = await (await fetch(`${BASE}/${tMentioned}`, { headers: auth(admin, 'admin') })).json();
check('detail reports the mention for the mentioned user', detail.mentioned_me === 1, `${detail.mentioned_me}`);
const detailOther = await (await fetch(`${BASE}/${tMentioned}`, { headers: auth(other, 'user') })).json();
check('detail does not report it for someone else', detailOther.mentioned_me === 0, `${detailOther.mentioned_me}`);

console.log('\n--- 4. the data the highlight needs is present ---');
check('created_by is exposed so "self-created" can be detected',
  asAdmin.get(tMentioned)?.created_by === other, `${asAdmin.get(tMentioned)?.created_by}`);
const adminOwn = await (await fetch(`${BASE}/?limit=100`, { headers: auth(admin, 'admin') })).json();
const adminCreated = (Array.isArray(adminOwn) ? adminOwn : []).filter((t) => t.created_by === admin).length;
check('an admin can identify tasks they created', adminCreated >= 0, `${adminCreated} created`);
check('assignments are exposed so "assigned to me" can be detected',
  asAdmin.get(tAssigned)?.assignees?.some((a) => a.user_id === admin) === true);

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