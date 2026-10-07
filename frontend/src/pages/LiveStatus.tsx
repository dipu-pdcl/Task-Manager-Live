import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Radio, Users, Search, RefreshCw, Shield,
  Building2, CheckCircle2, AlertCircle, Eye, MessageSquare,
  Download, ArrowUpDown
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { LiveStatusSummary, LiveStatusUser, LiveStatusType } from '../lib/types';
import { LiveStatusBadge, LiveStatusDot } from '../components/LiveStatusIndicator';
import { Avatar, Badge } from '../components/ui';
import { timeAgo, cx } from '../lib/utils';

export default function LiveStatus() {
  const { user, isAdmin, updateLiveStatus } = useAuth();
  const [summary, setSummary] = useState<LiveStatusSummary>({ total: 0, active: 0, away: 0, inactive: 0 });
  const [users, setUsers] = useState<LiveStatusUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, setTick] = useState(0);
  const isMountedRef = useRef(true);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LiveStatusType>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'status' | 'name' | 'last_active' | 'emp_id'>('status');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Status updating state for current user
  const [updatingMyStatus, setUpdatingMyStatus] = useState(false);
  const [customMessage, setCustomMessage] = useState(user?.status_message || '');
  const [showCustomMsgInput, setShowCustomMsgInput] = useState(false);

  // Admin modal for managing a user's status
  const [selectedUserForAdmin, setSelectedUserForAdmin] = useState<LiveStatusUser | null>(null);
  const [adminStatusOverride, setAdminStatusOverride] = useState<LiveStatusType>('active');
  const [adminMsgOverride, setAdminMsgOverride] = useState('');
  const [savingAdminOverride, setSavingAdminOverride] = useState(false);

  const loadData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.get<{
        summary: LiveStatusSummary;
        users: LiveStatusUser[];
        server_time?: string;
      }>('/live-status/overview');

      if (isMountedRef.current && data) {
        setSummary(data.summary || { total: 0, active: 0, away: 0, inactive: 0 });
        setUsers(data.users || []);
        setLastRefreshedAt(new Date());
        setError(null);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        // Only surface user-facing error message if we have no existing data or manual refresh
        if (isManual || users.length === 0) {
          setError(err?.message || 'Failed to connect to live status service');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        if (isManual) setRefreshing(false);
      }
    }
  }, [users.length]);

  // Initial load + interval auto-refresh under 5s (every 3 seconds)
  useEffect(() => {
    isMountedRef.current = true;
    loadData();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && isMountedRef.current) {
        loadData();
      }
    }, 3000);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadData, autoRefresh]);

  // Dynamic 1-second ticker to keep relative time strings live
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync custom message from auth user
  useEffect(() => {
    if (user?.status_message !== undefined) {
      setCustomMessage(user.status_message || '');
    }
  }, [user?.status_message]);

  const handleStatusChange = async (newStatus: LiveStatusType, msg?: string) => {
    setUpdatingMyStatus(true);
    try {
      await updateLiveStatus(newStatus, msg !== undefined ? msg : customMessage);
      await loadData();
    } catch (err) {
      console.error('Failed to update live status:', err);
    } finally {
      setUpdatingMyStatus(false);
    }
  };

  const handleSaveCustomMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user) return;
    setUpdatingMyStatus(true);
    try {
      const current = (user.live_status as LiveStatusType) || 'active';
      await updateLiveStatus(current, customMessage);
      setShowCustomMsgInput(false);
      await loadData();
    } catch (err) {
      console.error('Failed to save message:', err);
    } finally {
      setUpdatingMyStatus(false);
    }
  };

  const handleAdminSaveStatus = async () => {
    if (!selectedUserForAdmin) return;
    setSavingAdminOverride(true);
    try {
      await api.put(`/live-status/admin/set-user-status/${selectedUserForAdmin.id}`, {
        status: adminStatusOverride,
        status_message: adminMsgOverride,
      });
      setSelectedUserForAdmin(null);
      await loadData();
    } catch (err) {
      console.error('Failed to save admin status override:', err);
    } finally {
      setSavingAdminOverride(false);
    }
  };

  // Extract unique departments for filter dropdown
  const departments = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (u.department_name) set.add(u.department_name);
    });
    return Array.from(set).sort();
  }, [users]);

  // Filtered & Sorted list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Status filter
      if (statusFilter !== 'all' && u.live_status !== statusFilter) return false;
      // Department filter
      if (deptFilter !== 'all' && u.department_name !== deptFilter) return false;
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = u.name.toLowerCase().includes(q);
        const matchEmail = u.email.toLowerCase().includes(q);
        const matchEmpId = (u.employee_id || '').toLowerCase().includes(q);
        const matchDept = (u.department_name || '').toLowerCase().includes(q);
        const matchTitle = (u.title || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchEmpId && !matchDept && !matchTitle) return false;
      }
      return true;
    }).sort((a, b) => {
      let comp = 0;
      if (sortBy === 'status') {
        const orderWeight: Record<LiveStatusType, number> = { active: 1, away: 2, inactive: 3 };
        comp = (orderWeight[a.live_status] || 3) - (orderWeight[b.live_status] || 3);
      } else if (sortBy === 'name') {
        comp = a.name.localeCompare(b.name);
      } else if (sortBy === 'emp_id') {
        comp = (a.employee_id || '').localeCompare(b.employee_id || '');
      } else if (sortBy === 'last_active') {
        const tA = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
        const tB = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
        comp = tB - tA; // latest first by default
      }
      return sortOrder === 'asc' ? comp : -comp;
    });
  }, [users, statusFilter, deptFilter, search, sortBy, sortOrder]);

  const currentLiveStatus: LiveStatusType = (user?.live_status as LiveStatusType) || 'active';

  // Export to CSV
  const handleExportCSV = () => {
    const headers = ['Name', 'Employee ID', 'Email', 'Branch', 'Role', 'Live Status', 'Status Message', 'Last Active', 'Last Login'];
    const rows = filteredUsers.map((u) => [
      `"${u.name.replace(/"/g, '""')}"`,
      `"${u.employee_id || ''}"`,
      `"${u.email}"`,
      `"${u.department_name || ''}"`,
      `"${u.role}"`,
      `"${u.live_status}"`,
      `"${(u.status_message || '').replace(/"/g, '""')}"`,
      `"${u.last_active_at || 'Never'}"`,
      `"${u.last_login || 'Never'}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `live_status_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const statusPresets = [
    'Available & working on tasks',
    'In a client meeting',
    'Lunch break',
    'Stepped away briefly',
    'Focused deep work (Do not disturb)',
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Radio size={22} className="animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2.5">
                <span>Live Status</span>
                <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  Live Sync
                </span>
              </h1>
              <p className="text-xs text-ink3 mt-0.5">
                Real-time user presence, activity tracking, and workplace availability
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <label className="flex items-center gap-2 text-xs font-medium text-ink2 bg-card2 px-3 py-2 rounded-xl border border-line cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded text-brand focus:ring-brand accent-brand"
            />
            <span>Auto-refresh (3s)</span>
          </label>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="btn btn-ghost border border-line flex items-center gap-2 text-xs !py-2 !px-3.5"
            title="Refresh live status now"
          >
            <RefreshCw size={14} className={cx(refreshing && 'animate-spin text-brand')} />
            <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
          </button>

          {isAdmin && (
            <button
              onClick={handleExportCSV}
              className="btn btn-ghost border border-line flex items-center gap-2 text-xs !py-2 !px-3.5"
              title="Export status list to CSV"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Error alert if service connection drops */}
      {error && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle size={16} className="text-amber-500 shrink-0" />
            <span className="truncate">Live status service temporarily unavailable ({error}). Automatic sync is active.</span>
          </div>
          <button
            onClick={() => loadData(true)}
            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-semibold shrink-0 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* User Live Status Switcher Card */}
      <div className="card p-5 border border-line relative overflow-hidden" style={{ background: 'rgb(var(--card))' }}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* User info snippet */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative shrink-0">
              <Avatar name={user?.name} src={user?.avatar} size={48} />
              <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-card ring-2 ring-card">
                <LiveStatusDot status={currentLiveStatus} size="sm" pulse={currentLiveStatus === 'active'} />
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base text-ink leading-snug">{user?.name}</span>
                <Badge color="#8b5cf6" className="text-[11px] !py-0.5 !px-2 shrink-0">{user?.role?.replace('_', ' ')}</Badge>
                <span className="text-[11px] font-mono text-ink3 bg-card2 px-2 py-0.5 rounded-md border border-line shrink-0">
                  {user?.employee_id || `EMP${String(user?.id || 0).padStart(3, '0')}`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink3 flex-wrap">
                <span className="text-ink2 font-medium">{user?.department_name || 'General Team'}</span>
                <span>•</span>
                <span>{user?.title || 'Chief Executive Officer'}</span>
                {user?.status_message && (
                  <>
                    <span>•</span>
                    <span className="italic text-ink2 bg-card2 px-2 py-0.5 rounded-md border border-line text-[11px] truncate max-w-[240px]" title={user.status_message}>
                      "{user.status_message}"
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick status selector buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <div className="text-xs font-semibold text-ink3 sm:text-right hidden xl:block">
              Set Your Status:
            </div>

            <div className="inline-flex p-1 rounded-2xl bg-card2 border border-line gap-1">
              {/* Active */}
              <button
                type="button"
                onClick={() => handleStatusChange('active')}
                disabled={updatingMyStatus}
                className={cx(
                  'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all',
                  currentLiveStatus === 'active'
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                    : 'text-ink2 hover:bg-card hover:text-ink'
                )}
              >
                <span className={cx('w-2.5 h-2.5 rounded-full', currentLiveStatus === 'active' ? 'bg-white' : 'bg-emerald-500')} />
                <span>🟢 Active</span>
              </button>

              {/* Away */}
              <button
                type="button"
                onClick={() => handleStatusChange('away')}
                disabled={updatingMyStatus}
                className={cx(
                  'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all',
                  currentLiveStatus === 'away'
                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25'
                    : 'text-ink2 hover:bg-card hover:text-ink'
                )}
              >
                <span className={cx('w-2.5 h-2.5 rounded-full', currentLiveStatus === 'away' ? 'bg-white' : 'bg-amber-400')} />
                <span>🟡 Away</span>
              </button>

              {/* Inactive indicator (Auto-managed) */}
              <div
                className={cx(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-ink3 select-none opacity-80',
                  currentLiveStatus === 'inactive' && 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                )}
                title="Status changes to Inactive automatically upon logout or disconnection"
              >
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>🔴 Inactive (Auto)</span>
              </div>
            </div>

            {/* Custom Status Message Button */}
            <button
              type="button"
              onClick={() => setShowCustomMsgInput((prev) => !prev)}
              className="btn btn-ghost border border-line text-xs flex items-center justify-center gap-1.5 !py-2 !px-3"
              title="Add a custom status message"
            >
              <MessageSquare size={13} />
              <span>{user?.status_message ? 'Edit Message' : 'Status Note'}</span>
            </button>
          </div>
        </div>

        {/* Custom Status Message Expandable Drawer */}
        {showCustomMsgInput && (
          <form onSubmit={handleSaveCustomMessage} className="mt-4 pt-4 border-t border-line anim-fade">
            <div className="text-xs font-semibold text-ink2 mb-2 flex items-center justify-between">
              <span>Set custom status note for team visibility:</span>
              <span className="text-[11px] text-ink3">Max 200 characters</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="e.g. In client meeting until 3:00 PM / Focused coding session"
                maxLength={200}
                className="input text-xs flex-1"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={updatingMyStatus}
                  className="btn btn-primary text-xs !py-2 !px-4 shrink-0"
                >
                  {updatingMyStatus ? 'Saving...' : 'Save Note'}
                </button>
                {customMessage && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMessage('');
                      handleStatusChange(currentLiveStatus, '');
                    }}
                    className="btn btn-ghost text-xs !py-2 !px-3 text-ink3 hover:text-bad"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Preset shortcuts */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
              <span className="text-[11px] text-ink3 mr-1">Quick presets:</span>
              {statusPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCustomMessage(preset);
                    handleStatusChange(currentLiveStatus, preset);
                    setShowCustomMsgInput(false);
                  }}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-card2 hover:bg-brand/10 hover:text-brand text-ink3 border border-line transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>
          </form>
        )}
      </div>

      {/* Live Status Overview Counters (Admin & User Dashboard) */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center justify-between">
          <span>Live Status Overview</span>
          <span className="text-[11px] text-ink3 font-normal">
            Updated {timeAgo(lastRefreshedAt.toISOString())}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Active users */}
          <div
            onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
            className={cx(
              'card p-4.5 border transition-all cursor-pointer select-none hover:shadow-md relative overflow-hidden group',
              statusFilter === 'active'
                ? 'border-emerald-500/60 ring-2 ring-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/20'
                : 'border-line hover:border-emerald-500/30'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
              <span className="text-lg">🟢</span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-ink tracking-tight">
                {summary.active}
              </span>
              <span className="text-xs text-ink3 font-medium">users</span>
            </div>
            <div className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70 mt-1 font-medium">
              {summary.total > 0 ? `${Math.round((summary.active / summary.total) * 100)}% of workforce` : '0%'}
            </div>
          </div>

          {/* Away users */}
          <div
            onClick={() => setStatusFilter(statusFilter === 'away' ? 'all' : 'away')}
            className={cx(
              'card p-4.5 border transition-all cursor-pointer select-none hover:shadow-md relative overflow-hidden group',
              statusFilter === 'away'
                ? 'border-amber-500/60 ring-2 ring-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20'
                : 'border-line hover:border-amber-500/30'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                Away
              </span>
              <span className="text-lg">🟡</span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-ink tracking-tight">
                {summary.away}
              </span>
              <span className="text-xs text-ink3 font-medium">users</span>
            </div>
            <div className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-1 font-medium">
              Temporarily unavailable
            </div>
          </div>

          {/* Inactive users */}
          <div
            onClick={() => setStatusFilter(statusFilter === 'inactive' ? 'all' : 'inactive')}
            className={cx(
              'card p-4.5 border transition-all cursor-pointer select-none hover:shadow-md relative overflow-hidden group',
              statusFilter === 'inactive'
                ? 'border-rose-500/60 ring-2 ring-rose-500/20 bg-rose-500/5 dark:bg-rose-950/20'
                : 'border-line hover:border-rose-500/30'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                Inactive
              </span>
              <span className="text-lg">🔴</span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-ink tracking-tight">
                {summary.inactive}
              </span>
              <span className="text-xs text-ink3 font-medium">users</span>
            </div>
            <div className="text-[11px] text-rose-600/80 dark:text-rose-400/70 mt-1 font-medium">
              Offline / Logged out
            </div>
          </div>

          {/* Total users */}
          <div
            onClick={() => setStatusFilter('all')}
            className={cx(
              'card p-4.5 border transition-all cursor-pointer select-none hover:shadow-md relative overflow-hidden group',
              statusFilter === 'all'
                ? 'border-brand/60 ring-2 ring-brand/20 bg-brand/5 dark:bg-brand/10'
                : 'border-line hover:border-brand/30'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink2 flex items-center gap-1.5">
                <Users size={14} className="text-brand" />
                Total Users
              </span>
              <Badge color="#3b82f6">All</Badge>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-ink tracking-tight">
                {summary.total}
              </span>
              <span className="text-xs text-ink3 font-medium">registered</span>
            </div>
            <div className="text-[11px] text-ink3 mt-1 font-medium">
              Enterprise members
            </div>
          </div>
        </div>
      </div>

      {/* Main Monitoring Section & User List */}
      <div className="card border border-line overflow-hidden" style={{ background: 'rgb(var(--card))' }}>
        {/* Filter Controls Bar */}
        <div className="p-4 border-b border-line bg-card2/30 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 p-1 bg-card rounded-xl border border-line overflow-x-auto shrink-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={cx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                statusFilter === 'all'
                  ? 'bg-brand text-white shadow-sm font-semibold'
                  : 'text-ink2 hover:bg-card2'
              )}
            >
              All Users ({summary.total})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={cx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                statusFilter === 'active'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-ink2 hover:bg-card2'
              )}
            >
              <LiveStatusDot status="active" size="xs" pulse={false} />
              <span>Active ({summary.active})</span>
            </button>
            <button
              onClick={() => setStatusFilter('away')}
              className={cx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                statusFilter === 'away'
                  ? 'bg-amber-500 text-white shadow-sm font-semibold'
                  : 'text-ink2 hover:bg-card2'
              )}
            >
              <LiveStatusDot status="away" size="xs" pulse={false} />
              <span>Away ({summary.away})</span>
            </button>
            <button
              onClick={() => setStatusFilter('inactive')}
              className={cx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                statusFilter === 'inactive'
                  ? 'bg-rose-600 text-white shadow-sm font-semibold'
                  : 'text-ink2 hover:bg-card2'
              )}
            >
              <LiveStatusDot status="inactive" size="xs" pulse={false} />
              <span>Inactive ({summary.inactive})</span>
            </button>
          </div>

          {/* Search & Branch filters */}
          <div className="flex items-center gap-2.5 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user, ID, branch..."
                className="input !pl-8.5 !py-1.5 text-xs rounded-xl w-full"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink3 hover:text-ink"
                >
                  ✕
                </button>
              )}
            </div>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="input text-xs !py-1.5 rounded-xl shrink-0 max-w-[160px]"
            >
              <option value="all">All Branches</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* User Presence Table (Admin & User view) */}
        {loading ? (
          <div className="p-12 text-center text-ink3">
            <div className="animate-spin w-8 h-8 rounded-full border-2 border-brand border-t-transparent mx-auto mb-3" />
            <div className="text-sm font-medium">Loading live user statuses...</div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-ink3">
            <Users size={32} className="mx-auto mb-2 opacity-30" />
            <div className="font-semibold text-ink mb-1">No users match your criteria</div>
            <div className="text-xs">Try adjusting your status filter, branch, or search query.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-line">
              <thead className="bg-card2/50 text-ink3 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    onClick={() => {
                      if (sortBy === 'name') setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                      else { setSortBy('name'); setSortOrder('asc'); }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>User</span>
                      <ArrowUpDown size={11} className={sortBy === 'name' ? 'text-brand' : 'opacity-40'} />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    onClick={() => {
                      if (sortBy === 'emp_id') setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                      else { setSortBy('emp_id'); setSortOrder('asc'); }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>Employee ID</span>
                      <ArrowUpDown size={11} className={sortBy === 'emp_id' ? 'text-brand' : 'opacity-40'} />
                    </div>
                  </th>
                  <th className="px-4 py-3">Branch</th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    onClick={() => {
                      if (sortBy === 'status') setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                      else { setSortBy('status'); setSortOrder('asc'); }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>Live Status</span>
                      <ArrowUpDown size={11} className={sortBy === 'status' ? 'text-brand' : 'opacity-40'} />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-ink transition-colors"
                    onClick={() => {
                      if (sortBy === 'last_active') setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                      else { setSortBy('last_active'); setSortOrder('desc'); }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>Last Active</span>
                      <ArrowUpDown size={11} className={sortBy === 'last_active' ? 'text-brand' : 'opacity-40'} />
                    </div>
                  </th>
                  <th className="px-4 py-3">Last Login</th>
                  {isAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredUsers.map((u) => {
                  const isMe = u.id === user?.id;
                  return (
                    <tr
                      key={u.id}
                      className={cx(
                        'hover:bg-card2/60 transition-colors group',
                        isMe && 'bg-brand/5 dark:bg-brand/10 font-medium'
                      )}
                    >
                      {/* User (Name + Avatar + Title) */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <Avatar name={u.name} src={u.avatar} size={34} />
                            <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-card ring-1 ring-card">
                              <LiveStatusDot status={u.live_status} size="xs" pulse={u.live_status === 'active'} />
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-ink flex items-center gap-1.5">
                              <span className="truncate">{u.name}</span>
                              {isMe && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-brand/20 text-brand font-bold">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink3 truncate">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Employee ID */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-card2 border border-line text-ink2">
                          {u.employee_id || `EMP${String(u.id).padStart(3, '0')}`}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-ink2">
                          <Building2 size={13} className="text-ink3 shrink-0" />
                          <span className="truncate">{u.department_name}</span>
                        </div>
                      </td>

                      {/* Live Status with Light */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <LiveStatusBadge status={u.live_status} size="sm" pulse={u.live_status === 'active'} />
                          {u.status_message && (
                            <span className="text-[11px] text-ink3 italic truncate max-w-[200px]" title={u.status_message}>
                              💬 {u.status_message}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Last Active */}
                      <td className="px-4 py-3">
                        {u.live_status === 'active' ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                            Just now (Live)
                          </span>
                        ) : u.last_active_at ? (
                          <div className="text-ink2 text-[11px]" title={new Date(u.last_active_at).toLocaleString()}>
                            {timeAgo(u.last_active_at)}
                          </div>
                        ) : (
                          <span className="text-ink3 text-[11px]">No activity</span>
                        )}
                      </td>

                      {/* Last Login */}
                      <td className="px-4 py-3 text-ink3 text-[11px]">
                        {u.last_login ? (
                          <span title={new Date(u.last_login).toLocaleString()}>
                            {new Date(u.last_login).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        ) : (
                          <span>Never</span>
                        )}
                      </td>

                      {/* Admin Actions */}
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setSelectedUserForAdmin(u);
                              setAdminStatusOverride(u.live_status);
                              setAdminMsgOverride(u.status_message || '');
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium text-ink2 hover:bg-card2 hover:text-brand transition-colors border border-transparent hover:border-line"
                            title="Manage user live status (Admin)"
                          >
                            Manage
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Summary */}
        <div className="px-4 py-3 bg-card2/40 border-t border-line text-xs text-ink3 flex items-center justify-between">
          <div>
            Showing <strong className="text-ink">{filteredUsers.length}</strong> of{' '}
            <strong className="text-ink">{users.length}</strong> total users
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{summary.active} Active</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>{summary.away} Away</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>{summary.inactive} Inactive</span>
            </span>
          </div>
        </div>
      </div>

      {/* Admin Status Override Modal */}
      {selectedUserForAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 anim-fade">
          <div className="card p-6 w-full max-w-md border border-line shadow-2xl anim-scale" style={{ background: 'rgb(var(--card))' }}>
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2.5">
                <Shield size={18} className="text-brand" />
                <h3 className="font-bold text-base text-ink">Manage User Status</h3>
              </div>
              <button
                onClick={() => setSelectedUserForAdmin(null)}
                className="text-ink3 hover:text-ink p-1 rounded-lg hover:bg-card2"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Target User Info */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-card2 border border-line">
                <Avatar name={selectedUserForAdmin.name} src={selectedUserForAdmin.avatar} size={40} />
                <div>
                  <div className="font-semibold text-sm text-ink">{selectedUserForAdmin.name}</div>
                  <div className="text-xs text-ink3">
                    {selectedUserForAdmin.employee_id} • {selectedUserForAdmin.department_name}
                  </div>
                </div>
              </div>

              {/* Status Selector */}
              <div>
                <label className="label">Live Status Light</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdminStatusOverride('active')}
                    className={cx(
                      'p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all',
                      adminStatusOverride === 'active'
                        ? 'bg-emerald-500 text-white border-emerald-600 shadow-md shadow-emerald-500/25'
                        : 'bg-card2 border-line text-ink2 hover:bg-card'
                    )}
                  >
                    <LiveStatusDot status="active" size="md" pulse={false} />
                    <span>🟢 Active</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAdminStatusOverride('away')}
                    className={cx(
                      'p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all',
                      adminStatusOverride === 'away'
                        ? 'bg-amber-500 text-white border-amber-600 shadow-md shadow-amber-500/25'
                        : 'bg-card2 border-line text-ink2 hover:bg-card'
                    )}
                  >
                    <LiveStatusDot status="away" size="md" pulse={false} />
                    <span>🟡 Away</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAdminStatusOverride('inactive')}
                    className={cx(
                      'p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all',
                      adminStatusOverride === 'inactive'
                        ? 'bg-rose-600 text-white border-rose-700 shadow-md shadow-rose-600/25'
                        : 'bg-card2 border-line text-ink2 hover:bg-card'
                    )}
                  >
                    <LiveStatusDot status="inactive" size="md" pulse={false} />
                    <span>🔴 Inactive</span>
                  </button>
                </div>
              </div>

              {/* Status Note */}
              <div>
                <label className="label">Status Message / Reason (Optional)</label>
                <input
                  type="text"
                  value={adminMsgOverride}
                  onChange={(e) => setAdminMsgOverride(e.target.value)}
                  placeholder="e.g. Set by Admin for training / On scheduled leave"
                  className="input text-xs"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setSelectedUserForAdmin(null)}
                  className="btn btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdminSaveStatus}
                  disabled={savingAdminOverride}
                  className="btn btn-primary text-xs"
                >
                  {savingAdminOverride ? 'Saving...' : 'Update Status'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
