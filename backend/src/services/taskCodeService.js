import crypto from 'node:crypto';
import { db } from '../db.js';

// Crockford-style alphabet: no I, L, O, U, so codes stay unambiguous when
// read aloud or copied off a screen. 32^9 is a huge space, so collisions are
// rare, but we still check before returning and the caller is protected by a
// UNIQUE index, so a collision can never silently duplicate.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 9;
const MAX_ATTEMPTS = 25;

function randomSegment(len = CODE_LENGTH) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * The code is the permanent, human-facing identifier of a task. It is
 * generated once, at insert, and never regenerated afterwards, so it must be
 * random rather than derived from the autoincrement id (ids are reused by
 * restore/reset and would not be stable).
 *
 * `prefix` only exists to make the owning table obvious to a human; uniqueness
 * is still checked across BOTH tables so the two namespaces can never collide.
 */
function candidate(prefix) {
  return `${prefix}-${randomSegment()}`;
}

function tablesWithTaskCode(handle) {
  const out = [];
  const has = (name) => !!handle
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  if (has('tasks')) out.push('tasks');
  if (has('priority_tasks')) out.push('priority_tasks');
  return out;
}

/** True when the code is already used by any task in any table. */
export function taskCodeExists(code, handle = db) {
  for (const table of tablesWithTaskCode(handle)) {
    if (handle.prepare(`SELECT 1 FROM "${table}" WHERE task_code = ?`).get(code)) return true;
  }
  return false;
}

/**
 * Generate a task code that is not currently in use. Checks every table that
 * carries a task_code so the id is unique across regular, daily and priority
 * tasks, and so codes minted after a backup restore cannot overlap restored
 * ones (restored rows keep their original codes).
 */
export function generateTaskCode(prefix = 'TSK', handle = db) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = candidate(prefix);
    if (!taskCodeExists(code, handle)) return code;
  }
  // Extremely unlikely. Fall back to a wider random string rather than ever
  // returning a code that might already be taken.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = `${prefix}-${randomSegment(CODE_LENGTH + 8)}`;
    if (!taskCodeExists(code, handle)) return code;
  }
  throw new Error('Unable to generate a unique task code');
}

/**
 * Guarantee a row has a code. Used as a safety net by the reconciliation pass
 * so that no task can exist without one, even if some future insert path forgets
 * to call generateTaskCode.
 */
export function ensureTaskCode(table, id, prefix = 'TSK', handle = db) {
  const row = handle.prepare(`SELECT task_code FROM "${table}" WHERE id = ?`).get(id);
  if (!row) return null;
  if (row.task_code) return row.task_code;
  const code = generateTaskCode(prefix, handle);
  handle.prepare(`UPDATE "${table}" SET task_code = ? WHERE id = ? AND (task_code IS NULL OR task_code = '')`).run(code, id);
  return code;
}

/**
 * Backfill any task row that has no code. Idempotent, and safe to run on
 * every boot: it only touches rows that are actually missing a code.
 *
 * This matters for restore. Restoring a backup taken before task_code existed
 * inserts rows without the column, so they land as '' and would otherwise stay
 * unidentified forever.
 */
export function backfillTaskCodes(handle = db) {
  const has = (name) => !!handle
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  const missingTotal = [];

  for (const [table, prefix] of [['tasks', 'TSK'], ['priority_tasks', 'PTY']]) {
    if (!has(table)) continue;
    const hasCol = handle.prepare(`PRAGMA table_info("${table}")`).all().some((c) => c.name === 'task_code');
    if (!hasCol) continue;
    const missing = handle
      .prepare(`SELECT id FROM "${table}" WHERE task_code IS NULL OR task_code = ''`)
      .all();
    for (const { id } of missing) ensureTaskCode(table, id, prefix, handle);
    if (missing.length) missingTotal.push(`${table}=${missing.length}`);
  }
  return missingTotal;
}

/** Human-facing label helper shared by exports and the UI. */
export function formatTaskCode(code, fallbackId) {
  return code && code.trim() ? code.trim() : `TSK-${String(fallbackId ?? '').padStart(4, '0')}`;
}
