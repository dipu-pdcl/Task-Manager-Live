import type { Settings, StatusMeta, PriorityMeta, DifficultyMeta } from './types';

/**
 * Display label for a task's permanent Task ID. Falls back to the internal row
 * id so a task restored from a very old backup is still identifiable in the UI
 * until the next reconciliation assigns it a code.
 */
export function taskCodeLabel(code?: string | null, id?: number | null): string {
  const c = (code || '').trim();
  if (c) return c;
  return id != null ? `#${id}` : '';
}

export function cx(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

export function parseBd(s?: string | null): Date | null {
  if (!s) return null;
  let iso = s.includes('T') ? s : s.replace(' ', 'T');
  if (iso.length <= 10) iso += 'T00:00:00';
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += '+06:00';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function toBdUTC(d: Date): Date {
  return new Date(d.getTime() + BD_OFFSET_MS);
}

export function bdDateKey(): string {
  return toBdUTC(new Date()).toISOString().slice(0, 10);
}

export function bdAddDays(key: string, n: number): string {
  const d = parseBd(key);
  if (!d) return key;
  d.setDate(d.getDate() + n);
  return toBdUTC(d).toISOString().slice(0, 10);
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const d = parseBd(iso);
  if (!d) return '';
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd}d ago`;
  return fmtDate(iso);
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = parseBd(iso);
  if (!d) return '—';
  return toBdUTC(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const prettyDate = fmtDate;

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = parseBd(iso);
  if (!d) return '—';
  return toBdUTC(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export function initials(name?: string): string {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#a855f7', '#f59e0b',
];

export function avatarColor(name?: string): string {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(task: { due_date?: string | null; status?: string }): boolean {
  if (!task.due_date || !task.status) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return task.due_date < bdDateKey();
}

export function isDueSoon(task: { due_date?: string | null; status?: string }, days = 1): boolean {
  if (!task.due_date || !task.status) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return task.due_date <= bdAddDays(bdDateKey(), days) && task.due_date >= bdDateKey();
}

export function statusById(settings: Settings | null, id?: string): StatusMeta {
  return settings?.taskStatuses.find((s) => s.id === id) || { id: id || 'todo', name: id || 'To Do', color: '#94a3b8' };
}

export function priorityById(settings: Settings | null, id?: string): PriorityMeta {
  return settings?.priorities.find((p) => p.id === id) || { id: id || 'medium', name: id || 'Medium', color: '#94a3b8', weight: 2 };
}

export function difficultyById(settings: Settings | null, id?: string): DifficultyMeta {
  return settings?.difficulties.find((d) => d.id === id) || { id: id || 'medium', name: id || 'Medium', points: 2 };
}

export const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: '180d', label: 'Last 180 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom Range' },
];

export const TASK_TYPES = ['task', 'bug', 'feature', 'research', 'design', 'infra'];

export const FLAGS = [
  'Urgent', 'Client', 'Internal', 'Finance', 'Development', 'Infrastructure',
  'Security', 'Bug', 'Enhancement', 'Testing', 'Software', 'Network',
];

export function buildQuery(params: Record<string, string | string[] | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) v.forEach((x) => x !== undefined && qs.append(k, String(x)));
    } else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const WEEKDAY_OPTIONS = [
  { id: 0, name: 'Sunday', short: 'Sun' },
  { id: 1, name: 'Monday', short: 'Mon' },
  { id: 2, name: 'Tuesday', short: 'Tue' },
  { id: 3, name: 'Wednesday', short: 'Wed' },
  { id: 4, name: 'Thursday', short: 'Thu' },
  { id: 5, name: 'Friday', short: 'Fri' },
  { id: 6, name: 'Saturday', short: 'Sat' },
];

export const WEEKEND_PRESETS = [
  { label: 'Fri Only (Dhanmondi Standard)', days: [5] },
  { label: 'Fri & Sat (Standard BD)', days: [5, 6] },
  { label: 'Sat & Sun (Standard Int\'l)', days: [6, 0] },
  { label: 'Sun Only', days: [0] },
  { label: 'Thu & Fri', days: [4, 5] },
];

const DAY_NAME_TO_INT: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

function normalizeDay(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val) && val >= 0 && val <= 6) return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s in DAY_NAME_TO_INT) return DAY_NAME_TO_INT[s];
    const n = Number(s);
    if (!isNaN(n) && n >= 0 && n <= 6) return n;
  }
  return null;
}

export function parseWeekendDays(raw?: unknown): number[] {
  if (Array.isArray(raw)) {
    const list = raw.map(normalizeDay).filter((n): n is number => n !== null);
    return list.length ? Array.from(new Set(list)).sort((a, b) => a - b) : [5];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list = parsed.map(normalizeDay).filter((n): n is number => n !== null);
        return list.length ? Array.from(new Set(list)).sort((a, b) => a - b) : [5];
      }
    } catch {
      const single = normalizeDay(raw);
      if (single !== null) return [single];
    }
  }
  return [5]; // Default Friday only
}

export function formatWeekendDays(weekendDays?: number[]): string {
  const days = parseWeekendDays(weekendDays);
  if (!days.length) return 'None';
  return days.map((d) => WEEKDAY_SHORT[d] || String(d)).join(', ');
}

export function formatWeekendDaysFull(weekendDays?: number[]): string {
  const days = parseWeekendDays(weekendDays);
  if (!days.length) return 'No assigned weekend';
  if (days.length === 1) return `${WEEKDAY_NAMES[days[0]]}`;
  return days.map((d) => WEEKDAY_NAMES[d]).join(' & ');
}

export function calculateLeaveDaysClient(
  startDateStr?: string,
  endDateStr?: string,
  weekendDays: number[] = [5],
  holidayDates: (string | { date: string })[] = [],
  durationType: string = 'full_day'
) {
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

  if (isNaN(cur.getTime()) || isNaN(end.getTime()) || cur.getTime() > end.getTime()) {
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
  const excludedDates: { date: string; type: 'weekend' | 'holiday'; dayOfWeek: number; dayName: string; label: string }[] = [];

  while (cur.getTime() <= end.getTime()) {
    totalCalendarDays++;
    const dayOfWeek = cur.getUTCDay();
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

