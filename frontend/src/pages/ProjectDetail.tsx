import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, FolderKanban, Users, CalendarDays, Plus, CheckCircle2, Clock, AlertCircle,
  TrendingUp, Pause, XCircle, Search, X, MessageSquare, Paperclip, MoreVertical, Edit2
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Skeleton, EmptyState, Avatar, Modal, ConfirmModal, AssigneeList } from '../components/ui';
import { useSettings } from '../lib/settings';
import { statusById, priorityById, fmtDate, isOverdue, cx, timeAgo, fmtDateTime, taskCodeLabel } from '../lib/utils';
import type { ProjectDetail, User, Task } from '../lib/types';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#3b82f6',
  high: '#f59e0b',
  critical: '#ef4444',
};

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  active: { label: 'Active', color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30', icon: TrendingUp },
  on_hold: { label: 'On Hold', color: 'text-amber-600 bg-amber-500/10 border-amber-500/30', icon: Pause },
  completed: { label: 'Completed', color: 'text-blue-600 bg-blue-500/10 border-blue-500/30', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'text-bad bg-bad/10 border-bad/30', icon: XCircle },
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isAdmin } = useAuth();
  const settings = useSettings();
  const [data, setData] = useState<{ project: ProjectDetail; members: any[]; tasks: any[]; is_admin: boolean } | null>(null);
  const [stats, setStats] = useState<{ status_breakdown: any[]; priority_breakdown: any[]; member_contribution: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [editProject, setEditProject] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        api.get<any>(`/projects/${id}`),
        api.get<any>(`/projects/${id}/stats`),
      ]);
      setData(d);
      setStats(s);
    } catch (e: any) {
      toast(e.message, 'error');
      if (e.message?.includes('authorized') || e.message?.includes('not found')) navigate('/projects');
    } finally {
      setLoading(false);
    }
  }, [id, toast, navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get<{ users: User[] }>('/chat/users', { q: '' }).then((r) => setAllUsers(r.users || [])).catch(() => {});
  }, []);

  const project = data?.project;
  const tasks = data?.tasks || [];
  const members = data?.members || [];
  const canManage = data?.project?.can_manage || isAdmin;

  const filteredTasks = useMemo(() => {
    let list = [...tasks];
    if (filter !== 'all') list = list.filter((t) => t.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q));
    }
    return list;
  }, [tasks, filter, search]);

  const handleStatusChange = async (taskId: number, status: string) => {
    try {
      await api.post(`/tasks/${taskId}/status`, { status });
      toast(`Task moved to ${status}`);
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const handleRemoveMember = async () => {
    if (!confirmRemove || !id) return;
    try {
      await api.delete(`/projects/${id}/members/${confirmRemove.userId}`);
      toast('Member removed');
      setConfirmRemove(null);
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  if (loading || !project) {
    return (
      <div className="max-w-[1300px] mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const meta = STATUS_META[project.status] || STATUS_META.active;
  const MetaIcon = meta.icon;
  const overdue = project.deadline && new Date(project.deadline) < new Date() && project.status === 'active';
  const memberIds = new Set(members.map((m) => m.user_id));

  return (
    <div className="max-w-[1300px] mx-auto space-y-5">
      <button onClick={() => navigate('/projects')} className="btn btn-ghost btn-sm flex items-center gap-1.5">
        <ArrowLeft size={14} /> All Projects
      </button>

      <div className="card p-5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: project.color }} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FolderKanban size={20} className="text-brand shrink-0" />
              <h1 className="text-2xl font-extrabold truncate">{project.name}</h1>
              <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border', meta.color)}>
                <MetaIcon size={10} /> {meta.label}
              </span>
            </div>
            {project.description && <p className="text-sm text-ink2 mt-1">{project.description}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold" style={{ background: `${PRIORITY_COLORS[project.priority] || '#3b82f6'}15`, color: PRIORITY_COLORS[project.priority] || '#3b82f6' }}>
                <AlertCircle size={11} /> {project.priority?.toUpperCase()}
              </span>
              {project.start_date && (
                <span className="inline-flex items-center gap-1 text-ink3">
                  <CalendarDays size={11} /> Start: {fmtDate(project.start_date)}
                </span>
              )}
              {project.deadline && (
                <span className={cx('inline-flex items-center gap-1', overdue ? 'text-bad font-semibold' : 'text-ink3')}>
                  <CalendarDays size={11} /> Deadline: {fmtDate(project.deadline)}
                </span>
              )}
              {project.budget > 0 && (
                <span className="inline-flex items-center gap-1 text-ink3">৳{project.budget.toLocaleString()} budget</span>
              )}
              {project.creator && (
                <span className="text-ink3">Created by {project.creator.name} · {timeAgo(project.created_at)}</span>
              )}
            </div>
          </div>
          {canManage && (
            <button onClick={() => setEditProject(true)} className="btn btn-sm flex items-center gap-1.5">
              <Edit2 size={12} /> Edit
            </button>
          )}
        </div>

        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <ProgressBlock label="Overall Progress" value={project.progress || 0} color={project.color} large />
          <div className="p-3 rounded-lg bg-card2 border border-line">
            <div className="text-xs text-ink3">Total Tasks</div>
            <div className="text-2xl font-extrabold mt-1">{project.task_count || 0}</div>
          </div>
          <div className="p-3 rounded-lg bg-card2 border border-line">
            <div className="text-xs text-ink3">Completed</div>
            <div className="text-2xl font-extrabold mt-1 text-ok">{project.done_count || 0}</div>
          </div>
          <div className="p-3 rounded-lg bg-card2 border border-line">
            <div className="text-xs text-ink3">In Progress</div>
            <div className="text-2xl font-extrabold mt-1 text-amber-500">{project.wip_count || 0}</div>
          </div>
          <div className="p-3 rounded-lg bg-card2 border border-line">
            <div className="text-xs text-ink3">Pending</div>
            <div className="text-2xl font-extrabold mt-1 text-ink3">{project.todo_count || 0}</div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold flex items-center gap-1.5"><Users size={15} className="text-brand" /> Team Members</h3>
            {canManage && (
              <button onClick={() => setShowAddMember(true)} className="btn btn-ghost btn-sm flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            )}
          </div>
          {members.length === 0 ? (
            <p className="text-xs text-ink3 text-center py-4">No members yet</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => {
                const contrib = stats?.member_contribution?.find((c) => c.id === m.user_id);
                return (
                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg bg-card2/60">
                    <Avatar name={m.name} src={m.avatar} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{m.name}</span>
                        {m.role === 'lead' && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 font-bold">LEAD</span>}
                        {m.user_id === project.created_by && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-600 font-bold">OWNER</span>}
                      </div>
                      <div className="text-[10px] text-ink3 truncate">
                        {m.user_role} · {contrib ? `${contrib.done || 0}/${contrib.total || 0} done` : 'no tasks'}
                      </div>
                    </div>
                    {canManage && m.user_id !== project.created_by && (
                      <button onClick={() => setConfirmRemove({ userId: m.user_id, name: m.name })} className="p-1 rounded hover:bg-bad/10 text-ink3 hover:text-bad" title="Remove">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-4 lg:col-span-2">
          <h3 className="font-bold mb-3 flex items-center gap-1.5"><TrendingUp size={15} className="text-brand" /> Progress Distribution</h3>
          <div className="space-y-2.5">
            {stats?.status_breakdown?.length ? (
              stats.status_breakdown.map((s: any) => {
                const total = project.task_count || 1;
                const pct = Math.round((s.c / total) * 100);
                const sMeta = settings?.taskStatuses?.find((x: any) => x.id === s.status);
                const color = sMeta?.color || '#6366f1';
                return (
                  <div key={s.status}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                        {sMeta?.name || s.status}
                      </span>
                      <span className="text-ink3">{s.c} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-card2 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-ink3 text-center py-4">No tasks yet</p>
            )}
          </div>
          {stats?.member_contribution && stats.member_contribution.length > 0 && (
            <div className="mt-5 pt-4 border-t border-line">
              <h4 className="text-xs font-bold uppercase text-ink3 mb-2">Member Contribution</h4>
              <div className="space-y-1.5">
                {stats.member_contribution.filter((c: any) => c.total > 0).map((c: any) => {
                  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
                  return (
                    <div key={c.id} className="flex items-center gap-2">
                      <Avatar name={c.name} src={c.avatar} size={22} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="text-ink3 shrink-0">{c.done}/{c.total}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-card2 overflow-hidden mt-0.5">
                          <div className="h-full bg-ok" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-bold flex items-center gap-1.5">Project Tasks <span className="text-xs text-ink3 font-normal">({tasks.length})</span></h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks…"
                className="input !pl-7 !py-1.5 !text-xs w-48"
              />
            </div>
            <select className="input !w-auto !text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {canManage && (
              <button onClick={() => setShowAddTask(true)} className="btn btn-primary btn-sm flex items-center gap-1">
                <Plus size={12} /> Add Task
              </button>
            )}
          </div>
        </div>

        {filteredTasks.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={26} />}
            title={search || filter !== 'all' ? 'No tasks match' : 'No tasks yet'}
            subtitle={!search && filter === 'all' ? 'Add the first task to start tracking project progress.' : undefined}
            action={canManage && !search && filter === 'all' ? <button onClick={() => setShowAddTask(true)} className="btn btn-primary btn-sm"><Plus size={12} /> Add Task</button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
                  <th className="px-3 py-2.5">Task ID</th>
                  <th className="px-3 py-2.5">Task</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Assignees</th>
                  <th className="px-3 py-2.5">Due</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((t) => {
                  const pr = priorityById(settings, t.priority);
                  const sMeta = statusById(settings, t.status);
                  const overdue = isOverdue(t);
                  return (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-card2">
                      <td className="px-3 py-2.5 font-mono text-[11px] text-ink3 whitespace-nowrap">{taskCodeLabel(t.task_code, t.id)}</td>
                      <td className="px-3 py-2.5 font-semibold">
                        <Link to={`/tasks/${t.id}`} className="hover:text-brand transition-colors line-clamp-1">{t.title}</Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border" style={{ background: `${sMeta?.color}15`, color: sMeta?.color, borderColor: `${sMeta?.color}40` }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: sMeta?.color }} />
                          {sMeta?.name || t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold" style={{ background: `${pr.color}15`, color: pr.color }}>
                          {pr.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <AssigneeList assignees={t.assignees} max={3} size={22} className="max-w-[200px]" />
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {t.due_date ? (
                          <span className={cx(overdue && 'text-bad font-semibold')}>{fmtDate(t.due_date)}</span>
                        ) : (
                          <span className="text-ink3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <select
                          value={t.status}
                          onChange={(e) => handleStatusChange(t.id, e.target.value)}
                          className="input !py-1 !text-xs !w-auto"
                        >
                          {settings?.taskStatuses?.map((s: any) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAddMember && (
        <AddMemberModal
          projectId={project.id}
          existingMemberIds={Array.from(memberIds)}
          users={allUsers}
          onClose={() => setShowAddMember(false)}
          onAdded={() => { setShowAddMember(false); load(); }}
        />
      )}
      {showAddTask && (
        <AddTaskModal
          projectId={project.id}
          members={members}
          settings={settings}
          onClose={() => setShowAddTask(false)}
          onAdded={() => { setShowAddTask(false); load(); }}
        />
      )}
      {editProject && (
        <EditProjectModal
          project={project}
          onClose={() => setEditProject(false)}
          onSaved={() => { setEditProject(false); load(); }}
        />
      )}
      <ConfirmModal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={handleRemoveMember}
        title="Remove Member?"
        message={`Remove ${confirmRemove?.name} from this project?`}
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}

function ProgressBlock({ label, value, color, large }: { label: string; value: number; color: string; large?: boolean }) {
  return (
    <div className={cx('p-3 rounded-lg border border-line', large ? 'bg-card2 lg:col-span-1' : 'bg-card2/60')}>
      <div className="text-xs text-ink3">{label}</div>
      <div className="text-2xl font-extrabold mt-1" style={{ color }}>{value}%</div>
      <div className="h-2 rounded-full bg-card overflow-hidden mt-2">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
      </div>
    </div>
  );
}

function AddMemberModal({ projectId, existingMemberIds, users, onClose, onAdded }: { projectId: number; existingMemberIds: number[]; users: User[]; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const set = new Set([...existingMemberIds, ...selected]);
  const available = users.filter((u) => !set.has(u.id));
  const filtered = search.trim() ? available.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || (u.email || '').toLowerCase().includes(search.toLowerCase())) : available;
  const submit = async () => {
    if (selected.length === 0) return toast('Select at least one user', 'error');
    setSaving(true);
    try {
      await api.post(`/projects/${projectId}/members`, { userIds: selected });
      toast(`${selected.length} member${selected.length === 1 ? '' : 's'} added`);
      onAdded();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add Members" width={500}
      footer={<><button className="btn" onClick={onClose} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={saving || selected.length === 0}>Add {selected.length > 0 ? `(${selected.length})` : ''}</button></>}>
      <div className="space-y-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" className="input !pl-7 !py-1.5 !text-xs w-full" />
        </div>
        <div className="max-h-72 overflow-y-auto border border-line rounded-lg">
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-xs text-ink3">No users to add</div>
          ) : filtered.map((u) => (
            <label key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-card2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={selected.includes(u.id)}
                onChange={(e) => setSelected((p) => e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id))}
                className="accent-brand"
              />
              <Avatar name={u.name} size={24} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{u.name}</div>
                <div className="text-[10px] text-ink3 truncate">{u.email}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function AddTaskModal({ projectId, members, settings, onClose, onAdded }: { projectId: number; members: any[]; settings: any; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>('medium');
  const [status, setStatus] = useState<string>('todo');
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!title.trim()) return toast('Title is required', 'error');
    setSaving(true);
    try {
      await api.post(`/projects/${projectId}/tasks`, { title, description, priority, status, difficulty, due_date: dueDate || null, assigneeIds });
      toast('Task created');
      onAdded();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add Project Task" width={560}
      footer={<><button className="btn" onClick={onClose} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={saving || !title.trim()}>Add Task</button></>}>
      <div className="space-y-3">
        <div>
          <label className="label">Title *</label>
          <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={300} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input w-full" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Status</label>
            <select className="input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              {settings?.taskStatuses?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input w-full" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="label">Difficulty</label>
            <select className="input w-full" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="expert">Expert</option>
            </select>
          </div>
          <div>
            <label className="label">Due Date</label>
            <input type="date" className="input w-full" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Assignees</label>
          <div className="max-h-40 overflow-y-auto border border-line rounded-lg p-1.5">
            {members.length === 0 ? <div className="p-2 text-xs text-ink3 text-center">No project members</div> : members.map((m) => (
              <label key={m.user_id} className="flex items-center gap-2 px-2 py-1 hover:bg-card2 rounded cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={assigneeIds.includes(m.user_id)}
                  onChange={(e) => setAssigneeIds((p) => e.target.checked ? [...p, m.user_id] : p.filter((x) => x !== m.user_id))}
                  className="accent-brand"
                />
                <Avatar name={m.name} src={m.avatar} size={20} />
                <span className="text-xs">{m.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EditProjectModal({ project, onClose, onSaved }: { project: ProjectDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [priority, setPriority] = useState<string>(project.priority);
  const [status, setStatus] = useState<string>(project.status);
  const [startDate, setStartDate] = useState(project.start_date || '');
  const [deadline, setDeadline] = useState(project.deadline || '');
  const [budget, setBudget] = useState(project.budget?.toString() || '0');
  const [color, setColor] = useState(project.color);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${project.id}`, { name, description, priority, status, start_date: startDate || null, deadline: deadline || null, budget: Number(budget) || 0, color });
      toast('Project updated');
      onSaved();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${project.name}`} width={640}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={saving}>Save</button></>}>
      <div className="space-y-3">
        <div>
          <label className="label">Name *</label>
          <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input w-full" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Priority</label>
            <select className="input w-full" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option><option value="on_hold">On Hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="label">Color</label>
            <div className="flex items-center gap-2">
              <input type="color" className="w-10 h-10 rounded-md border border-line" value={color} onChange={(e) => setColor(e.target.value)} />
              <input className="input flex-1" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Start Date</label>
            <input type="date" className="input w-full" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Deadline</label>
            <input type="date" className="input w-full" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div>
            <label className="label">Budget (৳)</label>
            <input type="number" min={0} className="input w-full" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
