import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole, audit } from '../middleware.js';

const router = Router();

// Strictly Super Admin. requireRole('super_admin') passes only super admins:
// it short-circuits for req.user.role === 'super_admin' and otherwise requires
// the role (or role group slug) to be in the list.
router.use(requireAuth, requireRole('super_admin'));

/**
 * Data Reset / Fresh Start.
 *
 * Super Admin can permanently clear one or more modules to prepare a clean
 * database. This is intentionally destructive and irreversible, so it is:
 *   - gated to super admins,
 *   - guarded by an explicit typed confirmation,
 *   - executed inside a single transaction that rolls back on any error,
 *   - limited to the selected modules.
 *
 * Deletions are written out explicitly rather than relying on ON DELETE CASCADE
 * alone, because several user_id columns are NOT NULL with NO ACTION: deleting
 * a user with those rows still present aborts the whole statement. Every table
 * below was mapped from PRAGMA foreign_key_list before being listed here.
 */
const TARGETS = [
  { key: 'tasks', label: 'Tasks', tables: ['tasks'] },
  { key: 'priority_tasks', label: 'Priority Tasks', tables: ['priority_tasks'] },
  { key: 'projects', label: 'Projects', tables: ['projects'] },
  { key: 'leave_applications', label: 'Leave Applications', tables: ['leave_applications'] },
  { key: 'users', label: 'Users', tables: ['users'] },
];
const VALID = new Set(TARGETS.map((t) => t.key));

/** Tables that are only ever removed alongside a user, never on their own. */
const USER_OWNED_CASCADE = [
  'task_assignees', 'notifications', 'saved_filters', 'chat_reads',
  'chat_group_members', 'leave_applications', 'leave_quotas',
  'daily_task_members', 'daily_task_awards',
];

/**
 * Rows that must be deleted outright because the referencing column is
 * NOT NULL with NO ACTION and so cannot be detached from a deleted user.
 * The column differs per table: chat_messages and chat_attachments key on
 * sender_id, chat_groups on created_by.
 */
const USER_OWNED_MUST_DELETE = [
  ['task_comments', 'user_id'],
  ['task_attachments', 'user_id'],
  ['time_entries', 'user_id'],
  ['chat_messages', 'sender_id'],
  ['chat_groups', 'created_by'],
  ['chat_attachments', 'sender_id'],
];

/** Nullable references: detach these so the surrounding record survives. */
const USER_OWNED_DETACH = [
  ['tasks', 'created_by'],
  ['tasks', 'reviewer_id'],
  ['task_checklist', 'created_by'],
  ['approvals', 'approver_id'],
  ['projects', 'created_by'],
];

function countRows(table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
  } catch {
    return 0;
  }
}

/** Current impact preview, so the UI can show what will be lost. */
router.get('/targets', (req, res) => {
  res.json({
    ok: true,
    targets: TARGETS.map((t) => ({
      key: t.key,
      label: t.label,
      count: countRows(t.tables[0]),
    })),
    protected: {
      superAdmins: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin'").get().c,
      note: 'Super Admin accounts are never deleted by a data reset.',
    },
  });
});

function inList(ids) {
  return ids.map(() => '?').join(',');
}

function deleteUsers(protectedIds, counts) {
  const ids = db.prepare(`
    SELECT id FROM users
    WHERE role <> 'super_admin'
    ${protectedIds.length ? `AND id NOT IN (${inList(protectedIds)})` : ''}
  `).all(...protectedIds).map((r) => r.id);

  if (ids.length === 0) return 0;
  const U = inList(ids);
  // Every statement below binds the same id list. Omitting the spread leaves the
  // placeholders as NULL, which matches nothing and silently deletes nothing.
  const run = (sql) => db.prepare(sql).run(...ids);

  // 1. Rows that cannot be detached from a deleted user.
  for (const [table, col] of USER_OWNED_MUST_DELETE) {
    counts[table] = (counts[table] || 0) + run(`DELETE FROM "${table}" WHERE "${col}" IN (${U})`).changes;
  }
  // Approval requests belong to the requester; approvals they merely signed off
  // are kept and detached instead.
  counts.approvals = (counts.approvals || 0) + run(`DELETE FROM approvals WHERE requester_id IN (${U})`).changes;

  // 2. Rows that belong to the user and disappear with them.
  for (const table of USER_OWNED_CASCADE) {
    counts[table] = (counts[table] || 0) + run(`DELETE FROM "${table}" WHERE user_id IN (${U})`).changes;
  }

  // 3. Detach nullable references so unselected modules keep their records.
  for (const [table, col] of USER_OWNED_DETACH) {
    try {
      counts[`${table}.${col}`] = (counts[`${table}.${col}`] || 0)
        + run(`UPDATE "${table}" SET "${col}" = NULL WHERE "${col}" IN (${U})`).changes;
    } catch {
      // Table absent on an older database; nothing to detach.
    }
  }

  counts.users = (counts.users || 0) + run(`DELETE FROM users WHERE id IN (${U})`).changes;
  return ids.length;
}

router.post('/', (req, res) => {
  const requested = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const targets = [...new Set(requested.filter((t) => VALID.has(t)))];

  if (requested.length !== targets.length) {
    return res.status(400).json({ error: 'One or more selected modules are not recognised. Nothing was deleted.' });
  }
  if (targets.length === 0) {
    return res.status(400).json({ error: 'Select at least one module to clear. Nothing was deleted.' });
  }
  if (String(req.body?.confirm || '').trim().toUpperCase() !== 'RESET') {
    return res.status(400).json({ error: 'Confirmation text did not match. Type RESET to proceed. Nothing was deleted.' });
  }

  const counts = {};
  const summary = [];
  let deletedUsers = 0;

  try {
    db.exec('BEGIN IMMEDIATE');

    if (targets.includes('tasks')) {
      // daily_task_awards has no FK to tasks, so it must be cleared explicitly.
      counts.daily_task_awards = (counts.daily_task_awards || 0) + db.prepare('DELETE FROM daily_task_awards').run().changes;
      counts.tasks = (counts.tasks || 0) + db.prepare('DELETE FROM tasks').run().changes;
    }
    if (targets.includes('priority_tasks')) {
      counts.priority_tasks = (counts.priority_tasks || 0) + db.prepare('DELETE FROM priority_tasks').run().changes;
    }
    if (targets.includes('projects')) {
      counts.projects = (counts.projects || 0) + db.prepare('DELETE FROM projects').run().changes;
    }
    if (targets.includes('leave_applications')) {
      counts.leave_applications = (counts.leave_applications || 0) + db.prepare('DELETE FROM leave_applications').run().changes;
    }
    if (targets.includes('users')) {
      deletedUsers = deleteUsers([req.user.id], counts);
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    console.error('[DataReset] failed:', err);
    return res.status(500).json({
      error: 'The reset failed and was rolled back. No data was changed.',
    });
  }

  for (const t of TARGETS) {
    if (!targets.includes(t.key)) continue;
    summary.push({ key: t.key, label: t.label, deleted: counts[t.key] ?? counts[t.tables[0]] ?? 0 });
  }

  // Written after the commit so the reset always leaves a permanent trace.
  audit(req, 'data.reset', 'system', null,
    `Data reset by ${req.user.name}: cleared ${summary.map((s) => `${s.label} (${s.deleted})`).join(', ')}` +
    `${deletedUsers ? `; ${deletedUsers} user account(s) removed, super admins preserved` : ''}`);

  res.json({
    ok: true,
    targets: summary,
    deletedUsers,
    details: counts,
    message: `Cleared: ${summary.map((s) => `${s.label} (${s.deleted})`).join(', ')}`,
  });
});

export default router;
