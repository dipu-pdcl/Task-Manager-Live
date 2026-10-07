import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { signToken, getPublicUser, requireAuth, audit, notify } from '../middleware.js';
import { broadcastToUser } from '../sse.js';

const router = Router();

const MAX_PASSWORD_LEN = 128;
const loginAttempts = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 10;
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.resetAt > windowMs) {
    loginAttempts.set(key, { count: 1, resetAt: now });
    return true;
  }
  rec.count += 1;
  if (rec.count > max) return false;
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of loginAttempts) if (v.resetAt < cutoff) loginAttempts.delete(k);
}, 5 * 60 * 1000).unref();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (String(password).length > MAX_PASSWORD_LEN) {
    return res.status(400).json({ error: 'Password is too long' });
  }
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(`${ip}:${String(email).trim().toLowerCase()}`)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const emailKey = String(email).trim().toLowerCase();
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
      d.hotline_ext
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE lower(u.email) = ?
  `).get(emailKey);

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'Your account has been deactivated. Contact an administrator.' });

  db.prepare(`
    UPDATE users
    SET last_login = datetime('now','+6 hours'),
        live_status = 'active',
        last_active_at = datetime('now','+6 hours'),
        status_updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(user.id);

  const freshUser = db.prepare(`
    SELECT u.*,
      rg.name AS role_group_name,
      rg.slug AS role_group_slug,
      rg.color AS role_group_color,
      rg.permissions AS role_group_permissions,
      t.name AS team_name,
      d.name AS department_name,
      d.hotline AS department_hotline,
      d.ext AS department_ext,
      d.hotline_ext
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(user.id);

  const token = signToken(freshUser || user);
  req.user = freshUser || user;
  audit(req, 'auth.login', 'user', user.id, 'User signed in (Status: Active)');
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/',
  });
  res.json({ user: getPublicUser(freshUser || user) });
});

router.post('/logout', requireAuth, (req, res) => {
  try {
    db.prepare(`
      UPDATE users
      SET live_status = 'inactive',
          last_active_at = datetime('now','+6 hours'),
          status_updated_at = datetime('now','+6 hours')
      WHERE id = ?
    `).run(req.user.id);
    broadcastToUser(req.user.id, 'live-status', { live_status: 'inactive', last_active_at: null });
    audit(req, 'auth.logout', 'user', req.user.id, 'User signed out (Status: Inactive)');
  } catch {}
  res.clearCookie('auth_token', { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ ok: true, message: 'Logged out successfully' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: getPublicUser(req.user) });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current password and new password are required' });
  if (typeof newPassword !== 'string' || String(newPassword).length > MAX_PASSWORD_LEN) {
    return res.status(400).json({ error: 'New password is too long' });
  }
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  if (!bcrypt.compareSync(String(currentPassword), req.user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (String(currentPassword) === String(newPassword)) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }
  db.prepare("UPDATE users SET password_hash = ?, password_must_change = 0, updated_at = datetime('now','+6 hours') WHERE id = ?")
    .run(bcrypt.hashSync(String(newPassword), 12), req.user.id);
  audit(req, 'auth.change_password', 'user', req.user.id, 'Password changed');
  notify(req.user.id, 'security', 'Password changed', 'Your account password was successfully updated.');
  res.json({ ok: true });
});

export default router;
