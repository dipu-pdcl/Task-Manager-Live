import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Trash2, Upload, FileText, FileImage, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { User, Team, Department, Task, Assignee, Attachment } from '../lib/types';
import { useSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { Modal, useToast, Switch, Avatar } from './ui';
import { cx, FLAGS, TASK_TYPES, taskCodeLabel } from '../lib/utils';
import { filterAssignees } from '../lib/assigneeSearch';

export interface TaskFormValues {
  title: string;
  description: string;
  status: string;
  priority: string;
  difficulty: string;
  task_type: string;
  flags: string[];
  tags: string[];
  budget: number;
  estimated_hours: number;
  due_date: string;
  start_date: string;
  assignees: number[];
  reviewer_id: number | '';
  team_id: number | '';
  department_id: number | '';
  checklist: string[];
  is_blocked: boolean;
  is_recurring: boolean;
  recurring_rule: string;
  parent_task_id: number | '';
}

export function emptyForm(): TaskFormValues {
  return {
    title: '', description: '', status: 'todo', priority: 'medium', difficulty: 'medium',
    task_type: 'task', flags: [], tags: [], budget: 0, estimated_hours: 0,
    due_date: '', start_date: '', assignees: [], reviewer_id: '', team_id: '', department_id: '',
    checklist: [], is_blocked: false, is_recurring: false, recurring_rule: '', parent_task_id: '',
  };
}

export default function TaskForm({ open, onClose, task, onSaved, selfTask }: {
  open: boolean; onClose: () => void; task?: Task | null; onSaved: (t: Task) => void; selfTask?: boolean;
}) {
  const settings = useSettings();
  const toast = useToast();
  const { user: me } = useAuth();
  const [form, setForm] = useState<TaskFormValues>(emptyForm());
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  // `me` is a fresh object on every live-status poll, and it is an effect
  // dependency below. Without this guard those updates re-run the effect while
  // the modal is open, which would reset a half-typed create form.
  const wasOpen = useRef(false);

  useEffect(() => {
    // Record the transition BEFORE the early return, otherwise `wasOpen` never
    // resets to false while closed and the next create would skip the reset.
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open) return;
    // assignable=1 adds today's availability so leave/weekend users can be marked.
    api.get<User[]>('/users', { assignable: 1 }).then(setUsers).catch(() => {});
    api.get<Team[]>('/teams').then(setTeams).catch(() => {});
    api.get<Department[]>('/departments').then(setDepts).catch(() => {});
    api.get<Task[]>('/tasks?limit=300').then((t) => setAllTasks(t)).catch(() => {});
    if (task) {
      setForm({
        title: task.title, description: task.description || '', status: task.status, priority: task.priority,
        difficulty: task.difficulty, task_type: task.task_type, flags: task.flags || [], tags: task.tags || [],
        budget: task.budget || 0, estimated_hours: task.estimated_hours || 0,
        due_date: task.due_date || '', start_date: task.start_date || '',
        assignees: (task.assignees || []).map((a) => a.user_id),
        reviewer_id: task.reviewer_id || '', team_id: task.team_id || '', department_id: task.department_id || '',
        checklist: [], is_blocked: !!task.is_blocked, is_recurring: !!task.is_recurring,
        recurring_rule: task.recurring_rule || '', parent_task_id: task.parent_task_id || '',
      });
      api.get<Attachment[]>('/uploads?task_id=' + task.id).then(setExistingAttachments).catch(() => setExistingAttachments([]));
    } else {
      // Create mode must start from a clean slate. Without this the form keeps
      // whatever the last edit left behind, so a newly created task silently
      // inherits the previous task's title, assignees, dates and team.
      // Only on the closed -> open transition, so a background `me` update
      // cannot wipe what the user is currently typing.
      if (opening) setForm(emptyForm());
      setExistingAttachments([]);
    }
    setTagInput('');
    setNewCheck('');
    setSelectedFiles([]);
  }, [open, task, selfTask, me]);

  const set = (patch: Partial<TaskFormValues>) => setForm((f) => ({ ...f, ...patch }));
  const toggleInList = (key: 'flags' | 'tags', v: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v],
    }));
  };
  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) set({ tags: [...form.tags, t] });
    setTagInput('');
  };

  const save = async () => {
    if (!form.title.trim()) return toast('Task title is required', 'error');
    setSaving(true);
    try {
      const payload: any = { ...form, is_self_task: selfTask ? 1 : 0, assignees: form.assignees, reviewer_id: form.reviewer_id || null, team_id: form.team_id || null, department_id: form.department_id || null, parent_task_id: form.parent_task_id || null };
      const saved = task
        ? await api.put<Task>(`/tasks/${task.id}`, payload)
        : await api.post<Task>('/tasks', payload);

      if (selectedFiles.length > 0) {
        setUploading(true);
        const fd = new FormData();
        selectedFiles.forEach((f) => fd.append('files', f));
        try {
          await api.upload<Attachment[]>(`/uploads/task/${saved.id}`, fd);
          toast(`${selectedFiles.length} file(s) uploaded`);
        } catch (e: any) {
          toast('Attachment upload failed: ' + (e.message || 'Unknown error'), 'error');
        } finally {
          setUploading(false);
        }
      }

      toast(task ? 'Task updated' : 'Task created');
      onSaved(saved);
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const flagSet = useMemo(() => [...new Set([...FLAGS, ...form.flags])], [form.flags]);

  const filteredAssignees = useMemo(() => {
    const filtered = filterAssignees(users, assigneeSearch);
    // Exclude current user from assignee list - users cannot assign tasks to themselves
    if (!me) return filtered;
    return filtered.filter((u) => u.id !== me.id);
  }, [users, assigneeSearch, me]);

  // People can share a name, so the branch is shown beside it. Display only.
  const assigneeLabel = (u: User) => (u.department_name ? `${u.name} (${u.department_name})` : u.name);

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit Task' : selfTask ? 'Create Self Task' : 'Create New Task'} width={760}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : task ? 'Save Changes' : selfTask ? 'Create Self Task' : 'Create Task'}</button>
        </>
      }>
      {selfTask && !task && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-brand/10 text-brand border border-brand/20">
          Self tasks are personal tasks assigned to yourself. Completing one earns KPI points (1 pt within 1 hour, 2 pts after 1 hour).
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="label">Task Title *</label>
          <input className="input" placeholder="e.g. Implement new dashboard widgets" value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </div>

        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea className="input textarea" placeholder="Detailed description, acceptance criteria..." value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div>
          <label className="label">Status *</label>
          <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value })}>
            {(settings?.taskStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority *</label>
          <select className="input" value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
            {(settings?.priorities || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {task && (
          <>
            <div>
              <label className="label">Difficulty</label>
              <select className="input" value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
                {(settings?.difficulties || []).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.points} pts)</option>)}
              </select>
            </div>
            <div>
              <label className="label">Task Type</label>
              <select className="input" value={form.task_type} onChange={(e) => set({ task_type: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </>
        )}
        <div>
          <label className="label">Due Date</label>
          <input type="date" className="input" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
        </div>
        {task && (
          <>
            <div>
              <label className="label">Start Date</label>
              <input type="date" className="input" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            </div>
            <div>
              <label className="label">Budget</label>
              <input type="number" className="input" placeholder="0" value={form.budget} onChange={(e) => set({ budget: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">Estimated Hours</label>
              <input type="number" className="input" placeholder="0" value={form.estimated_hours} onChange={(e) => set({ estimated_hours: Number(e.target.value) })} />
            </div>
          </>
        )}
        <div>
          <label className="label">Team</label>
          <select className="input" value={String(form.team_id)} onChange={(e) => set({ team_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">None</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Branch</label>
          <select className="input" value={String(form.department_id)} onChange={(e) => set({ department_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">None</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {selfTask && !task ? (
          <div>
            <label className="label">Assignee</label>
            <span className="chip !bg-brand/15 !border-brand/40 !text-brand !py-1.5 !px-2.5">
              {me ? (users.find((u) => u.id === me.id)?.name || me.name) : 'You'}
            </span>
          </div>
        ) : (
        <div>
          <label className="label">Assignees (multiple)</label>
          {form.assignees.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.assignees.map((uid) => {
                const u = users.find((x) => x.id === uid);
                if (!u) return null;
                return (
                  <span key={uid} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-card2 text-xs">
                    <Avatar name={u.name} src={u.avatar} size={16} />
                    <span className="truncate max-w-40" title={assigneeLabel(u)}>{assigneeLabel(u)}</span>
                    <button
                      type="button"
                      onClick={() => set({ assignees: form.assignees.filter((a) => a !== uid) })}
                      className="hover:text-bad"
                      title="Remove"
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="relative mb-1.5">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={assigneeSearch}
              onChange={(e) => setAssigneeSearch(e.target.value)}
              placeholder="Search users…"
              className="input !pl-7 !py-1.5 !text-xs w-full"
            />
          </div>
          <div className="max-h-48 overflow-y-auto border border-line rounded-lg">
            {filteredAssignees.length === 0 ? (
              <div className="p-3 text-center text-xs text-ink3">No users found</div>
            ) : filteredAssignees.map((u) => {
              // Someone on approved leave or on their weekend cannot take the
              // task, so they stay visible but cannot be ticked.
              const blocked = u.availability && !u.availability.available;
              const alreadyOnTask = !!task?.assignees?.some((a) => a.user_id === u.id);
              return (
              <label
                key={u.id}
                className={cx(
                  'flex items-center gap-2 px-2.5 py-1.5 text-sm',
                  blocked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-card2 cursor-pointer'
                )}
                title={blocked ? u.availability?.reason : assigneeLabel(u)}
              >
                <input
                  type="checkbox"
                  checked={form.assignees.includes(u.id)}
                  disabled={!!blocked}
                  onChange={(e) => {
                    if (blocked) {
                      toast(u.availability?.reason || 'This user is unavailable and cannot be assigned.', 'error');
                      return;
                    }
                    const newAssignees = e.target.checked
                      ? [...form.assignees, u.id]
                      : form.assignees.filter((a) => a !== u.id);
                    set({ assignees: newAssignees });
                  }}
                  className="accent-brand"
                />
                <Avatar name={u.name} src={u.avatar} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate" title={assigneeLabel(u)}>{assigneeLabel(u)}</div>
                  {blocked ? (
                    <div className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                      {u.availability?.status === 'weekend' ? 'On Weekend' : 'On Leave'}
                      {alreadyOnTask ? ' · already assigned' : ''}
                    </div>
                  ) : (
                    <div className="text-[10px] text-ink3 truncate">{u.email}</div>
                  )}
                </div>
              </label>
              );
            })}
          </div>
        </div>
        )}
        {task && (
          <>
            <div>
              <label className="label">Reviewer</label>
              <select className="input" value={String(form.reviewer_id)} onChange={(e) => set({ reviewer_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">None</option>
                {users.filter((u) => u.role !== 'user' || form.assignees.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Depends On (Task)</label>
              <select className="input" value={String(form.parent_task_id)} onChange={(e) => set({ parent_task_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">None</option>
                {allTasks.filter((t) => !task || t.id !== task.id).map((t) => <option key={t.id} value={t.id}>{taskCodeLabel(t.task_code, t.id)} {t.title.slice(0, 40)}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="mt-4">
        <label className="label">Flags</label>
        <div className="flex flex-wrap gap-1.5">
          {flagSet.map((f) => (
            <button key={f} type="button" onClick={() => toggleInList('flags', f)}
              className={cx('chip !py-1.5 !px-2.5 cursor-pointer transition-all', form.flags.includes(f) && '!bg-amber-500/15 !border-amber-500/40 !text-amber-500')}>
              {form.flags.includes(f) ? <><X size={10} /> {f}</> : <><Plus size={10} /> {f}</>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Tags</label>
        <div className="flex flex-wrap gap-1.5 items-center">
          {form.tags.map((t) => (
            <span key={t} className="chip"><button type="button" onClick={() => toggleInList('tags', t)} className="text-ink3 hover:text-bad"><X size={10} /></button> {t}</span>
          ))}
          <div className="flex gap-1.5">
            <input className="input !w-32 !py-1.5" placeholder="Add tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addTag}><Plus size={13} /></button>
          </div>
        </div>
      </div>

      {task && (
        <div className="mt-4">
          <label className="label">Checklist</label>
          <div className="space-y-1.5">
            {form.checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="chip flex-1">{c}</span>
                <button type="button" className="p-1 text-ink3 hover:text-bad" onClick={() => set({ checklist: form.checklist.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input className="input !py-1.5" placeholder="Checklist item" value={newCheck}
                onChange={(e) => setNewCheck(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newCheck.trim()) { set({ checklist: [...form.checklist, newCheck.trim()] }); setNewCheck(''); } } }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (newCheck.trim()) { set({ checklist: [...form.checklist, newCheck.trim()] }); setNewCheck(''); } }}><Plus size={13} /></button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Switch checked={form.is_blocked} onChange={(v) => set({ is_blocked: v })} label="Blocked task" />
        <Switch checked={form.is_recurring} onChange={(v) => set({ is_recurring: v })} label="Recurring task" />
        {form.is_recurring && (
          <div className="md:col-span-2">
            <input className="input" placeholder="Recurring rule (e.g. weekly, monthly)" value={form.recurring_rule} onChange={(e) => set({ recurring_rule: e.target.value })} />
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="label">Attachments</label>
        {existingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {existingAttachments.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 chip !py-1 !px-2">
                {a.mime?.startsWith('image') ? <FileImage size={14} className="text-ink2" /> : <FileText size={14} className="text-ink2" />}
                <span className="text-xs text-ink3 max-w-[120px] truncate">{a.filename}</span>
                <span className="text-[10px] text-ink4">({(a.size / 1024).toFixed(1)}KB)</span>
              </div>
            ))}
          </div>
        )}
        <div className="border-2 border-dashed border-ink4/30 rounded-lg p-3 text-center cursor-pointer hover:border-brand/50"
          onClick={() => document.getElementById('task-form-attachment-input')?.click()}>
          <Upload size={20} className="mx-auto mb-1 text-ink3" />
          <span className="text-sm text-ink2">{uploading ? 'Uploading...' : 'Click to add attachments (JPG, PNG, PDF - up to 10 files, 2MB each)'}</span>
          <input id="task-form-attachment-input" type="file" multiple accept="image/jpeg,image/png,application/pdf"
            className="hidden" onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 10) { toast('Maximum 10 files allowed', 'error'); return; }
              setSelectedFiles((prev) => [...prev, ...files].slice(0, 10));
            }} />
        </div>
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {selectedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 chip !py-1 !px-2">
                {f.type.startsWith('image') ? <FileImage size={14} className="text-ink2" /> : <FileText size={14} className="text-ink2" />}
                <span className="text-xs text-ink3 max-w-[120px] truncate">{f.name}</span>
                <button type="button" className="p-0.5 text-ink3 hover:text-bad" onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}><X size={10} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
