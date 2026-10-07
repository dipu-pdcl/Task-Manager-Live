import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Trash2, Paperclip, MessageSquare, ListChecks, History, Users,
  CalendarDays, Flag, Tag, Link2, Clock, CheckCircle2, Send, Plus, X, ShieldCheck, Upload, Download, FileText,
  FileImage, File, UserPlus, UserMinus, ArrowRightLeft, Search, Lock, UserCheck,
} from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import type { Task as TaskType, TaskDetail, Comment, User } from '../lib/types';
import { useSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { statusById, priorityById, difficultyById, fmtDate, fmtDateTime, timeAgo, cx } from '../lib/utils';
import { Avatar, Badge, Modal, Skeleton, useToast, ConfirmModal, Tabs, AssigneeList } from '../components/ui';
import { ownTaskClass, ownTaskKind, OWN_TASK_LABEL } from '../lib/ownTasks';
import TaskForm from '../components/TaskForm';
import { AttachmentViewer } from '../components/AttachmentViewer';

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const { user, isAdmin, hasPermission } = useAuth();
  const toast = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('details');
  const [comment, setComment] = useState('');
  const [mentionUsers, setMentionUsers] = useState<number[]>([]);
  const [newCheck, setNewCheck] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const [approverId, setApproverId] = useState('');
  const [approvalComment, setApprovalComment] = useState('');
  const [timeOpen, setTimeOpen] = useState(false);
  const [hours, setHours] = useState(1);
  const [timeNote, setTimeNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [progressDraft, setProgressDraft] = useState<Record<number, number>>({});
  const [transferOpen, setTransferOpen] = useState(false);
  const [addAssigneeOpen, setAddAssigneeOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [transferIds, setTransferIds] = useState<number[]>([]);
  const [addIds, setAddIds] = useState<number[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.get<TaskDetail>(`/tasks/${id}`);
      setTask(t);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
    // assignable=1 adds today's availability so leave/weekend users are marked.
    api.get<User[]>('/users', { assignable: 1 }).then(setUsers).catch(() => {});
  }, [load]);

  if (loading) return <div className="max-w-5xl mx-auto space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (!task) return <div className="max-w-5xl mx-auto text-center py-20 text-ink2">Task not found</div>;

  const st = statusById(settings, task.status);
  const pr = priorityById(settings, task.priority);
  const diff = difficultyById(settings, task.difficulty);
  // A role can be limited to status-only updates by holding tasks.status
  // without tasks.edit (e.g. Branch Asst.). Mirror the backend rules so the
  // UI does not offer controls that would come back as 403.
  const canEditTask = hasPermission('tasks.edit');
  const canStatusOnly = hasPermission('tasks.status') && !canEditTask;
  const canEdit = canEditTask && (isAdmin || task.created_by === user?.id);
  const isAssignee = (task.assignees || []).some((a) => a.user_id === user?.id);
  // Admin-only "own task" marker, matching the list and dashboard.
  const ownId = isAdmin ? user?.id : null;
  const ownKind = ownTaskKind(task, ownId);
  const overallProgress = task.progress;
  // A completed task is locked to admins only. Mirrored here so the control is
  // visibly disabled rather than letting the user click and eat a 403. Daily
  // tasks are excluded: they keep their own current-date/previous-date rules.
  const statusLocked = task.status === 'done' && !task.daily_task_key && !isAdmin;

  const changeStatus = async (status: string) => {
    try {
      await api.post(`/tasks/${task.id}/status`, { status });
      toast('Status updated');
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    try {
      const c = await api.post<Comment>(`/tasks/${task.id}/comments`, { content: comment, mentions: mentionUsers });
      toast('Comment added');
      setComment('');
      setMentionUsers([]);
      setTask((t) => t && ({ ...t, comments: [c, ...(t.comments || [])], comments_count: (t.comments_count || 0) + 1 }));
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const addCheck = async () => {
    if (!newCheck.trim()) return;
    try {
      await api.post(`/tasks/${task.id}/checklist`, { title: newCheck });
      setNewCheck('');
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const toggleCheck = async (cid: number, done: boolean) => {
    try {
      await api.put(`/tasks/${task.id}/checklist/${cid}`, { done });
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const deleteCheck = async (cid: number) => {
    try { await api.delete(`/tasks/${task.id}/checklist/${cid}`); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const updateProgress = async (uid: number, progress: number) => {
    try {
      await api.put(`/tasks/${task.id}/assignees/${uid}/progress`, { progress });
      setProgressDraft((d) => { const { [uid]: _, ...rest } = d; return rest; });
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const canManageAssignees = (canEditTask || hasPermission('tasks.assign'))
    && (isAdmin || task.created_by === user?.id || isAssignee);

  const handleTransfer = async (selectedUserIds: number[]) => {
    if (!selectedUserIds.length) return;
    try {
      await api.post(`/tasks/${task.id}/assignees/transfer`, { user_ids: selectedUserIds });
      toast('Task transferred');
      setTransferOpen(false);
      setSearchQuery('');
      load();
    } catch (e: any) { toast(e.message || 'Transfer failed', 'error'); }
  };

  const handleAddAssignees = async (selectedUserIds: number[]) => {
    if (!selectedUserIds.length) return;
    try {
      await api.post(`/tasks/${task.id}/assignees/add`, { user_ids: selectedUserIds });
      toast('Assignees added');
      setAddAssigneeOpen(false);
      setSearchQuery('');
      load();
    } catch (e: any) { toast(e.message || 'Failed to add assignees', 'error'); }
  };

  const deleteAttachment = async (aid: number) => {
    try { await api.delete(`/uploads/${aid}`); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const decideApproval = async (aid: number, status: string) => {
    try { await api.post(`/tasks/${task.id}/approvals/${aid}`, { status }); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const logTime = async () => {
    try {
      await api.post(`/tasks/${task.id}/time`, { hours, note: timeNote });
      setTimeNote('');
      load();
      toast('Time logged');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const deleteTask = async () => {
    try {
      await api.delete(`/tasks/${task.id}`);
      toast('Task deleted');
      navigate('/tasks');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const requestApproval = async () => {
    if (!approverId) return toast('Select an approver', 'error');
    try {
      await api.post(`/tasks/${task.id}/approvals`, { approver_id: Number(approverId), comment: approvalComment });
      setApproverOpen(false);
      toast('Approval requested');
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const exportTask = async () => {
    try { await downloadExport(`/reports/export?type=tasks&status=${task.status}`, `task-${task.id}.csv`); } catch (e: any) { toast(e.message, 'error'); }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const validExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
    const invalidFiles = Array.from(files).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return !validExtensions.includes(`.${ext}`);
    });

    if (invalidFiles.length > 0) {
      toast(`Only JPG, JPEG, PNG, and PDF files are allowed. ${invalidFiles.length} file(s) skipped.`, 'error');
      return;
    }

    const oversized = Array.from(files).filter((f) => f.size > 2 * 1024 * 1024);
    if (oversized.length > 0) {
      toast(`Each file must be under 2 MB. ${oversized.length} file(s) skipped.`, 'error');
      return;
    }

    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    try {
      await api.upload(`/uploads/task/${task.id}`, fd);
      toast('Files uploaded');
      load();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (input) input.value = '';
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const tabs = [
    { key: 'details', label: 'Details', icon: FileText },
    { key: 'comments', label: 'Comments', count: task.comments?.length, icon: MessageSquare },
    { key: 'checklist', label: 'Checklist', count: (task.checklist_items?.length ?? 0), icon: ListChecks },
    { key: 'attachments', label: 'Files', count: task.attachments?.length, icon: Paperclip },
    { key: 'activity', label: 'Activity', icon: History },
    { key: 'approvals', label: 'Approvals', count: task.approvals?.length, icon: ShieldCheck },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5 anim-in">
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/tasks')}><ArrowLeft size={15} /> Back</button>
        <span className="text-sm text-ink3">Task #{task.id}</span>
        {task.task_code && (
          <span className="text-[11px] font-mono font-bold text-ink2 bg-card2 border border-line rounded px-1.5 py-0.5" title="Permanent Task ID">{task.task_code}</span>
        )}
        <div className="ml-auto flex gap-2">
          {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</button>}
          {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => setDelOpen(true)}><Trash2 size={14} /> Delete</button>}
        </div>
      </div>

      {canStatusOnly && (
        <div className="card p-3 text-sm text-ink2 flex items-center gap-2">
          <Lock size={14} className="shrink-0" />
          You have status-only access to this task. You can change its status and log your progress, but not edit its details or assignees.
        </div>
      )}

      <div className={cx('card p-6', ownTaskClass(task, ownId))}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {ownKind && (
            <Badge color={ownKind === 'self' ? 'rgb(var(--own-self))' : 'rgb(var(--own-assigned))'} dot>
              {OWN_TASK_LABEL[ownKind]}
            </Badge>
          )}
          <Badge color={st.color} dot>{st.name}</Badge>
          <Badge color={pr.color}><Flag size={10} /> {pr.name}</Badge>
          <Badge color={diff.points >= 5 ? '#ef4444' : diff.points >= 3 ? '#f97316' : '#3b82f6'}>{diff.name} ({diff.points} pts)</Badge>
          {task.is_blocked && <Badge color="#ef4444">Blocked</Badge>}
          {task.is_recurring && <Badge color="#a855f7">Recurring</Badge>}
          {task.is_self_task && <Badge color="#10b981">Self Task</Badge>}
          {task.approval_status === 'pending' && <Badge color="#eab308">Approval pending</Badge>}
        </div>
        <h1 className="text-2xl font-extrabold leading-snug">{task.title}</h1>
        <p className="text-sm text-ink2 mt-2 whitespace-pre-wrap">{task.description || 'No description provided.'}</p>

        <div className="flex flex-wrap gap-2 mt-4">
          {task.flags.map((f) => <span key={f} className="chip"><Flag size={10} className="text-amber-500" /> {f}</span>)}
          {task.tags.map((t) => <span key={t} className="chip"><Tag size={10} /> {t}</span>)}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 text-sm">
          <Meta icon={<CalendarDays size={14} />} label="Due Date" value={fmtDate(task.due_date)} />
          <Meta icon={<Users size={14} />} label="Team" value={task.team_name || '—'} />
          <Meta icon={<Users size={14} />} label="Branch" value={task.department_name || '—'} />
          <Meta icon={<Clock size={14} />} label="Est. Hours" value={task.estimated_hours ? `${task.estimated_hours}h` : '—'} />
          <Meta icon={<Users size={14} />} label="Assigned To"
            value={task.assignees?.length
              ? <AssigneeList assignees={task.assignees} max={0} size={20} />
              : <span className="text-ink3">Unassigned</span>} />
          <Meta icon={<Users size={14} />} label="Created By" value={task.created_by_name || '—'} />
          <Meta icon={<ShieldCheck size={14} />} label="Reviewer" value={task.reviewer_name || '—'} />
          <Meta icon={<Clock size={14} />} label="Created" value={fmtDate(task.created_at)} />
          <Meta icon={<CheckCircle2 size={14} />} label="Completed" value={task.completed_at ? fmtDate(task.completed_at) : '—'} />
          {task.completed_by_name && (
            <Meta icon={<UserCheck size={14} />} label="Completed By" value={task.completed_by_name} />
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="font-semibold">Overall Progress</span>
            <span className="font-bold text-brand">{overallProgress}%</span>
          </div>
          <div className="progress-bar !h-3"><div style={{ width: `${overallProgress}%` }} /></div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-5">
          {(settings?.taskStatuses || []).map((s) => (
            <button key={s.id} onClick={() => changeStatus(s.id)} disabled={s.id === task.status || statusLocked}
              className={cx('chip !py-1.5 !px-3 cursor-pointer transition-all', s.id === task.status && 'font-bold')}
              style={s.id === task.status ? { color: s.color, borderColor: s.color, background: `${s.color}22` } : {}}>
              {s.name}
            </button>
          ))}
        </div>
        {statusLocked && (
          <div className="card p-3 mt-3 text-sm text-ink2 flex items-center gap-2">
            <Lock size={14} className="shrink-0" />
            This task is completed, so its status is locked and the KPI points it earned are protected. Only an administrator can change it.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold flex items-center gap-2"><Users size={16} className="text-brand" /> Assignees ({task.assignees?.length})</h3>
              {canManageAssignees && (
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSearchQuery(''); setTransferOpen(true); }}><ArrowRightLeft size={14} /> Transfer</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setSearchQuery(''); setAddAssigneeOpen(true); }}><UserPlus size={14} /> Add Assignee</button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {(task.assignees || []).map((a) => (
                <div key={a.user_id} className="flex items-center gap-3 p-2.5 rounded-xl bg-card2/60">
                  <Avatar name={a.user_name} src={a.avatar} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{a.user_name}</span>
                      <span className="text-xs font-bold">{a.progress}%</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <input type="range" min={0} max={100} step={5}
                        value={progressDraft[a.user_id] ?? a.progress}
                        disabled={!isAdmin && a.user_id !== user?.id}
                        onChange={(e) => setProgressDraft((d) => ({ ...d, [a.user_id]: Number(e.target.value) }))}
                        onMouseUp={() => updateProgress(a.user_id, progressDraft[a.user_id] ?? a.progress)}
                        onTouchEnd={() => updateProgress(a.user_id, progressDraft[a.user_id] ?? a.progress)}
                        onBlur={() => { if (progressDraft[a.user_id] !== undefined) updateProgress(a.user_id, progressDraft[a.user_id]); }}
                        className="flex-1 accent-indigo-500" />
                    </div>
                  </div>
                  <Badge color={statusById(settings, a.status).color}>{statusById(settings, a.status).name}</Badge>
                </div>
              ))}
              {!task.assignees?.length && <p className="text-sm text-ink3">No assignees yet</p>}
            </div>
          </div>

          <div className="card overflow-hidden">
            <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, count: t.count }))} active={tab} onChange={setTab} className="px-4 pt-3 border-b border-line" />
            <div className="p-4">
              {tab === 'details' && (
                <div className="space-y-4 text-sm">
                  <div><span className="label">Task Type</span><span className="capitalize">{task.task_type}</span></div>
                  <div><span className="label">Budget</span>${task.budget?.toLocaleString() || 0}</div>
                  <div><span className="label">Recurring Rule</span>{task.recurring_rule || '—'}</div>
                  {task.dependencies?.length > 0 && (
                    <>
                      <div className="label">Dependencies</div>
                      {task.dependencies.map((d) => (
                        <button key={d.depends_on} onClick={() => navigate(`/tasks/${d.depends_on}`)} className="chip cursor-pointer"><Link2 size={11} /> #{d.depends_on} {d.title}</button>
                      ))}
                    </>
                  )}
                  {task.parent_task_id && (
                    <>
                      <div className="label">Parent Task</div>
                      <button onClick={() => navigate(`/tasks/${task.parent_task_id}`)} className="chip cursor-pointer"><Link2 size={11} /> #{task.parent_task_id}</button>
                    </>
                  )}
                </div>
              )}

              {tab === 'comments' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    {(task.comments || []).map((c) => (
                      <div key={c.id} className="flex gap-3 p-3 rounded-xl bg-card2/60">
                        <Avatar name={c.user_name} src={c.avatar} size={32} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{c.user_name}</span>
                            <span className="text-[11px] text-ink3">{timeAgo(c.created_at)}</span>
                          </div>
                          <p className="text-sm mt-1 whitespace-pre-wrap">{c.content}</p>
                        </div>
                      </div>
                    ))}
                    {(task.comments || []).length === 0 && <p className="text-sm text-ink3 text-center py-4">No comments yet</p>}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="label !mb-0">Mention:</span>
                      <div className="flex flex-wrap gap-1">
                        {users.filter((u) => u.id !== user?.id).map((u) => {
                          // A user on approved leave or on their weekend cannot be
                          // mentioned, so the chip is shown but not clickable.
                          const blocked = u.availability && !u.availability.available;
                          return (
                            <button
                              key={u.id}
                              disabled={!!blocked}
                              title={blocked ? u.availability?.reason : `Mention @${u.name}`}
                              onClick={() => {
                                if (blocked) {
                                  toast(u.availability?.reason || 'This user is unavailable and cannot be mentioned.', 'error');
                                  return;
                                }
                                setMentionUsers((m) => m.includes(u.id) ? m.filter((x) => x !== u.id) : [...m, u.id]);
                              }}
                              className={cx(
                                'chip !py-1',
                                blocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                                mentionUsers.includes(u.id) && '!bg-brand/15 !border-brand/40 !text-brand'
                              )}
                            >
                              @{u.name.split(' ')[0]}
                              {blocked && (
                                <span className="ml-1 text-[9px] font-semibold uppercase">
                                  {u.availability?.status === 'weekend' ? 'Wknd' : 'Leave'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <textarea className="input textarea flex-1" placeholder="Write a comment..." value={comment} onChange={(e) => setComment(e.target.value)} />
                      <button className="btn btn-primary self-end" onClick={addComment} disabled={!comment.trim()}><Send size={15} /></button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'checklist' && (
                <div className="space-y-2">
                  {(task.checklist_items || []).map((c) => (
                    <label key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-card2 cursor-pointer">
                      <input type="checkbox" checked={!!c.done} onChange={() => toggleCheck(c.id, !c.done)} className="w-4 h-4 accent-indigo-500" />
                      <span className={cx('text-sm flex-1', c.done ? 'line-through text-ink3' : '')}>{c.title}</span>
                      <button onClick={() => deleteCheck(c.id)} className="text-ink3 hover:text-bad"><X size={13} /></button>
                    </label>
                  ))}
                  {!(task.checklist_items || []).length && <p className="text-sm text-ink3 text-center py-4">No checklist items</p>}
                  {canEditTask && (
                    <div className="flex gap-2 pt-2">
                      <input className="input flex-1" placeholder="Add checklist item" value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} />
                      <button className="btn btn-ghost" onClick={addCheck}><Plus size={15} /></button>
                    </div>
                  )}
                </div>
              )}

              {tab === 'attachments' && (
                <div className="space-y-3">
                  <label className={cx('block border-2 border-dashed border-line rounded-xl p-6 text-center cursor-pointer hover:border-brand/40 transition-colors', uploading && 'opacity-50')}>
                    <Upload size={20} className="mx-auto text-ink3 mb-2" />
                    <span className="text-sm text-ink2">{uploading ? 'Uploading...' : 'Click to upload attachments (JPG, PNG, PDF - up to 10 files, 2MB each)'}</span>
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.pdf"
                      className="hidden"
                      onChange={(e) => uploadFiles(e.target.files)}
                    />
                  </label>
                  <div className="space-y-2">
                    {(task.attachments || []).map((a) => {
                      const fileExt = a.stored_name ? a.stored_name.split('.').pop()?.toLowerCase() : '';
                      const isImage = fileExt === 'jpg' || fileExt === 'jpeg' || fileExt === 'png';
                      const isPdf = fileExt === 'pdf';
                      const FileIcon = isImage ? FileImage : isPdf ? FileText : File;
                      const fileType = isImage ? 'Image' : isPdf ? 'PDF' : 'Document';
                      const sizeFormatted = a.size >= 1024 * 1024 ? `${(a.size / (1024 * 1024)).toFixed(1)} MB` : `${(a.size / 1024).toFixed(1)} KB`;
                      return (
                        <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-card2/60">
                          <FileIcon size={24} className="text-ink3 shrink-0" />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setViewerIndex((task.attachments || []).findIndex((x) => x.id === a.id)); setViewerOpen(true); }}>
                            <div className="text-sm font-medium truncate hover:text-brand">{a.filename}</div>
                            <div className="text-[11px] text-ink3 truncate">
                              {fileType} · {sizeFormatted} · {fmtDateTime(a.uploaded_at)}
                            </div>
                          </div>
                          <a
                            href={`/api/uploads/file/${a.stored_name}/download`}
                            download={a.filename}
                            className="p-1.5 rounded-lg text-ink3 hover:text-brand hover:bg-card transition-colors shrink-0"
                            title="Download"
                          >
                            <Download size={14} />
                          </a>
                        </div>
                      );
                    })}
                    {(task.attachments || []).length === 0 && (
                      <div className="text-center py-6 text-ink3">
                        <Paperclip size={24} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No attachments yet. Upload files using the area above.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'activity' && (
                <div className="space-y-1">
                  {(task.history || []).map((h) => (
                    <div key={h.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-card2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand/60 shrink-0" />
                      <div className="text-xs">
                        <span className="font-semibold">{h.user_name || 'System'}</span>{' '}
                        <span className="text-ink2">{h.action.replace('.', ' ')}</span>
                        {h.old_value && h.old_value !== h.new_value && <span className="text-ink3"> from <span className="line-through">{String(h.old_value).slice(0, 40)}</span></span>}
                        {h.new_value && <span className="text-ink2"> to <span className="text-brand font-medium">{String(h.new_value).slice(0, 40)}</span></span>}
                        <div className="text-[10px] text-ink3 mt-0.5">{fmtDateTime(h.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  {(task.history || []).length === 0 && <p className="text-sm text-ink3 text-center py-4">No activity recorded</p>}
                </div>
              )}

              {tab === 'approvals' && (
                <div className="space-y-3">
                  <button className="btn btn-primary btn-sm" onClick={() => setApproverOpen(true)}><ShieldCheck size={14} /> Request Approval</button>
                  {(task.approvals || []).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-card2/60">
                      <div className="flex-1">
                        <div className="text-sm font-medium">Requested by {a.requester_name}</div>
                        <div className="text-xs text-ink3">{a.comment || 'No comment'} · {fmtDateTime(a.created_at)}</div>
                      </div>
                      <Badge color={a.status === 'approved' ? '#22c55e' : a.status === 'rejected' ? '#ef4444' : '#eab308'}>{a.status}</Badge>
                      {a.status === 'pending' && isAdmin && (
                        <div className="flex gap-1.5">
                          <button className="btn btn-primary btn-xs" onClick={() => decideApproval(a.id, 'approved')}>Approve</button>
                          <button className="btn btn-danger btn-xs" onClick={() => decideApproval(a.id, 'rejected')}>Reject</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {(task.approvals || []).length === 0 && <p className="text-sm text-ink3">No approval requests yet</p>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Clock size={16} className="text-brand" /> Time Tracking</h3>
            <div className="space-y-2">
              {(task.time_entries || []).slice(0, 5).map((te) => (
                <div key={te.id} className="flex items-center justify-between text-sm">
                  <div className="text-ink2">{te.user_name} · <span className="text-ink3">{te.date}</span></div>
                  <span className="font-bold">{te.hours}h</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 pt-2">
                <input type="number" min={0.5} step={0.5} className="input !w-20 !py-1.5" value={hours} onChange={(e) => setHours(Number(e.target.value))} />
                <input className="input flex-1 !py-1.5" placeholder="Note" value={timeNote} onChange={(e) => setTimeNote(e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={logTime}><Plus size={14} /></button>
              </div>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-bold mb-3">Quick Actions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {isAssignee && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => updateProgress(user!.id, 25)}>25%</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => updateProgress(user!.id, 50)}>50%</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => updateProgress(user!.id, 75)}>75%</button>
                  <button className="btn btn-primary btn-sm" onClick={() => updateProgress(user!.id, 100)}>100%</button>
                </>
              )}
              <button className="btn btn-ghost btn-sm col-span-2" onClick={exportTask}><Download size={14} /> Export</button>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-bold mb-3">Task Metadata</h3>
            <dl className="space-y-2 text-sm">
              <Row k="Type" v={<span className="capitalize">{task.task_type}</span>} />
              <Row k="Budget" v={`$${(task.budget || 0).toLocaleString()}`} />
              <Row k="Est. Hours" v={`${task.estimated_hours || 0}h`} />
              <Row k="Created" v={fmtDate(task.created_at)} />
              <Row k="Updated" v={timeAgo(task.updated_at)} />
              <Row k="Archived" v={task.archived ? 'Yes' : 'No'} />
            </dl>
          </div>
        </div>
      </div>

      <TaskForm open={editOpen} onClose={() => setEditOpen(false)} task={task} onSaved={() => { setEditOpen(false); load(); }} />

      <ConfirmModal open={delOpen} onClose={() => setDelOpen(false)}
        onConfirm={deleteTask}
        title="Delete task?" message="This action cannot be undone." confirmLabel="Delete" danger />

      <Modal open={approverOpen} onClose={() => setApproverOpen(false)} title="Request Approval"
        footer={<><button className="btn btn-ghost" onClick={() => setApproverOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={requestApproval} disabled={!approverId}>Request</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Approver</label>
            <select className="input" value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              <option value="">Select approver</option>
              {users.filter((u) => u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Comment</label>
            <textarea className="input textarea" value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer Task"
        footer={
          <><button className="btn btn-ghost" onClick={() => setTransferOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleTransfer(transferIds)} disabled={!transferIds.length}>Transfer</button></>
        }>
        <div className="space-y-3">
          <p className="text-sm text-ink2">This will remove current assignees and assign this task to the selected user(s).</p>
          <TransferUserSelect users={users} selectedIds={transferIds} onChange={setTransferIds} currentAssignees={(task.assignees || []).map((a) => a.user_id)} currentUserId={user?.id ?? 0} />
        </div>
      </Modal>

      <Modal open={addAssigneeOpen} onClose={() => setAddAssigneeOpen(false)} title="Add Assignee"
        footer={
          <><button className="btn btn-ghost" onClick={() => setAddAssigneeOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleAddAssignees(addIds)} disabled={!addIds.length}>Add Assignee(s)</button></>
        }>
        <div className="space-y-3">
          <p className="text-sm text-ink2">Add one or more users to this task without changing existing assignees.</p>
          <TransferUserSelect users={users} selectedIds={addIds} onChange={setAddIds} currentAssignees={(task.assignees || []).map((a) => a.user_id)} currentUserId={user?.id ?? 0} />
        </div>
      </Modal>

      {task && (
        <AttachmentViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          attachments={task.attachments || []}
          initialIndex={viewerIndex}
        />
      )}
    </div>
  );
}

function TransferUserSelect({ users, selectedIds, onChange, currentAssignees = [], currentUserId }: {
  users: User[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  currentAssignees?: number[];
  currentUserId: number;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const filtered = users.filter((u) => {
    // Exclude current user - users cannot assign/transfer tasks to themselves
    if (u.id === currentUserId) return false;
    if (currentAssignees.includes(u.id) && !selectedIds.includes(u.id)) return false;
    return u.name.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
        <input className="input !pl-9" placeholder="Search users..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {filtered.length === 0 && <p className="text-sm text-ink3 text-center py-4">No users found</p>}
        {filtered.map((u) => {
          const checked = selectedIds.includes(u.id);
          // Leave/weekend users are shown with their reason but cannot be
          // transferred or added, since they cannot work the task.
          const blocked = u.availability && !u.availability.available;
          return (
            <label
              key={u.id}
              title={blocked ? u.availability?.reason : u.name}
              className={cx(
                'flex items-center gap-3 p-2 rounded-xl',
                blocked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-card2 cursor-pointer'
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!!blocked}
                onChange={(e) => {
                  if (blocked) {
                    toast(u.availability?.reason || 'This user is unavailable and cannot be assigned.', 'error');
                    return;
                  }
                  onChange(checked ? selectedIds.filter((x) => x !== u.id) : [...selectedIds, u.id]);
                }}
                className="w-4 h-4 accent-indigo-500"
              />
              <span className="text-sm font-medium min-w-0 flex-1 truncate">{u.name}</span>
              {blocked && (
                <span className="shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  {u.availability?.status === 'weekend' ? 'Weekend' : 'Leave'}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {selectedIds.length > 0 && (
        <div className="text-xs text-ink3">{selectedIds.length} user{selectedIds.length > 1 ? 's' : ''} selected</div>
      )}
    </div>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-card2/60">
      <span className="text-ink3">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-ink3 font-semibold">{label}</div>
        <div className="font-semibold text-sm truncate">{value}</div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><dt className="text-ink3">{k}</dt><dd className="font-medium text-right">{v}</dd></div>;
}
