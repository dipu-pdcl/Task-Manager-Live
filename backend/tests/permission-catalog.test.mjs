// Guard for the System Permissions Catalog.
//
// Purpose: a new backend feature must not be shippable without declaring its
// permissions. This script fails when
//   - a requirePermission('x') string is used anywhere but is not in the catalog
//   - a seeded role references a permission that is not in the catalog
//   - a permission id does not live under its own module's namespace
//   - a route file is a new feature but declares no permissions and is not
//     explicitly acknowledged below
//   - a super_admin_only flag and SUPER_ADMIN_ONLY_PERMISSIONS disagree
//
// Run: node backend/tests/permission-catalog.test.mjs   (or: npm test)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_MODULES, ALL_PERMISSION_IDS, SUPER_ADMIN_ONLY_PERMISSIONS, DEFAULT_ROLE_GROUPS, PERMISSION_GRANTS } from '../src/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');
const ROUTES_DIR = path.join(SRC, 'routes');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };
const warn = (n, x = '') => console.log(`WARN  ${n}${x ? ' :: ' + x : ''}`);

/**
 * Route files that deliberately have no catalog permission, with the reason.
 *
 * Anything NOT listed here must declare requirePermission(...) for at least one
 * route. That is what makes "a new feature must appear in the catalog" an
 * enforced rule rather than a convention: add a new route file and this test
 * fails until its module is declared.
 */
const ROUTES_WITHOUT_PERMISSIONS = {
  'auth.js': 'Login, logout, password change and session bootstrap. Must be reachable by users with no permissions at all, otherwise nobody can sign in.',
  'notifications.js': 'Self-scoped: a user only ever sees their own notifications. No cross-user surface, so a permission would add nothing.',
  'uploads.js': 'Serves blobs for other modules (avatars, task/chat attachments) that are already permission-checked at the owning route. Gating here would break those callers.',
  'backup.js': 'Mounted under /api/settings and guarded by requireAuth + requireAdmin. Full backup/restore is inherently an admin operation; modelled by settings.manage.',
  'dataReset.js': 'Guarded by requireRole("super_admin"). Deliberately separate from settings so it cannot be reached by holding a settings permission.',
  'liveStatus.js': 'Read routes are open to any signed-in user by design; the only privileged action (setting another user\'s status) is requireAdmin and matches live_status.manage in the catalog.',
  'dashboard.js': 'Aggregates the caller\'s own scope. Every underlying number is already permission-filtered, and /api/kpi/me relies on the same open-by-default behaviour.',
  'reports.js': 'KNOWN GAP. reports.view and reports.export are in the catalog but no route enforces them, so any signed-in user can read every user\'s KPI report. Worth tightening in a dedicated change.',
  'chat.js': 'KNOWN GAP. Channel membership is enforced in-handler, but there is no chat.* module, so "create channel" and channel admin have no catalog permission.',
  'projects.js': 'KNOWN GAP. Project CRUD is requireAdmin/requireMembership; the UI borrows tasks.* permissions. A projects.* module would be cleaner but a separate change.',
  'kpi.js': 'KPI reporting endpoints (/api/kpi/me, /api/kpi/overview, /api/kpi/users) are read-only aggregations of task completion data. They require authentication but no specific KPI permission; access is implicitly granted to any signed-in user.',
};

console.log('--- 1. catalog integrity ---');
const moduleIds = PERMISSION_MODULES.map((m) => m.id);
const dupModules = moduleIds.filter((id, i) => moduleIds.indexOf(id) !== i);
check('no duplicate module ids', dupModules.length === 0, dupModules.join(', '));

const allPerms = PERMISSION_MODULES.flatMap((m) => m.permissions);
const permIds = allPerms.map((p) => p.id);
const dupPerms = permIds.filter((id, i) => permIds.indexOf(id) !== i);
check('no duplicate permission ids', dupPerms.length === 0, dupPerms.join(', '));

const missingName = allPerms.filter((p) => !p.name || !p.description);
check('every permission has a name and description', missingName.length === 0, missingName.map((p) => p.id).join(', '));

// A permission must live under its own module's namespace, e.g. tasks.* in the
// "tasks" module. Catches a typo like "task.view" declared inside "tasks".
const misNamespaced = PERMISSION_MODULES.flatMap((m) =>
  m.permissions.filter((p) => !p.id.startsWith(`${m.id}.`)).map((p) => `${m.id} -> ${p.id}`));
check('permission ids are namespaced under their module', misNamespaced.length === 0, misNamespaced.join(', '));

const catalogSet = new Set(ALL_PERMISSION_IDS);
console.log(`  catalog: ${PERMISSION_MODULES.length} modules, ${ALL_PERMISSION_IDS.length} permissions`);

console.log('\n--- 2. every permission used in routes is declared ---');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}
const srcFiles = walk(SRC);
const usedPerms = new Map(); // permId -> [files]
// requirePermission is variadic (any-of), e.g.
// requirePermission('kpi.view', 'kpi.manage'), so capture the whole argument
// list and then every quoted id inside it. Matching only the first argument
// would silently under-report.
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const call of text.matchAll(/requirePermission\(([^)]*)\)/g)) {
    for (const m of call[1].matchAll(/'([^']+)'/g)) {
      const id = m[1];
      if (!usedPerms.has(id)) usedPerms.set(id, []);
      usedPerms.get(id).push(path.relative(SRC, file));
    }
  }
}
const undeclared = [...usedPerms.keys()].filter((id) => !catalogSet.has(id));
check('no undeclared permission is enforced by a route', undeclared.length === 0,
  undeclared.map((id) => `${id} (${usedPerms.get(id).join(', ')})`).join('; '));
console.log(`  ${usedPerms.size} distinct permissions enforced by routes`);

console.log('\n--- 3. every feature route file declares permissions ---');
const routeFiles = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js')).sort();
for (const f of routeFiles) {
  const text = fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8');
  const hasPerm = /requirePermission\(\s*'/.test(text);
  const acknowledged = Object.prototype.hasOwnProperty.call(ROUTES_WITHOUT_PERMISSIONS, f);
  if (hasPerm) continue;
  check(`${f} declares permissions or is acknowledged`, acknowledged,
    acknowledged ? '' : 'add its module to PERMISSION_MODULES, or document the reason in ROUTES_WITHOUT_PERMISSIONS');
}
// Stale entries would let a file be deleted while the exception lingers.
const stale = Object.keys(ROUTES_WITHOUT_PERMISSIONS).filter((f) => !routeFiles.includes(f));
check('no stale entries in ROUTES_WITHOUT_PERMISSIONS', stale.length === 0, stale.join(', '));

console.log('\n--- 4. seeded roles only reference real permissions ---');
for (const g of DEFAULT_ROLE_GROUPS) {
  const bad = g.permissions.filter((p) => !catalogSet.has(p));
  check(`${g.slug} references only catalog permissions`, bad.length === 0, bad.join(', '));
}
const superGroup = DEFAULT_ROLE_GROUPS.find((g) => g.slug === 'super_admin');
check('super_admin holds every permission automatically (uses ALL_PERMISSION_IDS)',
  superGroup && superGroup.permissions === ALL_PERMISSION_IDS);

console.log('\n--- 5. super-admin-only flags stay in sync ---');
const flagged = allPerms.filter((p) => p.super_admin_only).map((p) => p.id).sort();
const declared = [...SUPER_ADMIN_ONLY_PERMISSIONS].sort();
const onlyFlagged = flagged.filter((id) => !declared.includes(id));
const onlyDeclared = declared.filter((id) => !flagged.includes(id));
check('no permission is flagged but missing from the array', onlyFlagged.length === 0, onlyFlagged.join(', '));
check('no entry in the array is unflagged', onlyDeclared.length === 0, onlyDeclared.join(', '));

console.log('\n--- 6. existing role groups will receive new permissions ---');
// PERMISSION_GRANTS is the opt-in list that pushes new permissions into
// already-seeded role_groups rows. A typo there would silently do nothing, and
// a slug that is not a real seeded group would never apply.
for (const [slug, grants] of Object.entries(PERMISSION_GRANTS)) {
  const group = DEFAULT_ROLE_GROUPS.find((g) => g.slug === slug);
  check(`PERMISSION_GRANTS["${slug}"] targets a real seeded role group`, !!group);
  const bad = grants.filter((p) => !catalogSet.has(p));
  check(`PERMISSION_GRANTS["${slug}"] references only catalog permissions`, bad.length === 0, bad.join(', '));
  // If a grant is not also in DEFAULT_ROLE_GROUPS the two sources of truth
  // disagree, and a fresh database would end up with different access than an
  // upgraded one.
  if (group) {
    const missingFromSeed = grants.filter((p) => !group.permissions.includes(p));
    check(`PERMISSION_GRANTS["${slug}"] agrees with DEFAULT_ROLE_GROUPS`, missingFromSeed.length === 0,
      `granted on upgrade but absent for a fresh install: ${missingFromSeed.join(', ')}`);
  }
}
// The reverse direction is a warning, not a failure: most seeded permissions
// predate the table and are applied at creation time by the seed loop.
for (const g of DEFAULT_ROLE_GROUPS) {
  const seeded = new Set(g.permissions);
  const upgrades = new Set(PERMISSION_GRANTS[g.slug] || []);
  const drift = [...seeded].filter((p) => !upgrades.has(p) && !g.permissions.includes(p));
  if (drift.length) warn(`${g.slug}: ${drift.join(', ')}`);
}

console.log('\n--- 7. informational: catalog permissions not enforced by any route ---');
const unreferenced = ALL_PERMISSION_IDS.filter((id) => !usedPerms.has(id));
if (unreferenced.length === 0) console.log('  (none)');
else unreferenced.forEach((id) => warn(`${id} is in the catalog but no route enforces it`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
