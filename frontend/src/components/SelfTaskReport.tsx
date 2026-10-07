import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserCheck, FileText, FileSpreadsheet, FileJson, Filter, X,
  CheckCircle2, CircleDot, AlertTriangle, Users, Gauge,
} from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Skeleton, EmptyState, StatCard, StatusBadge } from '../components/ui';
import { DATE_PRESETS, priorityById, taskCodeLabel } from '../lib/utils';
import type { Settings, User, Team, Department } from '../lib/types';

interface SelfTaskRow {
  id: number;
  user_name: string;
  user_id: number;
  task_id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string;
  completion_date: string;
  completion_time: string;
  difficulty: string;
  difficulty_label: string;
  difficulty_points: number;
  team_name: string;
  department_name: string;
  assigned_names: string;
}

interface SelfTaskSummary {
  total: number; done: number; open: number; cancelled: number;
  overdue: number; completionRate: number; uniqueUsers: number;
}

const EMPTY_SUMMARY: SelfTaskSummary = {
  total: 0, done: 0, open: 0, cancelled: 0, overdue: 0, completionRate: 0, uniqueUsers: 0,
};

type Filters = {
  user_id: string; status: string; priority: string; team_id: string;
  department_id: string; dateKey: string; from: string; to: string; search: string;
};

const INITIAL: Filters = {
  user_id: 'all', status: 'all', priority: 'all', team_id: 'all',
  department_id: 'all', dateKey: '30d', from: '', to: '', search: '',
};

export default function SelfTaskReport() {
  const { isAdmin, hasPermission } = useAuth();
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [rows, setRows] = useState<SelfTaskRow[]>([]);
  const [summary, setSummary] = useState<SelfTaskSummary>(EMPTY_SUMMARY);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);

  const canExport = isAdmin && hasPermission('reports.export');

  useEffect(() => {
    api.get<Settings>('/settings').then(setSettings).catch(() => {});
    api.get<User[]>('/users').then(setUsers).catch(() => {});
    api.get<Team[]>('/teams').then(setTeams).catch(() => {});
    api.get<Department[]>('/departments').then(setDepts).catch(() => {});
  }, []);

  // Only send filters that are actually narrowing, so the server sees the same
  // query string the export buttons build.
  const query = useMemo(() => ({
    user_id: filters.user_id,
    status: filters.status,
    priority: filters.priority,
    team_id: filters.team_id,
    department_id: filters.department_id,
    dateKey: filters.dateKey,
    from: filters.from,
    to: filters.to,
    search: filters.search.trim() || undefined,
  }), [filters]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || v === 'all') continue;
      p.append(k, String(v));
    }
    return p.toString();
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ rows: SelfTaskRow[]; summary: SelfTaskSummary; truncated: boolean }>(
        `/reports/self-tasks${qs ? `?${qs}` : ''}`,
      );
      setRows(res.rows || []);
      setSummary(res.summary || EMPTY_SUMMARY);
      setTruncated(!!res.truncated);
    } catch (e: any) {
      toast(e.message, 'error');
      setRows([]); setSummary(EMPTY_SUMMARY); setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, [qs, toast]);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const dirty = JSON.stringify(filters) !== JSON.stringify(INITIAL);

  const exportPath = (format: string) => `/reports/export?type=selftasks&format=${format}&tzOffset=360${qs ? `&${qs}` : ''}`;

  const doExport = async (format: string, file: string) => {
    try { await downloadExport(exportPath(format), file); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const statuses = settings?.taskStatuses || [];
  const priorities = settings?.priorities || [];

  const sel = 'input !w-auto';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Self Tasks" value={summary.total} icon={<UserCheck size={18} />} color="#6366f1"
          sub={`${summary.uniqueUsers} user${summary.uniqueUsers === 1 ? '' : 's'}`} />
        <StatCard label="Completed" value={summary.done} icon={<CheckCircle2 size={18} />} color="#22c55e"
          sub={`${summary.completionRate}% completion rate`} />
        <StatCard label="Still Open" value={summary.open} icon={<CircleDot size={18} />} color="#f97316" />
        <StatCard label="Overdue" value={summary.overdue} icon={<AlertTriangle size={18} />} color="#ef4444" />
        <StatCard label="Cancelled" value={summary.cancelled} icon={<X size={18} />} color="#94a3b8" />
        <StatCard label="Completion Rate" value={`${summary.completionRate}%`} icon={<Gauge size={18} />} color="#0ea5e9" />
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold"><Filter size={15} className="text-brand" /> Filters</div>
          {dirty && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters(INITIAL)}>
              <X size={13} /> Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {isAdmin && (
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink2">User</span>
              <select className={sel} value={filters.user_id} onChange={(e) => set('user_id', e.target.value)}>
                <option value="all">All users</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink2">Date Range</span>
            <select className={sel} value={filters.dateKey} onChange={(e) => set('dateKey', e.target.value)}>
              {DATE_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          {filters.dateKey === 'custom' && (
            <>
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink2">From</span>
                <input type="date" className={sel} value={filters.from} onChange={(e) => set('from', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink2">To</span>
                <input type="date" className={sel} value={filters.to} onChange={(e) => set('to', e.target.value)} />
              </label>
            </>
          )}
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink2">Status</span>
            <select className={sel} value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="all">All statuses</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink2">Priority</span>
            <select className={sel} value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="all">All priorities</option>
              {priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink2">Team</span>
            <select className={sel} value={filters.team_id} onChange={(e) => set('team_id', e.target.value)}>
              <option value="all">All teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink2">Department</span>
            <select className={sel} value={filters.department_id} onChange={(e) => set('department_id', e.target.value)}>
              <option value="all">All departments</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink2">Search</span>
            <input className={sel} placeholder="Title, Task ID or user" value={filters.search}
              onChange={(e) => set('search', e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
          <span className="text-xs text-ink3">
            {loading ? 'Loading…' : `${summary.total} self task${summary.total === 1 ? '' : 's'} match the current filters`}
          </span>
          <div className="flex gap-1.5 ml-auto">
            {(canExport
              ? [
                  { icon: FileText, label: 'CSV', format: 'csv', file: 'self-task-report.csv' },
                  { icon: FileSpreadsheet, label: 'Excel', format: 'xlsx', file: 'self-task-report.xlsx' },
                  { icon: FileJson, label: 'PDF', format: 'pdf', file: 'self-task-report.pdf' },
                ]
              : []
            ).map((e) => (
              <button key={e.format} className="btn btn-ghost btn-sm" onClick={() => doExport(e.format, e.file)}
                title={`Download the complete Self Task Report as ${e.label}`} disabled={!rows.length}>
                <e.icon size={14} /> <span className="hidden sm:inline">{e.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {truncated && (
        <div className="text-xs text-ink3">
          Showing the first 5,000 rows. Narrow the date range or filters for a complete figure.
        </div>
      )}

      {loading ? (
        <Skeleton className="h-72" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<UserCheck size={28} />} title="No self tasks found"
          subtitle={dirty ? 'Try widening or clearing the filters.' : 'Self tasks raised by users will appear here.'} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1080px]">
              <thead>
                <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
                  <th className="px-3 py-2.5">User</th>
                  <th className="px-3 py-2.5">Task ID</th>
                  <th className="px-3 py-2.5">Task Title</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Due Date</th>
                  <th className="px-3 py-2.5">Completion Date</th>
                  <th className="px-3 py-2.5">Completion Time</th>
                  <th className="px-3 py-2.5">Rating / Difficulty</th>
                  <th className="px-3 py-2.5">Team</th>
                  <th className="px-3 py-2.5">Department</th>
                  <th className="px-3 py-2.5">Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pr = priorityById(settings, r.priority);
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-card2">
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{r.user_name}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink2 whitespace-nowrap">
                        {taskCodeLabel(r.task_id, r.id)}
                      </td>
                      <td className="px-3 py-2.5 max-w-[280px] truncate" title={r.title}>{r.title}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={r.status} settings={settings ?? undefined} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: pr.color }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: pr.color }} />{pr.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-ink2 whitespace-nowrap">{r.due_date || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.completion_date
                          ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">{r.completion_date}</span>
                          : <span className="text-ink3">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-ink2 font-mono text-xs whitespace-nowrap">
                        {r.completion_time || '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="font-medium">{r.difficulty_label}</span>
                          <span className="text-ink3">{r.difficulty_points} pts</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-ink2 whitespace-nowrap">{r.team_name || '—'}</td>
                      <td className="px-3 py-2.5 text-ink2 whitespace-nowrap">{r.department_name || '—'}</td>
                      <td className="px-3 py-2.5 text-ink2 max-w-[200px] truncate" title={r.assigned_names || ''}>
                        {r.assigned_names || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}