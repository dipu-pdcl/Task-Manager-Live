export const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

import { db } from './db.js';

function bdVirtual(ms = Date.now()) {
  return new Date(ms + BD_OFFSET_MS);
}

export function bdNow() { return bdVirtual(); }

export function today() { return bdNow().toISOString().slice(0, 10); }

export function now() { return bdNow().toISOString().replace('T', ' ').slice(0, 19); }

export function isoNow() { return bdNow().toISOString(); }

export function daysAgoISO(n) {
  const d = bdNow();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

export function dateDaysAgo(n) {
  const d = bdNow();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStrOrDays, n) {
  let dateStr = dateStrOrDays;
  let days = n;
  if (typeof dateStrOrDays === 'number' && n === undefined) {
    days = dateStrOrDays;
    dateStr = today();
  } else if (!dateStr) {
    dateStr = today();
  }
  const s = String(dateStr);
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return new Date(Date.UTC(y, mo - 1, d + (Number(days) || 0))).toISOString().slice(0, 10);
}

export function startOfMonth() {
  const b = bdNow();
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1));
}

export function startOfYear() {
  const b = bdNow();
  return new Date(Date.UTC(b.getUTCFullYear(), 0, 1));
}

function fmtDT(d) { return d.toISOString().replace('T', ' ').slice(0, 19); }

export function dateRangeFromKey(key, custom = null) {
  const now = bdNow();
  let end = new Date(now);
  let start;
  switch (key) {
    case 'today': start = new Date(now); break;
    case 'yesterday': start = new Date(now); start.setUTCDate(start.getUTCDate() - 1); end.setUTCDate(end.getUTCDate() - 1); break;
    case '7d': start = new Date(now); start.setUTCDate(start.getUTCDate() - 7); break;
    case '30d': start = new Date(now); start.setUTCDate(start.getUTCDate() - 30); break;
    case '90d': start = new Date(now); start.setUTCDate(start.getUTCDate() - 90); break;
    case '180d': start = new Date(now); start.setUTCDate(start.getUTCDate() - 180); break;
    case 'month': start = new Date(now); start.setUTCDate(1); break;
    case 'year': start = new Date(now); start.setUTCMonth(0, 1); break;
    case 'custom':
      {
        const from = new Date(custom?.from);
        const to = custom?.to ? new Date(custom.to) : null;
        if (isNaN(from.getTime()) || (to && isNaN(to.getTime()))) {
          start = new Date(now); start.setUTCDate(start.getUTCDate() - 30);
        } else {
          start = from;
          if (to) end = new Date(to);
        }
        break;
      }
    default: start = new Date(now); start.setUTCDate(start.getUTCDate() - 30); break;
  }
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  return { start: fmtDT(start), end: fmtDT(end) };
}

export function prettyDate(iso) {
  if (!iso) return '—';
  const s = String(iso);
  if (s.length <= 10) {
    const d = new Date(s.length === 10 ? s + 'T00:00:00+06:00' : s);
    if (isNaN(d.getTime())) return s;
    return new Date(d.getTime()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = String(iso);
  const t = s.length <= 10 ? s + 'T00:00:00+06:00' : (s.includes('T') ? s : s.replace(' ', 'T'));
  const d = new Date(t);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (isNaN(diff)) return '';
  if (diff < 60) return 'just now';
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd}d ago`;
  return prettyDate(iso);
}

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function initials(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DAY_NAME_TO_INT = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

function normalizeDay(val) {
  if (typeof val === 'number' && !isNaN(val) && val >= 0 && val <= 6) return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s in DAY_NAME_TO_INT) return DAY_NAME_TO_INT[s];
    const n = Number(s);
    if (!isNaN(n) && n >= 0 && n <= 6) return n;
  }
  return null;
}

export function parseWeekendDays(raw) {
  if (Array.isArray(raw)) {
    const list = raw.map(normalizeDay).filter((n) => n !== null);
    return list.length ? Array.from(new Set(list)).sort((a, b) => a - b) : [5];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list = parsed.map(normalizeDay).filter((n) => n !== null);
        return list.length ? Array.from(new Set(list)).sort((a, b) => a - b) : [5];
      }
    } catch {
      const single = normalizeDay(raw);
      if (single !== null) return [single];
    }
  }
  return [5]; // Default: Friday only (5)
}

/**
 * Calculates deductible leave days excluding the user's specific assigned weekend days and company holidays.
 * @param {string} startDateStr - 'YYYY-MM-DD'
 * @param {string} endDateStr - 'YYYY-MM-DD'
 * @param {number[]|string} weekendDays - e.g. [5] or [5, 6] (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
 * @param {string[]|{date:string}[]} [holidayDates] - list of holiday date strings 'YYYY-MM-DD'
 * @param {string} [durationType] - 'full_day' | 'half_day_morning' | 'half_day_afternoon'
 */
export function calculateLeaveDays(startDateStr, endDateStr, weekendDays = [5], holidayDates = [], durationType = 'full_day') {
  if (!startDateStr || !endDateStr) {
    return {
      daysCount: 1,
      totalCalendarDays: 1,
      workingDays: 1,
      weekendDaysCount: 0,
      holidayDaysCount: 0,
      excludedDates: [],
      weekendDays: [5],
    };
  }

  const weekends = parseWeekendDays(weekendDays);
  const holidaySet = new Set(
    (holidayDates || []).map((h) => (typeof h === 'string' ? h : h?.date)).filter(Boolean)
  );

  const [y1, m1, d1] = startDateStr.split('-').map(Number);
  const [y2, m2, d2] = endDateStr.split('-').map(Number);
  const cur = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));

  if (cur.getTime() > end.getTime()) {
    return {
      daysCount: 0,
      totalCalendarDays: 0,
      workingDays: 0,
      weekendDaysCount: 0,
      holidayDaysCount: 0,
      excludedDates: [],
      weekendDays: weekends,
    };
  }

  let totalCalendarDays = 0;
  let workingDays = 0;
  let weekendDaysCount = 0;
  let holidayDaysCount = 0;
  const excludedDates = [];

  while (cur.getTime() <= end.getTime()) {
    totalCalendarDays++;
    const dayOfWeek = cur.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const dateStr = cur.toISOString().slice(0, 10);
    const dayName = WEEKDAY_NAMES[dayOfWeek];

    if (weekends.includes(dayOfWeek)) {
      weekendDaysCount++;
      excludedDates.push({ date: dateStr, type: 'weekend', dayOfWeek, dayName, label: `Weekend (${dayName})` });
    } else if (holidaySet.has(dateStr)) {
      holidayDaysCount++;
      excludedDates.push({ date: dateStr, type: 'holiday', dayOfWeek, dayName, label: 'Company Holiday' });
    } else {
      workingDays++;
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  let finalDays = workingDays;
  if (durationType === 'half_day_morning' || durationType === 'half_day_afternoon') {
    if (workingDays === 1) {
      finalDays = 0.5;
    } else if (workingDays > 1) {
      finalDays = Math.max(0.5, workingDays - 0.5);
    }
  }

  return {
    daysCount: finalDays,
    totalCalendarDays,
    workingDays,
    weekendDaysCount,
    holidayDaysCount,
    excludedDates,
    weekendDays: weekends,
  };
}

/**
 * Checks if a user is currently on an approved leave.
 * @param {number} userId - The user ID
 * @param {string} [dateStr] - Optional date string 'YYYY-MM-DD' (defaults to today in BD timezone)
 * @returns {{ onLeave: boolean, leaveType?: string, leaveApplication?: object }}
 */
export function isUserOnLeave(userId, dateStr = today()) {
  const leave = db.prepare(`
    SELECT * FROM leave_applications
    WHERE user_id = ? AND status = 'approved'
      AND ? BETWEEN start_date AND end_date
    ORDER BY start_date LIMIT 1
  `).get(userId, dateStr);

  if (leave) {
    return { onLeave: true, leaveType: leave.leave_type, leaveApplication: leave };
  }
  return { onLeave: false };
}

/**
 * Checks if a given date falls on a user's weekend.
 * @param {number} userId - The user ID
 * @param {string} [dateStr] - Optional date string 'YYYY-MM-DD' (defaults to today in BD timezone)
 * @returns {{ isWeekend: boolean, weekendDay?: number, weekendDayName?: string }}
 */
export function isUserOnWeekend(userId, dateStr = today()) {
  const user = db.prepare('SELECT weekend_days FROM users WHERE id = ?').get(userId);
  if (!user) return { isWeekend: false };

  const weekendDays = parseWeekendDays(user.weekend_days);
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday, ..., 6 = Saturday

  if (weekendDays.includes(dayOfWeek)) {
    return { isWeekend: true, weekendDay: dayOfWeek, weekendDayName: WEEKDAY_NAMES[dayOfWeek] };
  }
  return { isWeekend: false };
}

/**
 * Checks if a user is currently unavailable (on Leave or Weekend).
 * @param {number} userId - The user ID
 * @param {string} [dateStr] - Optional date string 'YYYY-MM-DD' (defaults to today in BD timezone)
 * @returns {{ available: boolean, reason?: string, details?: object }}
 */
export function checkUserAvailability(userId, dateStr = today()) {
  const leaveCheck = isUserOnLeave(userId, dateStr);
  if (leaveCheck.onLeave) {
    return {
      available: false,
      reason: `This user is currently on Leave (${leaveCheck.leaveType}) and cannot be mentioned.`,
      details: { type: 'leave', ...leaveCheck }
    };
  }

  const weekendCheck = isUserOnWeekend(userId, dateStr);
  if (weekendCheck.isWeekend) {
    return {
      available: false,
      reason: `This user is on Weekend (${weekendCheck.weekendDayName}) and cannot be mentioned.`,
      details: { type: 'weekend', ...weekendCheck }
    };
  }

  return { available: true };
}

export function toLocal(dt, offsetMin = 360) {
  if (dt === null || dt === undefined || dt === '') return '';
  const s = String(dt);
  if (s.length <= 10) return s;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) return s.replace('T', ' ').slice(0, 19);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const bd = new Date(d.getTime() + offsetMin * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const hasSec = /:\d{2}:\d{2}/.test(s);
  return `${bd.getUTCFullYear()}-${p(bd.getUTCMonth() + 1)}-${p(bd.getUTCDate())} ${p(bd.getUTCHours())}:${p(bd.getUTCMinutes())}${hasSec ? ':' + p(bd.getUTCSeconds()) : ''}`;
}

