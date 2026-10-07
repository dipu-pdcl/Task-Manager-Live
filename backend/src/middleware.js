import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from './db.js';
import { broadcastToUser } from './sse.js';
import { ALL_PERMISSION_IDS, DEFAULT_ROLE_GROUPS, SUPER_ADMIN_ONLY_PERMISSIONS } from './permissions.js';
import { parseWeekendDays } from './utils.js';

function getPersistentJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }
    const newSecret = crypto.randomBytes(48).toString('hex');
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, datetime('now','+6 hours'))").run(newSecret);
    return newSecret;
  } catch {
    const fallback = crypto.randomBytes(48).toString('hex');
    console.error('[SECURITY] JWT secret not found in env or DB — generated ephemeral secret. Set JWT_SECRET or the settings.jwt_secret row. Tokens will be invalidated on restart.');
    return fallback;
  }
}

const JWT_SECRET = getPersistentJwtSecret();

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, tv: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

export function resolveUserPermissions(u) {
  if (u.role === 'super_admin' || u.role_group_slug === 'super_admin') {
    return ALL_PERMISSION_IDS;
  }
  let perms = [];
  if (u.role_group_permissions) {
    try {
      const parsed = typeof u.role_group_permissions === 'string' ? JSON.parse(u.role_group_permissions) : u.role_group_permissions;
      if (Array.isArray(parsed)) perms = parsed;
    } catch {}
  } else if (u.role_group_id) {
    try {
      const rg = db.prepare('SELECT permissions FROM role_groups WHERE id = ?').get(u.role_group_id);
      if (rg && rg.permissions) {
        const parsed = typeof rg.permissions === 'string' ? JSON.parse(rg.permissions) : rg.permissions;
        if (Array.isArray(parsed)) perms = parsed;
      }
    } catch {}
  } else {
    // Fallback to default group matching role slug
    const fallback = DEFAULT_ROLE_GROUPS.find((g) => g.slug === u.role) || DEFAULT_ROLE_GROUPS.find((g) => g.slug === 'user');
    perms = fallback ? fallback.permissions : [];
  }
  // Strip super admin exclusive permissions for non-super admin users
  return perms.filter((p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p));
}

export function getPublicUser(u, requester = null) {
  const weekendDays = parseWeekendDays(u.weekend_days);

  // Resolve role group details if not joined in query
  let rgName = u.role_group_name;
  let rgSlug = u.role_group_slug;
  let rgColor = u.role_group_color;
  let rgPerms = u.role_group_permissions;

  if (!rgName && u.role_group_id) {
    try {
      const rg = db.prepare('SELECT name, slug, color, permissions FROM role_groups WHERE id = ?').get(u.role_group_id);
      if (rg) {
        rgName = rg.name;
        rgSlug = rg.slug;
        rgColor = rg.color;
        rgPerms = rg.permissions;
      }
    } catch {}
  }

  const rawPermissions = u.permissions || resolveUserPermissions({ ...u, role_group_permissions: rgPerms });
  let safePermissions = rawPermissions;

  if (requester) {
    const isRequesterSuper = typeof requester === 'boolean' ? requester : requester.role === 'super_admin';
    const requesterId = typeof requester === 'object' ? requester?.id : null;
    const isSelf = requesterId && requesterId === u.id;

    if (!isRequesterSuper && !isSelf) {
      if (u.role === 'super_admin' || rgSlug === 'super_admin') {
        // Super Admin master scope is completely hidden from non-super admins
        safePermissions = [];
      } else {
        safePermissions = rawPermissions.filter((p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p));
      }
    } else if (!isRequesterSuper && isSelf) {
      safePermissions = rawPermissions.filter((p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p));
    }
  }

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    role_group_id: u.role_group_id || null,
    role_group_name: rgName || (u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : u.role === 'sub_admin' ? 'Sub-Admin' : 'User'),
    role_group_slug: rgSlug || u.role,
    role_group_color: rgColor || (u.role === 'super_admin' ? '#8b5cf6' : u.role === 'admin' ? '#3b82f6' : u.role === 'sub_admin' ? '#06b6d4' : '#10b981'),
    permissions: safePermissions,
    title: u.title,
    phone: u.phone,
    avatar: u.avatar,
    team_id: u.team_id,
    team_name: u.team_name || '',
    department_id: u.department_id,
    department_name: u.department_name || '',
    department_hotline: u.department_hotline || '',
    department_ext: u.department_ext || '',
    department_manager_name: u.department_manager_name || '',
    department_manager_ext: u.department_manager_ext || '',
    employee_id: u.employee_id || ('EMP' + String(u.id).padStart(3, '0')),
    live_status: u.live_status || 'inactive',
    last_active_at: u.last_active_at || null,
    status_message: u.status_message || '',
    status_updated_at: u.status_updated_at || null,
    weekend_days: weekendDays,
    duty_time: u.duty_time || '',
    is_active: !!u.is_active,
    last_login: u.last_login,
    created_at: u.created_at,
    password_must_change: !!u.password_must_change,
  };
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token && req.cookies && req.cookies.auth_token) {
    token = req.cookies.auth_token;
  }
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`
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
        d.manager_ext AS department_manager_ext
      FROM users u
      LEFT JOIN role_groups rg ON rg.id = u.role_group_id
      LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ?
    `).get(payload.id);

    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });
    if ((user.token_version || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Session has been invalidated. Please log in again.' });
    }

    user.permissions = resolveUserPermissions(user);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const perms = user.permissions || resolveUserPermissions(user);
  return perms.includes(permission) || perms.includes('*');
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'super_admin') return next();
    const userPerms = req.user.permissions || [];
    const hasAny = permissions.some((p) => userPerms.includes(p) || userPerms.includes('*'));
    if (!hasAny) {
      return res.status(403).json({
        error: `Permission denied. Required: ${permissions.join(' or ')}`,
        required_permissions: permissions,
      });
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user.role === 'super_admin') return next();
    if (!roles.includes(req.user.role) && !roles.includes(req.user.role_group_slug)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

export const isSuperAdmin = (user) => user && (user.role === 'super_admin' || user.role_group_slug === 'super_admin');
export const isAdmin = (user) => {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'sub_admin') return true;
  if (user.role_group_slug === 'super_admin' || user.role_group_slug === 'admin' || user.role_group_slug === 'sub_admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.some((p) => [
    'settings.manage',
    'settings.view',
    'roles.manage',
    'users.manage',
    'teams.manage',
    'departments.manage',
    'kpi.manage',
    'leaves.approve',
    'priority_tasks.manage',
    'admin.access',
  ].includes(p));
};

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'super_admin') return next();
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

export function audit(req, action, entityType = '', entityId = null, details = '') {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, details, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id ?? null,
      req.user?.name ?? 'system',
      action, entityType, entityId ?? null,
      typeof details === 'string' ? details.slice(0, 2000) : JSON.stringify(details).slice(0, 2000),
      req.ip || '',
    );
  } catch { /* audit must never break a request */ }
}

export function logHistory(taskId, userId, action, field = '', oldValue = '', newValue = '') {
  try {
    db.prepare(`
      INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, userId ?? null, action, field,
      typeof oldValue === 'string' ? oldValue.slice(0, 1000) : JSON.stringify(oldValue ?? '').slice(0, 1000),
      typeof newValue === 'string' ? newValue.slice(0, 1000) : JSON.stringify(newValue ?? '').slice(0, 1000));
  } catch { /* noop */ }
}

export function notify(userId, type, title, message, link = '') {
  try {
    const r = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, title, message, link);

    const notifId = Number(r.lastInsertRowid);
    const unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(userId)?.c || 0;

    const notifPayload = {
      id: notifId,
      user_id: userId,
      type,
      title,
      message,
      link,
      read: 0,
      created_at: new Date().toISOString()
    };

    broadcastToUser(userId, 'notification', notifPayload);
    broadcastToUser(userId, 'unread-count', { count: unreadCount });
  } catch { /* noop */ }
}

export function sanitizeError(err, fallback = 'An internal error occurred') {
  try { console.error('[API ERROR]', err instanceof Error ? err.message : err); } catch {}
  return fallback;
}

