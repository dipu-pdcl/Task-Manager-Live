import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Flame, Upload, Download, Plus, Search, Trash2, Edit3, CheckCircle2,
  Clock, AlertCircle, RefreshCw, FileSpreadsheet, Check, X, User,
  ChevronDown, Calendar, Eye, Layers, FileText, Sparkles, ArrowUpDown,
  MessageSquare, MessageSquarePlus, Save, Send, DatabaseBackup
} from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { PriorityTask, User as UserType } from '../lib/types';
import { Avatar, Badge, Modal, useToast, Switch } from '../components/ui';
import { cx, fmtDate } from '../lib/utils';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; badge: string; icon: any }> = {
  todo: {
    label: 'To Do',
    color: 'text-sky-900 dark:text-sky-200',
    bg: 'bg-sky-100 dark:bg-sky-950/80',
    border: 'border-sky-300 dark:border-sky-700/80',
    badge: 'bg-sky-500',
    icon: Clock,
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-amber-900 dark:text-amber-200',
    bg: 'bg-amber-100 dark:bg-amber-950/80',
    border: 'border-amber-300 dark:border-amber-700/80',
    badge: 'bg-amber-500',
    icon: RefreshCw,
  },
  in_review: {
    label: 'In Review',
    color: 'text-purple-900 dark:text-purple-200',
    bg: 'bg-purple-100 dark:bg-purple-950/80',
    border: 'border-purple-300 dark:border-purple-700/80',
    badge: 'bg-purple-500',
    icon: Layers,
  },
  done: {
    label: 'Completed',
    color: 'text-emerald-900 dark:text-emerald-200',
    bg: 'bg-emerald-100 dark:bg-emerald-950/80',
    border: 'border-emerald-300 dark:border-emerald-700/80',
    badge: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-rose-900 dark:text-rose-200',
    bg: 'bg-rose-100 dark:bg-rose-950/80',
    border: 'border-rose-300 dark:border-rose-700/80',
    badge: 'bg-rose-500',
    icon: AlertCircle,
  },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  critical: {
    label: 'Critical',
    color: 'text-rose-900 dark:text-rose-200 font-bold',
    bg: 'bg-rose-100 dark:bg-rose-950/70',
    border: 'border-rose-300 dark:border-rose-700',
    dot: 'bg-rose-600 animate-pulse',
  },
  high: {
    label: 'High',
    color: 'text-amber-900 dark:text-amber-200 font-bold',
    bg: 'bg-amber-100 dark:bg-amber-950/70',
    border: 'border-amber-300 dark:border-amber-700',
    dot: 'bg-amber-600',
  },
  medium: {
    label: 'Medium',
    color: 'text-blue-900 dark:text-blue-200 font-bold',
    bg: 'bg-blue-100 dark:bg-blue-950/70',
    border: 'border-blue-300 dark:border-blue-700',
    dot: 'bg-blue-600',
  },
  low: {
    label: 'Low',
    color: 'text-slate-800 dark:text-slate-200 font-bold',
    bg: 'bg-slate-200/80 dark:bg-slate-800/80',
    border: 'border-slate-300 dark:border-slate-600',
    dot: 'bg-slate-500',
  },
};

interface UploadResult {
  count: number;
  matchedCount: number;
  unmatchedCount: number;
  matchedUsers: string[];
  unmatchedNames: string[];
  replaced: boolean;
}

export default function PriorityTasks() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [tasks, setTasks] = useState<PriorityTask[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Sorting
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'priority' | 'due_date' | 'status' | 'work_title' | 'created_at'>('priority');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Modals
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [remarksModalOpen, setRemarksModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Selected item state for edit/detail
  const [editingTask, setEditingTask] = useState<PriorityTask | null>(null);
  const [selectedTask, setSelectedTask] = useState<PriorityTask | null>(null);

  // User Remarks / Progress Tracking State (All users)
  const [remarksTask, setRemarksTask] = useState<PriorityTask | null>(null);
  const [remarksInput, setRemarksInput] = useState('');
  const [remarksStatus, setRemarksStatus] = useState<string>('todo');
  const [savingRemarks, setSavingRemarks] = useState(false);

  // Inline remarks state inside Detail Modal
  const [detailRemarksInput, setDetailRemarksInput] = useState('');
  const [isEditingDetailRemarks, setIsEditingDetailRemarks] = useState(false);
  const [savingDetailRemarks, setSavingDetailRemarks] = useState(false);

  // Upload Form State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [backupToMainInUpload, setBackupToMainInUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [downloadingType, setDownloadingType] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selection and Transfer State
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [transferring, setTransferring] = useState(false);
  const [includeRemarksInTransfer, setIncludeRemarksInTransfer] = useState(true);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Close template menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setTemplateMenuOpen(false);
      }
    };
    if (templateMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [templateMenuOpen]);

  // Create / Edit Form State
  const [formData, setFormData] = useState({
    work_title: '',
    description: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    assignee_type: 'user' as 'user' | 'custom',
    assignee_user_id: '' as string | number,
    assignee_name: '',
    status: 'todo' as 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled',
    due_date: '',
    remarks: '',
    backup_to_main: false,
  });

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<PriorityTask[]>('/priority-tasks', {
        search: search || undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        assignee: assigneeFilter !== 'all' ? assigneeFilter : undefined,
        sort: sortBy,
        order: sortOrder,
      });
      setTasks(data);
    } catch (e: any) {
      toast(e.message || 'Failed to load priority tasks', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, priorityFilter, statusFilter, assigneeFilter, sortBy, sortOrder, toast]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    api.get<UserType[]>('/users')
      .then(setUsers)
      .catch(() => {});
  }, []);

  // Download helper with toast feedback
  const handleDownload = async (path: string, filename: string, typeKey?: string) => {
    if (typeKey) setDownloadingType(typeKey);
    try {
      await downloadExport(path, filename);
      toast(`Downloaded ${filename}`, 'success');
    } catch (e: any) {
      toast(e.message || 'Download failed', 'error');
    } finally {
      if (typeKey) setDownloadingType(null);
    }
  };

  // Quick Status Updater (accessible to all logged-in users)
  const handleStatusChange = async (taskId: number, newStatus: string, optionalRemarks?: string) => {
    try {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: newStatus as any, remarks: optionalRemarks !== undefined ? optionalRemarks : t.remarks }
            : t
        )
      );

      const payload: any = { status: newStatus };
      if (optionalRemarks !== undefined) payload.remarks = optionalRemarks.trim();

      const updated = await api.patch<PriorityTask>(`/priority-tasks/${taskId}/status`, payload);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (selectedTask?.id === taskId) setSelectedTask(updated);

      toast(`Status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`, 'success');
    } catch (e: any) {
      toast(e.message || 'Failed to update status', 'error');
      loadTasks(); // rollback
    }
  };

  // Open Remarks Timeline Modal (for all users)
  const openRemarksModal = (task: PriorityTask) => {
    setRemarksTask(task);
    setRemarksInput('');
    setRemarksStatus(task.status);
    setRemarksModalOpen(true);
  };

  // Add new remark to task timeline (preserves all existing remarks)
  const handleAddRemark = async (taskId: number, remarkText: string, status?: string) => {
    if (!remarkText.trim()) return;
    setSavingRemarks(true);
    try {
      const updated = await api.post<PriorityTask>(`/priority-tasks/${taskId}/remarks`, {
        remark: remarkText.trim(),
        status,
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (selectedTask?.id === taskId) setSelectedTask(updated);
      if (remarksTask?.id === taskId) setRemarksTask(updated);
      setRemarksInput('');
      setDetailRemarksInput('');
      toast('Remark added to timeline', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to add remark', 'error');
    } finally {
      setSavingRemarks(false);
    }
  };

  // Delete specific remark from history (for admin or remark author)
  const handleDeleteRemark = async (taskId: number, remarkId: number) => {
    try {
      const updated = await api.delete<PriorityTask>(`/priority-tasks/${taskId}/remarks/${remarkId}`);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (selectedTask?.id === taskId) setSelectedTask(updated);
      if (remarksTask?.id === taskId) setRemarksTask(updated);
      toast('Remark removed from history', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to delete remark', 'error');
    }
  };

  // Save Remarks & Status from Modal (for all users)
  const handleSaveRemarksModal = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!remarksTask) return;

    if (!remarksInput.trim()) {
      if (remarksStatus !== remarksTask.status) {
        await handleStatusChange(remarksTask.id, remarksStatus);
        setRemarksModalOpen(false);
      } else {
        setRemarksModalOpen(false);
      }
      return;
    }

    setSavingRemarks(true);
    try {
      const updated = await api.post<PriorityTask>(`/priority-tasks/${remarksTask.id}/remarks`, {
        remark: remarksInput.trim(),
        status: remarksStatus,
      });
      setTasks((prev) => prev.map((t) => (t.id === remarksTask.id ? updated : t)));
      if (selectedTask?.id === remarksTask.id) setSelectedTask(updated);
      setRemarksTask(updated);
      setRemarksInput('');
      toast('New remark added & status updated', 'success');
      setRemarksModalOpen(false);
    } catch (err: any) {
      toast(err.message || 'Failed to add remark', 'error');
    } finally {
      setSavingRemarks(false);
    }
  };

  // Save Remarks directly from Detail Modal (for all users)
  const handleSaveDetailRemarks = async (taskId: number) => {
    if (!detailRemarksInput.trim()) return;
    setSavingDetailRemarks(true);
    try {
      const updated = await api.post<PriorityTask>(`/priority-tasks/${taskId}/remarks`, {
        remark: detailRemarksInput.trim(),
        status: selectedTask?.status,
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      if (selectedTask?.id === taskId) setSelectedTask(updated);
      setDetailRemarksInput('');
      setIsEditingDetailRemarks(false);
      toast('New remark added to timeline', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to add remark', 'error');
    } finally {
      setSavingDetailRemarks(false);
    }
  };

  // Upload handler
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      toast('Please select an Excel or CSV file first', 'error');
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('replace', String(replaceExisting));
      form.append('backup_to_main', String(backupToMainInUpload));

      const res = await api.upload<UploadResult>('/priority-tasks/upload', form);
      setUploadResult(res);
      toast(
        backupToMainInUpload
          ? `Successfully imported ${res.count} priority tasks and backed them up to the Main Tasks table!`
          : `Successfully imported ${res.count} priority tasks!`,
        'success'
      );
      loadTasks();
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      toast(e.message || 'Excel upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Selection toggles
  const toggleSelectTask = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  };

  const handleSelectUntransferred = () => {
    const untransferred = tasks.filter((t) => !t.transferred_to_task_id);
    if (untransferred.length === 0) {
      toast('All displayed priority tasks are already transferred/backed up.', 'info');
      return;
    }
    setSelectedIds(new Set(untransferred.map((t) => t.id)));
    toast(`Selected ${untransferred.length} untransferred priority tasks`, 'info');
  };

  // Transfer batch to Main Tasks Table
  const handleTransferSelected = async () => {
    if (selectedIds.size === 0) return;
    setTransferring(true);
    try {
      const res = await api.post<{ ok: boolean; count: number; results: Array<{ priorityTaskId: number; taskId: number }> }>('/priority-tasks/transfer', {
        ids: Array.from(selectedIds),
        includeRemarks: includeRemarksInTransfer,
      });
      toast(`Successfully transferred and backed up ${res.count} priority tasks to the Main Task Table!`, 'success');
      setSelectedIds(new Set());
      await loadTasks();
    } catch (e: any) {
      toast(e.message || 'Batch transfer failed', 'error');
    } finally {
      setTransferring(false);
    }
  };

  // Transfer single priority task to Main Tasks Table
  const handleTransferSingle = async (taskId: number) => {
    setTransferring(true);
    try {
      const res = await api.post<{ ok: boolean; taskId: number; priorityTask: PriorityTask }>(`/priority-tasks/${taskId}/transfer`, {
        includeRemarks: true,
      });
      toast(`Priority task transferred & backed up to Main Task Table (Task #${res.taskId})`, 'success');
      setTasks((prev) => prev.map((t) => (t.id === taskId ? res.priorityTask : t)));
      if (selectedTask?.id === taskId) {
        setSelectedTask(res.priorityTask);
      }
    } catch (e: any) {
      toast(e.message || 'Transfer failed', 'error');
    } finally {
      setTransferring(false);
    }
  };

  // Save manual task (Admin only)
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.work_title.trim()) {
      toast('Work Title is required', 'error');
      return;
    }

    try {
      const payload: any = {
        work_title: formData.work_title.trim(),
        description: formData.description.trim(),
        priority: formData.priority,
        status: formData.status,
        due_date: formData.due_date || null,
        remarks: formData.remarks.trim(),
      };

      if (formData.assignee_type === 'user' && formData.assignee_user_id) {
        const u = users.find((x) => x.id === Number(formData.assignee_user_id));
        payload.assignee_user_id = Number(formData.assignee_user_id);
        payload.assignee_name = u ? u.name : '';
      } else {
        payload.assignee_user_id = null;
        payload.assignee_name = formData.assignee_name.trim();
      }

      if (editingTask) {
        const updated = await api.put<PriorityTask>(`/priority-tasks/${editingTask.id}`, payload);
        setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? updated : t)));
        toast('Priority task updated successfully', 'success');
      } else {
        if (formData.backup_to_main) {
          payload.backup_to_main = true;
        }
        const created = await api.post<PriorityTask>('/priority-tasks', payload);
        setTasks((prev) => [created, ...prev]);
        toast(
          formData.backup_to_main
            ? 'Priority task created & backed up to Main Task table!'
            : 'Priority task created successfully',
          'success'
        );
      }

      setTaskModalOpen(false);
      setEditingTask(null);
    } catch (e: any) {
      toast(e.message || 'Failed to save priority task', 'error');
    }
  };

  const openCreateModal = () => {
    setEditingTask(null);
    setFormData({
      work_title: '',
      description: '',
      priority: 'medium',
      assignee_type: 'user',
      assignee_user_id: '',
      assignee_name: '',
      status: 'todo',
      due_date: '',
      remarks: '',
      backup_to_main: false,
    });
    setTaskModalOpen(true);
  };

  const openEditModal = (task: PriorityTask) => {
    setEditingTask(task);
    setFormData({
      work_title: task.work_title,
      description: task.description || '',
      priority: task.priority,
      assignee_type: task.assignee_user_id ? 'user' : 'custom',
      assignee_user_id: task.assignee_user_id || '',
      assignee_name: task.assignee_name || '',
      status: task.status,
      due_date: task.due_date ? task.due_date.slice(0, 10) : '',
      remarks: task.remarks || '',
      backup_to_main: false,
    });
    setTaskModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/priority-tasks/${id}`);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      toast('Priority task deleted', 'success');
      setDeleteConfirmId(null);
    } catch (e: any) {
      toast(e.message || 'Failed to delete priority task', 'error');
    }
  };

  // Metrics calculation
  const metrics = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'done').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const critical = tasks.filter((t) => t.priority === 'critical' || t.priority === 'high').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, critical, completionRate };
  }, [tasks]);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-500/20">
              <Flame size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Priority Tasks</h1>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                  {metrics.total} items
                </span>
              </div>
              <p className="text-xs text-ink3 mt-0.5">
                Specialized priority work management & Excel synchronization
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleDownload('/priority-tasks/export/file?format=xlsx', `Priority_Tasks_${new Date().toISOString().slice(0, 10)}.xlsx`, 'export')}
            disabled={downloadingType !== null}
            className="btn btn-secondary text-xs flex items-center gap-1.5"
            title="Export priority tasks to Excel (.xlsx)"
          >
            {downloadingType === 'export' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            <span>Export Excel</span>
          </button>

          {/* Download Template Dropdown Menu */}
          <div className="relative" ref={templateMenuRef}>
            <button
              type="button"
              onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
              disabled={downloadingType !== null}
              className={cx(
                'btn btn-secondary text-xs flex items-center gap-1.5 border-line hover:border-brand/40',
                templateMenuOpen && 'ring-2 ring-brand/30 bg-card2'
              )}
              title="Download formatted Excel or CSV templates"
            >
              {downloadingType && downloadingType.startsWith('template') ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={14} className="text-brand" />
              )}
              <span>Download Template</span>
              <ChevronDown size={13} className={cx('transition-transform duration-200 text-ink3', templateMenuOpen && 'rotate-180')} />
            </button>

            {templateMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 p-1.5 bg-card rounded-xl border border-line shadow-xl z-50 animate-in fade-in zoom-in-95 space-y-1">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink3">
                  Choose Template Format
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTemplateMenuOpen(false);
                    handleDownload('/priority-tasks/template?format=xlsx', 'Priority_Tasks_Template.xlsx', 'template-sample-xlsx');
                  }}
                  className="w-full text-left p-2 rounded-lg hover:bg-card2 text-xs flex items-start gap-2.5 transition-colors"
                >
                  <FileSpreadsheet size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-ink">Excel Template (.xlsx)</div>
                    <div className="text-[11px] text-ink3 leading-tight mt-0.5">Pre-filled with sample tasks & column validations</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTemplateMenuOpen(false);
                    handleDownload('/priority-tasks/template?format=xlsx&blank=true', 'Priority_Tasks_Blank_Template.xlsx', 'template-blank-xlsx');
                  }}
                  className="w-full text-left p-2 rounded-lg hover:bg-card2 text-xs flex items-start gap-2.5 transition-colors"
                >
                  <FileText size={15} className="text-sky-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-ink">Blank Excel Template (.xlsx)</div>
                    <div className="text-[11px] text-ink3 leading-tight mt-0.5">Clean formatted sheet with empty rows ready for entry</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTemplateMenuOpen(false);
                    handleDownload('/priority-tasks/template?format=csv', 'Priority_Tasks_Template.csv', 'template-csv');
                  }}
                  className="w-full text-left p-2 rounded-lg hover:bg-card2 text-xs flex items-start gap-2.5 transition-colors"
                >
                  <Download size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-ink">CSV Template (.csv)</div>
                    <div className="text-[11px] text-ink3 leading-tight mt-0.5">Standard universal comma-separated format</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {isAdmin && (
            <>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setUploadResult(null);
                  setUploadModalOpen(true);
                }}
                className="btn btn-secondary text-xs flex items-center gap-1.5 border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <Upload size={14} />
                <span>Upload Excel</span>
              </button>

              <button
                onClick={openCreateModal}
                className="btn btn-primary text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Plus size={15} />
                <span>New Priority Task</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-ink3 text-xs">
            <span>Total Priority Items</span>
            <Flame size={15} className="text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold">{metrics.total}</span>
            <span className="text-[11px] text-ink3">active queue</span>
          </div>
        </div>

        <div className="card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-ink3 text-xs">
            <span>Critical & High</span>
            <AlertCircle size={15} className="text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{metrics.critical}</span>
            <span className="text-[11px] text-ink3">urgent focus</span>
          </div>
        </div>

        <div className="card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-ink3 text-xs">
            <span>In Progress</span>
            <RefreshCw size={15} className="text-sky-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-sky-600 dark:text-sky-400">{metrics.inProgress}</span>
            <span className="text-[11px] text-ink3">underway</span>
          </div>
        </div>

        <div className="card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-ink3 text-xs">
            <span>Completion Rate</span>
            <CheckCircle2 size={15} className="text-emerald-500" />
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {metrics.completionRate}%
              </span>
              <span className="text-[11px] text-ink3">{metrics.completed} / {metrics.total} done</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                style={{ width: `${metrics.completionRate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="card p-3.5 space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              type="text"
              placeholder="Search work title, description, assignee, remarks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 text-xs w-full"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter Selectors */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="input text-xs py-1.5 px-2.5 h-8 min-w-[110px]"
            >
              <option value="all">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input text-xs py-1.5 px-2.5 h-8 min-w-[110px]"
            >
              <option value="all">All Statuses</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="done">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            {/* Assignee Filter */}
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="input text-xs py-1.5 px-2.5 h-8 min-w-[130px]"
            >
              <option value="all">All Assignees</option>
              <option value="unassigned">Unassigned</option>
              <option value="unmatched">External / Unmatched</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>

            {/* Sort Filter */}
            <div className="flex items-center rounded-lg border border-line overflow-hidden">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="input text-xs py-1 px-2 h-8 border-0 rounded-none bg-transparent"
              >
                <option value="priority">Sort: Priority</option>
                <option value="due_date">Sort: Due Date</option>
                <option value="status">Sort: Status</option>
                <option value="work_title">Sort: Work Title</option>
                <option value="created_at">Sort: Created Date</option>
              </select>
              <button
                onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                className="px-2 py-1 bg-card2 hover:bg-line text-ink2 border-l border-line h-8 flex items-center justify-center"
                title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
              >
                <ArrowUpDown size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Selection Action Bar (Displayed when items are selected) */}
      {selectedIds.size > 0 && (
        <div className="p-3.5 bg-brand/10 border-2 border-brand/40 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-brand text-white text-xs font-bold shrink-0 shadow-xs">
              {selectedIds.size}
            </span>
            <div>
              <div className="font-bold text-xs text-ink flex items-center gap-1.5">
                <span>{selectedIds.size} {selectedIds.size === 1 ? 'task marked' : 'tasks marked'} for transfer to Main Task Table</span>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-ink2 mt-0.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeRemarksInTransfer}
                  onChange={(e) => setIncludeRemarksInTransfer(e.target.checked)}
                  className="checkbox checkbox-sm"
                />
                <span>Include remarks timeline as task comments during backup</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="btn btn-secondary text-xs px-2.5 py-1.5"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={handleTransferSelected}
              disabled={transferring}
              className="btn btn-primary text-xs flex items-center gap-1.5 px-3.5 py-1.5 shadow-sm disabled:opacity-50"
            >
              {transferring ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <DatabaseBackup size={14} />
              )}
              <span>Transfer Selected ({selectedIds.size}) to Main Tasks</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Task List Table */}
      {loading ? (
        <div className="card p-12 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-xs text-ink3">Loading priority tasks...</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-card2 text-ink3 flex items-center justify-center mx-auto">
            <Flame size={28} />
          </div>
          <div>
            <h3 className="font-bold text-sm">No priority tasks found</h3>
            <p className="text-xs text-ink3 max-w-sm mx-auto mt-1">
              {search || priorityFilter !== 'all' || statusFilter !== 'all'
                ? 'Try adjusting your filters or search query.'
                : isAdmin
                ? 'Upload an Excel spreadsheet or add priority tasks to track them here.'
                : 'No priority tasks have been added yet.'}
            </p>
          </div>
          {isAdmin && (
            <div className="flex justify-center gap-2 pt-2">
              <button
                onClick={() => setUploadModalOpen(true)}
                className="btn btn-secondary text-xs flex items-center gap-1.5"
              >
                <Upload size={14} />
                <span>Upload Excel</span>
              </button>
              <button
                onClick={openCreateModal}
                className="btn btn-primary text-xs flex items-center gap-1.5"
              >
                <Plus size={14} />
                <span>New Priority Task</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line bg-card2/60 text-ink3 font-semibold uppercase tracking-wider text-[10px]">
                  {/* Select Checkbox Column Header */}
                  <th className="py-3 px-3.5 w-[44px] text-center">
                    <input
                      type="checkbox"
                      checked={tasks.length > 0 && selectedIds.size === tasks.length}
                      onChange={handleSelectAll}
                      className="checkbox cursor-pointer"
                      title={selectedIds.size === tasks.length ? 'Deselect all' : 'Select all priority tasks'}
                    />
                  </th>
                  <th className="py-3 px-4 w-[110px]">Priority</th>
                  <th className="py-3 px-4 min-w-[240px]">Work Title & Description</th>
                  <th className="py-3 px-4 w-[190px]">Assignee</th>
                  <th className="py-3 px-4 w-[160px]">Status (Tracking)</th>
                  <th className="py-3 px-4 w-[120px]">Due Date</th>
                  <th className="py-3 px-4 min-w-[160px]">Remarks</th>
                  <th className="py-3 px-4 text-right w-[110px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tasks.map((task) => {
                  const prio = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                  const stat = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;
                  const StatIcon = stat.icon;
                  const isSelected = selectedIds.has(task.id);

                  return (
                    <tr
                      key={task.id}
                      className={cx(
                        'hover:bg-card2/50 transition-colors group',
                        isSelected ? 'bg-brand/[0.04] dark:bg-brand/[0.08]' : '',
                        task.status === 'done' ? 'bg-emerald-500/[0.03] dark:bg-emerald-950/[0.08]' : ''
                      )}
                    >
                      {/* Checkbox Column */}
                      <td className="py-3.5 px-3.5 align-top text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectTask(task.id)}
                          className="checkbox cursor-pointer mt-1"
                          title={isSelected ? 'Deselect task' : 'Mark for transfer/backup to Main Tasks'}
                        />
                      </td>

                      {/* Priority Column */}
                      <td className="py-3.5 px-4 align-top">
                        <span
                          className={cx(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border shadow-xs transition-transform',
                            prio.bg,
                            prio.color,
                            prio.border
                          )}
                        >
                          <span className={cx('w-2 h-2 rounded-full shrink-0', prio.dot)} />
                          <span>{prio.label}</span>
                        </span>
                      </td>

                      {/* Work Title & Description */}
                      <td className="py-3.5 px-4 align-top">
                        <div
                          onClick={() => {
                            setSelectedTask(task);
                            setDetailModalOpen(true);
                          }}
                          className="cursor-pointer group/title"
                        >
                          <div className="flex items-start gap-1.5 flex-wrap">
                            <span className="font-bold text-ink group-hover/title:text-brand transition-colors text-xs leading-snug">
                              {task.work_title}
                            </span>
                            {task.transferred_to_task_id && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-700 shrink-0"
                                title={`Backed up to Main Task #${task.transferred_to_task_id}${task.transferred_at ? ` on ${fmtDate(task.transferred_at)}` : ''}`}
                              >
                                <DatabaseBackup size={10} />
                                <span>Main Task #{task.transferred_to_task_id}</span>
                              </span>
                            )}
                            {task.status === 'done' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-700 shrink-0">
                                <Check size={10} strokeWidth={3} />
                                <span>Done</span>
                              </span>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-[11px] text-ink2 line-clamp-2 mt-1 leading-relaxed">
                              {task.description}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Assignee Column (Matched user or plain text from Excel) */}
                      <td className="py-3.5 px-4 align-top">
                        {task.assignee_user_id || task.assignee_user_name ? (
                          <div className="flex items-center gap-2">
                            <Avatar
                              name={task.assignee_user_name || task.assignee_name}
                              src={task.assignee_user_avatar}
                              size={28}
                            />
                            <div className="min-w-0">
                              <div className="font-bold text-[11px] truncate flex items-center gap-1 text-ink">
                                <span>{task.assignee_user_name || task.assignee_name}</span>
                                <span title="Verified system user" className="text-emerald-600 dark:text-emerald-400">
                                  <Check size={12} strokeWidth={3} />
                                </span>
                              </div>
                              {task.assignee_user_title && (
                                <div className="text-[10px] text-ink3 truncate leading-none mt-0.5 font-medium">
                                  {task.assignee_user_title}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : task.assignee_name ? (
                          <div className="flex items-center gap-2 text-ink">
                            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-card2 border border-line flex items-center justify-center text-ink2 shrink-0">
                              <User size={13} />
                            </div>
                            <div className="min-w-0">
                              <span className="font-bold text-[11px] truncate block text-ink">
                                {task.assignee_name}
                              </span>
                              <span className="text-[9px] text-ink3 font-semibold uppercase tracking-wider block">
                                External
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-card2 text-ink3 border border-line text-[11px] font-medium">
                            <User size={11} className="opacity-40" />
                            <span>Unassigned</span>
                          </span>
                        )}
                      </td>

                      {/* Status Tracker (Editable directly by ALL logged-in users) */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="relative inline-block w-full">
                          <select
                            value={task.status}
                            onChange={(e) => handleStatusChange(task.id, e.target.value)}
                            className={cx(
                              'text-xs font-bold px-3 py-1.5 rounded-lg border appearance-none w-full cursor-pointer pr-7 transition-all shadow-xs',
                              stat.bg,
                              stat.color,
                              stat.border,
                              'hover:brightness-95 focus:ring-2 focus:ring-brand/30 focus:outline-hidden'
                            )}
                          >
                            <option value="todo" className="bg-card text-ink font-semibold">To Do</option>
                            <option value="in_progress" className="bg-card text-ink font-semibold">In Progress</option>
                            <option value="in_review" className="bg-card text-ink font-semibold">In Review</option>
                            <option value="done" className="bg-card text-ink font-semibold">Completed</option>
                            <option value="cancelled" className="bg-card text-ink font-semibold">Cancelled</option>
                          </select>
                          <ChevronDown
                            size={13}
                            className={cx(
                              'absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none stroke-[2.5]',
                              stat.color
                            )}
                          />
                        </div>
                      </td>

                      {/* Due Date */}
                      <td className="py-3.5 px-4 align-top text-[11px]">
                        {task.due_date ? (
                          <div className="flex items-center gap-1 font-semibold text-ink2">
                            <Calendar size={12} className="text-ink3" />
                            <span>{fmtDate(task.due_date)}</span>
                          </div>
                        ) : (
                          <span className="text-ink3 font-medium">—</span>
                        )}
                      </td>

                      {/* Remarks (Interactive Multi-Remark Timeline for all users) */}
                      <td className="py-3.5 px-4 align-top">
                        {task.remarks_list && task.remarks_list.length > 0 ? (
                          <div
                            onClick={() => openRemarksModal(task)}
                            className="group/rem cursor-pointer p-2 -m-1 rounded-lg hover:bg-amber-500/10 transition-all border border-amber-500/30 bg-amber-500/[0.06] shadow-xs"
                            title="Click to view full remarks timeline and add updates"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold text-[10px] bg-amber-500/20 text-amber-950 dark:text-amber-200 border border-amber-500/40">
                                  <MessageSquare size={11} className="text-amber-700 dark:text-amber-400" />
                                  <span>{task.remarks_list.length} {task.remarks_list.length === 1 ? 'Remark' : 'Remarks'}</span>
                                </span>
                                <Edit3
                                  size={11}
                                  className="text-amber-700 dark:text-amber-400 opacity-60 group-hover/rem:opacity-100 transition-opacity"
                                />
                              </div>
                              <p className="text-[11px] text-ink font-medium line-clamp-2 max-w-[220px] leading-relaxed">
                                {task.remarks_list[task.remarks_list.length - 1].remark}
                              </p>
                              <div className="text-[10px] text-ink3 flex items-center gap-1.5 pt-0.5">
                                <span className="font-semibold text-ink2">{task.remarks_list[task.remarks_list.length - 1].user_name || 'User'}</span>
                                <span>•</span>
                                <span>{fmtDate(task.remarks_list[task.remarks_list.length - 1].created_at)}</span>
                              </div>
                            </div>
                          </div>
                        ) : task.remarks ? (
                          <div
                            onClick={() => openRemarksModal(task)}
                            className="group/rem cursor-pointer p-2 -m-1 rounded-lg hover:bg-amber-500/10 transition-all border border-amber-500/30 bg-amber-500/[0.06] shadow-xs"
                            title="Click to view or add remarks"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold text-[10px] bg-amber-500/20 text-amber-950 dark:text-amber-200 border border-amber-500/40">
                                  <MessageSquare size={11} className="text-amber-700 dark:text-amber-400" />
                                  <span>1 Remark</span>
                                </span>
                                <Edit3
                                  size={11}
                                  className="text-amber-700 dark:text-amber-400 opacity-60 group-hover/rem:opacity-100 transition-opacity"
                                />
                              </div>
                              <p className="text-[11px] text-ink font-medium line-clamp-2 max-w-[220px] leading-relaxed">
                                {task.remarks}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openRemarksModal(task)}
                            className="text-[11px] font-bold text-ink2 hover:text-brand bg-card hover:bg-brand/10 border border-line hover:border-brand/40 px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 transition-all shadow-xs"
                            title="Add remarks / progress note"
                          >
                            <MessageSquarePlus size={13} className="text-brand" />
                            <span>+ Remark</span>
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Transfer / Backup Button */}
                          <button
                            onClick={() => handleTransferSingle(task.id)}
                            disabled={transferring}
                            className={cx(
                              'p-1.5 rounded-lg transition-colors border',
                              task.transferred_to_task_id
                                ? 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100/80 dark:hover:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800'
                                : 'text-brand hover:text-brand-hover hover:bg-brand/10 border-transparent hover:border-brand/30'
                            )}
                            title={
                              task.transferred_to_task_id
                                ? `Backed up to Main Task #${task.transferred_to_task_id}. Click to re-sync / update backup.`
                                : 'Transfer & Backup to Main Task Table'
                            }
                          >
                            <DatabaseBackup size={15} />
                          </button>

                          <button
                            onClick={() => openRemarksModal(task)}
                            className="p-1.5 text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-100/80 dark:hover:bg-amber-950/50 rounded-lg transition-colors border border-transparent hover:border-amber-300"
                            title="Update Status & Remarks"
                          >
                            <MessageSquare size={15} />
                          </button>

                          <button
                            onClick={() => {
                              setSelectedTask(task);
                              setDetailModalOpen(true);
                            }}
                            className="p-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-100/80 dark:hover:bg-blue-950/50 rounded-lg transition-colors border border-transparent hover:border-blue-300"
                            title="View Details"
                          >
                            <Eye size={15} />
                          </button>

                          {isAdmin && (
                            <>
                              <button
                                onClick={() => openEditModal(task)}
                                className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100/80 dark:hover:bg-indigo-950/50 rounded-lg transition-colors border border-transparent hover:border-indigo-300"
                                title="Edit Priority Task"
                              >
                                <Edit3 size={15} />
                              </button>

                              <button
                                onClick={() => setDeleteConfirmId(task.id)}
                                className="p-1.5 text-rose-500 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-100/80 dark:hover:bg-rose-950/50 rounded-lg transition-colors border border-transparent hover:border-rose-300"
                                title="Delete Task"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EXCEL UPLOAD MODAL (Admin Only) */}
      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title={
          <div className="flex items-center gap-2 text-sm font-bold">
            <Upload size={18} className="text-brand" />
            <span>Upload Priority Tasks Excel</span>
          </div>
        }
        width={580}
      >
        <form onSubmit={handleFileUpload} className="space-y-4">
          <div className="p-3.5 bg-brand/5 border border-brand/20 rounded-xl text-xs space-y-2">
            <div className="font-semibold text-brand flex items-center gap-1.5">
              <Sparkles size={14} />
              <span>Priority Sheet Guidelines & Smart Column Mapping</span>
            </div>
            <p className="text-ink2 leading-relaxed text-[11px]">
              Uploaded tasks appear <strong>exclusively in this Priority Task menu</strong> and will not mix with the general task list.
              Assignee names will be automatically matched to registered system users.
            </p>
            <div className="text-[11px] text-ink3 bg-card/70 p-2 rounded-lg border border-line flex flex-wrap gap-x-2 gap-y-1">
              <span className="font-semibold text-ink">Supported Columns:</span>
              <span><strong className="text-ink2">SL / Serial No</strong> (optional)</span>
              <span>• <strong className="text-ink2">Work Title</strong> (Required)</span>
              <span>• <strong className="text-ink2">Description</strong></span>
              <span>• <strong className="text-ink2">Priority</strong></span>
              <span>• <strong className="text-ink2">Assignee</strong></span>
              <span>• <strong className="text-ink2">Status</strong></span>
              <span>• <strong className="text-ink2">Due Date</strong></span>
              <span>• <strong className="text-ink2">Remarks</strong></span>
            </div>
          </div>

          {/* File Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={cx(
              'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
              selectedFile
                ? 'border-brand bg-brand/5'
                : 'border-line hover:border-brand/50 hover:bg-card2/50'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
              }}
            />

            {selectedFile ? (
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center mx-auto">
                  <FileSpreadsheet size={22} />
                </div>
                <div>
                  <div className="font-bold text-xs text-ink">{selectedFile.name}</div>
                  <div className="text-[11px] text-ink3">
                    {(selectedFile.size / 1024).toFixed(1)} KB • Ready to parse
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="text-xs text-rose-500 hover:underline pt-1"
                >
                  Remove & pick another
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-card2 text-ink3 flex items-center justify-center mx-auto">
                  <Upload size={20} />
                </div>
                <div>
                  <div className="font-semibold text-xs text-ink">
                    Click to browse or drag & drop Excel file
                  </div>
                  <div className="text-[11px] text-ink3 mt-0.5">
                    Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Replace Existing Option */}
          <div className="card p-3 bg-card2/50 flex items-start gap-3">
            <div className="pt-0.5">
              <Switch
                checked={replaceExisting}
                onChange={setReplaceExisting}
              />
            </div>
            <div className="flex-1 text-xs">
              <label className="font-semibold text-ink cursor-pointer" onClick={() => setReplaceExisting(!replaceExisting)}>
                Replace existing Priority Tasks
              </label>
              <p className="text-[11px] text-ink3 mt-0.5">
                {replaceExisting
                  ? 'All existing priority tasks will be erased and replaced by this sheet.'
                  : 'New tasks from this sheet will be appended to your current priority list.'}
              </p>
            </div>
          </div>

          {/* Backup To Main Task Option */}
          <div className="card p-3 bg-brand/5 border border-brand/20 flex items-start gap-3">
            <div className="pt-0.5">
              <Switch
                checked={backupToMainInUpload}
                onChange={setBackupToMainInUpload}
              />
            </div>
            <div className="flex-1 text-xs">
              <label className="font-semibold text-ink cursor-pointer flex items-center gap-1.5" onClick={() => setBackupToMainInUpload(!backupToMainInUpload)}>
                <DatabaseBackup size={14} className="text-brand" />
                <span>Backup to Main Task Table</span>
              </label>
              <p className="text-[11px] text-ink3 mt-0.5">
                Automatically mark and transfer all uploaded tasks into the primary task table to guarantee full database backup.
              </p>
            </div>
          </div>

          {/* Download Template Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-line text-xs">
            <span className="text-ink3 text-[11px]">Need the formatted column layout?</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleDownload('/priority-tasks/template?format=xlsx', 'Priority_Tasks_Template.xlsx', 'modal-template-xlsx')}
                disabled={downloadingType !== null}
                className="btn btn-secondary py-1 px-2 text-brand hover:text-brand-hover font-medium text-[11px] flex items-center gap-1.5"
                title="Download Excel (.xlsx) Template with sample tasks"
              >
                {downloadingType === 'modal-template-xlsx' ? <RefreshCw size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                <span>Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownload('/priority-tasks/template?format=xlsx&blank=true', 'Priority_Tasks_Blank_Template.xlsx', 'modal-template-blank')}
                disabled={downloadingType !== null}
                className="btn btn-secondary py-1 px-2 text-sky-600 dark:text-sky-400 font-medium text-[11px] flex items-center gap-1.5"
                title="Download Blank Excel (.xlsx) Template"
              >
                {downloadingType === 'modal-template-blank' ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
                <span>Blank Excel</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownload('/priority-tasks/template?format=csv', 'Priority_Tasks_Template.csv', 'modal-template-csv')}
                disabled={downloadingType !== null}
                className="btn btn-secondary py-1 px-2 text-ink2 hover:text-ink font-medium text-[11px] flex items-center gap-1.5"
                title="Download CSV Template (.csv)"
              >
                {downloadingType === 'modal-template-csv' ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
                <span>CSV (.csv)</span>
              </button>
            </div>
          </div>

          {/* Upload Result Feedback */}
          {uploadResult && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs space-y-2">
              <div className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={16} />
                <span>Upload Complete: {uploadResult.count} items imported</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-ink2">
                <div>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {uploadResult.matchedCount}
                  </span> matched to system users
                </div>
                <div>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {uploadResult.unmatchedCount}
                  </span> external/unmatched names
                </div>
              </div>
              {uploadResult.matchedUsers.length > 0 && (
                <div className="text-[10px] text-ink3">
                  <strong>Matched Users:</strong> {uploadResult.matchedUsers.slice(0, 5).join(', ')}
                  {uploadResult.matchedUsers.length > 5 && ` (+${uploadResult.matchedUsers.length - 5} more)`}
                </div>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={() => setUploadModalOpen(false)}
              className="btn btn-secondary text-xs"
            >
              {uploadResult ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={!selectedFile || uploading}
              className="btn btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Upload size={14} />
                  <span>Import Sheet</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* CREATE / EDIT TASK MODAL (Admin Only) */}
      <Modal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        title={
          <div className="flex items-center gap-2 text-sm font-bold">
            <Flame size={18} className="text-brand" />
            <span>{editingTask ? 'Edit Priority Task' : 'New Priority Task'}</span>
          </div>
        }
        width={560}
      >
        <form onSubmit={handleSaveTask} className="space-y-3.5 text-xs">
          {/* Work Title */}
          <div>
            <label className="block font-semibold mb-1">
              Work Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Critical Server Migration & Patching"
              value={formData.work_title}
              onChange={(e) => setFormData({ ...formData, work_title: e.target.value })}
              className="input text-xs w-full font-medium"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-semibold mb-1">Description</label>
            <textarea
              rows={2}
              placeholder="Detailed instructions or scope of work..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input text-xs w-full resize-none"
            />
          </div>

          {/* Priority & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                className="input text-xs w-full"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="input text-xs w-full"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Assignee Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-semibold">Assignee (Person Responsible)</label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, assignee_type: 'user', assignee_name: '' })}
                  className={cx(
                    'px-2 py-0.5 rounded transition-all',
                    formData.assignee_type === 'user' ? 'bg-brand text-white font-semibold' : 'text-ink3 hover:text-ink'
                  )}
                >
                  System User
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, assignee_type: 'custom', assignee_user_id: '' })}
                  className={cx(
                    'px-2 py-0.5 rounded transition-all',
                    formData.assignee_type === 'custom' ? 'bg-brand text-white font-semibold' : 'text-ink3 hover:text-ink'
                  )}
                >
                  Custom Name
                </button>
              </div>
            </div>

            {formData.assignee_type === 'user' ? (
              <select
                value={formData.assignee_user_id}
                onChange={(e) => setFormData({ ...formData, assignee_user_id: e.target.value })}
                className="input text-xs w-full"
              >
                <option value="">-- Select Registered User --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role || u.email})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="Enter person name or external contact..."
                value={formData.assignee_name}
                onChange={(e) => setFormData({ ...formData, assignee_name: e.target.value })}
                className="input text-xs w-full"
              >
              </input>
            )}
          </div>

          {/* Due Date */}
          <div>
            <label className="block font-semibold mb-1">Due Date</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="input text-xs w-full"
            />
          </div>

          {/* Remarks */}
          <div>
            <label className="block font-semibold mb-1">Remarks (Optional)</label>
            <textarea
              rows={2}
              placeholder="Any additional notes or delivery requirements..."
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="input text-xs w-full resize-none"
            />
          </div>

          {/* Backup to Main Task Table Option (Create Mode only) */}
          {!editingTask && (
            <div className="p-3 bg-brand/5 border border-brand/20 rounded-xl">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.backup_to_main}
                  onChange={(e) => setFormData({ ...formData, backup_to_main: e.target.checked })}
                  className="checkbox checkbox-sm mt-0.5"
                />
                <div className="text-xs">
                  <span className="font-semibold text-ink flex items-center gap-1.5">
                    <DatabaseBackup size={13} className="text-brand" />
                    <span>Transfer & Backup to Main Task Table</span>
                  </span>
                  <span className="text-[11px] text-ink3 block mt-0.5">
                    Automatically creates an identical synchronized task in the primary task table so it is backed up.
                  </span>
                </div>
              </label>
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={() => setTaskModalOpen(false)}
              className="btn btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary text-xs"
            >
              {editingTask ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </Modal>

      {/* DETAIL MODAL (All Users) */}
      <Modal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={
          <div className="flex items-center gap-2 text-sm font-bold">
            <FileText size={18} className="text-brand" />
            <span>Priority Task Details</span>
          </div>
        }
        width={560}
      >
        {selectedTask && (
          <div className="space-y-4 text-xs">
            {/* Header info */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                {selectedTask.task_code && (
                  <span className="text-[11px] font-mono font-bold text-ink2 bg-card2 border border-line rounded px-1.5 py-0.5" title="Permanent Task ID">
                    {selectedTask.task_code}
                  </span>
                )}
                {(() => {
                  const p = PRIORITY_CONFIG[selectedTask.priority] || PRIORITY_CONFIG.medium;
                  return (
                    <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold text-[11px] border', p.bg, p.color, p.border)}>
                      <span className={cx('w-1.5 h-1.5 rounded-full', p.dot)} />
                      {p.label} Priority
                    </span>
                  );
                })()}
                {selectedTask.due_date && (
                  <span className="text-ink3 text-[11px] flex items-center gap-1">
                    <Calendar size={12} />
                    Due {fmtDate(selectedTask.due_date)}
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-ink leading-snug">
                {selectedTask.work_title}
              </h2>
            </div>

            {/* Description */}
            {selectedTask.description ? (
              <div className="p-3 bg-card2/60 rounded-xl">
                <div className="text-[11px] font-semibold text-ink3 uppercase tracking-wider mb-1">
                  Description / Scope
                </div>
                <p className="text-xs text-ink whitespace-pre-wrap leading-relaxed">
                  {selectedTask.description}
                </p>
              </div>
            ) : null}

            {/* Status Tracking Selector (Interactive for all users) */}
            <div className="p-3.5 card bg-card2/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">Completion Status Tracking</span>
                <span className="text-[10px] text-ink3">Available to all users</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(['todo', 'in_progress', 'done'] as const).map((stKey) => {
                  const conf = STATUS_CONFIG[stKey];
                  const Icon = conf.icon;
                  const active = selectedTask.status === stKey;
                  return (
                    <button
                      key={stKey}
                      type="button"
                      onClick={() => handleStatusChange(selectedTask.id, stKey)}
                      className={cx(
                        'p-2.5 rounded-xl border flex items-center justify-between font-bold text-xs transition-all',
                        active
                          ? `${conf.bg} ${conf.color} ${conf.border} shadow-sm ring-2 ring-brand/40`
                          : 'bg-card border-line text-ink2 hover:bg-card2'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={active ? conf.color : 'text-ink3'} />
                        <span>{conf.label}</span>
                      </div>
                      {active && <span className={cx('w-2 h-2 rounded-full', conf.badge)} />}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {(['in_review', 'cancelled'] as const).map((stKey) => {
                  const conf = STATUS_CONFIG[stKey];
                  const Icon = conf.icon;
                  const active = selectedTask.status === stKey;
                  return (
                    <button
                      key={stKey}
                      type="button"
                      onClick={() => handleStatusChange(selectedTask.id, stKey)}
                      className={cx(
                        'p-2.5 rounded-xl border flex items-center justify-between font-bold text-xs transition-all',
                        active
                          ? `${conf.bg} ${conf.color} ${conf.border} shadow-sm ring-2 ring-brand/40`
                          : 'bg-card border-line text-ink2 hover:bg-card2'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={active ? conf.color : 'text-ink3'} />
                        <span>{conf.label}</span>
                      </div>
                      {active && <span className={cx('w-2 h-2 rounded-full', conf.badge)} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Assignee Card */}
            <div className="p-3 card bg-card2/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar
                  name={selectedTask.assignee_user_name || selectedTask.assignee_name}
                  src={selectedTask.assignee_user_avatar}
                  size={36}
                />
                <div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-ink3">
                    Assigned Person
                  </div>
                  <div className="font-bold text-xs text-ink flex items-center gap-1.5 mt-0.5">
                    <span>{selectedTask.assignee_user_name || selectedTask.assignee_name || 'Unassigned'}</span>
                    {selectedTask.assignee_user_id && (
                      <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        System User
                      </span>
                    )}
                  </div>
                  {selectedTask.assignee_user_email && (
                    <div className="text-[11px] text-ink3">{selectedTask.assignee_user_email}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Remarks & History Timeline (All remarks preserved) */}
            <div className="p-3.5 card bg-card2/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  <MessageSquare size={14} className="text-amber-500" />
                  <span>Remarks & Activity Log ({selectedTask.remarks_list?.length || (selectedTask.remarks ? 1 : 0)})</span>
                </div>
                <span className="text-[10px] text-ink3">Append-only history</span>
              </div>

              {/* List of historical remarks */}
              {selectedTask.remarks_list && selectedTask.remarks_list.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {selectedTask.remarks_list.map((rem, idx) => (
                    <div
                      key={rem.id || idx}
                      className="p-2.5 bg-card rounded-xl border border-line text-ink leading-relaxed space-y-1 group/item"
                    >
                      <div className="flex items-center justify-between text-[10px] text-ink3">
                        <div className="flex items-center gap-1.5">
                          <Avatar name={rem.user_name || 'User'} src={rem.user_avatar} size={18} />
                          <span className="font-semibold text-ink2">{rem.user_name || 'User'}</span>
                          {rem.user_role && (
                            <span className="px-1 py-0.2 rounded bg-card2 border border-line text-[9px] uppercase tracking-wider">
                              {rem.user_role}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{fmtDate(rem.created_at)}</span>
                          {(isAdmin || (user && user.id === rem.user_id)) && rem.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRemark(selectedTask.id, rem.id)}
                              className="text-ink3 hover:text-rose-500 opacity-0 group-hover/item:opacity-100 transition-opacity p-0.5"
                              title="Delete this remark"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-ink whitespace-pre-wrap pl-6">{rem.remark}</p>
                    </div>
                  ))}
                </div>
              ) : selectedTask.remarks ? (
                <div className="p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl text-ink leading-relaxed">
                  <p className="text-xs whitespace-pre-wrap">{selectedTask.remarks}</p>
                </div>
              ) : (
                <div className="p-3 border border-dashed border-line rounded-xl text-center text-[11px] text-ink3">
                  No remarks recorded yet. Add the first remark below.
                </div>
              )}

              {/* Add New Remark box (Always visible, easy to post) */}
              <div className="pt-2 border-t border-line space-y-2">
                <label className="block text-[11px] font-semibold text-ink2">
                  + Add New Remark (Optional)
                </label>
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    placeholder="Type a new remark, progress update, or blocker (will not replace past remarks)..."
                    value={detailRemarksInput}
                    onChange={(e) => setDetailRemarksInput(e.target.value)}
                    className="input text-xs w-full resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleSaveDetailRemarks(selectedTask.id);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveDetailRemarks(selectedTask.id)}
                    disabled={savingDetailRemarks || !detailRemarksInput.trim()}
                    className="btn btn-primary text-xs px-3.5 flex flex-col items-center justify-center gap-1 shrink-0 self-stretch disabled:opacity-50"
                    title="Add remark (Ctrl+Enter)"
                  >
                    <Send size={13} />
                    <span className="text-[10px]">{savingDetailRemarks ? 'Posting...' : 'Post'}</span>
                  </button>
                </div>
                <div className="text-[10px] text-ink3">
                  Tip: All remarks are kept permanently in the timeline. Press Ctrl+Enter to post quickly.
                </div>
              </div>
            </div>

            {/* Main Task Backup & Transfer Section */}
            <div className="p-3.5 card bg-card2/40 border border-line rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-xs text-ink">
                  <DatabaseBackup size={15} className="text-brand" />
                  <span>Main Task Table Backup</span>
                </div>
                {selectedTask.transferred_to_task_id ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] bg-indigo-100 text-indigo-800 border border-indigo-300 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-700">
                    <CheckCircle2 size={11} />
                    <span>Backed Up (Task #{selectedTask.transferred_to_task_id})</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-[10px] bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700">
                    <span>Not Yet Backed Up</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-ink2 leading-relaxed">
                {selectedTask.transferred_to_task_id ? (
                  <>
                    This priority task is transferred to the primary tasks management system as <strong>Task #{selectedTask.transferred_to_task_id}</strong>
                    {selectedTask.transferred_at && ` on ${fmtDate(selectedTask.transferred_at)}`}.
                  </>
                ) : (
                  'Transferring creates a permanent backup record in the primary task table and copies all assignee linkages and remarks.'
                )}
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => handleTransferSingle(selectedTask.id)}
                  disabled={transferring}
                  className="btn btn-secondary text-xs flex items-center gap-1.5 border-brand/40 text-brand hover:bg-brand/10 disabled:opacity-50"
                >
                  {transferring ? <RefreshCw size={13} className="animate-spin" /> : <DatabaseBackup size={13} />}
                  <span>{selectedTask.transferred_to_task_id ? 'Re-sync / Re-transfer to Main Tasks' : 'Transfer & Backup to Main Tasks Table'}</span>
                </button>
              </div>
            </div>

            {/* Timestamps */}
            <div className="flex items-center justify-between text-[11px] text-ink3 pt-2 border-t border-line">
              <span>Created {fmtDate(selectedTask.created_at)}</span>
              <span>Updated {fmtDate(selectedTask.updated_at)}</span>
            </div>

            {/* Footer buttons */}
            <div className="flex justify-between items-center pt-2 border-t border-line">
              {isAdmin ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setDetailModalOpen(false);
                      openEditModal(selectedTask);
                    }}
                    className="btn btn-secondary text-xs flex items-center gap-1"
                  >
                    <Edit3 size={13} />
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={() => {
                      setDetailModalOpen(false);
                      setDeleteConfirmId(selectedTask.id);
                    }}
                    className="btn btn-secondary text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                </div>
              ) : <div />}

              <button
                onClick={() => setDetailModalOpen(false)}
                className="btn btn-primary text-xs"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* QUICK STATUS & REMARKS MODAL (Available to all users) */}
      <Modal
        open={remarksModalOpen}
        onClose={() => setRemarksModalOpen(false)}
        title={
          <div className="flex items-center gap-2 text-sm font-bold">
            <MessageSquare size={18} className="text-brand" />
            <span>Task Remarks & Tracking Timeline</span>
          </div>
        }
        width={540}
      >
        {remarksTask && (
          <form onSubmit={handleSaveRemarksModal} className="space-y-4 text-xs">
            {/* Task summary header */}
            <div className="p-3 bg-card2/60 rounded-xl space-y-1">
              <div className="flex items-center gap-2">
                {(() => {
                  const p = PRIORITY_CONFIG[remarksTask.priority] || PRIORITY_CONFIG.medium;
                  return (
                    <span className={cx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border', p.bg, p.color, p.border)}>
                      <span className={cx('w-1.5 h-1.5 rounded-full', p.dot)} />
                      {p.label}
                    </span>
                  );
                })()}
                {remarksTask.due_date && (
                  <span className="text-[11px] text-ink3 flex items-center gap-1">
                    <Calendar size={11} />
                    Due {fmtDate(remarksTask.due_date)}
                  </span>
                )}
              </div>
              <div className="font-bold text-sm text-ink">{remarksTask.work_title}</div>
              {remarksTask.assignee_name && (
                <div className="text-[11px] text-ink3">
                  Assignee: <strong className="text-ink2">{remarksTask.assignee_name}</strong>
                </div>
              )}
            </div>

            {/* Existing Remarks Timeline */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block font-semibold text-ink">
                  Remarks History ({remarksTask.remarks_list?.length || (remarksTask.remarks ? 1 : 0)})
                </label>
                <span className="text-[10px] text-ink3">Chronological log (all remarks shown)</span>
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {remarksTask.remarks_list && remarksTask.remarks_list.length > 0 ? (
                  remarksTask.remarks_list.map((rem, idx) => (
                    <div
                      key={rem.id || idx}
                      className="p-2.5 bg-card2/50 rounded-xl border border-line text-ink leading-relaxed space-y-1 group/remitem"
                    >
                      <div className="flex items-center justify-between text-[10px] text-ink3">
                        <div className="flex items-center gap-1.5">
                          <Avatar name={rem.user_name || 'User'} src={rem.user_avatar} size={18} />
                          <span className="font-semibold text-ink2">{rem.user_name || 'User'}</span>
                          {rem.user_role && (
                            <span className="px-1 py-0.2 rounded bg-card border border-line text-[9px] uppercase tracking-wider">
                              {rem.user_role}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{fmtDate(rem.created_at)}</span>
                          {(isAdmin || (user && user.id === rem.user_id)) && rem.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRemark(remarksTask.id, rem.id)}
                              className="text-ink3 hover:text-rose-500 opacity-0 group-hover/remitem:opacity-100 transition-opacity p-0.5"
                              title="Delete this remark"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-ink whitespace-pre-wrap pl-6">{rem.remark}</p>
                    </div>
                  ))
                ) : remarksTask.remarks ? (
                  <div className="p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl text-ink leading-relaxed">
                    <p className="text-xs whitespace-pre-wrap">{remarksTask.remarks}</p>
                  </div>
                ) : (
                  <div className="p-3 border border-dashed border-line rounded-xl text-center text-[11px] text-ink3">
                    No previous remarks. Add a new remark below.
                  </div>
                )}
              </div>
            </div>

            {/* Status Selector */}
            <div className="space-y-1.5 pt-1 border-t border-line">
              <label className="block font-semibold">Update Status (Optional)</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(['todo', 'in_progress', 'done'] as const).map((stKey) => {
                  const conf = STATUS_CONFIG[stKey];
                  const Icon = conf.icon;
                  const active = remarksStatus === stKey;
                  return (
                    <button
                      key={stKey}
                      type="button"
                      onClick={() => setRemarksStatus(stKey)}
                      className={cx(
                        'p-2.5 rounded-xl border flex items-center justify-between font-bold text-xs transition-all',
                        active
                          ? `${conf.bg} ${conf.color} ${conf.border} shadow-sm ring-2 ring-brand/40`
                          : 'bg-card border-line text-ink2 hover:bg-card2'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={active ? conf.color : 'text-ink3'} />
                        <span>{conf.label}</span>
                      </div>
                      {active && <span className={cx('w-2 h-2 rounded-full', conf.badge)} />}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {(['in_review', 'cancelled'] as const).map((stKey) => {
                  const conf = STATUS_CONFIG[stKey];
                  const Icon = conf.icon;
                  const active = remarksStatus === stKey;
                  return (
                    <button
                      key={stKey}
                      type="button"
                      onClick={() => setRemarksStatus(stKey)}
                      className={cx(
                        'p-2.5 rounded-xl border flex items-center justify-between font-bold text-xs transition-all',
                        active
                          ? `${conf.bg} ${conf.color} ${conf.border} shadow-sm ring-2 ring-brand/40`
                          : 'bg-card border-line text-ink2 hover:bg-card2'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={active ? conf.color : 'text-ink3'} />
                        <span>{conf.label}</span>
                      </div>
                      {active && <span className={cx('w-2 h-2 rounded-full', conf.badge)} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Add New Remark (Optional) */}
            <div className="space-y-1.5 pt-1 border-t border-line">
              <div className="flex items-center justify-between">
                <label className="block font-semibold">+ Add New Remark (Optional)</label>
                <span className="text-[10px] text-brand">Appended to history, nothing replaced</span>
              </div>
              <textarea
                rows={3}
                placeholder="Type a new tracking note, obstacle, or completion note..."
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                className="input text-xs w-full resize-none leading-relaxed"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setRemarksModalOpen(false)}
                className="btn btn-secondary text-xs"
                disabled={savingRemarks}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingRemarks}
                className="btn btn-primary text-xs flex items-center gap-1.5"
              >
                <Save size={13} />
                <span>{savingRemarks ? 'Saving...' : 'Save & Post Update'}</span>
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete Priority Task"
        width={420}
      >
        <div className="space-y-3 text-xs">
          <p className="text-ink2">
            Are you sure you want to delete this priority task? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeleteConfirmId(null)}
              className="btn btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="btn btn-danger text-xs flex items-center gap-1.5"
            >
              <Trash2 size={13} />
              <span>Delete Permanently</span>
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
