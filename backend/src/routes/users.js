import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireAdmin, requireRole, requirePermission, isAdmin, getPublicUser, audit, notify } from '../middleware.js';
import { initials, parseWeekendDays, today, checkUserAvailability } from '../utils.js';
import { invalidateGenerationCache, ensureDailyTasks } from '../services/dailyTaskService.js';

const router = Router();
router.use(requireAuth);

const MAX_PASSWORD_LEN = 128;

function generateTempPassword() {
  return crypto.randomBytes(8).toString('hex') + 'Aa1!';
}

function userRow(u, requester = null) {
  return {
    ...getPublicUser(u, requester),
    initials: initials(u.name),
    team_name: u.team_name || '',
    department_name: u.department_name || '',
    department_hotline: u.department_hotline || '',
    department_ext: u.department_ext || '',
    department_manager_name: u.department_manager_name || '',
    department_manager_ext: u.department_manager_ext || '',
    open_tasks: Number(u.open_tasks || 0),
    completed_tasks: Number(u.completed_tasks || 0),
    tasks_created: Number(u.tasks_created || 0),
    is_daily_task_member: Number(u.is_daily_task_member || 0) === 1,
  };
}

/**
 * Attaches today's availability to each listed user. Availability is only added
 * when the caller asks for it (assignable=1), because it costs two lookups per
 * user and most consumers of this list never assign anybody.
 */
function withAvailability(rows, currentDate) {
  return rows.map((r) => {
    const availability = checkUserAvailability(r.id, currentDate);
    return {
      ...r,
      availability: {
        available: availability.available,
        reason: availability.reason,
        status: availability.details?.type || null,
      },
    };
  });
}

/** SQL fragment selecting whether the user is in the Daily Task group. */
const DAILY_MEMBER_SELECT = `(SELECT COUNT(*) FROM daily_task_members dtm WHERE dtm.user_id = u.id) AS is_daily_task_member`;

/**
 * Add/remove a user from the Daily Task group. Returns true when membership
 * changed. Newly added members immediately receive today's tasks.
 */
function setDailyTaskMembership(userId, enabled, actorId) {
  if (enabled) {
    const r = db.prepare('INSERT OR IGNORE INTO daily_task_members (user_id, added_by) VALUES (?, ?)').run(userId, actorId);
    if (r.changes > 0) {
      invalidateGenerationCache();
      ensureDailyTasks();
      return true;
    }
    return false;
  }
  const r = db.prepare('DELETE FROM daily_task_members WHERE user_id = ?').run(userId);
  return r.changes > 0;
}

router.get('/', (req, res) => {
  const { q, role, role_group_id, is_active, department_id, team_id, live_status, exclude_super, assignable } = req.query;
  const withAvail = assignable === '1' || assignable === 'true';
  const currentDate = today();
  const userRole = req.user.role;

  const canViewAll = isAdmin(req.user) ||
    req.user.permissions?.includes('users.view') ||
    req.user.permissions?.includes('users.manage') ||
    req.user.permissions?.includes('users.*') ||
    req.user.permissions?.includes('*');

  if (!canViewAll) {
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.role_group_id, u.avatar, u.title, u.phone, u.employee_id, u.live_status, u.last_active_at, u.status_message, u.team_id, u.department_id, u.is_active,
        rg.name AS role_group_name, rg.slug AS role_group_slug, rg.color AS role_group_color, rg.permissions AS role_group_permissions,
        t.name AS team_name, d.name AS department_name, d.hotline AS department_hotline, d.ext AS department_ext, d.hotline_ext,
        d.manager_name AS department_manager_name, d.manager_ext AS department_manager_ext,
        (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
          WHERE ta.user_id = u.id AND tk.status NOT IN ('done', 'cancelled')) AS open_tasks,
        (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
          WHERE ta.user_id = u.id AND tk.status = 'done') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t2 WHERE t2.created_by = u.id) AS tasks_created,
        ${DAILY_MEMBER_SELECT}
      FROM users u
      LEFT JOIN role_groups rg ON rg.id = u.role_group_id
      LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id != ? AND u.is_active = 1
      ORDER BY u.name ASC
    `).all(req.user.id);
    const mapped = rows.map((r) => userRow(r, req.user));
    return res.json(withAvail ? withAvailability(mapped, currentDate) : mapped);
  }

  let sql = `
    SELECT u.*,
      rg.name AS role_group_name,
      rg.slug AS role_group_slug,
      rg.color AS role_group_color,
      rg.permissions AS role_group_permissions,
      t.name AS team_name,
      d.name AS department_name,
      d.hotline AS department_hotline,
      d.ext AS department_ext,
      d.hotline_ext,
      d.manager_name AS department_manager_name,
      d.manager_ext AS department_manager_ext,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
        WHERE ta.user_id = u.id AND tk.status NOT IN ('done', 'cancelled')) AS open_tasks,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
        WHERE ta.user_id = u.id AND tk.status = 'done') AS completed_tasks,
      (SELECT COUNT(*) FROM tasks t2 WHERE t2.created_by = u.id) AS tasks_created,
      ${DAILY_MEMBER_SELECT}
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE 1=1
  `;
  const params = [];

  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    sql += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.role LIKE ? OR rg.name LIKE ? OR u.employee_id LIKE ? OR u.phone LIKE ? OR u.title LIKE ?)`;
    params.push(term, term, term, term, term, term, term);
  }
  if (role_group_id && role_group_id !== 'all') {
    sql += ` AND u.role_group_id = ?`;
    params.push(Number(role_group_id));
  }
  if (role && role !== 'all') {
    sql += ` AND (u.role = ? OR rg.slug = ?)`;
    params.push(role, role);
  }
  if (is_active !== undefined && is_active !== 'all') {
    sql += ` AND u.is_active = ?`;
    params.push(is_active === '1' || is_active === 'true' ? 1 : 0);
  }
  if (department_id && department_id !== 'all') {
    sql += ` AND u.department_id = ?`;
    params.push(department_id);
  }
  if (team_id && team_id !== 'all') {
    sql += ` AND u.team_id = ?`;
    params.push(team_id);
  }
  if (live_status && live_status !== 'all') {
    if (live_status === 'inactive') {
      sql += ` AND (u.live_status = 'inactive' OR u.live_status IS NULL)`;
    } else {
      sql += ` AND u.live_status = ?`;
      params.push(live_status);
    }
  }

  if (exclude_super === 'true' || exclude_super === '1') {
     sql += ` AND u.role != 'super_admin' AND u.email != 'dipu@populardiagnostic.com'`;
  }

  sql += `
    ORDER BY
      CASE WHEN u.role = 'super_admin' THEN 1 WHEN u.role = 'admin' THEN 2 ELSE 3 END ASC,
      u.name ASC
  `;
  res.json((() => {
    const mapped = db.prepare(sql).all(...params).map((r) => userRow(r, req.user));
    return withAvail ? withAvailability(mapped, currentDate) : mapped;
  })());
});

router.get('/:id/activity', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  // Assigned open tasks
  const openTasks = db.prepare(`
    SELECT t.id, t.title, t.priority, t.status, t.due_date, t.created_at
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id = ? AND t.status NOT IN ('done', 'cancelled')
    ORDER BY t.priority = 'urgent' DESC, t.due_date ASC, t.created_at DESC
    LIMIT 8
  `).all(id);

  // Recent completed tasks
  const completedTasks = db.prepare(`
    SELECT t.id, t.title, t.priority, t.status, t.due_date, t.completed_at
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id = ? AND t.status = 'done'
    ORDER BY t.completed_at DESC
    LIMIT 6
  `).all(id);

  // Recent audit logs for this user
  const recentLogs = db.prepare(`
    SELECT id, action, details, ip AS ip_address, created_at
    FROM audit_logs
    WHERE user_id = ? OR (entity_type = 'user' AND entity_id = ?)
    ORDER BY created_at DESC
    LIMIT 10
  `).all(id, id);

  res.json({
    user: u,
    openTasks,
    completedTasks,
    recentLogs,
  });
});

router.get('/workload', requirePermission('users.view', 'dashboard.view'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, u.role,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id WHERE ta.user_id = u.id AND tk.status NOT IN ('done', 'cancelled')) AS active_tasks,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id WHERE ta.user_id = u.id AND tk.status NOT IN ('done', 'cancelled') AND tk.priority IN ('high', 'urgent', 'critical')) AS high_prio_tasks
    FROM users u
    WHERE u.is_active = 1
    ORDER BY active_tasks DESC
  `).all();
  res.json(rows.map((u) => ({ ...u, initials: initials(u.name) })));
});

router.get('/:id', (req, res) => {
  const u = db.prepare(`
    SELECT u.*,
      rg.name AS role_group_name, rg.slug AS role_group_slug, rg.color AS role_group_color, rg.permissions AS role_group_permissions,
      t.name AS team_name,
      d.name AS department_name,
      d.hotline AS department_hotline,
      d.ext AS department_ext,
      d.hotline_ext,
      d.manager_name AS department_manager_name,
      d.manager_ext AS department_manager_ext,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
        WHERE ta.user_id = u.id AND tk.status NOT IN ('done', 'cancelled')) AS open_tasks,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
        WHERE ta.user_id = u.id AND tk.status = 'done') AS completed_tasks,
      (SELECT COUNT(*) FROM tasks t2 WHERE t2.created_by = u.id) AS tasks_created,
      ${DAILY_MEMBER_SELECT}
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json(userRow(u, req.user.role === 'super_admin'));
});

router.post('/', requirePermission('users.manage'), (req, res) => {
  const { name, email, password, role, role_group_id, title, team_id, department_id, phone, employee_id, avatar, weekend_days, duty_time } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const trimmedName = String(name).trim();
  const trimmedEmail = String(email).trim().toLowerCase();
  const pwdStr = String(password);

  if (!trimmedName) return res.status(400).json({ error: 'Name is required' });
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (pwdStr.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (pwdStr.length > MAX_PASSWORD_LEN) return res.status(400).json({ error: 'Password is too long' });

  // Resolve role group
  let targetGroup = null;
  if (role_group_id) {
    targetGroup = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(Number(role_group_id));
  }
  if (!targetGroup && role) {
    targetGroup = db.prepare('SELECT * FROM role_groups WHERE slug = ?').get(role);
  }
  if (!targetGroup) {
    // Check default role group setting
    const defSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_role_group_id'").get();
    let defId = null;
    if (defSetting && defSetting.value) {
      try { defId = JSON.parse(defSetting.value); } catch { defId = Number(defSetting.value); }
    }
    if (defId) {
      targetGroup = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(defId);
    }
  }
  if (!targetGroup) {
    targetGroup = db.prepare("SELECT * FROM role_groups WHERE slug = 'user'").get();
  }

  const assignedGroupId = targetGroup?.id || 4;
  const assignedSlug = targetGroup?.slug || 'user';
  const newRole = targetGroup?.is_system ? targetGroup.slug : (assignedSlug === 'super_admin' ? 'super_admin' : assignedSlug === 'admin' ? 'admin' : 'user');

  if (assignedSlug === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can create super admin accounts' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(trimmedEmail);
  if (exists) return res.status(400).json({ error: 'Email address is already in use by another user' });

  const weekendJson = JSON.stringify(parseWeekendDays(weekend_days));

   const r = db.prepare(`
     INSERT INTO users (name, email, password_hash, role, role_group_id, title, phone, employee_id, team_id, department_id, avatar, weekend_days, duty_time, is_active, live_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'inactive')
   `).run(
     trimmedName,
     trimmedEmail,
     bcrypt.hashSync(pwdStr, 12),
     newRole,
     assignedGroupId,
     title ? String(title).trim() : '',
     phone ? String(phone).trim() : '',
     employee_id ? String(employee_id).trim() : '',
     team_id ? Number(team_id) : null,
     department_id ? Number(department_id) : null,
     avatar ? String(avatar).trim() : '',
     weekendJson,
     duty_time ? String(duty_time).trim() : ''
   );
  const id = Number(r.lastInsertRowid);
  if (!employee_id) {
    db.prepare("UPDATE users SET employee_id = 'EMP' || printf('%03d', id) WHERE id = ?").run(id);
  }

  // Daily Task group tagging from the user panel.
  if (req.body?.daily_task_member) {
    setDailyTaskMembership(id, true, req.user.id);
    notify(id, 'task', 'Added to Daily Task group', 'You will now receive your daily tasks automatically', '/daily-task');
  }

  audit(req, 'user.create', 'user', id, `Created user ${trimmedName} (${targetGroup?.name || newRole}) with email ${trimmedEmail}`);
  notify(id, 'system', 'Welcome to PDCL ICT', `Your account was created by an administrator.`);

  const created = db.prepare(`
    SELECT u.*,
      rg.name AS role_group_name, rg.slug AS role_group_slug, rg.color AS role_group_color, rg.permissions AS role_group_permissions,
      t.name AS team_name, d.name AS department_name, 0 AS open_tasks, 0 AS completed_tasks, 0 AS tasks_created,
      (SELECT COUNT(*) FROM daily_task_members dtm WHERE dtm.user_id = u.id) AS is_daily_task_member
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(id);
  res.json(userRow(created, req.user));
});

router.put('/:id', requirePermission('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { name, email, password, role, role_group_id, title, team_id, department_id, phone, employee_id, is_active, avatar, weekend_days, duty_time } = req.body || {};

  if (u.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can modify a super admin account' });
  }

  let targetGroupId = u.role_group_id;
  let targetRole = u.role;

  if (role_group_id !== undefined) {
    const rg = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(Number(role_group_id));
    if (!rg) return res.status(400).json({ error: 'Selected role group does not exist' });
    if (rg.slug === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can grant the super admin role group' });
    }
    targetGroupId = rg.id;
    targetRole = rg.is_system ? rg.slug : (rg.slug === 'super_admin' ? 'super_admin' : rg.slug === 'admin' ? 'admin' : 'user');
  } else if (role !== undefined) {
    if (!['user', 'admin', 'super_admin', 'sub_admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can grant the super admin role' });
    }
    const rg = db.prepare('SELECT * FROM role_groups WHERE slug = ?').get(role);
    if (rg) {
      targetGroupId = rg.id;
      targetRole = role;
    } else {
      targetRole = role;
    }
  }

  if (id === req.user.id && targetRole !== u.role && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'You cannot change your own role' });
  }

  let newEmail = undefined;
  if (email !== undefined && email !== null) {
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (trimmed !== u.email.toLowerCase()) {
      const exists = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(trimmed, id);
      if (exists) return res.status(400).json({ error: 'Email address is already in use by another user' });
      newEmail = trimmed;
    }
  }

  let newPasswordHash = undefined;
  if (password !== undefined && password !== null && String(password).trim() !== '') {
    const pwdStr = String(password);
    if (pwdStr.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (pwdStr.length > MAX_PASSWORD_LEN) return res.status(400).json({ error: 'Password is too long' });
    newPasswordHash = bcrypt.hashSync(pwdStr, 12);
  }

  const trimmedName = name !== undefined ? String(name).trim() : undefined;
  if (trimmedName !== undefined && !trimmedName) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }

  const newWeekendDays = weekend_days !== undefined ? JSON.stringify(parseWeekendDays(weekend_days)) : null;
  const newDutyTime = duty_time !== undefined ? String(duty_time).trim() : null;

  db.prepare(`
    UPDATE users SET
      name = COALESCE(?, name),
      email = COALESCE(?, email),
      password_hash = COALESCE(?, password_hash),
      role = ?,
      role_group_id = ?,
      title = COALESCE(?, title),
      phone = COALESCE(?, phone),
      employee_id = COALESCE(?, employee_id),
      avatar = COALESCE(?, avatar),
      weekend_days = COALESCE(?, weekend_days),
      duty_time = COALESCE(?, duty_time),
      team_id = ?,
      department_id = ?,
      is_active = ?,
      updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(
    trimmedName ?? null,
    newEmail ?? null,
    newPasswordHash ?? null,
    targetRole,
    targetGroupId,
    title ?? null,
    phone ?? null,
    employee_id !== undefined ? String(employee_id).trim() : null,
    avatar !== undefined ? String(avatar).trim() : null,
    newWeekendDays,
    newDutyTime,
    team_id === undefined ? u.team_id : (team_id ? Number(team_id) : null),
    department_id === undefined ? u.department_id : (department_id ? Number(department_id) : null),
    is_active === undefined ? u.is_active : (is_active ? 1 : 0),
    id
  );

  // Daily Task group tagging from the user panel. Applied before the row below
  // is read so the response reflects the new membership.
  let dailyMembershipChanged = null;
  if (req.body?.daily_task_member !== undefined && req.body.daily_task_member !== null) {
    const want = req.body.daily_task_member === true || req.body.daily_task_member === 1 || req.body.daily_task_member === '1' || req.body.daily_task_member === 'true';
    if (setDailyTaskMembership(id, want, req.user.id)) dailyMembershipChanged = want;
  }

  const updatedUser = db.prepare(`
    SELECT u.*,
      rg.name AS role_group_name, rg.slug AS role_group_slug, rg.color AS role_group_color, rg.permissions AS role_group_permissions,
      t.name AS team_name,
      d.name AS department_name,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
        WHERE ta.user_id = u.id AND tk.status NOT IN ('done', 'cancelled')) AS open_tasks,
      (SELECT COUNT(*) FROM task_assignees ta JOIN tasks tk ON tk.id = ta.task_id
        WHERE ta.user_id = u.id AND tk.status = 'done') AS completed_tasks,
      (SELECT COUNT(*) FROM tasks t2 WHERE t2.created_by = u.id) AS tasks_created,
      ${DAILY_MEMBER_SELECT}
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(id);

  if (newEmail) {
    audit(req, 'user.update_email', 'user', id, `Updated email for ${u.name} from ${u.email} to ${newEmail}`);
    notify(id, 'security', 'Email address updated', `Your account email address was updated to ${newEmail} by an administrator.`);
  }
  if (newPasswordHash) {
    audit(req, 'user.update_password', 'user', id, `Updated password for ${u.name}`);
    notify(id, 'security', 'Password updated', `Your account password was updated by an administrator.`);
  }

  if (dailyMembershipChanged !== null) {
    audit(req, dailyMembershipChanged ? 'daily_task.members_add' : 'daily_task.members_remove', 'daily_task_members', id,
      `${dailyMembershipChanged ? 'Added' : 'Removed'} ${u.name} ${dailyMembershipChanged ? 'to' : 'from'} the Daily Task group (via user panel)`);
    notify(id, 'task',
      dailyMembershipChanged ? 'Added to Daily Task group' : 'Removed from Daily Task group',
      dailyMembershipChanged ? 'You will now receive your daily tasks automatically.' : 'You will no longer receive new daily tasks.',
      '/daily-task');
  }

  audit(req, 'user.update', 'user', id, `Updated user ${trimmedName || u.name} (${updatedUser.role_group_name || targetRole})`);
  if (u.role_group_id !== targetGroupId && updatedUser.is_active === 1) {
    notify(id, 'system', 'Role Group updated', `Your role group was changed to ${updatedUser.role_group_name || targetRole}.`);
  }

  res.json(userRow(updatedUser, req.user));
});

router.delete('/:id', requireRole('super_admin'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.role === 'super_admin') {
    const superCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin'").get().c;
    if (superCount <= 1) return res.status(400).json({ error: 'Cannot delete the last super admin' });
  }
  try {
    db.exec('BEGIN');
    db.prepare('UPDATE tasks SET created_by = NULL WHERE created_by = ?').run(id);
    db.prepare('UPDATE tasks SET reviewer_id = NULL WHERE reviewer_id = ?').run(id);
    db.prepare('UPDATE approvals SET approver_id = NULL WHERE approver_id = ?').run(id);
    db.prepare('DELETE FROM approvals WHERE requester_id = ?').run(id);
    db.prepare('DELETE FROM task_comments WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM task_attachments WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM time_entries WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to delete user: ' });
  }
  audit(req, 'user.delete', 'user', id, `Deleted user ${u.name}`);
  res.json({ ok: true });
});

router.post('/:id/reset-password', requirePermission('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can reset a super admin password' });
  }

  let pwd = '';
  if (newPassword != null && String(newPassword).trim() !== '') {
    const strPwd = String(newPassword);
    if (typeof newPassword !== 'string' || strPwd.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (strPwd.length > MAX_PASSWORD_LEN) {
      return res.status(400).json({ error: 'Password is too long' });
    }
    pwd = strPwd;
  } else {
    pwd = generateTempPassword();
  }

  db.prepare("UPDATE users SET password_hash = ?, password_must_change = 1, updated_at = datetime('now','+6 hours') WHERE id = ?")
    .run(bcrypt.hashSync(pwd, 12), id);
  audit(req, 'user.reset_password', 'user', id, `Reset password for ${u.name}`);
  notify(id, 'security', 'Password reset', 'An administrator reset your password. Please change it on next login.');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json({ ok: true, temporaryPassword: pwd });
});

router.post('/reset-all-default-passwords', requirePermission('users.manage'), (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can reset all passwords' });
  }
  const { newPassword } = req.body || {};
  const pwd = (newPassword != null && String(newPassword).trim() !== '') ? String(newPassword) : '123456';
  if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (pwd.length > MAX_PASSWORD_LEN) return res.status(400).json({ error: 'Password is too long' });

  const hash = bcrypt.hashSync(pwd, 12);
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?, password_must_change = 1, updated_at = datetime('now','+6 hours')
    WHERE role != 'super_admin' AND is_active = 1
  `).run(hash);

  audit(req, 'user.bulk_reset_passwords', 'user', null, `Bulk-reset passwords for ${result.changes} non-super-admin users`);

  const affected = db.prepare(`
    SELECT id, name, email FROM users WHERE role != 'super_admin' AND is_active = 1
  `).all();
  for (const u of affected) {
    try {
      notify(u.id, 'security', 'Password reset', 'Your password has been reset by an administrator. Please change it on next login.');
    } catch {}
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json({ ok: true, updated: result.changes, temporaryPassword: pwd });
});

router.post('/:id/toggle-active', requirePermission('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  if (u.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can modify a super admin account' });
  }
  const next = u.is_active ? 0 : 1;
  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now','+6 hours') WHERE id = ?").run(next, id);
  audit(req, 'user.toggle_active', 'user', id, `${next ? 'Activated' : 'Deactivated'} ${u.name}`);
  if (next) notify(id, 'system', 'Account activated', 'Your account has been activated.');
  res.json({ ok: true, is_active: !!next });
});

router.put('/me/profile', (req, res) => {
  const { name, title, phone, avatar } = req.body || {};
  const trimmedName = name !== undefined ? String(name).trim() : undefined;
  if (trimmedName !== undefined && !trimmedName) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  db.prepare("UPDATE users SET name = COALESCE(?, name), title = COALESCE(?, title), phone = COALESCE(?, phone), avatar = COALESCE(?, avatar), updated_at = datetime('now','+6 hours') WHERE id = ?")
    .run(trimmedName ?? null, title ?? null, phone ?? null, avatar ?? null, req.user.id);
  audit(req, 'user.profile_update', 'user', req.user.id, 'Updated own profile');
  const updated = db.prepare(`
    SELECT u.*, rg.name AS role_group_name, rg.slug AS role_group_slug, rg.color AS role_group_color, rg.permissions AS role_group_permissions
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE u.id = ?
  `).get(req.user.id);
  res.json(getPublicUser(updated));
});

export default router;
