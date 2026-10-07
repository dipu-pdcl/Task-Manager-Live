import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const secret = fs.readFileSync('E:/ICT Task Manager - LLM/backend/.env', 'utf8')
  .split(/\r?\n/).find((l) => l.trim().startsWith('JWT_SECRET='))?.split('=')[1]?.trim();
const BASE = 'http://127.0.0.1:3001/api';
let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

const d = new DatabaseSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db', { readOnly: true });
console.log('--- 1. catalog exposure ---');
const admin = d.prepare("SELECT id,email,role,token_version FROM users WHERE role='super_admin' AND is_active=1 LIMIT 1").get();
const roles = {};
for (const r of d.prepare('SELECT slug, permissions FROM role_groups').all()) roles[r.slug] = JSON.parse(r.permissions);
d.close();

const AH = { Authorization: `Bearer ${jwt.sign({ id: admin.id, role: admin.role, email: admin.email, tv: admin.token_version || 0 }, secret, { expiresIn: '30m' })}` };
const cat = await (await fetch(`${BASE}/settings/permissions`, { headers: AH })).json();
const docs = cat.modules.find((m) => m.id === 'documents');
check('documents module present in the catalog API', !!docs);
console.log(`  "${docs.name}" -> ${docs.permissions.map((p) => p.id).join(', ')}`);
check('all 4 documents permissions declared', docs.permissions.length === 4);
const rolesMod = cat.modules.find((m) => m.id === 'roles');
check('roles split into its own module', !!rolesMod, `settings now has ${cat.modules.find((m) => m.id === 'settings').permissions.length} permissions`);

console.log('\n--- 2. existing access preserved after the grant migration ---');
for (const [slug, want] of [
  ['admin', ['documents.view', 'documents.upload', 'documents.manage', 'documents.admin']],
  ['sub_admin', ['documents.view', 'documents.upload', 'documents.manage', 'documents.admin']],
  ['user', ['documents.view', 'documents.upload', 'documents.manage']],
]) {
  check(`${slug} has ${want.length} documents perms`, want.every((p) => roles[slug].includes(p)),
    (roles[slug].filter((p) => p.startsWith('documents.'))).join(', '));
}
check('it_asst deliberately has no documents perms', !roles.it_asst.some((p) => p.startsWith('documents.')),
  roles.it_asst.join(', '));
check('super_admin auto-holds every permission', roles.super_admin.length === cat.all_permission_ids.length,
  `${roles.super_admin.length} vs ${cat.all_permission_ids.length}`);

console.log('\n--- 3. enforcement on the DMS API ---');
// A `user`-group member must still work exactly as before.
const dw = new DatabaseSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db');
const plain = dw.prepare(`SELECT u.id,u.email,u.role,u.token_version,u.role_group_id FROM users u
  JOIN role_groups rg ON rg.id=u.role_group_id WHERE rg.slug='user' AND u.is_active=1 LIMIT 1`).get();
const itUser = dw.prepare(`SELECT u.id,u.email,u.role,u.token_version,u.role_group_id FROM users u
  JOIN role_groups rg ON rg.id=u.role_group_id WHERE rg.slug='it_asst' AND u.is_active=1 LIMIT 1`).get();
dw.close();

const tok = (u, role) => ({ Authorization: `Bearer ${jwt.sign({ id: u.id, role, email: u.email, tv: u.token_version || 0 }, secret, { expiresIn: '30m' })}` });
const call = (hdr, m, p) => fetch(`${BASE}${p}`, { method: m, headers: hdr });

if (plain) {
  const H = tok(plain, plain.role);
  check('GET /documents  200 for a user-group member', (await call(H, 'GET', '/documents')).status === 200);
  check('GET /documents/folders 200', (await call(H, 'GET', '/documents/folders')).status === 200);
  check('GET /documents/search 200', (await call(H, 'GET', '/documents/search?q=a')).status === 200);
  // This group DOES hold documents.upload and documents.manage, so these must
  // get past the permission gate. They may still fail validation (no multipart
  // body, no required fields), so assert "not 403" rather than a 2xx.
  const up = await call(H, 'POST', '/documents');
  check('POST /documents passes the permission gate', up.status !== 403, `got ${up.status}`);
  const fold = await call(H, 'POST', '/documents/folders');
  check('POST /documents/folders passes the permission gate', fold.status !== 403, `got ${fold.status}`);
  check('GET /documents/admin/backup blocked (not an admin)', (await call(H, 'GET', '/documents/admin/backup-files')).status === 403);
} else console.log('SKIP: no active user-group member');

if (itUser) {
  // IT Asst has no documents.* at all, so every DMS route must refuse it.
  const H = tok(itUser, itUser.role);
  check('GET /documents blocked for IT Asst', (await call(H, 'GET', '/documents')).status === 403);
  check('GET /documents/search blocked for IT Asst', (await call(H, 'GET', '/documents/search?q=a')).status === 403);
  check('GET /documents/folders blocked for IT Asst', (await call(H, 'GET', '/documents/folders')).status === 403);
  check('POST /documents blocked for IT Asst', (await call(H, 'POST', '/documents')).status === 403);
} else console.log('SKIP: no active IT Asst member');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);