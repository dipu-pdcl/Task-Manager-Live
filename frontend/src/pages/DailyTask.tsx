import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarCheck, CheckCircle2, LoaderCircle, Plus, Trash2, Download,
  Users, Settings2, Trophy, AlertTriangle, MessageSquare, X, Search, Lock,
} from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Badge, Modal, Skeleton, EmptyState, ConfirmModal } from '../components/ui';
import { cx, taskCodeLabel } from '../lib/utils';

interface DailyTaskItem {
  id: number;
  task_code?: string;
  title: string;
  key: string;
  status: string;
  due_date?: string;
  completed_at?: string;
  done: boolean;
  missed: boolean;
  readOnly: boolean;
  comments_count: number;
  points: number;
}

interface MyDay {
  date: string;
  readOnly: boolean;
  isMember: boolean;
  tasks: DailyTaskItem[];
  total: number;
  completed: number;
  points: number;
  maxPoints: number;
}

interface Template {
  id: number; key: string; name: string; description: string;
  enabled: number; points: number; sort_order: number;
}

interface Member { user_id: number; name: string; email: string; role: string; is_active: number }
interface Candidate { id: number; name: string; email: string; role: string; title: string; is_active: number }
interface OverviewRow {
  user_id: number; name: string; email: string; role: string; is_active: number;
  done: number; missed: number; pending: number; points: number; tasks: DailyTaskItem[];
}
interface Overview {
  date: string;
  summary: { assigned: number; done: number; missed: number; points: number };
  users: OverviewRow[];
}

interface DailyComment {
  id: number; content: string; created_at: string;
  user_id: number; user_name: string; avatar?: string;
}

interface KpiRow {
  user_id: number; name: string; email: string; role: string;
  assigned: number; done: number; missed: number; earned: number; penalty: number; net: number;
}
interface KpiReport {
  from: string; to: string;
  summary: { assigned: number; done: number; missed: number; earned: number; penalty: number; net: number };
  users: KpiRow[];
}

const STATUS_LABEL: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

/** First day of the month containing the given YYYY-MM-DD. */
function monthStart(d: string) {
  return `${d.slice(0, 7)}-01`;
}

export default function DailyTaskPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('daily_task.manage');

  const [tab, setTab] = useState<'mine' | 'manage'>(canManage ? 'manage' : 'mine');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mine, setMine] = useState<MyDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [kpi, setKpi] = useState<KpiReport | null>(null);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [editTpl, setEditTpl] = useState<Template | null>(null);
  const [deleteTpl, setDeleteTpl] = useState<Template | null>(null);
  const [editName, setEditName] = useState('');
  const [editPoints, setEditPoints] = useState(2);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPoints, setNewPoints] = useState(2);

  const [commentTask, setCommentTask] = useState<DailyTaskItem | null>(null);
  const [comments, setComments] = useState<DailyComment[]>([]);
  const [commentReadOnly, setCommentReadOnly] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const loadMine = useCallback(async () => {
    setLoading(true);
    try {
      setMine(await api.get<MyDay>('/daily-task/me', { date }));
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [date, toast]);

  const loadManage = useCallback(async () => {
    setBusy(true);
    // Settled, not all: one failing endpoint must not blank the whole panel.
    // Each section renders independently and reports its own failure.
    const results = await Promise.allSettled([
      api.get<{ templates: Template[] }>('/daily-task/templates'),
      api.get<{ members: Member[] }>('/daily-task/members'),
      api.get<{ users: Candidate[] }>('/daily-task/candidates'),
      api.get<Overview>('/daily-task/overview', { date }),
      api.get<KpiReport>('/daily-task/kpi', { from: monthStart(date), to: date }),
    ]);
    const [t, m, c, o, k] = results;
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);

    const tv = value(t);
    const mv = value(m);
    const cv = value(c);
    const ov = value(o);
    const kv = value(k);

    setTemplates(tv?.templates || []);
    setMembers(mv?.members || []);
    setCandidates(cv?.users || []);
    setOverview(ov);
    setKpi(kv);

    const failed = ['templates', 'members', 'candidates', 'overview', 'KPI']
      .filter((_, i) => results[i].status === 'rejected')
      .map((label, i) => `${label}: ${(results[i] as PromiseRejectedResult).reason?.message}`)
      .join('; ');
    if (failed) toast(`Could not load ${failed}`, 'error');
    setBusy(false);
  }, [date, toast]);

  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { if (canManage) loadManage(); }, [canManage, loadManage]);

  const toggleDone = async (t: DailyTaskItem) => {
    if (t.readOnly) {
      toast('Previous days are read-only. Only today\'s daily task can be changed.', 'error');
      return;
    }
    setToggling(t.id);
    try {
      await api.post(`/tasks/${t.id}/status`, { status: t.done ? 'in_progress' : 'done' });
      await loadMine();
      toast(t.done ? `${t.title} reopened` : `${t.title} completed (+${t.points || 2} KPI points)`);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setToggling(null); }
  };

  const openComments = async (t: DailyTaskItem) => {
    setCommentTask(t);
    setCommentBody('');
    setCommentsOpen(true);
    setComments([]);
    try {
      const r = await api.get<{ comments: DailyComment[]; readOnly: boolean }>(
        `/daily-task/${t.id}/comments`,
      );
      setComments(r.comments || []);
      setCommentReadOnly(!!r.readOnly);
    } catch (e: any) {
      setComments([]);
      setCommentReadOnly(t.readOnly);
      toast(e.message, 'error');
    }
  };

  const addComment = async () => {
    if (!commentTask || !commentBody.trim()) return;
    setCommentBusy(true);
    try {
      const r = await api.post<{ comment: DailyComment }>(
        `/daily-task/${commentTask.id}/comments`,
        { content: commentBody.trim() },
      );
      setComments((c) => [...c, r.comment]);
      setCommentBody('');
      await loadMine();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setCommentBusy(false); }
  };

  const exportKpi = async () => {
    setBusy(true);
    try {
      const from = monthStart(date);
      await downloadExport(
        `/daily-task/export/kpi?from=${from}&to=${date}`,
        `daily-task-kpi_${from}_to_${date}.csv`,
      );
      toast('Daily Task KPI exported');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const addMembers = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const r = await api.post<{ added: number }>('/daily-task/members', { user_ids: selected });
      toast(`Added ${r.added} user(s) to the Daily Task group`);
      setSelected([]); setAddOpen(false);
      await loadManage();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const removeMember = async (m: Member) => {
    try {
      await api.delete(`/daily-task/members/${m.user_id}`);
      toast(`Removed ${m.name} from the Daily Task group`);
      await loadManage();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const saveTemplate = async (tpl: Template, patch: Record<string, unknown>) => {
    try {
      await api.put(`/daily-task/templates/${tpl.id}`, patch);
      setEditTpl(null);
      await loadManage();
      await loadMine();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const deleteTemplate = async (tpl: Template) => {
    setBusy(true);
    try {
      await api.delete(`/daily-task/templates/${tpl.id}`);
      setDeleteTpl(null);
      await loadManage();
      await loadMine();
      toast(`Deleted "${tpl.name}"`);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const createTemplate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await api.post<{ template: Template }>('/daily-task/templates', {
        name,
        description: newDesc.trim(),
        points: newPoints,
      });
      setNewOpen(false);
      setNewName(''); setNewDesc(''); setNewPoints(2);
      toast(`Daily task "${r.template.name}" created`);
      await loadManage();
      await loadMine();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const notMembers = candidates.filter(
    (c) => !members.some((m) => m.user_id === c.id) &&
      c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <CalendarCheck size={24} className="text-brand" /> My Daily Task
          </h1>
          <p className="text-sm text-ink2 mt-0.5">
            Recurring duties assigned automatically every day at 12:00 AM &mdash; +2 KPI points each, &minus;1 if missed.
            Kept separate from the main task list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
          {canManage && (
            <button className="btn btn-primary btn-sm" onClick={exportKpi} disabled={busy}>
              <Download size={14} /> Export KPI Points
            </button>
          )}
        </div>
      </div>

      {mine?.readOnly && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          <Lock size={14} className="shrink-0" />
          <span>
            <strong className="font-bold">{mine.date}</strong> is read-only. Only the current day's daily task can be
            changed &mdash; you can still read the comments below.
          </span>
        </div>
      )}

      {canManage && (
        <div className="flex items-center gap-1.5 p-1 bg-card2/80 rounded-2xl border border-line w-fit">
          {([['manage', 'Admin Controls', Settings2], ['mine', 'My Daily Tasks', CalendarCheck]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)} className={cx(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              tab === key ? 'bg-brand text-white shadow-sm' : 'text-ink2 hover:text-ink hover:bg-card',
            )}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'mine' && (
        loading ? <Skeleton className="h-72" /> : !mine?.isMember ? (
          <EmptyState
            icon={<CalendarCheck size={26} />}
            title="You are not in the Daily Task group"
            subtitle="An admin needs to add you before daily tasks are assigned automatically."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Tasks Today', value: mine.total, icon: CalendarCheck, color: 'text-brand' },
                { label: 'Completed', value: mine.completed, icon: CheckCircle2, color: 'text-green-500' },
                { label: 'KPI Points', value: mine.points, icon: Trophy, color: 'text-amber-500' },
                { label: 'Max Possible', value: mine.maxPoints, icon: Trophy, color: 'text-ink3' },
              ].map((s) => (
                <div key={s.label} className="card p-4">
                  <div className="flex items-center gap-2 text-ink3 text-xs font-semibold">
                    <s.icon size={14} /> {s.label}
                  </div>
                  <div className={cx('text-2xl font-extrabold mt-1 tabular-nums', s.color)}>{s.value}</div>
                </div>
              ))}
            </div>

            <div className="card overflow-hidden">
              {mine.tasks.length === 0 ? (
                <div className="p-8">
                  <EmptyState icon={<CalendarCheck size={26} />} title="No daily tasks for {date}" subtitle="Tasks are generated once a day." />
                </div>
              ) : (
                <div className="table-wrap">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
                      <th className="px-4 py-3">Task ID</th>
                      <th className="px-4 py-3">Task</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">KPI</th>
                      <th className="px-4 py-3 text-right">Comments</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.tasks.map((t) => (
                      <tr key={t.id} className="border-b border-line last:border-0 hover:bg-card2">
                        <td className="px-4 py-3 font-mono text-xs text-ink2 whitespace-nowrap">{taskCodeLabel(t.task_code, t.id)}</td>
                        <td className="px-4 py-3 font-semibold">{t.title}</td>
                        <td className="px-4 py-3">
                          {t.done ? <Badge color="#22c55e">Done</Badge>
                            : t.missed ? <Badge color="#ef4444">Missed</Badge>
                            : <Badge color="#6366f1">{STATUS_LABEL[t.status] || t.status}</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold">
                          {t.done ? <span className="text-green-500">+{t.points}</span>
                            : t.missed ? <span className="text-red-500">{t.points}</span>
                            : <span className="text-ink3">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="btn btn-outline btn-xs"
                            onClick={() => openComments(t)}
                            title="Comments"
                          >
                            <MessageSquare size={13} />
                            {t.comments_count > 0 && <span className="tabular-nums">{t.comments_count}</span>}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className={cx('btn btn-sm', t.done ? 'btn-outline' : 'btn-primary')}
                            onClick={() => toggleDone(t)}
                            disabled={toggling === t.id || t.readOnly}
                            title={t.readOnly ? 'Read-only: only today\'s task can be changed' : undefined}
                          >
                            {t.readOnly ? <><Lock size={14} /> Read-only</>
                              : toggling === t.id ? <LoaderCircle size={14} className="animate-spin" />
                              : t.done ? <><X size={14} /> Reopen</> : <><CheckCircle2 size={14} /> Mark Done</>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {tab === 'manage' && canManage && (
        busy && !overview ? <Skeleton className="h-96" /> : (
          <>
            {/* Task definitions */}
            <div className="card p-5">
              <h3 className="font-bold flex items-center gap-2 mb-1">
                <Settings2 size={16} className="text-brand" /> Daily Task Definitions
              </h3>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <p className="text-xs text-ink3">Create, enable, disable or rename the tasks generated each day</p>
                <button className="btn btn-primary btn-sm" onClick={() => { setEditTpl(null); setNewOpen(true); }}>
                  <Plus size={14} /> Create Daily Task
                </button>
              </div>
              <div className="space-y-2">
                {templates.length === 0 ? (
                  <EmptyState icon={<CalendarCheck size={24} />} title="No daily tasks defined" subtitle="Create a daily task to have it generated every day." />
                ) : templates.map((t) => (
                  <div key={t.id} className={cx(
                    'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5',
                    t.enabled ? 'border-line bg-card' : 'border-line bg-card2/40 opacity-70',
                  )}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold flex items-center gap-2">
                        {t.name}
                        {!t.enabled && <Badge color="#6b7280">Disabled</Badge>}
                      </div>
                      <div className="text-[11px] text-ink3 mt-0.5">{t.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-ink3 tabular-nums">{t.points} pts</span>
                      <button className="btn btn-outline btn-xs" onClick={() => {
                        setEditTpl(t); setEditName(t.name); setEditPoints(t.points);
                      }}>Rename</button>
                      <button
                        className={cx('btn btn-xs', t.enabled ? 'btn-outline' : 'btn-primary')}
                        onClick={() => saveTemplate(t, { enabled: !t.enabled })}
                      >
                        {t.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="btn btn-xs text-bad"
                        title="Delete this daily task"
                        onClick={() => setDeleteTpl(t)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Group members */}
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h3 className="font-bold flex items-center gap-2">
                  <Users size={16} className="text-brand" /> Daily Task Group
                </h3>
                <button className="btn btn-primary btn-sm" onClick={() => { setAddOpen(true); setSelected([]); setSearch(''); }}>
                  <Plus size={14} /> Add Users
                </button>
              </div>
              <p className="text-xs text-ink3 mb-4">
                {members.length} user(s) receive the daily tasks automatically
              </p>
              {members.length === 0 ? (
                <EmptyState icon={<Users size={24} />} title="No members yet" subtitle="Add users to start assigning daily tasks." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2 rounded-lg border border-line bg-card2/50 px-2.5 py-1.5">
                      <span className="text-xs font-semibold">{m.name}</span>
                      {!m.is_active && <Badge color="#6b7280">Inactive</Badge>}
                      <button
                        className="p-1 rounded hover:bg-bad/10 text-bad"
                        title="Remove from group"
                        onClick={() => removeMember(m)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily Task KPI, separate from the general Total KPI */}
            {kpi && (
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <h3 className="font-bold flex items-center gap-2">
                    <Trophy size={16} className="text-brand" /> Daily Task KPI
                  </h3>
                  <span className="text-[11px] text-ink3">{kpi.from} &rarr; {kpi.to}</span>
                </div>
                <p className="text-xs text-ink3 mb-4">
                  {kpi.summary.done} completed (+{kpi.summary.earned}) &middot;{' '}
                  {kpi.summary.missed} missed ({kpi.summary.penalty}) &middot;{' '}
                  <strong className="text-ink">Net {kpi.summary.net}</strong> &middot; also included in each user&rsquo;s Total KPI
                </p>
                {kpi.users.length === 0 ? (
                  <EmptyState icon={<Users size={24} />} title="No group members to report on" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
                          <th className="px-3 py-2.5">User</th>
                          <th className="px-3 py-2.5 text-center">Assigned</th>
                          <th className="px-3 py-2.5 text-center">Done</th>
                          <th className="px-3 py-2.5 text-center">Missed</th>
                          <th className="px-3 py-2.5 text-right">Earned</th>
                          <th className="px-3 py-2.5 text-right">Penalty</th>
                          <th className="px-3 py-2.5 text-right">Net Daily KPI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpi.users.map((u) => (
                          <tr key={u.user_id} className="border-b border-line last:border-0">
                            <td className="px-3 py-2.5">
                              <div className="font-semibold">{u.name}</div>
                              <div className="text-[11px] text-ink3">{u.email}</div>
                            </td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-ink2">{u.assigned}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums font-bold text-green-500">{u.done}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums font-bold text-red-500">{u.missed}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-green-600">+{u.earned}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-red-500">{u.penalty}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-bold">{u.net}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Monitoring */}
            {overview && (
              <div className="card p-5">
                <h3 className="font-bold flex items-center gap-2 mb-1">
                  <Trophy size={16} className="text-brand" /> Completion &amp; KPI for {overview.date}
                </h3>
                <p className="text-xs text-ink3 mb-4">
                  {overview.summary.done} completed &middot; {overview.summary.missed} missed &middot;{' '}
                  {overview.summary.points} KPI points awarded
                </p>
                {overview.users.length === 0 ? (
                  <EmptyState icon={<Users size={24} />} title="No group members to report on" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
                          <th className="px-3 py-2.5">User</th>
                          <th className="px-3 py-2.5 text-center">Done</th>
                          <th className="px-3 py-2.5 text-center">Pending</th>
                          <th className="px-3 py-2.5 text-center">Missed</th>
                          <th className="px-3 py-2.5 text-right">KPI Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.users.map((u) => (
                          <tr key={u.user_id} className="border-b border-line last:border-0">
                            <td className="px-3 py-2.5">
                              <div className="font-semibold flex items-center gap-2">
                                {u.name}
                                {u.missed > 0 && <AlertTriangle size={13} className="text-amber-500" />}
                              </div>
                              <div className="text-[11px] text-ink3">{u.email}</div>
                            </td>
                            <td className="px-3 py-2.5 text-center tabular-nums font-bold text-green-500">{u.done}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-ink2">{u.pending}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums font-bold text-red-500">{u.missed}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-bold">{u.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )
      )}

      {/* Comments modal */}
      <Modal open={commentsOpen} onClose={() => setCommentsOpen(false)} title={`Comments — ${commentTask?.title ?? ''}`} width={520}>
        <div className="space-y-3">
          {commentReadOnly && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <Lock size={13} className="shrink-0" />
              This daily task is read-only. Comments can be viewed but not added or edited.
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-2.5">
            {comments.length === 0 ? (
              <p className="text-xs text-ink3 text-center py-6">No comments yet</p>
            ) : comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-line bg-card2/50 px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold">{c.user_name}</span>
                  <span className="text-[11px] text-ink3">{c.created_at}</span>
                </div>
                <p className="text-xs text-ink2 whitespace-pre-wrap break-words">{c.content}</p>
              </div>
            ))}
          </div>

          {!commentReadOnly && (
            <>
              <textarea
                className="input min-h-[70px] resize-y"
                placeholder="Add a comment..."
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setCommentsOpen(false)}
                >Close</button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={addComment}
                  disabled={!commentBody.trim() || commentBusy}
                >
                  {commentBusy && <LoaderCircle size={14} className="animate-spin" />}
                  Comment
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Add members modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Users to Daily Task Group" width={560}>
        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input className="input !pl-9" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {notMembers.length === 0 ? (
              <p className="text-xs text-ink3 text-center py-6">No matching users</p>
            ) : notMembers.map((u) => (
              <label key={u.id} className={cx(
                'flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer',
                selected.includes(u.id) ? 'border-brand/40 bg-brand/5' : 'border-line',
              )}>
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-line text-brand focus:ring-brand shrink-0"
                  checked={selected.includes(u.id)}
                  onChange={() => setSelected((p) => p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id])}
                />
                <span className="text-xs font-semibold flex-1">{u.name}</span>
                <span className="text-[11px] text-ink3">{u.email}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={addMembers} disabled={selected.length === 0 || busy}>
              {busy && <LoaderCircle size={14} className="animate-spin" />}
              Add {selected.length > 0 ? selected.length : ''} User(s)
            </button>
          </div>
        </div>
      </Modal>

      {/* Create daily task modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Create Daily Task" width={420}>
        <div className="space-y-3">
          <div>
            <label className="label">Task Name</label>
            <input
              className="input"
              placeholder="e.g. Firewall Rule Review"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input
              className="input"
              placeholder="What should be checked each day"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
          </div>
          <div>
            <label className="label">KPI Points</label>
            <input
              type="number" min={0} max={100} className="input"
              value={newPoints}
              onChange={(e) => setNewPoints(Number(e.target.value))}
            />
            <p className="text-[11px] text-ink3 mt-0.5">Awarded each day the task is completed.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setNewOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!newName.trim() || busy} onClick={createTemplate}>
              {busy && <LoaderCircle size={14} className="animate-spin" />}
              Create
            </button>
          </div>
        </div>
      </Modal>

      {/* Rename / points modal */}
      <Modal open={!!editTpl} onClose={() => setEditTpl(null)} title="Edit Daily Task" width={420}>
        {editTpl && (
          <div className="space-y-3">
            <div>
              <label className="label">Task Name</label>
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="label">KPI Points</label>
              <input
                type="number" min={0} max={100} className="input"
                value={editPoints}
                onChange={(e) => setEditPoints(Number(e.target.value))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setEditTpl(null)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!editName.trim()}
                onClick={() => saveTemplate(editTpl, { name: editName.trim(), points: editPoints })}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Deleting a template is irreversible and stops it being generated from
          tomorrow on, so it is confirmed rather than done in one click. */}
      <ConfirmModal
        open={!!deleteTpl}
        onClose={() => setDeleteTpl(null)}
        onConfirm={() => { if (deleteTpl) deleteTemplate(deleteTpl); }}
        title="Delete Daily Task?"
        message={`Delete "${deleteTpl?.name}"? It will stop being created from tomorrow on, and today's unfinished copy will be cancelled. Days already completed are kept for the record.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
