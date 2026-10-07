// Isolated migration + restore test. Runs against a throwaway copy of the DB
// via DB_PATH, never the live database.
import fs from 'node:fs';
import path from 'node:path';

const TMP = 'C:/Users/sdipu/AppData/Local/Temp/kilo';
const ISO = path.join(TMP, 'taskcode-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = ISO + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
fs.copyFileSync('E:/ICT Task Manager - LLM/backend/data/taskflow.db', ISO);
process.env.DB_PATH = ISO;

const { db, ensureSchema, restoreTablesFromData } = await import('../src/db.js');
const { generateTaskCode, backfillTaskCodes } = await import('../src/services/taskCodeService.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };
const q = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);

const before = one('SELECT COUNT(*) c FROM tasks').c;
const beforePt = one('SELECT COUNT(*) c FROM priority_tasks').c;
console.log(`source db: ${before} tasks, ${beforePt} priority tasks\n`);

console.log('--- 1. migration ---');
ensureSchema(db);
const cols = q('PRAGMA table_info(tasks)').map(c => c.name);
check('tasks.task_code column added', cols.includes('task_code'));
check('priority_tasks.task_code column added', q('PRAGMA table_info(priority_tasks)').map(c => c.name).includes('task_code'));
const idx = q("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%task_code'");
check('partial unique indexes created', idx.length === 2, idx.map(i => i.name).join(','));

const noCode = one("SELECT COUNT(*) c FROM tasks WHERE task_code IS NULL OR task_code = ''").c;
const noCodePt = one("SELECT COUNT(*) c FROM priority_tasks WHERE task_code IS NULL OR task_code = ''").c;
check('every task backfilled', noCode === 0, `${noCode} missing of ${before}`);
check('every priority task backfilled', noCodePt === 0, `${noCodePt} missing of ${beforePt}`);

const dupT = one("SELECT COUNT(*) c FROM (SELECT task_code FROM tasks WHERE task_code<>'' GROUP BY task_code HAVING COUNT(*)>1)").c;
const dupP = one("SELECT COUNT(*) c FROM (SELECT task_code FROM priority_tasks WHERE task_code<>'' GROUP BY task_code HAVING COUNT(*)>1)").c;
const overlap = one("SELECT COUNT(*) c FROM tasks t JOIN priority_tasks p ON p.task_code=t.task_code").c;
check('no duplicate codes in tasks', dupT === 0);
check('no duplicate codes in priority_tasks', dupP === 0);
check('no code shared across both tables', overlap === 0);
check('codes are random, not id-derived', !q("SELECT task_code FROM tasks LIMIT 200").every(r => /^TSK-0*$/.test(r.task_code.replace(/^TSK-/, '')) || r.task_code.startsWith('TSK-0000')));

console.log('\n--- 2. generation is unique + random ---');
const minted = new Set();
let collides = 0;
for (let i = 0; i < 3000; i++) {
  const c = generateTaskCode('TSK');
  if (minted.has(c) || one('SELECT 1 FROM tasks WHERE task_code=?', c)) collides++;
  minted.add(c);
}
check('3000 generated codes all distinct and unused', collides === 0, `${collides} collisions`);
check('generated codes vary in length/content', new Set([...minted].map(c => c.slice(4, 7))).size > 100);

console.log('\n--- 3. immutability ---');
const sample = one("SELECT id, task_code FROM tasks WHERE task_code<>'' LIMIT 1");
db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(sample.id);
check('status change leaves code intact', one('SELECT task_code FROM tasks WHERE id=?', sample.id).task_code === sample.task_code);
db.prepare("UPDATE tasks SET title=title||' x' WHERE id=?").run(sample.id);
check('title change leaves code intact', one('SELECT task_code FROM tasks WHERE id=?', sample.id).task_code === sample.task_code);

console.log('\n--- 4. restore PRESERVES existing codes ---');
const codesBefore = new Map(q('SELECT id, task_code FROM tasks').map(r => [r.id, r.task_code]));
const snapshot = {};
for (const t of q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
  snapshot[t.name] = q(`SELECT * FROM "${t.name}"`);
}
restoreTablesFromData(snapshot);
let drift = 0, lost = 0;
for (const [id, code] of codesBefore) {
  const now = one('SELECT task_code FROM tasks WHERE id=?', id);
  if (!now) { lost++; continue; }
  if (now.task_code !== code) drift++;
}
check('all tasks survive restore', lost === 0, `${lost} lost`);
check('every restored code identical to before', drift === 0, `${drift} drifted`);

console.log('\n--- 5. restore from a LEGACY backup (no task_code column) ---');
// Simulate a backup file written before the feature existed.
const legacy = {};
for (const t of q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
  legacy[t.name] = q(`SELECT * FROM "${t.name}"`).map((row) => {
    const c = { ...row };
    if (t.name === 'tasks' || t.name === 'priority_tasks') delete c.task_code;
    return c;
  });
}
restoreTablesFromData(legacy);
const legacyMissing = one("SELECT COUNT(*) c FROM tasks WHERE task_code IS NULL OR task_code=''").c
  + one("SELECT COUNT(*) c FROM priority_tasks WHERE task_code IS NULL OR task_code=''").c;
check('legacy restore gives every task an ID', legacyMissing === 0, `${legacyMissing} still missing`);
const legacyDup = one("SELECT COUNT(*) c FROM (SELECT task_code FROM tasks WHERE task_code<>'' GROUP BY task_code HAVING COUNT(*)>1)").c;
check('legacy backfill produces no duplicates', legacyDup === 0);

console.log('\n--- 6. new task after restore does not overlap ---');
const existing = new Set(q("SELECT task_code FROM tasks WHERE task_code<>''").map(r => r.task_code)
  .concat(q("SELECT task_code FROM priority_tasks WHERE task_code<>''").map(r => r.task_code)));
let overlapCount = 0;
for (let i = 0; i < 500; i++) {
  const c = generateTaskCode('TSK');
  if (existing.has(c)) overlapCount++;
}
check('500 post-restore codes avoid all restored IDs', overlapCount === 0, `${overlapCount} overlaps`);

console.log('\n--- 7. uniqueness enforced by the index ---');
const dup = one("SELECT task_code FROM tasks WHERE task_code<>'' LIMIT 1").task_code;
let blocked = false;
try { db.prepare("INSERT INTO tasks (title, status, priority, task_code) VALUES ('dup', 'todo', 'medium', ?)").run(dup); }
catch { blocked = true; }
check('duplicate code rejected by DB', blocked);
const missingRow = one("SELECT COUNT(*) c FROM tasks WHERE task_code IS NULL OR task_code=''").c;
console.log(`  (rows without a code: ${missingRow} — backfill is idempotent)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);