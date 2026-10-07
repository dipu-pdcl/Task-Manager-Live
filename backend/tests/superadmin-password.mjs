// Exercises the real ensureSchema() against an isolated database, with no HTTP
// server involved. Verifies:
//  1. a brand new database with no DEFAULT_ADMIN_PASSWORD still gets the
//     deterministic built-in password (the old code fell back to random hex)
//  2. a second ensureSchema pass with nothing to change leaves password_hash and
//     token_version alone, so a restart does not kill live sessions
//  3. when the password was changed by hand, the next pass restores the built-in
//     one -- the "fixed" behaviour that was requested
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const EMAIL = 'dipu@populardiagnostic.com';
const BUILTIN = '@dmin5066';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdcl-seed-'));
const dbPath = path.join(tmp, 'fresh.db');
const envFile = path.join(ROOT, '.env');
const envSaved = fs.readFileSync(envFile, 'utf8');
// Strip DEFAULT_ADMIN_PASSWORD so the built-in fallback is exercised.
fs.writeFileSync(envFile, envSaved.split(/\r?\n/).filter((l) => !l.trim().startsWith('DEFAULT_ADMIN_PASSWORD')).join('\n'));

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };

// Runs one ensureSchema pass in its own process so module state is fresh each
// time, exactly like a server restart.
const pass1 = (script) => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath },
  });
  return out;
};

const READ = `import { DatabaseSync } from 'node:sqlite';
const d = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
const u = d.prepare("SELECT id,password_hash,token_version,role,is_active FROM users WHERE lower(email)=?").get('${EMAIL}');
console.log(JSON.stringify(u || null));`;

const runEnsure = `import './src/env.js';
import { ensureSchema } from './src/db.js';
await ensureSchema();`;

try {
  console.log(`isolated db, no DEFAULT_ADMIN_PASSWORD in env\nbuilt-in password: ${BUILTIN}\n`);

  console.log('--- 1. first ensureSchema on a brand new database ---');
  const log1 = pass1(runEnsure);
  check('created the super admin', /Created default super admin/.test(log1));
  check('log names the built-in password', log1.includes(BUILTIN));
  check('no random hex password generated', /Password: [0-9a-f]{12,}/.test(log1) === false);

  const s1 = JSON.parse(pass1(READ).trim().split('\n').pop());
  check('super admin exists, active, correct role', !!s1 && s1.is_active === 1 && s1.role === 'super_admin', s1 ? `${s1.role} active=${s1.is_active}` : 'missing');

  console.log('\n--- 2. second pass: no churn when nothing needs changing ---');
  const log2 = pass1(runEnsure);
  const s2 = JSON.parse(pass1(READ).trim().split('\n').pop());
  check('password_hash unchanged', s2.password_hash === s1.password_hash);
  check('token_version not bumped (sessions survive a restart)', s2.token_version === s1.token_version, `${s1.token_version} -> ${s2.token_version}`);
  check('no "password set" message on a no-op pass', !/Set default super admin password/.test(log2));

  console.log('\n--- 3. a hand-changed password is restored to the built-in ---');
  const bcrypt = (await import('bcryptjs')).default;
  const { DatabaseSync } = await import('node:sqlite');
  const w = new DatabaseSync(dbPath);
  w.prepare('UPDATE users SET password_hash = ? WHERE lower(email)=?').run(bcrypt.hashSync('SomethingElse123', 12), EMAIL);
  w.close();
  const log3 = pass1(runEnsure);
  const s3 = JSON.parse(pass1(READ).trim().split('\n').pop());
  check('boot reports restoring the built-in password', /Set default super admin password/.test(log3));
  check('password_hash actually changed back', s3.password_hash !== s2.password_hash);
  const bcryptMod = bcrypt;
  check('the built-in password now matches the stored hash', bcryptMod.compareSync(BUILTIN, s3.password_hash));
  check('the hand-changed password no longer matches', !bcryptMod.compareSync('SomethingElse123', s3.password_hash));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  fs.writeFileSync(envFile, envSaved);
  fs.rmSync(tmp, { recursive: true, force: true });
}