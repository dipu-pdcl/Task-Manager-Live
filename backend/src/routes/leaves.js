import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, requireAdmin, audit, notify, isAdmin } from '../middleware.js';
import { bdNow, today, calculateLeaveDays, parseWeekendDays, WEEKDAY_NAMES } from '../utils.js';

const router = Router();
router.use(requireAuth);

const DEFAULT_EL_QUOTA = 14;
const DEFAULT_CL_QUOTA = 10;
const DEFAULT_ANNUAL_QUOTA = 24; // EL (14) + CL (10)
const DEFAULT_SL_QUOTA = 14;     // Sick Leave (14) is separate and does not count towards the 24-day annual quota

export function getLeaveQuotasForUser(userId, year) {
  const custom = db.prepare('SELECT * FROM leave_quotas WHERE user_id = ? AND year = ?').get(userId, year);
  return {
    el_quota: custom ? Number(custom.el_quota) : DEFAULT_EL_QUOTA,
    cl_quota: custom ? Number(custom.cl_quota) : DEFAULT_CL_QUOTA,
    sl_quota: custom ? Number(custom.sl_quota) : DEFAULT_SL_QUOTA,
    annual_quota: (custom ? Number(custom.el_quota) : DEFAULT_EL_QUOTA) + (custom ? Number(custom.cl_quota) : DEFAULT_CL_QUOTA),
  };
}

export function calculateUserLeaveBalance(userId, year) {
  const quotas = getLeaveQuotasForUser(userId, year);

  const usageRows = db.prepare(`
    SELECT
      leave_type,
      status,
      COALESCE(SUM(days_count), 0) as total_days,
      COUNT(*) as count
    FROM leave_applications
    WHERE user_id = ? AND year = ? AND status IN ('approved', 'pending')
    GROUP BY leave_type, status
  `).all(userId, year);

  let el_approved = 0;
  let el_pending = 0;
  let cl_approved = 0;
  let cl_pending = 0;
  let sl_approved = 0;
  let sl_pending = 0;

  for (const row of usageRows) {
    const days = Number(row.total_days) || 0;
    if (row.leave_type === 'EL') {
      if (row.status === 'approved') el_approved += days;
      if (row.status === 'pending') el_pending += days;
    } else if (row.leave_type === 'CL') {
      if (row.status === 'approved') cl_approved += days;
      if (row.status === 'pending') cl_pending += days;
    } else if (row.leave_type === 'SL') {
      if (row.status === 'approved') sl_approved += days;
      if (row.status === 'pending') sl_pending += days;
    }
  }

  const el_balance = Math.max(0, quotas.el_quota - el_approved);
  const cl_balance = Math.max(0, quotas.cl_quota - cl_approved);
  const sl_balance = Math.max(0, quotas.sl_quota - sl_approved);

  const annual_approved = el_approved + cl_approved;
  const annual_pending = el_pending + cl_pending;
  const annual_balance = Math.max(0, quotas.annual_quota - annual_approved);

  return {
    year,
    quotas,
    el: {
      quota: quotas.el_quota,
      approved: el_approved,
      pending: el_pending,
      balance: el_balance,
      label: 'Earned Leave (EL)',
    },
    cl: {
      quota: quotas.cl_quota,
      approved: cl_approved,
      pending: cl_pending,
      balance: cl_balance,
      label: 'Casual Leave (CL)',
    },
    annual: {
      quota: quotas.annual_quota,
      approved: annual_approved,
      pending: annual_pending,
      balance: annual_balance,
      label: 'Total Annual Leave (EL + CL)',
      note: 'Combined total quota of 24 days/year (14 EL + 10 CL)',
    },
    sl: {
      quota: quotas.sl_quota,
      approved: sl_approved,
      pending: sl_pending,
      balance: sl_balance,
      label: 'Sick Leave (SL)',
      note: 'Separate 14 days/year, does not count toward the 24-day annual total',
    },
  };
}

// GET /api/leaves/summary
router.get('/summary', (req, res) => {
  const currentYear = bdNow().getUTCFullYear();
  const year = Number(req.query.year) || currentYear;
  const targetUserId = (isAdmin(req.user) && req.query.user_id) ? Number(req.query.user_id) : req.user.id;

  const targetUser = db.prepare('SELECT id, name, email, role, avatar, title FROM users WHERE id = ?').get(targetUserId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const balance = calculateUserLeaveBalance(targetUserId, year);

  const pendingAdminCount = isAdmin(req.user)
    ? db.prepare("SELECT COUNT(*) c FROM leave_applications WHERE status = 'pending' AND year = ?").get(year)?.c || 0
    : 0;

  const userPendingCount = db.prepare("SELECT COUNT(*) c FROM leave_applications WHERE user_id = ? AND status = 'pending' AND year = ?").get(targetUserId, year)?.c || 0;
  const userApprovedCount = db.prepare("SELECT COUNT(*) c FROM leave_applications WHERE user_id = ? AND status = 'approved' AND year = ?").get(targetUserId, year)?.c || 0;

  // Monthly breakdown of approved leaves for this user in the specified year
  const monthlyRows = db.prepare(`
    SELECT
      strftime('%m', start_date) as month,
      leave_type,
      SUM(days_count) as total_days
    FROM leave_applications
    WHERE user_id = ? AND year = ? AND status = 'approved'
    GROUP BY strftime('%m', start_date), leave_type
    ORDER BY month ASC
  `).all(targetUserId, year);

  res.json({
    user: targetUser,
    year,
    balance,
    counts: {
      userPending: userPendingCount,
      userApproved: userApprovedCount,
      adminPending: pendingAdminCount,
    },
    monthlyUsage: monthlyRows,
  });
});

// GET /api/leaves/balances-all (Admin / Super Admin / Leave Managers view of all staff leave ledgers)
router.get('/balances-all', requirePermission('leaves.manage_quotas', 'leaves.approve'), (req, res) => {
  const currentYear = bdNow().getUTCFullYear();
  const year = Number(req.query.year) || currentYear;

  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.title, u.phone, u.employee_id, u.avatar, u.team_id, u.department_id, u.weekend_days,
           t.name AS team_name, d.name AS department_name
    FROM users u
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.is_active = 1
    ORDER BY u.name ASC
  `).all().map((u) => ({
    ...u,
    weekend_days: parseWeekendDays(u.weekend_days),
  }));

  const results = users.map((u) => ({
    user: u,
    balance: calculateUserLeaveBalance(u.id, year),
  }));

  res.json(results);
});

// GET /api/leaves/calendar (Calendar view of all approved leaves)
router.get('/calendar', (req, res) => {
  const currentYear = bdNow().getUTCFullYear();
  const year = Number(req.query.year) || currentYear;
  const month = req.query.month; // optional 01-12

  let sql = `
    SELECT
      la.*,
      u.name AS applicant_name,
      u.email AS applicant_email,
      u.avatar AS applicant_avatar,
      u.title AS applicant_title,
      t.name AS team_name,
      d.name AS department_name
    FROM leave_applications la
    JOIN users u ON u.id = la.user_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE la.status = 'approved' AND la.year = ?
  `;
  const params = [year];

  if (month) {
    sql += ` AND (strftime('%m', la.start_date) = ? OR strftime('%m', la.end_date) = ?)`;
    params.push(String(month).padStart(2, '0'), String(month).padStart(2, '0'));
  }

  sql += ' ORDER BY la.start_date ASC';
  const list = db.prepare(sql).all(...params);
  res.json(list);
});

// GET /api/leaves (List applications)
router.get('/', (req, res) => {
  const currentYear = bdNow().getUTCFullYear();
  const year = req.query.year ? Number(req.query.year) : null;
  const status = req.query.status; // 'pending', 'approved', 'rejected', 'cancelled', 'all'
  const leaveType = req.query.leave_type; // 'EL', 'CL', 'SL', 'all'
  const requestedUserId = req.query.user_id ? Number(req.query.user_id) : null;
  const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
  const departmentId = req.query.department_id ? Number(req.query.department_id) : null;

  let sql = `
    SELECT
      la.*,
      u.name AS applicant_name,
      u.email AS applicant_email,
      u.avatar AS applicant_avatar,
      u.title AS applicant_title,
      u.role AS applicant_role,
      u.weekend_days AS applicant_weekend_days,
      t.name AS team_name,
      d.name AS department_name,
      d.id AS department_id,
      rel.name AS reliever_name,
      appr.name AS approver_name
    FROM leave_applications la
    JOIN users u ON u.id = la.user_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN users rel ON rel.id = la.reliever_user_id
    LEFT JOIN users appr ON appr.id = la.approved_by
    WHERE 1=1
  `;
  const params = [];

  // If not admin, normal user can only view their own leave applications
  if (!isAdmin(req.user)) {
    sql += ' AND la.user_id = ?';
    params.push(req.user.id);
  } else if (requestedUserId) {
    sql += ' AND la.user_id = ?';
    params.push(requestedUserId);
  }

  if (year) {
    sql += ' AND la.year = ?';
    params.push(year);
  }

  if (status && status !== 'all') {
    sql += ' AND la.status = ?';
    params.push(status);
  }

  if (leaveType && leaveType !== 'all') {
    sql += ' AND la.leave_type = ?';
    params.push(leaveType);
  }

  if (departmentId) {
    sql += ' AND d.id = ?';
    params.push(departmentId);
  }

  if (search) {
    sql += ' AND (lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(la.reason) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY la.created_at DESC';

  const rows = db.prepare(sql).all(...params).map((r) => ({
    ...r,
    applicant_weekend_days: parseWeekendDays(r.applicant_weekend_days),
  }));
  res.json(rows);
});

// GET /api/leaves/:id (Single application detail)
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT
      la.*,
      u.name AS applicant_name,
      u.email AS applicant_email,
      u.avatar AS applicant_avatar,
      u.title AS applicant_title,
      u.role AS applicant_role,
      u.weekend_days AS applicant_weekend_days,
      t.name AS team_name,
      d.name AS department_name,
      rel.name AS reliever_name,
      rel.email AS reliever_email,
      appr.name AS approver_name
    FROM leave_applications la
    JOIN users u ON u.id = la.user_id
    LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN users rel ON rel.id = la.reliever_user_id
    LEFT JOIN users appr ON appr.id = la.approved_by
    WHERE la.id = ?
  `).get(id);

  if (!row) return res.status(404).json({ error: 'Leave application not found' });

  if (!isAdmin(req.user) && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  res.json({
    ...row,
    applicant_weekend_days: parseWeekendDays(row.applicant_weekend_days),
  });
});

// GET /api/leaves/calculate & POST /api/leaves/calculate (Dynamic calculation endpoint)
const handleCalculate = (req, res) => {
  const params = req.method === 'GET' ? req.query : (req.body || {});
  const { user_id, start_date, end_date, duration_type = 'full_day' } = params;
  const targetUserId = (isAdmin(req.user) && user_id) ? Number(user_id) : (user_id ? Number(user_id) : req.user.id);

  const applicant = db.prepare('SELECT id, name, email, weekend_days FROM users WHERE id = ?').get(targetUserId);
  if (!applicant) return res.status(404).json({ error: 'User not found' });

  const holidays = db.prepare('SELECT date, name FROM holidays').all();
  const userWeekends = parseWeekendDays(applicant.weekend_days);
  const calc = calculateLeaveDays(start_date, end_date, userWeekends, holidays, duration_type);

  res.json({
    user_id: targetUserId,
    user_name: applicant.name,
    weekend_days: userWeekends,
    weekend_names: userWeekends.map((d) => WEEKDAY_NAMES[d]),
    ...calc,
  });
};

router.get('/calculate', handleCalculate);
router.post('/calculate', handleCalculate);

// POST /api/leaves (Submit a new leave application)
router.post('/', (req, res) => {
  const {
    user_id,
    leave_type,
    duration_type = 'full_day',
    start_date,
    end_date,
    days_count,
    reason,
    reliever_user_id,
    emergency_contact,
  } = req.body || {};

  const targetUserId = (isAdmin(req.user) && user_id) ? Number(user_id) : req.user.id;
  const applicant = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!applicant) return res.status(404).json({ error: 'Applicant user not found' });

  if (!['EL', 'CL', 'SL'].includes(leave_type)) {
    return res.status(400).json({ error: 'Invalid leave type. Must be EL (Earned Leave), CL (Casual Leave), or SL (Sick Leave).' });
  }

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required.' });
  }

  if (start_date > end_date) {
    return res.status(400).json({ error: 'Start date cannot be after end date.' });
  }

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Reason for leave application is required.' });
  }

  // Calculate dynamic days based on applicant's specific assigned weekend days and holidays
  const holidays = db.prepare('SELECT date, name FROM holidays').all();
  const userWeekends = parseWeekendDays(applicant.weekend_days);
  const calc = calculateLeaveDays(start_date, end_date, userWeekends, holidays, duration_type || 'full_day');

  if (calc.daysCount <= 0) {
    const weekendDayNames = userWeekends.map((d) => WEEKDAY_NAMES[d]).join(', ');
    return res.status(400).json({
      error: `The selected date range falls entirely on assigned weekend day(s) (${weekendDayNames}) or company holidays. Deductible leave duration is 0 days.`,
      calc,
    });
  }

  const finalDays = calc.daysCount;
  const startYear = Number(start_date.slice(0, 4)) || bdNow().getUTCFullYear();

  // Check for duplicate / overlapping active applications
  const overlap = db.prepare(`
    SELECT id, start_date, end_date, leave_type FROM leave_applications
    WHERE user_id = ?
      AND status IN ('pending', 'approved')
      AND NOT (end_date < ? OR start_date > ?)
  `).get(targetUserId, start_date, end_date);

  if (overlap) {
    return res.status(400).json({
      error: `An active ${overlap.leave_type} leave application already exists for this period (${overlap.start_date} to ${overlap.end_date}).`,
    });
  }

  // Calculate current balance to check remaining quota
  const balance = calculateUserLeaveBalance(targetUserId, startYear);
  const typeKey = leave_type.toLowerCase();
  const availableBalance = balance[typeKey]?.balance ?? 0;

  if (finalDays > availableBalance) {
    return res.status(400).json({
      error: `Insufficient leave balance. You have ${availableBalance} day(s) of ${leave_type} remaining for ${startYear}, but requested ${finalDays} day(s) (${calc.totalCalendarDays} calendar days − ${calc.weekendDaysCount} weekend days${calc.holidayDaysCount ? ` − ${calc.holidayDaysCount} holidays` : ''}).`,
      balance,
      calc,
    });
  }

  const r = db.prepare(`
    INSERT INTO leave_applications (
      user_id, leave_type, duration_type, start_date, end_date, days_count,
      year, reason, reliever_user_id, emergency_contact, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    targetUserId,
    leave_type,
    duration_type || 'full_day',
    start_date,
    end_date,
    finalDays,
    startYear,
    String(reason).trim(),
    reliever_user_id ? Number(reliever_user_id) : null,
    emergency_contact ? String(emergency_contact).trim() : '',
  );

  const applicationId = Number(r.lastInsertRowid);
  const leaveName = leave_type === 'EL' ? 'Earned Leave' : leave_type === 'CL' ? 'Casual Leave' : 'Sick Leave';

  audit(req, 'leave.apply', 'leave_application', applicationId, `Applied for ${finalDays} days ${leave_type} (${start_date} to ${end_date}, ${calc.totalCalendarDays} cal days - ${calc.weekendDaysCount} weekend days) for ${applicant.name}`);

  // Notify all Admins
  const admins = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND is_active = 1 AND id != ?").all(req.user.id);
  for (const admin of admins) {
    notify(
      admin.id,
      'approval',
      'New Leave Application',
      `${applicant.name} applied for ${finalDays} day(s) of ${leaveName} from ${start_date} to ${end_date}.`,
      '/leaves'
    );
  }

  // If reliever was assigned, notify reliever
  if (reliever_user_id && Number(reliever_user_id) !== req.user.id) {
    notify(
      Number(reliever_user_id),
      'info',
      'Assigned as Leave Reliever',
      `${applicant.name} assigned you as a reliever during their ${leaveName} from ${start_date} to ${end_date}.`,
      '/leaves'
    );
  }

  const created = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(applicationId);
  res.json({
    ok: true,
    application: created,
    balance: calculateUserLeaveBalance(targetUserId, startYear),
  });
});

// PUT /api/leaves/:id/status (Approve or Reject leave application)
router.put('/:id/status', requirePermission('leaves.approve'), (req, res) => {
  const id = Number(req.params.id);
  const { status, admin_remarks = '' } = req.body || {};

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be either approved or rejected' });
  }

  const application = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(id);
  if (!application) return res.status(404).json({ error: 'Leave application not found' });

  if (application.status !== 'pending' && application.status !== status) {
    // If updating already decided status, allow admin to override
  }

  const applicant = db.prepare('SELECT * FROM users WHERE id = ?').get(application.user_id);

  // If approving, re-check balance
  if (status === 'approved' && application.status !== 'approved') {
    const balance = calculateUserLeaveBalance(application.user_id, application.year);
    const typeKey = application.leave_type.toLowerCase();
    const available = (balance[typeKey]?.balance ?? 0);
    // Note: application itself was pending, so balance.pending had it, but balance.balance is quota - approved.
    if (application.days_count > available) {
      return res.status(400).json({
        error: `Cannot approve: Insufficient balance. User only has ${available} day(s) of ${application.leave_type} available.`,
      });
    }
  }

  db.prepare(`
    UPDATE leave_applications
    SET status = ?, admin_remarks = ?, approved_by = ?, approved_at = datetime('now','+6 hours'), updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(status, String(admin_remarks).trim(), req.user.id, id);

  const leaveName = application.leave_type === 'EL' ? 'Earned Leave' : application.leave_type === 'CL' ? 'Casual Leave' : 'Sick Leave';
  const actionLabel = status === 'approved' ? 'Approved' : 'Rejected';

  audit(
    req,
    `leave.${status}`,
    'leave_application',
    id,
    `${actionLabel} ${application.days_count} days ${application.leave_type} for ${applicant?.name || 'user'}. Remarks: ${admin_remarks}`
  );

  notify(
    application.user_id,
    status === 'approved' ? 'approval' : 'security',
    `Leave Application ${actionLabel}`,
    `Your application for ${application.days_count} day(s) of ${leaveName} (${application.start_date} to ${application.end_date}) was ${actionLabel.toLowerCase()}.${admin_remarks ? ` Remarks: ${admin_remarks}` : ''}`,
    '/leaves'
  );

  const updated = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(id);
  res.json({
    ok: true,
    application: updated,
    balance: calculateUserLeaveBalance(application.user_id, application.year),
  });
});

// POST /api/leaves/:id/cancel (Cancel pending application)
router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const application = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(id);
  if (!application) return res.status(404).json({ error: 'Leave application not found' });

  if (!isAdmin(req.user) && application.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only cancel your own leave applications' });
  }

  if (application.status === 'cancelled') {
    return res.status(400).json({ error: 'Application is already cancelled' });
  }

  if (application.status === 'rejected') {
    return res.status(400).json({ error: 'Application has already been rejected' });
  }

  // Non-admins can only cancel pending applications
  if (!isAdmin(req.user) && application.status !== 'pending') {
    return res.status(400).json({ error: 'Approved applications can only be cancelled by an administrator' });
  }

  db.prepare(`
    UPDATE leave_applications
    SET status = 'cancelled', updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(id);

  audit(req, 'leave.cancel', 'leave_application', id, `Cancelled ${application.leave_type} leave application for user ID ${application.user_id}`);

  // Notify user if admin cancelled it
  if (req.user.id !== application.user_id) {
    notify(
      application.user_id,
      'info',
      'Leave Application Cancelled',
      `Your ${application.leave_type} leave application (${application.start_date} to ${application.end_date}) was cancelled by an administrator.`,
      '/leaves'
    );
  }

  res.json({ ok: true, balance: calculateUserLeaveBalance(application.user_id, application.year) });
});

// DELETE /api/leaves/:id (Delete application record)
router.delete('/:id', requirePermission('leaves.approve', 'leaves.manage_quotas'), (req, res) => {
  const id = Number(req.params.id);
  const application = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(id);
  if (!application) return res.status(404).json({ error: 'Leave application not found' });

  db.prepare('DELETE FROM leave_applications WHERE id = ?').run(id);
  audit(req, 'leave.delete', 'leave_application', id, `Deleted leave application record for user ID ${application.user_id}`);

  res.json({ ok: true });
});

export default router;
