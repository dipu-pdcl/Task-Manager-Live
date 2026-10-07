// End-to-end check of completion tracking against the live API.
// Creates a throwaway task as one user, completes it, and verifies who and
// when are recorded -- then cleans up.
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const env = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('JWT_SECRET=')).split('=')[1].trim();
const d = new DatabaseSync('data/taskflow.db', { readOnly: true });
const creator = d.prepare("SELECT id,email,name,role,token_version FROM users WHERE role='super_admin' AND is_active=1 LIMIT 1").get();
d.close();

const H = { Authorization: `Bearer ${jwt.sign({ id: creator.id, role: creator.role, email: creator.email, tv: creator.token_version || 0 }, env, { expiresIn: '30m' })}`, 'Content-Type': 'application/json' };
const api = (p, o = {}) => fetch('http://127.0.0.1:3001/api' + p, { headers: H, ...o });

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

const created = await (await api('/tasks', { method: 'POST', body: JSON.stringify({ title: '__completion_probe__', description: '', status: 'todo', priority: 'low', assignees: [creator.id] }) })).json();
check('created probe task', !!created.id, `#${created.id}`);
check('new task has no completer yet', created.completed_by == null && created.completed_at == null);

console.log('\ncreating a task already in the done state');
const born = await (await api('/tasks', { method: 'POST', body: JSON.stringify({ title: '__born_done_probe__', status: 'done', priority: 'low', assignees: [creator.id] }) })).json();
const bornFull = await (await api(`/tasks/${born.id}`)).json();
check('born-done records a completer', bornFull.completed_by === creator.id, `${bornFull.completed_by_name}`);
check('born-done records a date', !!bornFull.completed_at, bornFull.completed_at);
check('born-done is 100% progress', bornFull.progress === 100, String(bornFull.progress));
const bornHist = (bornFull.history || []).filter((h) => h.action === 'task.completed');
check('born-done has a task.completed history entry', bornHist.length === 1, `${bornHist.length}`);
await api(`/tasks/${born.id}`, { method: 'DELETE' });

console.log(`\ncompleting as ${creator.name} (id ${creator.id}) via POST /tasks/:id/status`);
await api(`/tasks/${created.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'done' }) });

const after = await (await api(`/tasks/${created.id}`)).json();
check('status is done', after.status === 'done', after.status);
check('completed_at recorded', !!after.completed_at, after.completed_at);
check('completed_by = the user who completed it', after.completed_by === creator.id, `got ${after.completed_by}`);
check('completed_by_name returned to the UI', after.completed_by_name === creator.name, `got "${after.completed_by_name}"`);

const hist = (after.history || []).filter((h) => h.action === 'task.completed');
check('activity history has a task.completed entry', hist.length === 1, `${hist.length} found`);
check('history entry names the completer', hist[0] && hist[0].user_name === creator.name, hist[0] ? hist[0].user_name : 'none');

console.log('\nreopening the task');
await api(`/tasks/${created.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'in_progress' }) });
const reopened = await (await api(`/tasks/${created.id}`)).json();
check('completed_at cleared on reopen', reopened.completed_at == null, String(reopened.completed_at));
check('completed_by cleared on reopen', reopened.completed_by == null, String(reopened.completed_by));

console.log('\nre-completing, then the PUT /:id edit path');
await api(`/tasks/${created.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'done' }) });
const put = await (await api(`/tasks/${created.id}`, { method: 'PUT', body: JSON.stringify({ title: '__completion_probe__', status: 'in_progress' }) })).json();
check('PUT to non-done clears completer', put.completed_by == null, String(put.completed_by));
await api(`/tasks/${created.id}`, { method: 'PUT', body: JSON.stringify({ title: '__completion_probe__', status: 'done' }) });
const put2 = await (await api(`/tasks/${created.id}`)).json();
check('PUT to done records completer', put2.completed_by === creator.id && !!put2.completed_by_name, `${put2.completed_by_name}`);

console.log('\nreport export carries Completed By');
const csv = await (await api('/reports/export?type=tasks&format=csv')).text();
const head = csv.split(/\r?\n/)[0];
check('CSV header has a Completed By column', /Completed By/.test(head), head.slice(0, 160));
const mine = csv.split(/\r?\n/).find((l) => l.includes('__completion_probe__'));
check('CSV row for the probe includes the completer name', !!mine && mine.includes(creator.name), mine ? mine.slice(0, 200) : 'row not found');

console.log('\ncleanup');
await api(`/tasks/${created.id}`, { method: 'DELETE' });
const gone = await api(`/tasks/${created.id}`);
check('probe task deleted', gone.status === 404, `status ${gone.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);