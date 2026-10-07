import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, requireRole, requirePermission, audit } from '../middleware.js';
import { getSettings, setSetting, resetSettingsCache } from '../config.js';
import {
  PERMISSION_MODULES,
  ALL_PERMISSION_IDS,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  NON_SUPER_PERMISSION_IDS,
  getFilteredPermissionModules,
  getFilteredPermissionIds,
} from '../permissions.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(getSettings());
});

// Role & Permission Management
router.get('/permissions', (req, res) => {
  const isSuper = req.user.role === 'super_admin';
  const userPerms = req.user.permissions || [];
  res.json({
    modules: getFilteredPermissionModules(userPerms, isSuper),
    all_permission_ids: getFilteredPermissionIds(userPerms, isSuper),
  });
});

router.get('/role-groups', (req, res) => {
  const isSuper = req.user.role === 'super_admin';
  const userPermsSet = new Set(req.user.permissions || []);
  const rows = db.prepare(`
    SELECT rg.*,
      (SELECT COUNT(*) FROM users u WHERE u.role_group_id = rg.id AND u.is_active = 1) AS user_count,
      (SELECT COUNT(*) FROM users u WHERE u.role_group_id = rg.id) AS total_user_count
    FROM role_groups rg
    ORDER BY rg.is_system DESC, rg.id ASC
  `).all();

  const groups = rows
    .filter((r) => r.slug !== 'super_admin')
    .map((r) => {
      let perms = [];
      try {
        perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
      } catch {}
      // Hierarchical RBAC: non-super users only see permissions that exist within their own scope
      const safePerms = Array.isArray(perms)
        ? (isSuper ? perms : perms.filter((p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p) && userPermsSet.has(p)))
        : [];
      return {
        ...r,
        is_system: !!r.is_system,
        user_count: Number(r.user_count || 0),
        total_user_count: Number(r.total_user_count || 0),
        permissions: safePerms,
      };
    });

  res.json(groups);
});

router.get('/default-role-group', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_role_group_id'").get();
  let defaultId = null;
  if (row && row.value) {
    try {
      defaultId = JSON.parse(row.value);
    } catch {
      defaultId = Number(row.value);
    }
  }
  if (!defaultId) {
    const userGroup = db.prepare("SELECT id FROM role_groups WHERE slug = 'user'").get();
    defaultId = userGroup?.id || 4;
  }
  const group = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(defaultId);
  res.json({
    default_role_group_id: defaultId,
    group: group ? { ...group, permissions: JSON.parse(group.permissions || '[]') } : null,
  });
});

router.put('/default-role-group', requirePermission('roles.manage'), (req, res) => {
  const { default_role_group_id } = req.body || {};
  const targetId = Number(default_role_group_id);
  if (!targetId) return res.status(400).json({ error: 'Valid default role group ID is required' });

  const group = db.prepare('SELECT id, name, slug FROM role_groups WHERE id = ?').get(targetId);
  if (!group) return res.status(404).json({ error: 'Role group not found' });
  if (group.slug === 'super_admin') return res.status(400).json({ error: 'Super Admin cannot be set as a default role group' });

  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('default_role_group_id', ?, datetime('now','+6 hours'))")
    .run(JSON.stringify(targetId));
  resetSettingsCache();

  audit(req, 'settings.default_role_group_update', 'settings', targetId, `Updated default user role group to ${group.name}`);
  res.json({ ok: true, default_role_group_id: targetId, group_name: group.name });
});

router.post('/role-groups', requirePermission('roles.manage'), (req, res) => {
  const isSuper = req.user.role === 'super_admin';
  const { name, description, color, permissions } = req.body || {};
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'Role group name is required' });

  // Generate unique slug
  let baseSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!baseSlug) baseSlug = 'group';
  let slug = baseSlug;
  let counter = 1;
  while (db.prepare('SELECT id FROM role_groups WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}_${counter++}`;
  }

  // Hierarchical restriction: non-super users can ONLY grant permissions they themselves possess
  const callerAllowedPerms = isSuper
    ? NON_SUPER_PERMISSION_IDS
    : (req.user.permissions || []).filter((p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p));

  const validPerms = Array.isArray(permissions)
    ? permissions.filter((p) => typeof p === 'string' && callerAllowedPerms.includes(p))
    : [];

  const r = db.prepare(`
    INSERT INTO role_groups (slug, name, description, color, is_system, permissions)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    slug,
    trimmedName,
    String(description || '').trim(),
    String(color || '#6366f1').trim(),
    JSON.stringify(validPerms)
  );

  const newId = Number(r.lastInsertRowid);
  audit(req, 'role_group.create', 'role_group', newId, `Created role group "${trimmedName}" with ${validPerms.length} permissions`);

  const created = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(newId);
  res.json({
    ...created,
    is_system: false,
    user_count: 0,
    total_user_count: 0,
    permissions: validPerms,
  });
});

router.put('/role-groups/:id', requirePermission('roles.manage'), (req, res) => {
  const isSuper = req.user.role === 'super_admin';
  const id = Number(req.params.id);
  const group = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(id);
  if (!group) return res.status(404).json({ error: 'Role group not found' });
  if (group.slug === 'super_admin') {
    return res.status(400).json({ error: 'Super Admin is a built-in root system role and does not require role group management.' });
  }

  const { name, description, color, permissions } = req.body || {};
  const trimmedName = name !== undefined ? String(name).trim() : group.name;
  if (!trimmedName) return res.status(400).json({ error: 'Role group name cannot be empty' });

  let updatedPerms = undefined;
  if (permissions !== undefined) {
    if (isSuper) {
      updatedPerms = Array.isArray(permissions)
        ? permissions.filter((p) => typeof p === 'string' && NON_SUPER_PERMISSION_IDS.includes(p))
        : [];
    } else {
      // Hierarchical delegation: non-super delegator can only modify permissions within their scope
      let existingGroupPerms = [];
      try {
        existingGroupPerms = JSON.parse(group.permissions || '[]');
      } catch {}
      const callerPermsSet = new Set(req.user.permissions || []);
      const preservedOutOfScopePerms = existingGroupPerms.filter((p) => !callerPermsSet.has(p));
      const grantedInScopePerms = Array.isArray(permissions)
        ? permissions.filter((p) => typeof p === 'string' && callerPermsSet.has(p) && !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p))
        : [];
      updatedPerms = [...preservedOutOfScopePerms, ...grantedInScopePerms];
    }
  }

  db.prepare(`
    UPDATE role_groups SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      color = COALESCE(?, color),
      permissions = COALESCE(?, permissions),
      updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(
    trimmedName,
    description !== undefined ? String(description).trim() : null,
    color !== undefined ? String(color).trim() : null,
    updatedPerms !== undefined ? JSON.stringify(updatedPerms) : null,
    id
  );

  audit(req, 'role_group.update', 'role_group', id, `Updated role group "${trimmedName}"`);

  const updated = db.prepare(`
    SELECT rg.*,
      (SELECT COUNT(*) FROM users u WHERE u.role_group_id = rg.id AND u.is_active = 1) AS user_count,
      (SELECT COUNT(*) FROM users u WHERE u.role_group_id = rg.id) AS total_user_count
    FROM role_groups rg
    WHERE rg.id = ?
  `).get(id);

  let perms = [];
  try {
    perms = JSON.parse(updated.permissions || '[]');
  } catch {}

  const safePerms = isSuper
    ? perms
    : perms.filter((p) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(p) && (req.user.permissions || []).includes(p));

  res.json({
    ...updated,
    is_system: !!updated.is_system,
    user_count: Number(updated.user_count || 0),
    total_user_count: Number(updated.total_user_count || 0),
    permissions: safePerms,
  });
});

router.delete('/role-groups/:id', requirePermission('roles.manage'), (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare('SELECT * FROM role_groups WHERE id = ?').get(id);
  if (!group) return res.status(404).json({ error: 'Role group not found' });

  if (group.is_system) {
    return res.status(400).json({ error: `Built-in system role group "${group.name}" cannot be deleted` });
  }

  const assignedUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role_group_id = ?').get(id)?.c || 0;
  if (assignedUsers > 0) {
    return res.status(400).json({
      error: `Cannot delete role group "${group.name}". It is currently assigned to ${assignedUsers} user(s). Please reassign them first.`,
      assigned_users_count: assignedUsers,
    });
  }

  db.prepare('DELETE FROM role_groups WHERE id = ?').run(id);
  audit(req, 'role_group.delete', 'role_group', id, `Deleted custom role group "${group.name}"`);

  res.json({ ok: true, message: `Role group "${group.name}" deleted successfully` });
});

router.get('/holidays', (req, res) => {
  res.json(db.prepare('SELECT * FROM holidays ORDER BY date').all());
});

router.post('/holidays', requireAdmin, (req, res) => {
  const { date, name } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date required' });
  db.prepare('INSERT OR IGNORE INTO holidays (date, name) VALUES (?, ?)').run(date, name || '');
  audit(req, 'settings.holiday_add', 'settings', null, `Added holiday ${date}`);
  res.json({ ok: true });
});

router.delete('/holidays/:date', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM holidays WHERE date = ?').run(req.params.date);
  audit(req, 'settings.holiday_remove', 'settings', null, `Removed holiday ${req.params.date}`);
  res.json({ ok: true });
});

router.post('/saved-filters', (req, res) => {
  const { name, payload } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = db.prepare('INSERT INTO saved_filters (user_id, name, payload) VALUES (?, ?, ?)')
    .run(req.user.id, name, JSON.stringify(payload || {}));
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

router.get('/saved-filters', (req, res) => {
  const rows = db.prepare('SELECT * FROM saved_filters WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') })));
});

router.delete('/saved-filters/:id', (req, res) => {
  db.prepare('DELETE FROM saved_filters WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.put('/', requirePermission('settings.manage'), (req, res) => {
  const allowed = ['taskStatuses', 'priorities', 'difficulties', 'kpi', 'workingDays', 'businessHours', 'notificationRules', 'security', 'dashboard'];
  const keys = Object.keys(req.body || {});
  for (const k of keys) {
    if (allowed.includes(k)) setSetting(k, req.body[k]);
  }
  audit(req, 'settings.update', 'settings', null, `Updated settings: ${keys.join(', ')}`);
  resetSettingsCache();
  res.json(getSettings());
});

export default router;

