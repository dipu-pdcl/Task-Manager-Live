import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const secret = fs.readFileSync('E:/ICT Task Manager - LLM/backend/.env', 'utf8')
  .split(/\r?\n/).find((l) => l.trim().startsWith('JWT_SECRET='))?.split('=')[1]?.trim();
const d = new DatabaseSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db', { readOnly: true });
const a = d.prepare("SELECT id,email,role,token_version FROM users WHERE role='super_admin' AND is_active=1 LIMIT 1").get();
// A regular (non-daily) task that has a code
const t = d.prepare("SELECT id, task_code, title FROM tasks WHERE task_code<>'' AND (daily_task_key='' OR daily_task_key IS NULL) ORDER BY id DESC LIMIT 1").get();
d.close();
const H = { Authorization: `Bearer ${jwt.sign({ id: a.id, role: a.role, email: a.email, tv: a.token_version || 0 }, secret, { expiresIn: '30m' })}` };
const search = async (q) => (await (await fetch(`http://127.0.0.1:3001/api/tasks?limit=100&search=${encodeURIComponent(q)}`, { headers: H })).json());

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };
const has = (rows, id) => rows.some((r) => r.id === id);

console.log(`target: task #${t.id}  ${t.task_code}  "${t.title.slice(0, 40)}"\n`);

const rows = await search(t.task_code);
check(`full Task ID "${t.task_code}" finds the task`, has(rows, t.id), `${rows.length} results`);
check('  and returns the exact code', rows.find((r) => r.id === t.id)?.task_code === t.task_code);

const lower = await search(t.task_code.toLowerCase());
check('lowercase Task ID also works', has(lower, t.id), `${lower.length} results`);

const partial = await search(t.task_code.slice(4, 10));
check('partial code (no prefix) narrows', has(partial, t.id), `${partial.length} results`);

const withPrefix = await search(t.task_code.slice(0, 8));
check('partial code (with prefix) works', has(withPrefix, t.id), `${withPrefix.length} results`);

check('bare task number finds it', has(await search(String(t.id)), t.id));
check('"#number" finds it', has(await search(`#${t.id}`), t.id));

const exact = await search(String(t.id));
const all = await search('');
check('bare number is an exact match, not a substring', exact.length <= 1, `${exact.length} results for "${t.id}"`);

check('title still searchable', has(await search(t.title.slice(0, 18)), t.id));
check('description still searchable', (await search('acceptance criteria')).length > 0, 'seeded descriptions matched');

const gibberish = await search('ZZZZZZZZZZZZ');
check('nonsense code returns nothing', gibberish.length === 0, `${gibberish.length} results`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);