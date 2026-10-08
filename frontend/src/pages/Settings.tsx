import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Settings as SettingsIcon,
  Plus,
  X,
  Save,
  CalendarDays,
  Bell,
  Shield,
  Pencil,
  Trash2,
  DatabaseBackup,
  Download,
  UploadCloud,
  LoaderCircle,
  AlertTriangle,
  Check,
  Users,
  CheckSquare,
  Building2,
  FolderSync,
  Paperclip,
  ShieldCheck,
  Calendar,
   Layers,
   Activity,
   History,
   RotateCcw,
   Sliders,
   FileText,
   FolderSymlink
} from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import type { Settings } from '../lib/types';
import { useSetSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { Switch, Modal, useToast, ConfirmModal, Skeleton } from '../components/ui';
import { cx, bdDateKey, fmtDateTime } from '../lib/utils';
import RolePermissionManager from '../components/RolePermissionManager';
import KpiConfig from '../components/KpiConfig';

interface BackupStats {
  totalUsers: number;
  totalTasks: number;
  totalLeaves: number;
  totalPriorityTasks: number;
  totalDepartments: number;
  totalTeams: number;
  totalSettings: number;
  totalHolidays: number;
  totalAttachments: number;
  totalChatAttachments: number;
  totalAuditLogs: number;
  totalDocuments: number;
}

interface BackupInspectData {
  valid: boolean;
  createdAt: string;
  systemTimezone?: string;
  summary: BackupStats;
  counts: Record<string, number>;
  checksumVerified: boolean;
  check: {
    ok: boolean;
    tables: number;
    users: number;
    tasks: number;
    leaves: number;
    priorityTasks: number;
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [holidays, setHolidays] = useState<{ id: number; date: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [prioModal, setPrioModal] = useState(false);
  const [editStatus, setEditStatus] = useState<{ id: string; name: string; color: string } | null>(null);
  const [newStatus, setNewStatus] = useState<{ id: string; name: string; color: string }>({ id: '', name: '', color: '#6366f1' });
  const [delStatus, setDelStatus] = useState<{ id: string; name: string } | null>(null);
  const [editPrio, setEditPrio] = useState<{ id: string; name: string; color: string; weight: number } | null>(null);
  const [newPrio, setNewPrio] = useState<{ id: string; name: string; color: string; weight: number }>({ id: '', name: '', color: '#6366f1', weight: 3 });
  const [delPrio, setDelPrio] = useState<{ id: string; name: string } | null>(null);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [delHoliday, setDelHoliday] = useState<string | null>(null);

  // Backup & Restore state
  const [systemStats, setSystemStats] = useState<BackupStats | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectData, setInspectData] = useState<BackupInspectData | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState<{ message: string; summary?: BackupStats; safetyBackup?: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Chat cleanup state
  const [chatCleanupDays, setChatCleanupDays] = useState(30);
  const [chatCleanupLoading, setChatCleanupLoading] = useState(false);

  const setGlobalSettings = useSetSettings();
  const toast = useToast();
  const { user: me, isSuper, hasPermission } = useAuth();
  const canManageRoles = isSuper || hasPermission('roles.manage');
  const canManageKpi = isSuper || hasPermission('kpi.manage');
  const [currentTab, setCurrentTab] = useState<'roles' | 'general' | 'backup' | 'reset' | 'kpi'>('general');

  useEffect(() => {
    if (canManageRoles) {
      setCurrentTab('roles');
    } else {
      setCurrentTab('general');
    }
  }, [canManageRoles]);

  const loadStats = () => {
    api.get<{ ok: boolean; summary: BackupStats }>('/settings/backup/stats')
      .then((res) => {
        if (res?.summary) setSystemStats(res.summary);
      })
      .catch(() => {});
  };

  useEffect(() => {
    api.get<Settings>('/settings').then(setSettings).catch(() => {});
    api.get<{ id: number; date: string; name: string }[]>('/settings/holidays').then(setHolidays).catch(() => {});
    loadStats();
  }, []);

  if (!settings) return <div className="max-w-4xl mx-auto text-center py-20 text-ink2">Loading settings...</div>;

  const save = async (patch: Partial<Settings>): Promise<boolean> => {
    setSaving(true);
    try {
      await api.put('/settings', patch);
      const next = { ...settings, ...patch };
      setSettings(next);
      setGlobalSettings?.(next);
      toast('Settings saved');
      loadStats();
      return true;
    } catch (e: any) {
      toast(e.message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveStatus = async () => {
    if (!editStatus) return;
    const list = settings.taskStatuses.map((s) => (s.id === editStatus.id ? { ...s, name: editStatus.name, color: editStatus.color } : s));
    if (await save({ taskStatuses: list })) setStatusModal(false);
  };
  const addStatus = async () => {
    if (!newStatus.name || !newStatus.id) return toast('Name and id required', 'error');
    const list = [...settings.taskStatuses, newStatus];
    if (await save({ taskStatuses: list })) setStatusModal(false);
  };
  const savePrio = async () => {
    if (!editPrio) return;
    const list = settings.priorities.map((p) => (p.id === editPrio.id ? { ...p, name: editPrio.name, color: editPrio.color, weight: editPrio.weight } : p));
    if (await save({ priorities: list })) setPrioModal(false);
  };
  const addPrio = async () => {
    if (!newPrio.name || !newPrio.id) return toast('Name and id required', 'error');
    const list = [...settings.priorities, newPrio];
    if (await save({ priorities: list })) setPrioModal(false);
  };

  const deleteStatus = async () => {
    if (!delStatus) return;
    const list = settings.taskStatuses.filter((s) => s.id !== delStatus.id);
    if (await save({ taskStatuses: list })) setDelStatus(null);
  };
  const deletePrio = async () => {
    if (!delPrio) return;
    const list = settings.priorities.filter((p) => p.id !== delPrio.id);
    if (await save({ priorities: list })) setDelPrio(null);
  };

  const addHoliday = async () => {
    if (!holidayDate) return;
    await api.post('/settings/holidays', { date: holidayDate, name: holidayName });
    setHolidayDate('');
    setHolidayName('');
    api.get<{ id: number; date: string; name: string }[]>('/settings/holidays').then(setHolidays).catch(() => {});
    loadStats();
    toast('Holiday added');
  };

  const runBackup = async () => {
    setBackingUp(true);
    try {
      const stamp = bdDateKey();
      await downloadExport('/settings/backup', `pdcl-ict-backup-${stamp}.pdcl-ict`);
      toast('Full system backup generated and downloaded');
      loadStats();
    } catch (e: any) {
      toast(e.message || 'Failed to download backup', 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const onPickRestore = async (file: File | null) => {
    setRestoreError(null);
    setRestoreDone(null);
    setInspectData(null);
    setRestoreFile(file);
    if (!file) return;

    // Quick client-side sanity check
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.format !== 'pdcl-ict-backup') {
        setRestoreError('Invalid file format. Please upload a valid PDCL ICT backup file (.pdcl-ict).');
        setRestoreFile(null);
        if (restoreInputRef.current) restoreInputRef.current.value = '';
        return;
      }
      if (parsed.version !== 1) {
        setRestoreError(`Unsupported backup version (${parsed.version}). Expected version 1.`);
        setRestoreFile(null);
        if (restoreInputRef.current) restoreInputRef.current.value = '';
        return;
      }
    } catch {
      setRestoreError('The selected file could not be parsed as JSON. Please ensure it is an intact .pdcl-ict backup.');
      setRestoreFile(null);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
      return;
    }

    // Inspect on server for full integrity verification & preview stats
    setInspecting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<BackupInspectData>('/settings/backup/inspect', fd);
      if (res && res.valid) {
        setInspectData(res);
      } else {
        setRestoreError('The backup file failed server-side validation.');
      }
    } catch (e: any) {
      setRestoreError(e.message || 'Failed to inspect backup file');
    } finally {
      setInspecting(false);
    }
  };

  const runRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const fd = new FormData();
      fd.append('file', restoreFile);
      fd.append('confirm', 'true');
      const res = await api.upload<{ ok: boolean; message: string; summary?: BackupStats; safetyBackup?: string }>(
        '/settings/backup/restore',
        fd
      );

      const msg = res?.message || 'Full system backup restored successfully.';
      toast(msg);
      setRestoreDone({
        message: msg,
        summary: res?.summary,
        safetyBackup: res?.safetyBackup,
      });
      setRestoreFile(null);
      setInspectData(null);
      if (restoreInputRef.current) restoreInputRef.current.value = '';

      // Reload page cleanly to refresh all active sessions and state
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (e: any) {
      setRestoreError(e.message || 'Restoration failed. Existing database was left untouched.');
      toast(e.message || 'Restore failed', 'error');
    } finally {
      setRestoring(false);
      setRestoreConfirm(false);
    }
  };

  const runChatCleanup = async () => {
    if (!isSuper) return;
    setChatCleanupLoading(true);
    try {
      const res = await api.post<{ ok: boolean; deleted: number; days: number }>('/chat/admin/cleanup-old-messages', { days: chatCleanupDays });
      toast(`Deleted ${res.deleted} chat message(s) older than ${res.days} days`);
    } catch (e: any) {
      toast(e.message || 'Chat cleanup failed', 'error');
    } finally {
      setChatCleanupLoading(false);
    }
  };

  const weekday = (n: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n];

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2">
          <SettingsIcon size={24} className="text-brand" /> Settings
        </h1>
        <p className="text-sm text-ink2 mt-0.5">
          Role & permission groups, workflow statuses, priorities, working days, and full system backup
        </p>
      </div>

      {/* SETTINGS TABS */}
      <div className="flex items-center gap-1.5 p-1 bg-card2/80 rounded-2xl border border-line w-fit">
        {canManageRoles && (
          <button
            onClick={() => setCurrentTab('roles')}
            className={cx(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              currentTab === 'roles'
                ? 'bg-brand text-white shadow-sm'
                : 'text-ink2 hover:text-ink hover:bg-card'
            )}
          >
            <ShieldCheck size={15} />
            <span>Role & Permission Groups</span>
            <span
              className={cx(
                'text-[10px] px-1.5 py-0.2 rounded-md font-semibold',
                currentTab === 'roles' ? 'bg-white/20 text-white' : 'bg-brand/10 text-brand'
              )}
            >
              RBAC
            </span>
          </button>
        )}
        <button
          onClick={() => setCurrentTab('general')}
          className={cx(
            'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
            currentTab === 'general'
              ? 'bg-brand text-white shadow-sm'
              : 'text-ink2 hover:text-ink hover:bg-card'
          )}
        >
          <Sliders size={15} />
          <span>Workflow & System</span>
        </button>
        {isSuper && (
          <button
            onClick={() => setCurrentTab('backup')}
            className={cx(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              currentTab === 'backup'
                ? 'bg-brand text-white shadow-sm'
                : 'text-ink2 hover:text-ink hover:bg-card'
            )}
          >
            <DatabaseBackup size={15} />
            <span>Backup & Disaster Recovery</span>
          </button>
        )}
        {canManageKpi && (
          <button
            onClick={() => setCurrentTab('kpi')}
            className={cx(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              currentTab === 'kpi'
                ? 'bg-brand text-white shadow-sm'
                : 'text-ink2 hover:text-ink hover:bg-card'
            )}
          >
            <Activity size={15} />
            <span>KPI Configuration</span>
          </button>
        )}
        {isSuper && (
          <button
            onClick={() => setCurrentTab('reset')}
            className={cx(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2',
              currentTab === 'reset'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-ink2 hover:text-ink hover:bg-card'
            )}
          >
            <AlertTriangle size={15} />
            <span>Data Reset</span>
          </button>
        )}
      </div>

      {/* TAB: DATA RESET / FRESH START (Super Admin only) */}
      {currentTab === 'reset' && isSuper && (
        <DataResetPanel onDone={() => { loadStats(); }} />
      )}
      {currentTab === 'roles' && canManageRoles && <RolePermissionManager />}
      {currentTab === 'kpi' && canManageKpi && <KpiConfig />}

      {/* TAB 2: FULL BACKUP & RESTORE SECTION */}
      {currentTab === 'backup' && isSuper && (
      <div className="card p-5 border-2 border-brand/20 bg-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <DatabaseBackup size={20} className="text-brand" />
              <h2 className="text-lg font-bold text-ink">Full System Backup & Disaster Recovery</h2>
              <span className="badge badge-brand text-xs font-semibold">Production Ready</span>
            </div>
            <p className="text-xs text-ink2 mt-1 max-w-2xl">
                Take a metadata snapshot of the entire PDCL ICT system or restore a previously downloaded backup.
A Full Backup captures <strong>all users and credentials</strong>, <strong>task and priority workflows</strong>,{' '}
                <strong>leave management data and quotas</strong>, <strong>system configurations</strong>,{' '}
               <strong>all file attachments</strong>, and <strong>document metadata</strong>{' '}
               (file names, types, tags, access permissions — <em>binary document files are excluded</em> to reduce backup size;
               use the Document Files Backup or document indexer to recover file data).
             </p>
          </div>
        </div>

        {/* Live System Footprint Stats */}
        {systemStats && (
          <div className="mb-4 p-3.5 rounded-xl bg-card2/70 border border-line">
            <div className="flex items-center justify-between text-xs text-ink3 font-semibold mb-2">
              <span className="flex items-center gap-1.5 text-ink2">
                <Activity size={13} className="text-brand" /> Current System Data Included in Backup
              </span>
              <button onClick={loadStats} className="text-brand hover:underline flex items-center gap-1">
                <RotateCcw size={11} /> Refresh counts
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-center">
              <div className="p-2 rounded-lg bg-bg/80 border border-line">
                <div className="text-base font-extrabold text-brand">{systemStats.totalUsers}</div>
                <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                  <Users size={11} /> Users
                </div>
              </div>
              <div className="p-2 rounded-lg bg-bg/80 border border-line">
                <div className="text-base font-extrabold text-blue-500">{systemStats.totalTasks}</div>
                <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                  <CheckSquare size={11} /> Tasks
                </div>
              </div>
              <div className="p-2 rounded-lg bg-bg/80 border border-line">
                <div className="text-base font-extrabold text-purple-500">{systemStats.totalLeaves}</div>
                <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                  <Calendar size={11} /> Leaves
                </div>
              </div>
              <div className="p-2 rounded-lg bg-bg/80 border border-line">
                <div className="text-base font-extrabold text-amber-500">{systemStats.totalPriorityTasks}</div>
                <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                  <Layers size={11} /> Priority Tasks
                </div>
              </div>
              <div className="p-2 rounded-lg bg-bg/80 border border-line">
                <div className="text-base font-extrabold text-emerald-500">{systemStats.totalDepartments}</div>
                <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                  <Building2 size={11} /> Branches
                </div>
              </div>
              <div className="p-2 rounded-lg bg-bg/80 border border-line">
                <div className="text-base font-extrabold text-cyan-500">{systemStats.totalAttachments}</div>
                <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                  <Paperclip size={11} /> Attachments
                </div>
              </div>
               <div className="p-2 rounded-lg bg-bg/80 border border-line">
                 <div className="text-base font-extrabold text-indigo-500">{systemStats.totalAuditLogs}</div>
                 <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                   <History size={11} /> Audit Logs
                 </div>
               </div>
               <div className="p-2 rounded-lg bg-bg/80 border border-line">
                 <div className="text-base font-extrabold text-rose-500">{systemStats.totalDocuments}</div>
                 <div className="text-[11px] text-ink3 flex items-center justify-center gap-1 mt-0.5">
                   <FileText size={11} /> Documents
                </div>
              </div>
            </div>
          </div>)}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* FULL BACKUP ACTION CARD */}
          <div className="p-4 rounded-xl bg-card2/60 border border-line flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-2 rounded-lg bg-brand/10 text-brand">
                  <Download size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-ink">Download Full Backup</h3>
                   <p className="text-[11px] text-ink3">Single-file .pdcl-ict system snapshot</p>
                </div>
              </div>
              <p className="text-xs text-ink2 mt-2 leading-relaxed">
                Generates a complete binary and structured snapshot protected with a SHA-256 integrity checksum. Includes all
                database tables, user accounts, leaves, tasks, attachments, and configurations.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between">
              <span className="text-[11px] text-ink3 flex items-center gap-1 font-medium">
                <ShieldCheck size={13} className="text-ok" /> SHA-256 Verified
              </span>
              <button className="btn btn-primary btn-sm px-4" onClick={runBackup} disabled={backingUp}>
                {backingUp ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
                {backingUp ? 'Creating Snapshot...' : 'Full Backup'}
              </button>
            </div>
          </div>

          {/* RESTORE BACKUP ACTION CARD */}
          <div className="p-4 rounded-xl bg-card2/60 border border-line flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                  <UploadCloud size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-ink">Restore Full Backup</h3>
                  <p className="text-[11px] text-ink3">Complete system state restoration</p>
                </div>
              </div>
              <p className="text-xs text-ink2 mt-2 leading-relaxed">
                 Upload a verified <code className="text-brand font-mono">.pdcl-ict</code> backup file to restore. Existing
                system data will be <strong>completely replaced</strong> to avoid duplicates, with an automated safety backup
                saved first.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between gap-2">
              <input
                ref={restoreInputRef}
                type="file"
                 accept=".pdcl-ict,application/json,.json"
                className="hidden"
                onChange={(e) => onPickRestore(e.target.files?.[0] ?? null)}
              />
              <button
                className="btn btn-ghost btn-sm text-xs truncate max-w-[170px]"
                onClick={() => restoreInputRef.current?.click()}
                 title="Select .pdcl-ict backup file"
              >
                {restoreFile ? (
                  <>
                    <X size={13} className="shrink-0" /> {restoreFile.name}
                  </>
                ) : (
                  <>
                    <FolderSync size={13} className="shrink-0" /> Choose .pdcl-ict file
                  </>
                )}
              </button>
              <button
                className="btn btn-primary btn-sm px-4 bg-amber-600 hover:bg-amber-700 border-amber-600"
                disabled={!restoreFile || inspecting || restoring}
                onClick={() => setRestoreConfirm(true)}
              >
                {restoring ? <LoaderCircle size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                {restoring ? 'Restoring...' : 'Restore Backup'}
              </button>
            </div>
          </div>
        </div>

        {/* DOCUMENT FILES BACKUP CARD */}
        <div className="mt-4 p-4 rounded-xl bg-card2/60 border border-line flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500">
              <FolderSymlink size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-ink">Document Files Backup</h3>
              <p className="text-xs text-ink2">Download a ZIP archive of all physical document files</p>
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              try {
                await downloadExport('/documents/admin/backup', 'pdcl-ict-documents');
                toast('Document files backup downloaded');
              } catch (e: any) {
                toast(e.message || 'Failed to download document backup', 'error');
              }
            }}
          >
            <Download size={14} /> Download Document Files
          </button>
        </div>
        {inspecting && (
          <div className="mt-3 p-3.5 rounded-xl bg-card2/80 border border-line flex items-center gap-2 text-xs text-ink2">
            <LoaderCircle size={14} className="animate-spin text-brand" />
            <span>Validating backup format, SQLite database binary, and cryptographic checksum...</span>
          </div>
        )}

        {inspectData && !restoring && !restoreDone && (
          <div className="mt-4 p-4 rounded-xl bg-card2/90 border-2 border-brand/30">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-ok" />
                <span className="font-bold text-sm text-ink">Backup Inspection Verified</span>
                <span className="badge badge-ok text-[11px]">Integrity Check Passed</span>
              </div>
              <div className="text-xs text-ink3">
                Created on: <span className="font-semibold text-ink">{inspectData.createdAt ? fmtDateTime(inspectData.createdAt) : 'Unknown'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 my-3">
              <div className="p-2 rounded-lg bg-bg/90 border border-line text-center">
                <div className="text-sm font-bold text-ink">{inspectData.summary.totalUsers}</div>
                <div className="text-[10px] text-ink3">Users & Accounts</div>
              </div>
              <div className="p-2 rounded-lg bg-bg/90 border border-line text-center">
                <div className="text-sm font-bold text-ink">{inspectData.summary.totalTasks}</div>
                <div className="text-[10px] text-ink3">Tasks & Workflows</div>
              </div>
              <div className="p-2 rounded-lg bg-bg/90 border border-line text-center">
                <div className="text-sm font-bold text-ink">{inspectData.summary.totalLeaves}</div>
                <div className="text-[10px] text-ink3">Leave Applications</div>
              </div>
              <div className="p-2 rounded-lg bg-bg/90 border border-line text-center">
                <div className="text-sm font-bold text-ink">{inspectData.summary.totalPriorityTasks}</div>
                <div className="text-[10px] text-ink3">Priority Tasks</div>
              </div>
              <div className="p-2 rounded-lg bg-bg/90 border border-line text-center">
                <div className="text-sm font-bold text-ink">{inspectData.summary.totalDepartments}</div>
                <div className="text-[10px] text-ink3">Branches & Teams</div>
              </div>
              <div className="p-2 rounded-lg bg-bg/90 border border-line text-center">
                <div className="text-sm font-bold text-ink">{inspectData.summary.totalAttachments}</div>
                <div className="text-[10px] text-ink3">Attachments</div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="text-ink3">
                Total Database Tables: <strong className="text-ink">{inspectData.check.tables}</strong> | Checksum:{' '}
                <code className="text-[11px] text-brand">SHA-256 Match</code>
              </span>
              <button
                className="btn btn-primary btn-sm bg-amber-600 hover:bg-amber-700 border-amber-600"
                onClick={() => setRestoreConfirm(true)}
              >
                Proceed to Restore
              </button>
            </div>
          </div>
        )}

        {/* Error message */}
        {restoreError && (
          <div className="mt-3 p-3 rounded-xl bg-bad/10 border border-bad/20 text-xs text-bad flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Restoration Issue</div>
              <div>{restoreError}</div>
            </div>
          </div>
        )}

        {/* Success message */}
        {restoreDone && (
          <div className="mt-3 p-4 rounded-xl bg-ok/10 border border-ok/20 text-xs text-ok">
            <div className="flex items-center gap-2 font-bold text-sm">
              <Check size={16} /> Full System Restored Successfully
            </div>
            <p className="mt-1 text-ink2">
              {restoreDone.message} The application will automatically reload in a few seconds to apply the restored snapshot.
            </p>
            {restoreDone.safetyBackup && (
              <div className="mt-2 text-[11px] text-ink3">
                Safety backup created: <code className="text-ink">{restoreDone.safetyBackup}</code>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* TAB 3: GENERAL & WORKFLOW SETTINGS */}
      {currentTab === 'general' && (
        <div className="space-y-6">
          {/* TASK STATUSES */}
          <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold">Task Statuses</h3>
            <p className="text-xs text-ink3">Color-coded workflow states</p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditStatus(null);
              setNewStatus({ id: '', name: '', color: '#6366f1' });
              setStatusModal(true);
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {settings.taskStatuses.map((s) => (
            <span
              key={s.id}
              className="chip !py-1 !pl-2 !pr-1 flex items-center gap-1"
              style={{ color: s.color, borderColor: s.color, background: `${s.color}14` }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              <span className="mx-0.5">{s.name}</span>
              <button
                title="Edit status"
                onClick={() => {
                  setEditStatus(s);
                  setStatusModal(true);
                }}
                className="p-1 rounded hover:bg-line/60 transition-colors"
              >
                <Pencil size={12} />
              </button>
              <button
                title="Delete status"
                onClick={() => setDelStatus(s)}
                className="p-1 rounded hover:bg-line/60 transition-colors text-bad"
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* PRIORITY LEVELS */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold">Priority Levels</h3>
            <p className="text-xs text-ink3">Used in filtering and task weighting</p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditPrio(null);
              setNewPrio({ id: '', name: '', color: '#6366f1', weight: 3 });
              setPrioModal(true);
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {settings.priorities.map((p) => (
            <span
              key={p.id}
              className="chip !py-1 !pl-2 !pr-1 flex items-center gap-1"
              style={{ color: p.color, borderColor: p.color, background: `${p.color}14` }}
            >
              {p.name} <span className="opacity-60">(w{p.weight})</span>
              <button
                title="Edit priority"
                onClick={() => {
                  setEditPrio({ id: p.id, name: p.name, color: p.color, weight: p.weight });
                  setPrioModal(true);
                }}
                className="p-1 rounded hover:bg-line/60 transition-colors"
              >
                <Pencil size={12} />
              </button>
              <button
                title="Delete priority"
                onClick={() => setDelPrio(p)}
                className="p-1 rounded hover:bg-line/60 transition-colors text-bad"
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* WORKING DAYS & BUSINESS HOURS */}
      <div className="card p-5">
        <h3 className="font-bold flex items-center gap-2 mb-1">
          <CalendarDays size={16} className="text-brand" /> Working Days & Business Hours
        </h3>
        <p className="text-xs text-ink3 mb-4">Used for accurate SLA and overdue calculations</p>
        <div className="space-y-4">
          <div>
            <label className="label">Working Days</label>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                const active = settings.workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const next = active ? settings.workingDays.filter((d) => d !== day) : [...settings.workingDays, day];
                      save({ workingDays: next.sort() });
                    }}
                    className={cx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all', active ? 'bg-brand text-white border-brand' : 'bg-card2 text-ink2 border-line hover:border-ink3')}
                  >
                    {weekday(day)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
            <div>
              <label className="label">Start Time</label>
              <input
                type="time"
                className="input"
                value={settings.businessHours.start}
                onChange={(e) => save({ businessHours: { ...settings.businessHours, start: e.target.value } })}
              />
            </div>
            <div>
              <label className="label">End Time</label>
              <input
                type="time"
                className="input"
                value={settings.businessHours.end}
                onChange={(e) => save({ businessHours: { ...settings.businessHours, end: e.target.value } })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* COMPANY HOLIDAYS */}
      <div className="card p-5">
        <h3 className="font-bold mb-1">Company Holidays</h3>
        <p className="text-xs text-ink3 mb-4">Holidays are excluded from turnaround time calculations</p>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input !w-44" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-44">
            <label className="label">Holiday Name</label>
            <input className="input" placeholder="e.g. Independence Day" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={addHoliday}>
            <Plus size={14} /> Add Holiday
          </button>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {holidays.length === 0 ? (
            <div className="text-xs text-ink3 py-3 text-center">No holidays configured</div>
          ) : (
            holidays.map((h) => (
              <div key={h.date} className="flex items-center justify-between p-2 rounded-lg bg-card2/60 border border-line text-xs">
                <span className="font-mono font-semibold">{h.date}</span>
                <span className="flex-1 ml-3 text-ink2">{h.name || 'Holiday'}</span>
                <button onClick={() => setDelHoliday(h.date)} className="p-1 rounded hover:bg-line text-bad" title="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* NOTIFICATION PREFERENCES */}
      <div className="card p-5">
        <h3 className="font-bold flex items-center gap-2 mb-1">
          <Bell size={16} className="text-brand" /> Notification Rules
        </h3>
        <p className="text-xs text-ink3 mb-4">Control automated notifications across all users</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['taskAssigned', 'Notify when a task is assigned'],
            ['taskUpdated', 'Notify on task status changes'],
            ['dueDateChanged', 'Notify when due date is updated'],
            ['commentAdded', 'Notify on new task comments'],
            ['taskCompleted', 'Notify on task completion'],
            ['taskOverdue', 'Notify when task becomes overdue'],
            ['mentions', 'Notify when @mentioned in comments'],
          ].map(([k, label]) => (
            <Switch
              key={k}
              label={label}
              checked={(settings.notificationRules as any)[k]}
              onChange={(v) => save({ notificationRules: { ...settings.notificationRules, [k]: v } })}
            />
          ))}
        </div>
      </div>

      {/* SECURITY & SESSIONS */}
      <div className="card p-5">
        <h3 className="font-bold flex items-center gap-2 mb-1">
          <Shield size={16} className="text-brand" /> Security & Sessions
        </h3>
        <p className="text-xs text-ink3 mb-4">Authentication controls</p>
        <div className="space-y-4">
          <Switch
            label="Require Two-Factor Authentication (2FA)"
            checked={settings.security.twoFactorEnabled}
            onChange={(v) => save({ security: { ...settings.security, twoFactorEnabled: v } })}
          />
          <div>
            <label className="label">Session Timeout (minutes, 0 = no timeout)</label>
            <input
              type="number"
              className="input !w-40"
              value={settings.security.sessionTimeoutMinutes}
              onChange={(e) => save({ security: { ...settings.security, sessionTimeoutMinutes: Number(e.target.value) } })}
            />
          </div>
        </div>
      </div>

      {/* CHAT CLEANUP (Super Admin only) */}
      {isSuper && (
      <div className="card p-5">
        <h3 className="font-bold flex items-center gap-2 mb-1">
          <History size={16} className="text-brand" /> Chat Message Cleanup
        </h3>
        <p className="text-xs text-ink3 mb-4">Manually remove chat messages older than a specified period</p>
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="label">Age Threshold (days)</label>
              <select className="select !w-40" value={chatCleanupDays} onChange={(e) => setChatCleanupDays(Number(e.target.value))}>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
            </div>
            <button
              className="btn btn-outline btn-sm"
              disabled={chatCleanupLoading}
              onClick={runChatCleanup}
            >
              {chatCleanupLoading ? <LoaderCircle size={14} className="animate-spin" /> : <History size={14} />}
              {chatCleanupLoading ? 'Cleaning...' : 'Clear Old Messages'}
            </button>
          </div>
          <p className="text-[11px] text-ink3">Messages and their attachments older than the selected period will be permanently deleted.</p>
        </div>
       </div>
      )}
      </div>
      )}

      {/* MODALS */}
      <Modal
        open={statusModal}
        onClose={() => setStatusModal(false)}
        title={editStatus ? 'Edit Status' : 'Add Status'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setStatusModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={editStatus ? saveStatus : addStatus}>
              {editStatus ? 'Save' : 'Add'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">ID</label>
            <input
              className="input"
              value={editStatus?.id || newStatus.id}
              disabled={!!editStatus}
              onChange={(e) => setNewStatus({ ...newStatus, id: e.target.value.toLowerCase().replace(/ /g, '_') })}
            />
          </div>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={editStatus?.name || newStatus.name}
              onChange={(e) =>
                editStatus ? setEditStatus({ ...editStatus, name: e.target.value }) : setNewStatus({ ...newStatus, name: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-10 w-16 rounded-lg cursor-pointer bg-card2 border border-line"
                value={editStatus?.color || newStatus.color}
                onChange={(e) =>
                  editStatus ? setEditStatus({ ...editStatus, color: e.target.value }) : setNewStatus({ ...newStatus, color: e.target.value })
                }
              />
              <input
                className="input"
                value={editStatus?.color || newStatus.color}
                onChange={(e) =>
                  editStatus ? setEditStatus({ ...editStatus, color: e.target.value }) : setNewStatus({ ...newStatus, color: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={prioModal}
        onClose={() => setPrioModal(false)}
        title={editPrio ? 'Edit Priority' : 'Add Priority'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPrioModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={editPrio ? savePrio : addPrio}>
              {editPrio ? 'Save' : 'Add'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">ID</label>
            <input
              className="input"
              value={editPrio?.id || newPrio.id}
              disabled={!!editPrio}
              onChange={(e) => setNewPrio({ ...newPrio, id: e.target.value.toLowerCase().replace(/ /g, '_') })}
            />
          </div>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={editPrio?.name || newPrio.name}
              onChange={(e) =>
                editPrio ? setEditPrio({ ...editPrio, name: e.target.value }) : setNewPrio({ ...newPrio, name: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Weight</label>
            <input
              type="number"
              min={1}
              max={10}
              className="input"
              value={editPrio?.weight ?? newPrio.weight}
              onChange={(e) =>
                editPrio ? setEditPrio({ ...editPrio, weight: Number(e.target.value) }) : setNewPrio({ ...newPrio, weight: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-10 w-16 rounded-lg cursor-pointer bg-card2 border border-line"
                value={editPrio?.color || newPrio.color}
                onChange={(e) =>
                  editPrio ? setEditPrio({ ...editPrio, color: e.target.value }) : setNewPrio({ ...newPrio, color: e.target.value })
                }
              />
              <input
                className="input"
                value={editPrio?.color || newPrio.color}
                onChange={(e) =>
                  editPrio ? setEditPrio({ ...editPrio, color: e.target.value }) : setNewPrio({ ...newPrio, color: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!delHoliday}
        onClose={() => setDelHoliday(null)}
        onConfirm={async () => {
          await api.delete(`/settings/holidays/${delHoliday}`);
          setDelHoliday(null);
          api.get<{ id: number; date: string; name: string }[]>('/settings/holidays').then(setHolidays).catch(() => {});
          loadStats();
          toast('Holiday removed');
        }}
        title="Remove holiday?"
        confirmLabel="Remove"
        danger
      />

      <ConfirmModal
        open={!!delStatus}
        onClose={() => setDelStatus(null)}
        onConfirm={deleteStatus}
        title="Delete task status?"
        message={`Delete "${delStatus?.name}"? Tasks currently in this status will be unaffected but the status option will no longer be available.`}
        confirmLabel="Delete"
        danger
      />

      <ConfirmModal
        open={!!delPrio}
        onClose={() => setDelPrio(null)}
        onConfirm={deletePrio}
        title="Delete priority level?"
        message={`Delete "${delPrio?.name}"? Tasks currently using this priority will keep it, but the priority option will no longer be available.`}
        confirmLabel="Delete"
        danger
      />

      {/* RESTORE CONFIRMATION DIALOG */}
      <ConfirmModal
        open={restoreConfirm}
        onClose={() => setRestoreConfirm(false)}
        onConfirm={runRestore}
        title="Restore Full System Snapshot?"
        danger
        confirmLabel="Yes, Clear and Restore System"
        message={
          inspectData
            ? `Restoring "${restoreFile?.name}" will completely clear all existing database records, users, tasks, leave ledgers, priority tasks, settings, and attachments, and replace them with this backup (${inspectData.summary.totalUsers} users, ${inspectData.summary.totalTasks} tasks, ${inspectData.summary.totalLeaves} leaves). An automated pre-restore safety backup of the current state is created before restoring.`
            : `Restoring "${restoreFile?.name}" will replace ALL current data with the contents of this backup. An automated pre-restore safety backup is created automatically before restoring.`
        }
      />
    </div>
  );
}

interface ResetTarget { key: string; label: string; count: number }

/**
 * Data Reset / Fresh Start. Super Admin only.
 *
 * Clearing is permanent and cannot be undone, so the panel requires an explicit
 * module selection and a typed confirmation, and it always recommends taking a
 * backup first.
 */
function DataResetPanel({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [targets, setTargets] = useState<ResetTarget[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ targets: ResetTarget[] }>('/data-reset/targets');
      setTargets(r.targets || []);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadTargets(); }, [loadTargets]);

  const toggle = (key: string) => {
    setResult(null);
    setSelected((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  };

  const selectedLabels = targets.filter((t) => selected.includes(t.key)).map((t) => t.label);
  const canRun = selected.length > 0 && confirmText.trim().toUpperCase() === 'RESET' && !busy;

  const runReset = async () => {
    if (!canRun) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/data-reset', {
        targets: selected,
        confirm: confirmText.trim(),
      });
      setResult(r.message);
      toast(r.message);
      setSelected([]);
      setConfirmText('');
      await loadTargets();
      onDone?.();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5 border-2 border-red-500/30 bg-card">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-red-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-red-600 dark:text-red-400">Data Reset / Fresh Start</h3>
            <p className="text-xs text-ink2 mt-0.5">
              Permanently delete selected application data to prepare a clean database. This cannot be undone.
              Take a full backup from the Backup &amp; Disaster Recovery tab first.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300 mb-4">
          <strong className="font-bold">Super Admin accounts are never deleted.</strong>{' '}
          Settings, role groups, teams, branches, leave quotas and Daily Task definitions are never affected.
          Select the modules you want to clear.
        </div>

        {loading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="space-y-2">
              {targets.map((t) => {
                const on = selected.includes(t.key);
                return (
                  <label
                    key={t.key}
                    className={cx(
                      'flex items-center gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors',
                      on ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-card hover:bg-card2',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-line text-red-600 focus:ring-red-500 shrink-0"
                      checked={on}
                      onChange={() => toggle(t.key)}
                    />
                    <span className="text-sm font-semibold flex-1">{t.label}</span>
                    <span className="text-[11px] text-ink3 tabular-nums">
                      {t.count} record{t.count === 1 ? '' : 's'}
                    </span>
                  </label>
                );
              })}
            </div>

            {selected.length > 0 && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/5 px-3.5 py-3">
                <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-2">
                  WARNING: This will permanently delete all records in{' '}
                  {selectedLabels.join(', ')}. This action cannot be undone.
                </p>
                <label className="label">
                  Type <span className="font-mono text-red-600 dark:text-red-400">RESET</span> to confirm
                </label>
                <input
                  className="input font-mono"
                  placeholder="RESET"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-line">
              <span className="text-xs text-ink3">
                {selected.length === 0
                  ? 'Select one or more modules to enable the reset.'
                  : confirmText.trim().toUpperCase() !== 'RESET'
                    ? 'Type RESET above to enable the button.'
                    : 'Ready to permanently delete the selected data.'}
              </span>
              <button
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={runReset}
                disabled={!canRun}
              >
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Clear Selected Data
              </button>
            </div>

            {result && (
              <div className="mt-3 rounded-xl border border-green-500/30 bg-green-500/10 px-3.5 py-2.5 text-xs text-green-700 dark:text-green-300">
                <strong className="font-bold">Reset complete.</strong> {result}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
