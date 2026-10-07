import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const secret = fs.readFileSync('E:/ICT Task Manager - LLM/backend/.env', 'utf8')
  .split(/\r?\n/).find((l) => l.trim().startsWith('JWT_SECRET='))?.split('=')[1]?.trim();

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

// --- 1. the role exists and is a system role -------------------------------
const d = new DatabaseSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db', { readOnly: true });
const g = d.prepare("SELECT * FROM role_groups WHERE slug='it_asst'").get();
check('it_asst role group exists', !!g);
if (!g) process.exit(1);
const perms = JSON.parse(g.permissions);
console.log(`  name="${g.name}" is_system=${g.is_system} color=${g.color}`);
console.log(`  permissions: ${perms.join(', ')}\n`);
check('marked as a system role', g.is_system === 1);
check('display name is "IT Asst."', g.name === 'IT Asst.');

console.log('--- 2. required permissions granted ---');
const want = ['tasks.view', 'tasks.status', 'live_status.view', 'leaves.view', 'leaves.apply'];
for (const p of want) check(`has ${p}`, perms.includes(p));

console.log('\n--- 3. nothing else granted ---');
const forbidden = ['tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign', 'daily_task.view', 'daily_task.manage',
  'kpi.view', 'kpi.manage', 'users.view', 'users.manage', 'leaves.approve', 'leaves.manage_quotas',
  'priority_tasks.view', 'priority_tasks.manage', 'live_status.manage', 'reports.view', 'reports.export',
  'audit.view', 'settings.view', 'roles.manage', 'teams.view', 'departments.view'];
for (const p of forbidden) check(`NOT granted: ${p}`, !perms.includes(p));
check('no admin-granting permission present', !perms.some(p => ['settings.manage', 'settings.view', 'roles.manage', 'users.manage', 'teams.manage', 'kpi.manage', 'leaves.approve', 'priority_tasks.manage'].includes(p)));
check('permission set is exactly the intended 5', perms.length === 5, `${perms.length}: ${perms.join(', ')}`);

// --- 4. a real IT Asst. user can be resolved and is not an admin -----------
const admin = d.prepare("SELECT id,email,role,token_version FROM users WHERE role='super_admin' AND is_active=1 LIMIT 1").get();
// Pick a task that a non-admin active user is actually assigned to, so the
// loadTask assigneeship check passes during the enforcement run.
const probe = d.prepare(`SELECT t.id, t.title, t.status FROM tasks t
  JOIN task_assignees ta ON ta.task_id = t.id
  JOIN users u ON u.id = ta.user_id
  WHERE u.is_active = 1 AND u.role <> 'super_admin'
    AND (t.daily_task_key = '' OR t.daily_task_key IS NULL)
  ORDER BY t.id DESC LIMIT 1`).get();
d.close();

const BASE = 'http://127.0.0.1:3001/api';
const hdr = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u.id, role: u.role, email: u.email, tv: u.token_version || 0 }, secret, { expiresIn: '30m' })}`, 'Content-Type': 'application/json' });
const AH = hdr(admin);

console.log('\n--- 5. role is assignable and resolves correctly ---');
const roles = await (await fetch(`${BASE}/settings/role-groups`, { headers: AH })).json();
const list = Array.isArray(roles) ? roles : (roles.groups || roles.data || []);
const itRole = list.find((r) => r.slug === 'it_asst');
check('appears in the role groups API', !!itRole);
check('API reports is_system true', itRole?.is_system === true);
check('API returns the 5 permissions', itRole?.permissions?.length === 5, JSON.stringify(itRole?.permissions));

console.log(`\n--- 6. enforcement for a real member of the it_asst group (task #${probe.id}) ---`);
// The probe token must NOT carry role=super_admin, or every guard short-circuits
// on the super-admin bypass and the checks are meaningless. So point a real
// non-admin user at the it_asst group for the duration of the run, then put
// them back exactly as they were.
const dw = new DatabaseSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db');
const subject = dw.prepare("SELECT u.id, u.email, u.role, u.token_version, u.role_group_id FROM users u JOIN task_assignees ta ON ta.user_id=u.id WHERE ta.task_id=? AND u.is_active=1 AND u.role<>'super_admin' LIMIT 1").get(probe.id);
if (!subject) { dw.close(); console.log('SKIP: no active non-admin assignee found'); }
else {
  const itGroup = dw.prepare("SELECT id FROM role_groups WHERE slug='it_asst'").get();
  const saved = { role: subject.role, role_group_id: subject.role_group_id };
  dw.prepare('UPDATE users SET role = ?, role_group_id = ? WHERE id = ?').run('it_asst', itGroup.id, subject.id);
  dw.close();
  console.log(`  subject: ${subject.email} (was role=${saved.role}, group=${saved.role_group_id})`);
  try {
    const MH = { Authorization: `Bearer ${jwt.sign({ id: subject.id, role: 'it_asst', email: subject.email, tv: subject.token_version || 0 }, secret, { expiresIn: '30m' })}`, 'Content-Type': 'application/json' };
    const call = (m, p, b) => fetch(`${BASE}${p}`, { method: m, headers: MH, body: b ? JSON.stringify(b) : undefined });
    const T = probe.id;

    const me = await (await call('GET', '/auth/me')).json();
    check('resolves to the 5 IT Asst permissions',
      JSON.stringify(me.user?.permissions) === JSON.stringify(want), JSON.stringify(me.user?.permissions));
    check('is not treated as an admin', me.user?.role === 'it_asst');

    check('GET task allowed', (await call('GET', `/tasks/${T}`)).status === 200);
    check('GET /tasks allowed', (await call('GET', '/tasks')).status === 200);
    check('POST comment allowed (Task Comments: Yes)', (await call('POST', `/tasks/${T}/comments`, { content: 'it asst probe comment' })).status === 200);
    check('POST /status allowed (Update Task Status: Yes)', (await call('POST', `/tasks/${T}/status`, { status: 'in_progress' })).status === 200);
    check('POST /tasks blocked (no tasks.create)', (await call('POST', '/tasks', { title: 'x', status: 'todo', priority: 'medium' })).status === 403);
    check('DELETE task blocked (no tasks.delete)', (await call('DELETE', `/tasks/${T}`)).status === 403);
    check('PUT {title} blocked (no tasks.edit)', (await call('PUT', `/tasks/${T}`, { title: 'nope' })).status === 403);
    check('PUT {assignees} blocked (no tasks.assign)', (await call('PUT', `/tasks/${T}`, { assignees: [1] })).status === 403);
    check('POST assignees blocked', (await call('POST', `/tasks/${T}/assignees`, { user_id: 1 })).status === 403);
    check('POST transfer blocked', (await call('POST', `/tasks/${T}/assignees/transfer`, { user_ids: [1] })).status === 403);
    check('POST checklist blocked', (await call('POST', `/tasks/${T}/checklist`, { title: 'x' })).status === 403);
    check('POST approvals blocked', (await call('POST', `/tasks/${T}/approvals`, { approver_id: 1 })).status === 403);
    check('GET /kpi/me allowed (own KPI)', (await call('GET', '/kpi/me')).status === 200);
    check('GET /kpi/users blocked (no leaderboard)', (await call('GET', '/kpi/users')).status === 403);
    check('GET /live-status/overview allowed', (await call('GET', '/live-status/overview')).status === 200);
  } finally {
    // Remove the probe comment and restore the subject's original role/group.
    const dr = new DatabaseSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db');
    dr.prepare("DELETE FROM task_comments WHERE content='it asst probe comment'").run();
    dr.prepare('UPDATE users SET role = ?, role_group_id = ? WHERE id = ?').run(saved.role, saved.role_group_id, subject.id);
    const back = dr.prepare('SELECT role, role_group_id FROM users WHERE id = ?').get(subject.id);
    dr.close();
    check(`subject restored to role=${saved.role} group=${saved.role_group_id}`,
      back.role === saved.role && back.role_group_id === saved.role_group_id, JSON.stringify(back));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);