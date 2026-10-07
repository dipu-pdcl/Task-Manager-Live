import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, CalendarDays, Users, Search, Filter, Pencil, TrendingUp, AlertCircle, CheckCircle2, Pause, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Skeleton, EmptyState, Avatar, Modal, ConfirmModal } from '../components/ui';
import type { Project, User } from '../lib/types';
import { fmtDate, cx, timeAgo } from '../lib/utils';

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

export default function Projects() {
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, u] = await Promise.all([
        api.get<{ projects: Project[] }>('/projects', { archived: '0' }),
        api.get<{ users: User[] }>('/chat/users', { q: '' }),
      ]);
      setProjects(p.projects || []);
      setUsers(u.users || []);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = [...projects];
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const aActive = a.status === 'active' ? 0 : 1;
      const bActive = b.status === 'active' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
    return list;
  }, [projects, search, statusFilter]);

  const summary = useMemo(() => {
    return {
      total: projects.filter((p) => !p.archived).length,
      active: projects.filter((p) => p.status === 'active').length,
      onHold: projects.filter((p) => p.status === 'on_hold').length,
      completed: projects.filter((p) => p.status === 'completed').length,
      avgProgress: projects.length ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length) : 0,
    };
  }, [projects]);

  if (loading && projects.length === 0) {
    return (
      <div className="max-w-[1300px] mx-auto space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1300px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><FolderKanban size={24} className="text-brand" /> Projects</h1>
          <p className="text-sm text-ink2 mt-0.5">Manage large initiatives, members, and overall completion</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={() => setCreateOpen(true)} className="btn btn-primary btn-sm flex items-center gap-1.5">
              <Plus size={14} /> New Project
            </button>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Projects" value={summary.total} color="#6366f1" icon={<FolderKanban size={18} />} />
        <StatCard label="Active" value={summary.active} color="#22c55e" icon={<TrendingUp size={18} />} />
        <StatCard label="On Hold" value={summary.onHold} color="#f59e0b" icon={<Pause size={18} />} />
        <StatCard label="Completed" value={summary.completed} color="#3b82f6" icon={<CheckCircle2 size={18} />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px] sm:min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="input !pl-7 !py-1.5 !text-xs w-full"
          />
        </div>
        <select className="input !w-auto !text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={28} />}
          title={search || statusFilter !== 'all' ? 'No projects match your filters' : 'No projects yet'}
          subtitle={isAdmin ? 'Create your first project to group related tasks and track overall progress.' : 'You have not been added to any projects yet.'}
          action={isAdmin ? <button onClick={() => setCreateOpen(true)} className="btn btn-primary btn-sm"><Plus size={14} /> New Project</button> : undefined}
        />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onEdit={() => setEditing(p)}
              canManage={isAdmin || p.created_by === user?.id}
            />
          ))}
        </div>
      )}

      <ProjectFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        users={users}
        onSaved={() => { setCreateOpen(false); load(); }}
      />
      <ProjectFormModal
        open={!!editing}
        project={editing}
        onClose={() => setEditing(null)}
        users={users}
        onSaved={() => { setEditing(null); load(); }}
      />
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="card p-4 anim-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-ink3">{label}</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color }}>{value}</div>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}15`, color }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onEdit, canManage }: { project: Project; onEdit: () => void; canManage: boolean }) {
  const navigate = useNavigate();
  const meta = STATUS_META[project.status] || STATUS_META.active;
  const MetaIcon = meta.icon;
  const overdue = project.deadline && new Date(project.deadline) < new Date() && project.status === 'active';
  return (
    <div className="card card-hover p-4 anim-in relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: project.color }} />
      <div className="flex items-start justify-between gap-2 mb-2">
        <button
          onClick={() => navigate(`/projects/${project.id}`)}
          className="text-left flex-1 min-w-0"
        >
          <h3 className="font-bold text-base leading-snug truncate hover:text-brand transition-colors">{project.name}</h3>
        </button>
        <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0', meta.color)}>
          <MetaIcon size={10} /> {meta.label}
        </span>
      </div>
      {project.description && (
        <p className="text-xs text-ink3 line-clamp-2 mb-3">{project.description}</p>
      )}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold" style={{ background: `${PRIORITY_COLORS[project.priority] || '#3b82f6'}15`, color: PRIORITY_COLORS[project.priority] || '#3b82f6' }}>
          <AlertCircle size={10} /> {(project.priority || 'medium').toUpperCase()}
        </span>
        {project.deadline && (
          <span className={cx('inline-flex items-center gap-1', overdue ? 'text-bad font-semibold' : 'text-ink3')}>
            <CalendarDays size={11} /> {fmtDate(project.deadline)}
          </span>
        )}
        {project.budget > 0 && (
          <span className="inline-flex items-center gap-1 text-ink3">
            ৳{project.budget.toLocaleString()}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-ink3 font-semibold uppercase">
          <span>Progress</span>
          <span>{project.progress || 0}%</span>
        </div>
        <div className="h-2 rounded-full bg-card2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${project.progress || 0}%`,
              background: `linear-gradient(90deg, ${project.color}, ${project.color}cc)`,
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
        <MiniStat label="Total" value={project.task_count || 0} color="#6366f1" />
        <MiniStat label="Done" value={project.done_count || 0} color="#22c55e" />
        <MiniStat label="WIP" value={project.wip_count || 0} color="#f59e0b" />
        <MiniStat label="Todo" value={project.todo_count || 0} color="#94a3b8" />
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
        <div className="flex items-center gap-1.5 text-xs text-ink3">
          <Users size={12} /> {project.member_count || 0} member{project.member_count === 1 ? '' : 's'}
          {project.creator && (
            <span className="text-ink3">· by {project.creator.name}</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => navigate(`/projects/${project.id}`)}
            className="px-2 py-1 rounded-md text-xs font-medium text-brand hover:bg-brand/10"
          >
            Open
          </button>
          {canManage && (
            <button onClick={onEdit} className="p-1.5 rounded-md hover:bg-card2 text-ink2" title="Edit">
              <Pencil size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-1.5 rounded-md bg-card2/70">
      <div className="font-bold text-sm" style={{ color }}>{value}</div>
      <div className="text-[9px] text-ink3 uppercase">{label}</div>
    </div>
  );
}

function ProjectFormModal({ open, onClose, project, users, onSaved }: { open: boolean; onClose: () => void; project?: Project | null; users: User[]; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [priority, setPriority] = useState<string>(project?.priority || 'medium');
  const [status, setStatus] = useState<string>(project?.status || 'active');
  const [startDate, setStartDate] = useState(project?.start_date || '');
  const [deadline, setDeadline] = useState(project?.deadline || '');
  const [budget, setBudget] = useState(project?.budget?.toString() || '0');
  const [color, setColor] = useState(project?.color || '#6366f1');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(project?.name || '');
      setDescription(project?.description || '');
      setPriority(project?.priority || 'medium');
      setStatus(project?.status || 'active');
      setStartDate(project?.start_date || '');
      setDeadline(project?.deadline || '');
      setBudget(project?.budget?.toString() || '0');
      setColor(project?.color || '#6366f1');
      setMemberIds([]);
      setSearch('');
    }
  }, [open, project]);

  const available = useMemo(() => {
    const set = new Set(memberIds);
    let list = users.filter((u) => !set.has(u.id) && u.is_active);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    }
    return list;
  }, [users, memberIds, search]);

  const selectedMembers = useMemo(() => users.filter((u) => memberIds.includes(u.id)), [users, memberIds]);

  const submit = async () => {
    if (!name.trim()) return toast('Project name is required', 'error');
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/projects/${project!.id}`, {
          name: name.trim(),
          description,
          priority,
          status,
          start_date: startDate || null,
          deadline: deadline || null,
          budget: Number(budget) || 0,
          color,
        });
        if (memberIds.length > 0) {
          await api.post(`/projects/${project!.id}/members`, { userIds: memberIds });
        }
        toast('Project updated');
      } else {
        await api.post('/projects', {
          name: name.trim(),
          description,
          priority,
          start_date: startDate || null,
          deadline: deadline || null,
          budget: Number(budget) || 0,
          color,
          memberIds,
        });
        toast('Project created');
      }
      onSaved();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit Project: ${project?.name}` : 'Create New Project'}
      width={680}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Project Name *</label>
          <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website Redesign" maxLength={200} autoFocus />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input w-full" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about?" maxLength={1000} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Priority</label>
            <select className="input w-full" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          {isEdit && (
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          )}
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
          <div>
            <label className="label">Color</label>
            <div className="flex items-center gap-2">
              <input type="color" className="w-10 h-10 rounded-md border border-line cursor-pointer" value={color} onChange={(e) => setColor(e.target.value)} />
              <input className="input flex-1" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
        </div>
        <div>
          <label className="label">Team Members {selectedMembers.length > 0 && <span className="text-ink3">({selectedMembers.length} added)</span>}</label>
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2 p-2 rounded-lg bg-card2 max-h-32 overflow-y-auto">
              {selectedMembers.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/15 text-brand text-xs font-medium">
                  {u.name}
                  <button type="button" onClick={() => setMemberIds((p) => p.filter((x) => x !== u.id))} className="hover:text-bad">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="relative mb-1.5">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" className="input !pl-7 !py-1.5 !text-xs w-full" />
          </div>
          <div className="max-h-40 overflow-y-auto border border-line rounded-lg">
            {available.length === 0 ? (
              <div className="p-3 text-center text-xs text-ink3">No more users</div>
            ) : available.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setMemberIds((p) => [...p, u.id])}
                className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-card2 text-left text-sm"
              >
                <Avatar name={u.name} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{u.name}</div>
                  <div className="text-[10px] text-ink3 truncate">{u.email}</div>
                </div>
                <Plus size={12} className="text-ink3" />
              </button>
            ))}
          </div>
          {isEdit && <p className="text-[10px] text-ink3 mt-1">Newly added members will be notified.</p>}
        </div>
      </div>
    </Modal>
  );
}
