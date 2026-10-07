import { db } from './db.js';

export const STATUSES = [
  { id: 'todo', name: 'To Do', color: '#3b82f6', icon: 'circle' },
  { id: 'discussion', name: 'Under Discussion', color: '#eab308', icon: 'message' },
  { id: 'in_progress', name: 'In Progress', color: '#f97316', icon: 'loader' },
  { id: 'in_review', name: 'In Review', color: '#a855f7', icon: 'eye' },
  { id: 'done', name: 'Done', color: '#22c55e', icon: 'check' },
  { id: 'cancelled', name: 'Cancelled', color: '#ef4444', icon: 'x' },
];

export const PRIORITIES = [
  { id: 'low', name: 'Low', color: '#64748b', weight: 1 },
  { id: 'medium', name: 'Medium', color: '#3b82f6', weight: 2 },
  { id: 'high', name: 'High', color: '#f97316', weight: 3 },
  { id: 'critical', name: 'Critical', color: '#ef4444', weight: 4 },
];

export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', points: 1, enabled: true },
  { id: 'medium', name: 'Medium', points: 2, enabled: true },
  { id: 'hard', name: 'Hard', points: 2, enabled: true },
  { id: 'critical', name: 'Critical', points: 5, enabled: true },
];

export const FLAGS = [
  'Urgent', 'Client', 'Internal', 'Finance', 'Development', 'Infrastructure',
  'Security', 'Bug', 'Enhancement', 'Testing', 'Software', 'Network',
];

export const DEFAULT_SETTINGS = {
  taskStatuses: STATUSES,
  priorities: PRIORITIES,
  difficulties: DIFFICULTIES,
  workingDays: [1, 2, 3, 4, 5],
  businessHours: { start: '09:00', end: '18:00' },
  notificationRules: {
    deadlineApproachingDays: 1,
    taskAssigned: true,
    taskUpdated: true,
    dueDateChanged: true,
    commentAdded: true,
    taskCompleted: true,
    mentions: true,
    taskOverdue: true,
  },
  security: { twoFactorEnabled: false, sessionTimeoutMinutes: 0 },
  dashboard: {},
};

let cache = null;
export function getSettings() {
  if (cache) return cache;
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.value);
      out[r.key] = Array.isArray(parsed) ? parsed : { ...(out[r.key] ?? {}), ...parsed };
    }
    catch { /* ignore malformed */ }
  }
  cache = out;
  return out;
}

export function getSetting(key) {
  return getSettings()[key];
}

export function setSetting(key, value) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  let merged;
  if (Array.isArray(value)) {
    merged = value;
  } else {
    const existing = row ? JSON.parse(row.value) : null;
    merged = existing ? { ...existing, ...value } : value;
  }
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','+6 hours'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','+6 hours')
  `).run(key, JSON.stringify(merged));
  cache = null;
}

export function resetSettingsCache() { cache = null; }

export function getStatusById(id) {
  return getSetting('taskStatuses').find((s) => s.id === id) ?? STATUSES[0];
}
export function getPriorityById(id) {
  return getSetting('priorities').find((p) => p.id === id) ?? PRIORITIES[1];
}
export function getDifficultyById(id) {
  return getSetting('difficulties').find((d) => d.id === id) ?? DIFFICULTIES[1];
}
export function getDifficultyPoints(id) {
  return getDifficultyById(id).points;
}
