import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, KeyRound, Power, Search, Trash2, UserCog, Eye, EyeOff,
  Copy, Check, Shield, RefreshCw, Mail, Phone, Building2, Users as UsersIcon,
  Download, CheckSquare, Clock, Filter, X, ChevronRight, Activity, Calendar,
  CalendarCheck,
  Lock
} from 'lucide-react';
import { api } from '../lib/api';
import type { User, LiveStatusType, RoleGroup, Role } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Avatar, Badge, Modal, ConfirmModal, useToast, EmptyState, Skeleton } from '../components/ui';
import { LiveStatusDot, LiveStatusBadge } from '../components/LiveStatusIndicator';
import {
  cx,
  parseWeekendDays,
  formatWeekendDays,
  formatWeekendDaysFull,
  WEEKDAY_OPTIONS,
  WEEKEND_PRESETS,
  WEEKDAY_NAMES,
} from '../lib/utils';

const ROLES = ['user', 'admin', 'super_admin'] as const;

interface UserActivityData {
  user: { id: number; name: string; email: string; role: string };
  openTasks: { id: number; title: string; priority: string; status: string; due_date?: string; created_at: string }[];
  completedTasks: { id: number; title: string; priority: string; status: string; due_date?: string; completed_at: string }[];
  recentLogs: { id: number; action: string; details: string; ip_address?: string; created_at: string }[];
}

export default function Users() {
  const toast = useToast();
  const { user: me, isSuper, setUser, hasPermission } = useAuth();
  
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([]);
  const [depts, setDepts] = useState<{ id: number; name: string }[]>([]);
  const [roleGroups, setRoleGroups] = useState<RoleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  
  // Filter state
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [roleGroupFilter, setRoleGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  const [liveStatusFilter, setLiveStatusFilter] = useState('all'); // all, active, away, inactive
  const [branchFilter, setBranchFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');

  // Form modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    email: string;
    password: string;
    role: Role;
    role_group_id: string;
    title: string;
    phone: string;
    employee_id: string;
    avatar: string;
    team_id: string;
    department_id: string;
    weekend_days: number[];
    duty_time: string;
    daily_task_member: boolean;
  }>({
    name: '',
    email: '',
    password: '',
    role: 'user',
    role_group_id: '',
    title: '',
    phone: '',
    employee_id: '',
    avatar: '',
    team_id: '',
    department_id: '',
    weekend_days: [5],
    duty_time: '',
    daily_task_member: false,
  });

  // Reset password modal state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetSuccessResult, setResetSuccessResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  // User Dossier / Activity inspection modal
  const [dossierUser, setDossierUser] = useState<User | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierData, setDossierData] = useState<UserActivityData | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setSyncing(true);
    try {
      const [u, t, d, rg] = await Promise.all([
        api.get<User[]>('/users?exclude_super=true'),
        api.get<{ id: number; name: string }[]>('/teams'),
        api.get<{ id: number; name: string }[]>('/departments'),
        api.get<RoleGroup[]>('/settings/role-groups').catch(() => []),
      ]);
      // Exclude super admin (Smd Dipu) from User Management directory as requested
      const staffList = (u || []).filter(
        (user) =>
          user.role !== 'super_admin' &&
          user.role_group_slug !== 'super_admin' &&
          user.email !== 'dipu@populardiagnostic.com' &&
          !user.name.toLowerCase().includes('smd dipu')
      );
      setUsers(staffList);
      setTeams(t);
      setDepts(d);
      setRoleGroups(rg || []);
      setLastSyncTime(new Date());
    } catch (e: any) {
      if (!isSilent) toast(e.message, 'error');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [toast]);

  // Initial load and periodic background sync (every 30s)
  useEffect(() => {
    load();
    const interval = setInterval(() => {
      load(true);
    }, 30000);

    const onSyncEvent = () => load(true);
    window.addEventListener('users:sync', onSyncEvent);
    window.addEventListener('focus', onSyncEvent);

    return () => {
      clearInterval(interval);
      window.removeEventListener('users:sync', onSyncEvent);
      window.removeEventListener('focus', onSyncEvent);
    };
  }, [load]);

  const triggerGlobalSync = () => {
    window.dispatchEvent(new CustomEvent('users:sync'));
  };

  // Open Form
  const openForm = (u?: User) => {
    setEditing(u || null);
    setShowPassword(false);
    setForm(u ? {
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      role_group_id: String(u.role_group_id || ''),
      title: u.title || '',
      phone: u.phone || '',
      employee_id: u.employee_id || '',
      avatar: u.avatar || '',
      team_id: String(u.team_id || ''),
      department_id: String(u.department_id || ''),
      weekend_days: parseWeekendDays(u.weekend_days),
      duty_time: u.duty_time || '',
      daily_task_member: !!u.is_daily_task_member,
    } : {
      name: '',
      email: '',
      password: '',
      role: 'user',
      role_group_id: (() => {
        const def = roleGroups.find((r) => r.is_default) || roleGroups.find((r) => r.slug === 'user');
        return def ? String(def.id) : '';
      })(),
      title: '',
      phone: '',
      employee_id: '',
      avatar: '',
      team_id: '',
      department_id: '',
      weekend_days: [5],
      duty_time: '',
      daily_task_member: false,
    });
    setFormOpen(true);
  };

  const toggleWeekendDay = (dayIndex: number) => {
    const current = [...form.weekend_days];
    const exists = current.includes(dayIndex);
    let next: number[];
    if (exists) {
      if (current.length === 1) {
        toast('A user must have at least 1 day assigned or specify none via custom', 'info');
      }
      next = current.filter((d) => d !== dayIndex);
    } else {
      next = [...current, dayIndex].sort((a, b) => a - b);
    }
    setForm((prev) => ({ ...prev, weekend_days: next }));
  };

  const applyWeekendPreset = (days: number[]) => {
    setForm((prev) => ({ ...prev, weekend_days: [...days] }));
  };

  const save = async () => {
    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim().toLowerCase();

    if (!trimmedName) return toast('Full name is required', 'error');
    if (!trimmedEmail) return toast('Email address is required', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return toast('Please enter a valid email address', 'error');
    }

    if (!editing && !form.password) {
      return toast('Password is required for new accounts', 'error');
    }
    if (form.password && form.password.length < 6) {
      return toast('Password must be at least 6 characters', 'error');
    }

    setSaving(true);
    try {
      if (editing) {
        const payload: any = {
          name: trimmedName,
          email: trimmedEmail,
          role: form.role,
          role_group_id: form.role_group_id ? Number(form.role_group_id) : null,
          title: form.title.trim(),
          phone: form.phone.trim(),
          employee_id: form.employee_id.trim() || undefined,
          avatar: form.avatar.trim() || undefined,
          team_id: form.team_id ? Number(form.team_id) : null,
          department_id: form.department_id ? Number(form.department_id) : null,
          weekend_days: form.weekend_days,
          duty_time: form.duty_time,
          daily_task_member: form.daily_task_member,
        };
        if (form.password && form.password.trim()) {
          payload.password = form.password.trim();
        }

        const updated = await api.put<User>(`/users/${editing.id}`, payload);
        toast('User updated successfully');

        // Synchronize logged-in user profile if self was edited
        if (me && me.id === editing.id) {
          setUser({ ...me, ...updated });
        }
      } else {
        await api.post('/users', {
          name: trimmedName,
          email: trimmedEmail,
          password: form.password,
          role: form.role,
          role_group_id: form.role_group_id ? Number(form.role_group_id) : null,
          title: form.title.trim(),
          phone: form.phone.trim(),
          employee_id: form.employee_id.trim() || undefined,
          avatar: form.avatar.trim() || undefined,
          team_id: form.team_id ? Number(form.team_id) : null,
          department_id: form.department_id ? Number(form.department_id) : null,
          weekend_days: form.weekend_days,
          duty_time: form.duty_time,
          daily_task_member: form.daily_task_member,
        });
        toast('User created successfully');
      }
      setFormOpen(false);
      triggerGlobalSync();
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let res = '';
    for (let i = 0; i < 10; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setResetPasswordInput(res);
  };

  const openResetModal = (u: User) => {
    setResetTarget(u);
    setResetPasswordInput('');
    setShowResetPassword(false);
    setResetSuccessResult(null);
    setCopied(false);
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (resetPasswordInput && resetPasswordInput.length < 6) {
      return toast('Password must be at least 6 characters', 'error');
    }
    setResetting(true);
    try {
      const res = await api.post<{ ok: boolean; temporaryPassword: string }>(`/users/${resetTarget.id}/reset-password`, {
        newPassword: resetPasswordInput.trim() || undefined,
      });
      setResetSuccessResult(res.temporaryPassword);
      toast(`Password for ${resetTarget.name} has been updated`);
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setResetting(false);
    }
  };

  const copyToClipboard = (text: string, label = 'Copied') => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast(`${label} to clipboard`);
    setTimeout(() => setCopied(false), 2500);
  };

  const toggleActive = async (u: User) => {
    try {
      const r = await api.post<{ ok: boolean; is_active: boolean }>(`/users/${u.id}/toggle-active`, {});
      toast(r.is_active ? `Activated ${u.name}` : `Deactivated ${u.name}`);
      triggerGlobalSync();
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/users/${deleteTarget.id}`);
      toast('User deleted successfully');
      setDeleteTarget(null);
      triggerGlobalSync();
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  // Open User Dossier & Activity Modal
  const openDossier = async (u: User) => {
    setDossierUser(u);
    setDossierLoading(true);
    setDossierData(null);
    try {
      const data = await api.get<UserActivityData>(`/users/${u.id}/activity`);
      setDossierData(data);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setDossierLoading(false);
    }
  };

  // Filtered list
  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (q.trim()) {
        const s = `${u.name} ${u.email} ${u.role || ''} ${u.role_group_name || ''} ${u.title || ''} ${u.phone || ''} ${u.employee_id || ''} ${u.team_name || ''} ${u.department_name || ''}`.toLowerCase();
        if (!s.includes(q.trim().toLowerCase())) return false;
      }
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (roleGroupFilter !== 'all') {
        if (roleGroupFilter.startsWith('rg:')) {
          const rgId = Number(roleGroupFilter.replace('rg:', ''));
          if (u.role_group_id !== rgId) return false;
        } else if (u.role !== roleGroupFilter && String(u.role_group_id) !== roleGroupFilter) {
          return false;
        }
      }
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
      if (liveStatusFilter !== 'all') {
        const live = u.live_status || (u.is_active ? 'active' : 'inactive');
        if (live !== liveStatusFilter) return false;
      }
      if (branchFilter !== 'all' && String(u.department_id) !== branchFilter) return false;
      if (teamFilter !== 'all' && String(u.team_id) !== teamFilter) return false;
      return true;
    });
  }, [users, q, roleFilter, roleGroupFilter, statusFilter, liveStatusFilter, branchFilter, teamFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.is_active).length;
    const inactive = total - active;
    const online = users.filter((u) => u.is_active && u.live_status === 'active').length;
    const away = users.filter((u) => u.is_active && u.live_status === 'away').length;
    const admins = users.filter((u) => u.role === 'admin').length;
    return { total, active, inactive, online, away, admins };
  }, [users]);

  // Export to CSV
  const exportUsersCSV = () => {
    if (filtered.length === 0) return toast('No users to export', 'error');
    const headers = ['ID', 'Name', 'Email', 'Role', 'Role Group', 'Employee ID', 'Title', 'Phone', 'Branch', 'Team', 'Assigned Weekend', 'Duty Time', 'Account Status', 'Live Status', 'Open Tasks', 'Completed Tasks', 'Created At'];
    const rows = filtered.map((u) => [
      u.id,
      `"${u.name.replace(/"/g, '""')}"`,
      `"${u.email}"`,
      u.role,
      `"${(u.role_group_name || u.role).replace(/"/g, '""')}"`,
      `"${u.employee_id || `EMP${String(u.id).padStart(3, '0')}`}"`,
      `"${(u.title || '').replace(/"/g, '""')}"`,
      `"${u.phone || ''}"`,
      `"${(u.department_name || '').replace(/"/g, '""')}"`,
      `"${(u.team_name || '').replace(/"/g, '""')}"`,
      `"${formatWeekendDaysFull(u.weekend_days)}"`,
      `"${u.duty_time || ''}"`,
      u.is_active ? 'Active' : 'Inactive',
      u.live_status || 'inactive',
      u.open_tasks || 0,
      u.completed_tasks || 0,
      u.created_at || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `pdcl_ict_users_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('User directory exported to CSV');
  };

  const roleColor: Record<string, string> = { super_admin: '#8b5cf6', admin: '#6366f1', user: '#22c55e' };
  const hasActiveFilters = q || roleFilter !== 'all' || roleGroupFilter !== 'all' || statusFilter !== 'all' || liveStatusFilter !== 'all' || branchFilter !== 'all' || teamFilter !== 'all';

  const resetFilters = () => {
    setQ('');
    setRoleFilter('all');
    setRoleGroupFilter('all');
    setStatusFilter('all');
    setLiveStatusFilter('all');
    setBranchFilter('all');
    setTeamFilter('all');
  };

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold flex items-center gap-2 tracking-tight">
              <UserCog size={26} className="text-brand" /> User Management
            </h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-brand/10 text-brand">
              <RefreshCw size={11} className={cx(syncing && 'animate-spin')} />
              <span>Live Synced</span>
            </div>
          </div>
          <p className="text-sm text-ink2 mt-0.5">
            Manage user credentials, roles, branches, workloads, and real-time activity status
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm text-ink2 flex items-center gap-1.5"
            onClick={() => load()}
            disabled={syncing}
            title="Force synchronization with server"
          >
            <RefreshCw size={14} className={cx(syncing && 'animate-spin text-brand')} />
            <span>Sync</span>
          </button>

          <button
            className="btn btn-ghost btn-sm text-ink2 flex items-center gap-1.5"
            onClick={exportUsersCSV}
            title="Export filtered users to CSV"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>

          <button className="btn btn-primary btn-sm flex items-center gap-1.5" onClick={() => openForm()}>
            <Plus size={15} />
            <span>New User</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card p-3.5 border-line/70">
          <div className="text-xs text-ink3 font-medium">Total Users</div>
          <div className="text-xl font-bold text-ink1 mt-0.5">{metrics.total}</div>
          <div className="text-[11px] text-ink3 mt-0.5">{users.length} accounts in system</div>
        </div>

        <div className="card p-3.5 border-line/70">
          <div className="text-xs text-ink3 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Active
          </div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{metrics.active}</div>
          <div className="text-[11px] text-ink3 mt-0.5">{Math.round((metrics.active / (metrics.total || 1)) * 100)}% active accounts</div>
        </div>

        <div className="card p-3.5 border-line/70">
          <div className="text-xs text-ink3 font-medium flex items-center gap-1">
            <LiveStatusDot status="active" size="xs" pulse /> Online Now
          </div>
          <div className="text-xl font-bold text-brand mt-0.5">{metrics.online}</div>
          <div className="text-[11px] text-ink3 mt-0.5">{metrics.away} marked away</div>
        </div>

        <div className="card p-3.5 border-line/70">
          <div className="text-xs text-ink3 font-medium flex items-center gap-1">
            <Shield size={12} className="text-purple-500" /> Admins
          </div>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-0.5">{metrics.admins}</div>
          <div className="text-[11px] text-ink3 mt-0.5">Staff administrators</div>
        </div>

        <div className="card p-3.5 border-line/70">
          <div className="text-xs text-ink3 font-medium flex items-center gap-1">
            <Building2 size={12} className="text-blue-500" /> Branches
          </div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-0.5">{depts.length}</div>
          <div className="text-[11px] text-ink3 mt-0.5">Assigned branches</div>
        </div>

        <div className="card p-3.5 border-line/70">
          <div className="text-xs text-ink3 font-medium flex items-center gap-1">
            <UsersIcon size={12} className="text-indigo-500" /> Teams
          </div>
          <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{teams.length}</div>
          <div className="text-[11px] text-ink3 mt-0.5">Cross-functional units</div>
        </div>
      </div>

      {/* Advanced Filter Toolbar */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Search Box */}
          <div className="relative sm:col-span-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              className="input !pl-9"
              placeholder="Search by name, email, phone, ID, title..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink1"
                onClick={() => setQ('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Role Group / System Role Filter */}
          <div>
            <select className="input" value={roleGroupFilter} onChange={(e) => setRoleGroupFilter(e.target.value)}>
              <option value="all">All Role Groups & Roles</option>
              {roleGroups.length > 0 && (
                <optgroup label="Configured Role Groups">
                  {roleGroups
                    .filter((rg) => rg.slug !== 'super_admin')
                    .map((rg) => (
                      <option key={rg.id} value={`rg:${rg.id}`}>
                        {rg.name} ({rg.is_system ? 'System' : 'Custom'})
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="System Roles">
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </optgroup>
            </select>
          </div>

          {/* Account Status Filter */}
          <div>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Account: All</option>
              <option value="active">Active Accounts</option>
              <option value="inactive">Deactivated</option>
            </select>
          </div>

          {/* Live Status Filter */}
          <div>
            <select className="input" value={liveStatusFilter} onChange={(e) => setLiveStatusFilter(e.target.value)}>
              <option value="all">Live: All Statuses</option>
              <option value="active">🟢 Online (Active)</option>
              <option value="away">🟡 Away</option>
              <option value="inactive">⚪ Offline</option>
            </select>
          </div>

          {/* Branch Filter */}
          <div>
            <select className="input" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="all">All Branches</option>
              {depts.map((d) => (
                <option key={d.id} value={String(d.id)}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Filter Results & Clear Action */}
        <div className="flex items-center justify-between pt-1 text-xs text-ink3">
          <div className="flex items-center gap-2">
            <span>
              Showing <b>{filtered.length}</b> of <b>{users.length}</b> users
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                className="text-brand hover:underline font-medium inline-flex items-center gap-1 ml-2"
                onClick={resetFilters}
              >
                <X size={12} /> Clear Filters
              </button>
            )}
          </div>
          <div className="text-[11px] text-ink3">
            Last synced: {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Users Grid */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<UserCog size={30} />}
          title="No users match your filters"
          subtitle="Try adjusting your search criteria or clear active filters."
          action={
            hasActiveFilters ? (
              <button className="btn btn-ghost btn-sm mt-2" onClick={resetFilters}>
                Clear All Filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((u) => {
            const isOnline = u.is_active && u.live_status === 'active';
            const isAway = u.is_active && u.live_status === 'away';
            return (
              <div
                key={u.id}
                className={cx(
                  'card card-hover p-4.5 anim-in flex flex-col justify-between transition-all duration-200',
                  !u.is_active && 'opacity-65 border-dashed bg-card/40'
                )}
              >
                <div>
                  {/* Top user header */}
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0 cursor-pointer" onClick={() => openDossier(u)}>
                      <Avatar name={u.name} src={u.avatar} size={46} />
                      <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-card ring-2 ring-card">
                        <LiveStatusDot
                          status={u.live_status || (u.is_active ? 'active' : 'inactive')}
                          size="xs"
                          pulse={isOnline}
                        />
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-bold text-ink1">
                        <span
                          className="truncate cursor-pointer hover:text-brand transition-colors"
                          onClick={() => openDossier(u)}
                          title="Click to view user activity dossier"
                        >
                          {u.name.replace(/\s*\((?:super\s*admin|superadmin)\)/gi, '')}
                        </span>
                        {u.id === me?.id && (
                          <span className="text-[10px] font-semibold text-brand px-1.5 py-0.5 rounded bg-brand/10 shrink-0">
                            You
                          </span>
                        )}
                      </div>

                      <div
                        className="text-xs text-ink3 truncate flex items-center gap-1 mt-0.5 cursor-pointer hover:text-ink1"
                        onClick={() => copyToClipboard(u.email, 'Email copied')}
                        title="Click to copy email"
                      >
                        <Mail size={11} className="shrink-0 text-ink3" />
                        <span className="truncate">{u.email}</span>
                      </div>

                      {u.phone ? (
                        <div className="text-xs text-ink3 truncate flex items-center gap-1.5 mt-0.5">
                          <a
                            href={`tel:${u.phone.replace(/[^\d+]/g, '')}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toast(`Initiating call to ${u.name} (${u.phone})...`, 'info');
                            }}
                            className="flex items-center gap-1 text-ink2 hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
                            title={`Click to call ${u.name}: ${u.phone}`}
                          >
                            <Phone size={11} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span className="truncate font-mono">{u.phone}</span>
                          </a>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(u.phone!, 'Phone copied');
                            }}
                            className="p-0.5 hover:text-ink1 text-ink3 rounded"
                            title="Copy phone"
                          >
                            <Copy size={10} />
                          </button>
                        </div>
                      ) : (
                        <div className="text-[11px] text-ink3/70 italic mt-0.5">No phone registered</div>
                      )}
                    </div>

                    {/* Role & Status Pill */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge color={u.role_group_color || roleColor[u.role] || '#94a3b8'}>
                        {(u.role_group_name || u.role).replace('_', ' ').toUpperCase()}
                      </Badge>
                      <LiveStatusBadge
                        status={u.live_status || (u.is_active ? 'active' : 'inactive')}
                        size="sm"
                        pulse={isOnline}
                      />
                    </div>
                  </div>

                  {/* Metadata Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3 text-xs text-ink2">
                    <span className="chip !text-[11px] !py-0.5 font-mono font-medium">
                      {u.employee_id || `EMP${String(u.id).padStart(3, '0')}`}
                    </span>
                    {u.title && <span className="chip !text-[11px] !py-0.5">{u.title}</span>}
                    {u.department_name && (
                      <span className="chip !text-[11px] !py-0.5 inline-flex items-center gap-1" title={`Branch: ${u.department_name}`}>
                        <Building2 size={10} className="text-brand shrink-0" />
                        <span>{u.department_name}</span>
                      </span>
                    )}
                    {u.team_name && (
                      <span className="chip !text-[11px] !py-0.5" title="Team">
                        <UsersIcon size={10} className="mr-1 inline text-brand" />
                        {u.team_name}
                      </span>
                    )}
                    <span className="chip !text-[11px] !py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" title={`Assigned Weekend: ${formatWeekendDaysFull(u.weekend_days)}`}>
                      <Calendar size={10} className="mr-1 inline text-amber-500" />
                      Weekend: {formatWeekendDays(u.weekend_days)}
                    </span>
                  </div>

                  {/* Tasks & Workload Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 p-2 rounded-lg bg-card2/50 border border-line/50 text-xs">
                    <div className="flex items-center gap-1.5">
                      <CheckSquare size={13} className="text-amber-500 shrink-0" />
                      <span className="text-ink3">Open Tasks:</span>
                      <span className="font-bold text-ink1">{u.open_tasks || 0}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check size={13} className="text-emerald-500 shrink-0" />
                      <span className="text-ink3">Completed:</span>
                      <span className="font-bold text-ink1">{u.completed_tasks || 0}</span>
                    </div>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="flex items-center justify-between border-t border-line/60 pt-2.5 mt-3">
                  <div className="flex items-center gap-1">
                    <button
                      className="btn btn-ghost btn-xs text-ink2"
                      onClick={() => openDossier(u)}
                      title="View user activity history and workload"
                    >
                      <Activity size={12} /> Dossier
                    </button>
                    {(!isSuper && u.role === 'super_admin') ? (
                      <span className="text-[11px] text-ink3 italic flex items-center gap-1 px-2 py-1 bg-card2/40 rounded-md border border-line/40">
                        <Lock size={11} className="text-purple-500" /> Super Admin
                      </span>
                    ) : (
                      <>
                        <button
                          className="btn btn-ghost btn-xs text-ink2"
                          onClick={() => openForm(u)}
                          title="Edit user details, role or branch"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-ink2"
                          onClick={() => openResetModal(u)}
                          title="Reset account password"
                        >
                          <KeyRound size={12} /> Password
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {(!isSuper && u.role === 'super_admin') ? null : (
                      <button
                        className={cx(
                          'btn btn-xs',
                          u.is_active
                            ? 'btn-ghost text-amber-600 hover:!bg-amber-500/10'
                            : 'btn-ghost text-emerald-600 hover:!bg-emerald-500/10'
                        )}
                        onClick={() => toggleActive(u)}
                        disabled={u.id === me?.id || (u.role === 'super_admin' && !isSuper)}
                        title={u.is_active ? 'Deactivate account' : 'Activate account'}
                      >
                        <Power size={12} />
                        <span>{u.is_active ? 'Deactivate' : 'Activate'}</span>
                      </button>
                    )}

                    {isSuper && u.id !== me?.id && (
                      <button
                        className="btn btn-ghost btn-xs !text-red-500 hover:!bg-red-500/10"
                        onClick={() => setDeleteTarget(u)}
                        title="Delete user account permanently"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* User Create / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit User: ${editing.name}` : 'Create New User Account'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Account'}
            </button>
          </>
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="label">Full Name *</label>
              <input
                className="input"
                placeholder="e.g. John Doe"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Email Address (Login) *</label>
              <input
                className="input"
                type="email"
                placeholder="user@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {editing && editing.email.toLowerCase() !== form.email.trim().toLowerCase() && (
                <p className="text-[11px] text-brand mt-1 flex items-center gap-1">
                  <Mail size={11} /> Will update login credential and sync across sessions.
                </p>
              )}
            </div>

            <div>
              <label className="label">Employee ID</label>
              <input
                className="input"
                placeholder="e.g. EMP001 (Auto-generated if blank)"
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Phone Number</label>
              <input
                className="input"
                placeholder="+880 1..."
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div>
              <label className="label">
                {editing ? 'Change Password (Optional)' : 'Password *'}
              </label>
              <div className="relative">
                <input
                  className="input !pr-10"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editing ? 'Leave blank to keep current password' : 'Min 6 characters'}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink1 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="label flex items-center justify-between">
                <span>Role & Permission Group</span>
                <span className="text-[11px] text-ink3 font-normal">Controls access, page permissions & authority</span>
              </label>
              {editing?.role === 'super_admin' ? (
                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs flex items-center justify-between text-purple-900 dark:text-purple-300">
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="text-purple-600 dark:text-purple-400 shrink-0" />
                    <div>
                      <div className="font-bold text-sm text-purple-700 dark:text-purple-300">Super Administrator</div>
                      <div className="text-[11px] text-ink3 mt-0.5">
                        Inherent 100% full system access across all modules, workflows, and settings.
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold text-xs uppercase tracking-wide">
                    Full Access (Auto)
                  </span>
                </div>
              ) : (
                <>
                  <select
                    className="input font-medium"
                    value={form.role_group_id}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const grp = roleGroups.find((g) => String(g.id) === selectedId);
                      setForm({
                        ...form,
                        role_group_id: selectedId,
                        role: grp ? (grp.slug === 'admin' ? 'admin' : 'user') : form.role,
                      });
                    }}
                  >
                    <option value="">Default System Role ({form.role.toUpperCase()})</option>
                    {roleGroups
                      .filter((rg) => rg.slug !== 'super_admin')
                      .map((rg) => (
                        <option key={rg.id} value={rg.id}>
                          {rg.name} {rg.is_system ? '• System Group' : '• Custom Group'} ({Array.isArray(rg.permissions) ? rg.permissions.length : 0} permissions)
                        </option>
                      ))}
                  </select>

                  {form.role_group_id && (
                    <div className="mt-2 p-2.5 rounded-xl bg-card2/80 border border-line text-xs flex items-center justify-between">
                      {(() => {
                        const activeGrp = roleGroups.find((g) => String(g.id) === form.role_group_id);
                        if (!activeGrp) return null;
                        const permsCount = Array.isArray(activeGrp.permissions) ? activeGrp.permissions.length : 0;
                        return (
                          <>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-3 h-3 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: activeGrp.color || '#6366f1' }} />
                              <span className="font-bold text-ink1">{activeGrp.name}</span>
                              <span className="text-ink3 truncate">— {activeGrp.description || 'Assigned permission policy'}</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-md bg-brand/10 text-brand font-mono font-bold text-[11px] shrink-0">
                              {permsCount} Permissions
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="label">Job Title / Designation</label>
              <input
                className="input"
                placeholder="e.g. IT Executive"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Branch</label>
              <select
                className="input"
                value={form.department_id}
                onChange={(e) => setForm({ ...form, department_id: e.target.value })}
              >
                <option value="">No Branch Assigned</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Assigned Team</label>
              <select
                className="input"
                value={form.team_id}
                onChange={(e) => setForm({ ...form, team_id: e.target.value })}
              >
                <option value="">No Team Assigned</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="label">Avatar Image URL (Optional)</label>
              <input
                className="input"
                placeholder="https://..."
                value={form.avatar}
                onChange={(e) => setForm({ ...form, avatar: e.target.value })}
              />
            </div>

            {/* Weekend Configuration Section */}
            <div className="sm:col-span-2 p-3.5 rounded-xl bg-card2/80 border border-line space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-ink1">
                    <Calendar size={14} className="text-brand" />
                    <span>Assigned Weekend Day(s)</span>
                  </div>
                  <p className="text-[11px] text-ink3 mt-0.5">
                    Select which day(s) this user observes as their weekend. These days are automatically excluded from leave deductions.
                  </p>
                </div>
                <div className="text-[11px] font-medium text-brand bg-brand/10 px-2 py-0.5 rounded shrink-0">
                  {form.weekend_days.length === 0
                    ? 'No weekend assigned'
                    : form.weekend_days.length === 1
                    ? `${WEEKDAY_NAMES[form.weekend_days[0]]} (${form.weekend_days.length} day/week)`
                    : `${formatWeekendDays(form.weekend_days)} (${form.weekend_days.length} days/week)`}
                </div>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-ink3 font-medium mr-1">Quick Presets:</span>
                {WEEKEND_PRESETS.map((preset) => {
                  const isActive =
                    preset.days.length === form.weekend_days.length &&
                    preset.days.every((d) => form.weekend_days.includes(d));
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={cx(
                        'text-[11px] px-2 py-0.5 rounded-md border transition-all',
                        isActive
                          ? 'bg-brand text-white border-brand font-medium shadow-xs'
                          : 'bg-card text-ink2 border-line hover:bg-card2 hover:text-ink1'
                      )}
                      onClick={() => applyWeekendPreset(preset.days)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Day-by-Day Selector Pills */}
              <div className="grid grid-cols-7 gap-1.5 pt-1">
                {WEEKDAY_OPTIONS.map((day) => {
                  const isSelected = form.weekend_days.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleWeekendDay(day.id)}
                      className={cx(
                        'flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all',
                        isSelected
                          ? 'bg-brand/15 border-brand text-brand font-bold shadow-xs'
                          : 'bg-card border-line text-ink2 hover:bg-card2 hover:border-ink3/40'
                      )}
                      title={`Toggle ${day.name} as weekend day`}
                    >
                      <span className="text-[10px] uppercase tracking-wider">{day.short}</span>
                      <span className="text-[11px] mt-0.5 font-medium">
                        {isSelected ? '✓ OFF' : 'WORK'}
                      </span>
                    </button>
                  );
                })}
               </div>
             </div>

             {/* Duty Time Configuration Section */}
             <div className="sm:col-span-2">
               <label className="label">Duty Time</label>
               <input
                 className="input"
                 placeholder="e.g. 09:00 - 18:00 (Mon-Fri)"
                 value={form.duty_time}
                 onChange={(e) => setForm({ ...form, duty_time: e.target.value })}
               />
                <p className="text-[11px] text-ink3 mt-0.5">
                  Define the user's working schedule. This will be displayed in the user profile and team roster.
                </p>
              </div>

              {/* Daily Task Group */}
              <div className="sm:col-span-2">
                <label className="label">Daily Task</label>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, daily_task_member: !form.daily_task_member })}
                  className={cx(
                    'w-full flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                    form.daily_task_member
                      ? 'border-brand/40 bg-brand/5'
                      : 'border-line bg-card hover:bg-card2',
                  )}
                >
                  <span className={cx(
                    'mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                    form.daily_task_member ? 'bg-brand border-brand text-white' : 'border-line',
                  )}>
                    {form.daily_task_member && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <CalendarCheck size={14} className="text-brand shrink-0" />
                      <span className="text-sm font-bold">Assign Daily Tasks</span>
                      {form.daily_task_member && <Badge color="#6366f1">Member</Badge>}
                    </span>
                    <span className="block text-[11px] text-ink3 mt-0.5">
                      Tagged users receive CCTV Monitoring, All ISP Check, Internal Network Check and Server Check
                      &amp; Backup Check automatically at 12:00 AM every day. Only tagged users get Daily Tasks.
                    </span>
                  </span>
                </button>
              </div>
            </div>

         </div>
       </Modal>

      {/* User Dossier & Activity Inspection Modal */}
      <Modal
        open={!!dossierUser}
        onClose={() => setDossierUser(null)}
        title={dossierUser ? `User Dossier: ${dossierUser.name}` : 'User Dossier'}
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-ink3">
              Account created: {dossierUser?.created_at ? new Date(dossierUser.created_at).toLocaleDateString() : 'N/A'}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (dossierUser) {
                    const u = dossierUser;
                    setDossierUser(null);
                    openForm(u);
                  }
                }}
              >
                <Pencil size={13} /> Edit Account
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setDossierUser(null)}>
                Close
              </button>
            </div>
          </div>
        }
      >
        {dossierUser && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* Header Identity */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-card2 border border-line">
              <Avatar name={dossierUser.name} src={dossierUser.avatar} size={52} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-base text-ink1 truncate">{dossierUser.name}</h3>
                  <Badge color={roleColor[dossierUser.role] || '#94a3b8'}>
                    {dossierUser.role.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
                <div className="text-xs text-ink2 mt-0.5">{dossierUser.email}</div>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-ink3">
                  <span className="font-mono bg-card px-1.5 py-0.5 rounded border border-line text-ink1 font-medium">
                    {dossierUser.employee_id || `EMP${String(dossierUser.id).padStart(3, '0')}`}
                  </span>
                  {dossierUser.title && <span>{dossierUser.title}</span>}
                  {dossierUser.department_name && (
                    <span className="flex items-center gap-1.5 text-brand">
                      <Building2 size={12} className="shrink-0" />
                      <span>{dossierUser.department_name}</span>
                    </span>
                  )}
                  {dossierUser.team_name && (
                    <span className="flex items-center gap-1">
                      <UsersIcon size={11} /> {dossierUser.team_name}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                    <Calendar size={11} /> Weekend: {formatWeekendDaysFull(dossierUser.weekend_days)}
                  </span>
                </div>
              </div>
            </div>

            {/* Live Status & Last Active */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-card border border-line">
                <div className="text-ink3 text-[11px]">Live Status</div>
                <div className="font-semibold text-ink1 mt-1 flex items-center gap-1.5">
                  <LiveStatusDot status={dossierUser.live_status || 'inactive'} size="xs" />
                  <span className="capitalize">{dossierUser.live_status || 'Offline'}</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-card border border-line">
                <div className="text-ink3 text-[11px]">Assigned Weekend</div>
                <div className="font-semibold text-amber-600 dark:text-amber-400 mt-1 truncate" title={formatWeekendDaysFull(dossierUser.weekend_days)}>
                  {formatWeekendDays(dossierUser.weekend_days)}
                </div>
              </div>

              {dossierUser.duty_time && (
                <div className="p-2.5 rounded-lg bg-card border border-line">
                  <div className="text-ink3 text-[11px]">Duty Time</div>
                  <div className="font-semibold text-ink1 mt-1 truncate" title={dossierUser.duty_time}>
                    {dossierUser.duty_time}
                  </div>
                </div>
              )}

              <div className="p-2.5 rounded-lg bg-card border border-line">
                <div className="text-ink3 text-[11px]">Open Tasks</div>
                <div className="font-bold text-ink1 mt-1">{dossierUser.open_tasks || 0}</div>
              </div>

              <div className="p-2.5 rounded-lg bg-card border border-line">
                <div className="text-ink3 text-[11px]">Completed Tasks</div>
                <div className="font-bold text-emerald-600 mt-1">{dossierUser.completed_tasks || 0}</div>
              </div>
            </div>

            {/* Assigned Open Tasks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-xs uppercase tracking-wider text-ink3 flex items-center gap-1.5">
                  <CheckSquare size={13} className="text-brand" /> Active Assigned Tasks ({dossierData?.openTasks?.length || 0})
                </h4>
              </div>

              {dossierLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : !dossierData?.openTasks?.length ? (
                <div className="text-xs text-ink3 py-3 text-center border border-dashed border-line rounded-lg">
                  No open tasks currently assigned to this user.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {dossierData.openTasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-2 rounded-lg bg-card border border-line text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <span className={cx(
                          'w-2 h-2 rounded-full shrink-0',
                          t.priority === 'urgent' ? 'bg-red-500' : t.priority === 'high' ? 'bg-amber-500' : 'bg-blue-500'
                        )} />
                        <span className="font-medium text-ink1 truncate">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-ink3 text-[11px]">
                        <span className="chip !text-[10px] !py-0">{t.status.replace('_', ' ')}</span>
                        {t.due_date && <span>Due: {t.due_date}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Completed Tasks */}
            {dossierData?.completedTasks && dossierData.completedTasks.length > 0 && (
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-ink3 mb-2 flex items-center gap-1.5">
                  <Check size={13} className="text-emerald-500" /> Recently Completed Tasks
                </h4>
                <div className="space-y-1.5">
                  {dossierData.completedTasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-2 rounded-lg bg-card/60 border border-line text-xs">
                      <div className="font-medium text-ink1 truncate">{t.title}</div>
                      <div className="text-[11px] text-ink3 shrink-0">
                        {t.completed_at ? new Date(t.completed_at).toLocaleDateString() : 'Completed'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audit Events */}
            {dossierData?.recentLogs && dossierData.recentLogs.length > 0 && (
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-ink3 mb-2 flex items-center gap-1.5">
                  <Activity size={13} className="text-purple-500" /> Recent Security & Activity Logs
                </h4>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {dossierData.recentLogs.map((log) => (
                    <div key={log.id} className="p-2 rounded-lg bg-card2/60 border border-line text-xs">
                      <div className="flex items-center justify-between gap-2 text-ink2">
                        <span className="font-mono font-bold text-[11px] text-ink1">{log.action}</span>
                        <span className="text-[10px] text-ink3">{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-[11px] text-ink3 mt-0.5">{log.details}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Dedicated Reset Password Modal */}
      <Modal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title={resetSuccessResult ? 'Password Reset Successful' : `Reset Password: ${resetTarget?.name}`}
        footer={
          resetSuccessResult ? (
            <button className="btn btn-primary" onClick={() => setResetModalOpen(false)}>
              Done
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setResetModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleResetPassword} disabled={resetting}>
                {resetting ? 'Resetting...' : 'Set Password'}
              </button>
            </>
          )
        }
      >
        {resetSuccessResult ? (
          <div className="space-y-4 text-center py-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto">
              <Check size={24} />
            </div>
            <div>
              <h3 className="font-bold text-base">Password Updated for {resetTarget?.name}</h3>
              <p className="text-xs text-ink3 mt-1">Please copy this password and securely provide it to the user.</p>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-card2 border border-line font-mono text-sm">
              <span className="font-bold select-all">{resetSuccessResult}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs flex items-center gap-1"
                onClick={() => copyToClipboard(resetSuccessResult, 'Password copied')}
              >
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <p className="text-xs text-ink3">
              The user can now log in using <b>{resetTarget?.email}</b> and this new password.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-card2/80 border border-line text-xs text-ink2 flex items-center gap-2">
              <KeyRound size={16} className="text-brand shrink-0" />
              <div>
                Resetting password for <b>{resetTarget?.name}</b> ({resetTarget?.email}).
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label !mb-0">New Password</label>
                <button
                  type="button"
                  className="text-xs text-brand hover:underline flex items-center gap-1"
                  onClick={generateRandomPassword}
                >
                  <RefreshCw size={11} /> Generate Random Password
                </button>
              </div>
              <div className="relative">
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  className="input !pr-10"
                  placeholder="Enter custom password or click Generate above"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink1 transition-colors"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                >
                  {showResetPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-[11px] text-ink3 mt-1">
                If left empty, a secure temporary password will be automatically generated.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete User Confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete User Account?"
        message={`Permanently delete ${deleteTarget?.name} (${deleteTarget?.email})? This cleans up their assignments, time entries, approvals, and comments. This cannot be undone.`}
        confirmLabel="Delete User"
        danger
      />
    </div>
  );
}
