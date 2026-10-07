import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Plus, CheckCircle2, XCircle, Clock,
  Search, Check, X, User as UserIcon, Building2, Users as UsersIcon,
  ChevronLeft, ChevronRight, Download, Sparkles,
  HeartPulse, Coffee, CalendarCheck2, ArrowRight, Calendar,
  RotateCcw
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  User,
  LeaveApplication,
  LeaveSummaryResponse,
  LeaveType,
  LeaveStatus,
  DurationType,
  EmployeeLeaveLedger,
  LeaveBalance,
  LeaveCalculationResult,
} from '../lib/types';
import { useAuth } from '../lib/auth';
import { Avatar, Badge, Modal, ConfirmModal, useToast, Skeleton, EmptyState } from '../components/ui';
import {
  cx,
  prettyDate,
  parseWeekendDays,
  formatWeekendDays,
  formatWeekendDaysFull,
  calculateLeaveDaysClient,
  WEEKDAY_NAMES,
} from '../lib/utils';

interface LeaveTypeMeta {
  id: LeaveType;
  name: string;
  shortName: string;
  quota: number;
  color: string;
  badgeClass: string;
  description: string;
}

const LEAVE_TYPES: LeaveTypeMeta[] = [
  {
    id: 'EL',
    name: 'Earned Leave (EL)',
    shortName: 'Earned Leave',
    quota: 14,
    color: '#3b82f6',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    description: '14 days/yr · Planned vacations & privilege leave',
  },
  {
    id: 'CL',
    name: 'Casual Leave (CL)',
    shortName: 'Casual Leave',
    quota: 10,
    color: '#f59e0b',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    description: '10 days/yr · Unplanned short personal matters',
  },
  {
    id: 'SL',
    name: 'Sick Leave (SL)',
    shortName: 'Sick Leave',
    quota: 14,
    color: '#ec4899',
    badgeClass: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30',
    description: '14 days/yr · Separate medical & illness quota',
  },
];

const STATUS_CONFIG: Record<LeaveStatus, { label: string; color: string; icon: any; badgeClass: string }> = {
  pending: { label: 'Pending Review', color: '#f59e0b', icon: Clock, badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  approved: { label: 'Approved', color: '#10b981', icon: CheckCircle2, badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  rejected: { label: 'Rejected', color: '#ef4444', icon: XCircle, badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30' },
  cancelled: { label: 'Cancelled', color: '#94a3b8', icon: X, badgeClass: 'bg-slate-500/10 text-slate-500 border-slate-500/30' },
};

export default function Leaves() {
  const toast = useToast();
  const { user: me, isAdmin } = useAuth();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [activeTab, setActiveTab] = useState<'my' | 'all' | 'calendar' | 'ledger'>('my');

  // Data states
  const [summary, setSummary] = useState<LeaveSummaryResponse | null>(null);
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [allBalances, setAllBalances] = useState<EmployeeLeaveLedger[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters for applications list
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Staff Ledger Filter & Search States (Branch-wise, Employee-wise, Keyword, Sort)
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState<string>('');
  const [ledgerBranch, setLedgerBranch] = useState<string>('all');
  const [ledgerEmployee, setLedgerEmployee] = useState<string>('all');
  const [ledgerSort, setLedgerSort] = useState<'name_asc' | 'annual_bal_desc' | 'annual_bal_asc' | 'used_desc'>('name_asc');

  // Calendar view state
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth() + 1); // 1-12
  const [calEvents, setCalEvents] = useState<LeaveApplication[]>([]);

  // Apply Modal State
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [applyForm, setApplyForm] = useState({
    user_id: '',
    leave_type: 'EL' as LeaveType,
    duration_type: 'full_day' as DurationType,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    days_count: 1,
    reason: '',
    reliever_user_id: '',
    emergency_contact: '',
  });

  // Action / Review Modal State (Approve / Reject)
  const [reviewTarget, setReviewTarget] = useState<LeaveApplication | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | null>(null);
  const [adminRemarks, setAdminRemarks] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Detail Modal State
  const [detailTarget, setDetailTarget] = useState<LeaveApplication | null>(null);

  // Cancel Confirmation State
  const [cancelTarget, setCancelTarget] = useState<LeaveApplication | null>(null);

  // Calculation result state for interactive breakdown
  const [calcResult, setCalcResult] = useState<LeaveCalculationResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  // Target applicant user for weekend resolution
  const targetApplicant = useMemo<User | null>(() => {
    const uid = applyForm.user_id ? Number(applyForm.user_id) : me?.id;
    if (!uid) return (me as User) || null;
    return usersList.find((u) => u.id === uid) || (me as User) || null;
  }, [applyForm.user_id, me, usersList]);

  // Recalculate function that calls API and updates local calcResult and days_count
  const recomputeLeaveDays = useCallback(
    async (
      targetUserId: number | string | undefined,
      start: string,
      end: string,
      durType: DurationType = 'full_day'
    ) => {
      if (!start || !end) return;
      const uid = targetUserId ? Number(targetUserId) : me?.id;
      const applicant = usersList.find((u) => u.id === uid) || (me as User) || null;
      const weekendDays = parseWeekendDays(applicant?.weekend_days);

      // Instant client calculation
      const localResult = calculateLeaveDaysClient(start, end, weekendDays, [], durType);
      setCalcResult(localResult);
      setApplyForm((prev) => ({ ...prev, days_count: localResult.daysCount }));

      // Fetch official server computation (which accounts for holidays and user DB record)
      if (uid) {
        setCalcLoading(true);
        try {
          const res = await api.get<LeaveCalculationResult>(
            `/leaves/calculate?user_id=${uid}&start_date=${start}&end_date=${end}&duration_type=${durType}`
          );
          setCalcResult(res);
          setApplyForm((prev) => ({ ...prev, days_count: res.daysCount }));
        } catch {
          // fallback to localResult already set
        } finally {
          setCalcLoading(false);
        }
      }
    },
    [me, usersList]
  );

  // Load summary and applications
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, appRes, uRes, deptRes] = await Promise.all([
        api.get<LeaveSummaryResponse>(`/leaves/summary?year=${selectedYear}`),
        api.get<LeaveApplication[]>(`/leaves?year=${selectedYear}`),
        api.get<User[]>('/users'),
        api.get<{ id: number; name: string }[]>('/departments').catch(() => []),
      ]);
      setSummary(sumRes);
      setApplications(appRes);
      setUsersList(uRes);
      setDepartments(deptRes || []);

      if (isAdmin) {
        const balRes = await api.get<EmployeeLeaveLedger[]>(`/leaves/balances-all?year=${selectedYear}`);
        setAllBalances(balRes);
      }
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, isAdmin, toast]);

  const loadCalendar = useCallback(async () => {
    try {
      const events = await api.get<LeaveApplication[]>(`/leaves/calendar?year=${selectedYear}&month=${calMonth}`);
      setCalEvents(events);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }, [selectedYear, calMonth, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'calendar') {
      loadCalendar();
    }
  }, [activeTab, loadCalendar]);

  const handleStartDateChange = (newStart: string) => {
    let newEnd = applyForm.end_date;
    if (newStart > newEnd) {
      newEnd = newStart;
    }
    setApplyForm((prev) => ({ ...prev, start_date: newStart, end_date: newEnd }));
    recomputeLeaveDays(applyForm.user_id, newStart, newEnd, applyForm.duration_type);
  };

  const handleEndDateChange = (newEnd: string) => {
    setApplyForm((prev) => ({ ...prev, end_date: newEnd }));
    recomputeLeaveDays(applyForm.user_id, applyForm.start_date, newEnd, applyForm.duration_type);
  };

  const handleDurationTypeChange = (newDur: DurationType) => {
    setApplyForm((prev) => ({ ...prev, duration_type: newDur }));
    recomputeLeaveDays(applyForm.user_id, applyForm.start_date, applyForm.end_date, newDur);
  };

  const handleUserChange = (newUserId: string) => {
    setApplyForm((prev) => ({ ...prev, user_id: newUserId }));
    recomputeLeaveDays(newUserId, applyForm.start_date, applyForm.end_date, applyForm.duration_type);
  };

  const openApplyModal = (preferredType: LeaveType = 'EL', targetUserId?: number) => {
    const today = new Date().toISOString().slice(0, 10);
    const targetUid = String(targetUserId || me?.id || '');
    setApplyForm({
      user_id: targetUid,
      leave_type: preferredType,
      duration_type: 'full_day',
      start_date: today,
      end_date: today,
      days_count: 1,
      reason: '',
      reliever_user_id: '',
      emergency_contact: me?.phone || '',
    });
    setApplyModalOpen(true);
    recomputeLeaveDays(targetUid, today, today, 'full_day');
  };

  // Determine active balance for current user or selected user (if admin)
  const activeBalance = useMemo<LeaveBalance | null>(() => {
    if (isAdmin && applyForm.user_id && Number(applyForm.user_id) !== me?.id) {
      const found = allBalances.find((b) => b.user.id === Number(applyForm.user_id));
      if (found) return found.balance;
    }
    return summary?.balance || null;
  }, [isAdmin, applyForm.user_id, me?.id, allBalances, summary]);

  // Balance for currently selected leave type in modal
  const currentModalBalance = useMemo(() => {
    if (!activeBalance) return 0;
    const typeKey = applyForm.leave_type.toLowerCase() as 'el' | 'cl' | 'sl';
    return activeBalance[typeKey]?.balance ?? 0;
  }, [activeBalance, applyForm.leave_type]);

  const submitApplication = async () => {
    if (!applyForm.reason.trim()) {
      return toast('Please enter the reason for leave', 'error');
    }
    if (applyForm.days_count <= 0) {
      return toast('Leave days must be greater than 0', 'error');
    }
    if (applyForm.days_count > currentModalBalance) {
      return toast(`Requested ${applyForm.days_count} day(s) exceeds remaining ${applyForm.leave_type} balance (${currentModalBalance} days).`, 'error');
    }

    setSubmitting(true);
    try {
      await api.post('/leaves', {
        user_id: isAdmin && applyForm.user_id ? Number(applyForm.user_id) : me?.id,
        leave_type: applyForm.leave_type,
        duration_type: applyForm.duration_type,
        start_date: applyForm.start_date,
        end_date: applyForm.end_date,
        days_count: applyForm.days_count,
        reason: applyForm.reason.trim(),
        reliever_user_id: applyForm.reliever_user_id ? Number(applyForm.reliever_user_id) : null,
        emergency_contact: applyForm.emergency_contact.trim(),
      });
      toast('Leave application submitted successfully!');
      setApplyModalOpen(false);
      loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewAction = async () => {
    if (!reviewTarget || !reviewAction) return;
    setActionLoading(true);
    try {
      await api.put(`/leaves/${reviewTarget.id}/status`, {
        status: reviewAction,
        admin_remarks: adminRemarks.trim(),
      });
      toast(`Leave application ${reviewAction === 'approved' ? 'Approved' : 'Rejected'}`);
      setReviewTarget(null);
      setReviewAction(null);
      setAdminRemarks('');
      loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelApplication = async () => {
    if (!cancelTarget) return;
    try {
      await api.post(`/leaves/${cancelTarget.id}/cancel`, {});
      toast('Leave application cancelled');
      setCancelTarget(null);
      loadData();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  // Filtered applications
  const filteredApplications = useMemo(() => {
    return applications.filter((app) => {
      // Tab filter
      if (activeTab === 'my' && app.user_id !== me?.id) return false;

      // Status filter
      if (statusFilter !== 'all' && app.status !== statusFilter) return false;

      // Leave Type filter
      if (typeFilter !== 'all' && app.leave_type.toUpperCase() !== typeFilter.toUpperCase()) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = `${app.applicant_name || ''} ${app.applicant_email || ''} ${app.reason || ''} ${app.reliever_name || ''} ${app.leave_type}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [applications, activeTab, me?.id, statusFilter, typeFilter, searchQuery]);

  const pendingApprovalsCount = useMemo(() => {
    return applications.filter((a) => a.status === 'pending').length;
  }, [applications]);

  // Branch / Department Options for Staff Ledger
  const branchOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    departments.forEach((d) => {
      map.set(String(d.id), { id: String(d.id), name: d.name, count: 0 });
    });
    allBalances.forEach((item) => {
      const bId = item.user.department_id ? String(item.user.department_id) : 'unassigned';
      const bName = item.user.department_name || 'Unassigned Branch';
      if (!map.has(bId)) {
        map.set(bId, { id: bId, name: bName, count: 0 });
      }
      const existing = map.get(bId)!;
      existing.count += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, allBalances]);

  // Employee Options for Staff Ledger Dropdown (filtered by selected branch if any)
  const employeeOptions = useMemo(() => {
    let list = allBalances.map((b) => b.user);
    if (ledgerBranch !== 'all') {
      list = list.filter((u) => {
        if (ledgerBranch === 'unassigned') return !u.department_id;
        return String(u.department_id) === ledgerBranch || u.department_name === ledgerBranch;
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [allBalances, ledgerBranch]);

  // Filtered and Sorted Staff Ledger
  const filteredBalances = useMemo(() => {
    const list = allBalances.filter((item) => {
      // 1. Branch-wise filter
      if (ledgerBranch !== 'all') {
        if (ledgerBranch === 'unassigned') {
          if (item.user.department_id) return false;
        } else {
          if (String(item.user.department_id) !== ledgerBranch && item.user.department_name !== ledgerBranch) {
            return false;
          }
        }
      }

      // 2. Employee-wise filter
      if (ledgerEmployee !== 'all') {
        if (String(item.user.id) !== ledgerEmployee) {
          return false;
        }
      }

      // 3. Search query filter (employee name, email, employee ID, title/designation, team, department)
      if (ledgerSearchQuery.trim()) {
        const q = ledgerSearchQuery.toLowerCase().trim();
        const name = (item.user.name || '').toLowerCase();
        const email = (item.user.email || '').toLowerCase();
        const empId = (item.user.employee_id || '').toLowerCase();
        const title = (item.user.title || '').toLowerCase();
        const dept = (item.user.department_name || '').toLowerCase();
        const team = (item.user.team_name || '').toLowerCase();
        if (
          !name.includes(q) &&
          !email.includes(q) &&
          !empId.includes(q) &&
          !title.includes(q) &&
          !dept.includes(q) &&
          !team.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    return list.sort((a, b) => {
      if (ledgerSort === 'annual_bal_desc') {
        return b.balance.annual.balance - a.balance.annual.balance;
      }
      if (ledgerSort === 'annual_bal_asc') {
        return a.balance.annual.balance - b.balance.annual.balance;
      }
      if (ledgerSort === 'used_desc') {
        return b.balance.annual.approved - a.balance.annual.approved;
      }
      return a.user.name.localeCompare(b.user.name);
    });
  }, [allBalances, ledgerBranch, ledgerEmployee, ledgerSearchQuery, ledgerSort]);

  // Aggregate Metrics for Filtered Staff Ledger
  const ledgerMetrics = useMemo(() => {
    const totalStaff = filteredBalances.length;
    const totalAnnualQuota = filteredBalances.reduce((acc, i) => acc + (i.balance.annual.quota || 24), 0);
    const totalAnnualApproved = filteredBalances.reduce((acc, i) => acc + (i.balance.annual.approved || 0), 0);
    const totalAnnualBalance = filteredBalances.reduce((acc, i) => acc + (i.balance.annual.balance || 0), 0);
    const totalSickApproved = filteredBalances.reduce((acc, i) => acc + (i.balance.sl.approved || 0), 0);
    const avgRemaining = totalStaff > 0 ? (totalAnnualBalance / totalStaff).toFixed(1) : '0';
    return { totalStaff, totalAnnualQuota, totalAnnualApproved, totalAnnualBalance, totalSickApproved, avgRemaining };
  }, [filteredBalances]);

  const hasActiveLedgerFilters = ledgerSearchQuery.trim() !== '' || ledgerBranch !== 'all' || ledgerEmployee !== 'all';

  const resetLedgerFilters = () => {
    setLedgerSearchQuery('');
    setLedgerBranch('all');
    setLedgerEmployee('all');
    setLedgerSort('name_asc');
  };

  // Export balance ledger to CSV (respects active branch & employee search filters)
  const exportLedgerCSV = () => {
    if (!filteredBalances.length) {
      toast('No staff data to export', 'error');
      return;
    }
    const headers = [
      'Employee Name',
      'Employee ID',
      'Email',
      'Designation / Title',
      'Branch',
      'Team',
      'Assigned Weekend',
      'EL Quota (14d)',
      'EL Used',
      'EL Balance',
      'CL Quota (10d)',
      'CL Used',
      'CL Balance',
      'Annual Quota (24d)',
      'Annual Used',
      'Annual Balance',
      'Sick Leave Quota (14d)',
      'Sick Leave Used',
      'Sick Leave Balance',
    ];
    const rows = filteredBalances.map((item) => [
      `"${item.user.name}"`,
      `"${item.user.employee_id || ''}"`,
      `"${item.user.email}"`,
      `"${item.user.title || ''}"`,
      `"${item.user.department_name || 'N/A'}"`,
      `"${item.user.team_name || 'N/A'}"`,
      `"${formatWeekendDaysFull(item.user.weekend_days)}"`,
      item.balance.el.quota,
      item.balance.el.approved,
      item.balance.el.balance,
      item.balance.cl.quota,
      item.balance.cl.approved,
      item.balance.cl.balance,
      item.balance.annual.quota,
      item.balance.annual.approved,
      item.balance.annual.balance,
      item.balance.sl.quota,
      item.balance.sl.approved,
      item.balance.sl.balance,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const selectedBranchObj = branchOptions.find((b) => b.id === ledgerBranch);
    const branchSuffix = ledgerBranch !== 'all' ? `_${(selectedBranchObj?.name || 'Branch').replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    link.setAttribute('download', `Staff_Leave_Ledger_${selectedYear}${branchSuffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Exported ${filteredBalances.length} staff records to CSV`);
  };

  // Calendar rendering helpers
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const daysInMonth = new Date(selectedYear, calMonth, 0).getDate();
  const firstDayOfWeek = new Date(selectedYear, calMonth - 1, 1).getDay();

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand/10 text-brand">
              <CalendarDays size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Leave Management</h1>
              <p className="text-xs text-ink3 mt-0.5">
                Earned (14d) + Casual (10d) = 24d Annual Quota · Sick Leave (14d separate)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Year selector */}
          <div className="flex items-center gap-1 bg-card2 p-1 rounded-xl border border-line">
            <span className="text-xs font-semibold px-2 text-ink3">Year:</span>
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <button
                key={y}
                className={cx(
                  'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                  selectedYear === y ? 'bg-brand text-white shadow-sm' : 'text-ink2 hover:text-ink1 hover:bg-card'
                )}
                onClick={() => setSelectedYear(y)}
              >
                {y}
              </button>
            ))}
          </div>

          <button className="btn btn-primary shadow-md shadow-brand/20" onClick={() => openApplyModal('EL')}>
            <Plus size={16} /> Apply for Leave
          </button>
        </div>
      </div>

      {/* Quota & Balance Overview Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Earned Leave */}
          <div
            className="card p-4 relative cursor-pointer hover:border-blue-500/50 transition-all border-t-4 border-t-blue-500 flex flex-col justify-between"
            onClick={() => openApplyModal('EL')}
            title="Click to apply for Earned Leave"
          >
            <div>
              <div className="flex items-center justify-between text-xs text-ink3 mb-1">
                <span className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <Sparkles size={14} /> Earned Leave (EL)
                </span>
                <span className="font-semibold text-[11px] text-ink3">{summary.balance.el.quota}d Quota</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-ink1">{summary.balance.el.balance}</span>
                <span className="text-xs text-ink3">days left</span>
              </div>
              <div className="w-full bg-card2 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (summary.balance.el.approved / summary.balance.el.quota) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink3 mt-3 pt-2 border-t border-line/60">
              <span>Used: <b className="text-ink1">{summary.balance.el.approved}d</b></span>
              {summary.balance.el.pending > 0 && <span className="text-amber-500 font-semibold">{summary.balance.el.pending}d pending</span>}
              <span className="text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-0.5">Apply <ArrowRight size={11} /></span>
            </div>
          </div>

          {/* Casual Leave */}
          <div
            className="card p-4 relative cursor-pointer hover:border-amber-500/50 transition-all border-t-4 border-t-amber-500 flex flex-col justify-between"
            onClick={() => openApplyModal('CL')}
            title="Click to apply for Casual Leave"
          >
            <div>
              <div className="flex items-center justify-between text-xs text-ink3 mb-1">
                <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <Coffee size={14} /> Casual Leave (CL)
                </span>
                <span className="font-semibold text-[11px] text-ink3">{summary.balance.cl.quota}d Quota</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-ink1">{summary.balance.cl.balance}</span>
                <span className="text-xs text-ink3">days left</span>
              </div>
              <div className="w-full bg-card2 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (summary.balance.cl.approved / summary.balance.cl.quota) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink3 mt-3 pt-2 border-t border-line/60">
              <span>Used: <b className="text-ink1">{summary.balance.cl.approved}d</b></span>
              {summary.balance.cl.pending > 0 && <span className="text-amber-500 font-semibold">{summary.balance.cl.pending}d pending</span>}
              <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-0.5">Apply <ArrowRight size={11} /></span>
            </div>
          </div>

          {/* Total Annual Quota (EL + CL = 24) */}
          <div className="card p-4 relative border-t-4 border-t-brand bg-brand/5 dark:bg-brand/10 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-ink3 mb-1">
                <span className="font-bold text-brand flex items-center gap-1.5">
                  <CalendarCheck2 size={14} /> Total Annual Quota
                </span>
                <span className="text-[10px] font-bold text-brand px-1.5 py-0.5 rounded bg-brand/10">14 EL + 10 CL</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-brand">{summary.balance.annual.balance}</span>
                <span className="text-xs text-ink2">/ 24 days left</span>
              </div>
              <div className="w-full bg-card2 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-brand h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (summary.balance.annual.approved / summary.balance.annual.quota) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink3 mt-3 pt-2 border-t border-line/60">
              <span>Used: <b className="text-ink1">{summary.balance.annual.approved}d</b></span>
              <span>Total: <b>24 days</b></span>
            </div>
          </div>

          {/* Sick Leave (Separate 14 Days) */}
          <div
            className="card p-4 relative cursor-pointer hover:border-pink-500/50 transition-all border-t-4 border-t-pink-500 flex flex-col justify-between"
            onClick={() => openApplyModal('SL')}
            title="Click to apply for Sick Leave"
          >
            <div>
              <div className="flex items-center justify-between text-xs text-ink3 mb-1">
                <span className="font-bold text-pink-600 dark:text-pink-400 flex items-center gap-1.5">
                  <HeartPulse size={14} /> Sick Leave (SL)
                </span>
                <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded bg-pink-500/10">Separate 14d</span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-ink1">{summary.balance.sl.balance}</span>
                <span className="text-xs text-ink3">days left</span>
              </div>
              <div className="w-full bg-card2 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-pink-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (summary.balance.sl.approved / summary.balance.sl.quota) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink3 mt-3 pt-2 border-t border-line/60">
              <span>Used: <b className="text-ink1">{summary.balance.sl.approved}d</b></span>
              {summary.balance.sl.pending > 0 && <span className="text-amber-500 font-semibold">{summary.balance.sl.pending}d pending</span>}
              <span className="text-pink-600 dark:text-pink-400 font-semibold flex items-center gap-0.5">Apply <ArrowRight size={11} /></span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-1">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            className={cx(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border-b-2 -mb-1',
              activeTab === 'my'
                ? 'border-brand text-brand bg-brand/5'
                : 'border-transparent text-ink2 hover:text-ink1 hover:bg-card2'
            )}
            onClick={() => setActiveTab('my')}
          >
            <UserIcon size={16} /> My Leaves
          </button>

          <button
            className={cx(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border-b-2 -mb-1',
              activeTab === 'all'
                ? 'border-brand text-brand bg-brand/5'
                : 'border-transparent text-ink2 hover:text-ink1 hover:bg-card2'
            )}
            onClick={() => setActiveTab('all')}
          >
            <UsersIcon size={16} />
            <span>{isAdmin ? 'All Applications' : 'Team Requests'}</span>
            {pendingApprovalsCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                {pendingApprovalsCount}
              </span>
            )}
          </button>

          <button
            className={cx(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border-b-2 -mb-1',
              activeTab === 'calendar'
                ? 'border-brand text-brand bg-brand/5'
                : 'border-transparent text-ink2 hover:text-ink1 hover:bg-card2'
            )}
            onClick={() => setActiveTab('calendar')}
          >
            <CalendarDays size={16} /> Team Calendar
          </button>

          {isAdmin && (
            <button
              className={cx(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border-b-2 -mb-1',
                activeTab === 'ledger'
                  ? 'border-brand text-brand bg-brand/5'
                  : 'border-transparent text-ink2 hover:text-ink1 hover:bg-card2'
              )}
              onClick={() => setActiveTab('ledger')}
            >
              <Building2 size={16} /> Staff Ledger
            </button>
          )}
        </div>

        {/* Search & Filters */}
        {(activeTab === 'my' || activeTab === 'all') && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                className="input !py-1.5 !pl-8.5 !text-xs w-44 sm:w-52"
                placeholder="Search leaves..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Leave Type Filter */}
            <select
              className="input !py-1.5 !text-xs w-32 font-semibold"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="EL">EL (Earned)</option>
              <option value="CL">CL (Casual)</option>
              <option value="SL">SL (Sick)</option>
            </select>

            {/* Status Filter */}
            <select
              className="input !py-1.5 !text-xs w-32 font-semibold"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : activeTab === 'my' || activeTab === 'all' ? (
        /* Applications List View */
        filteredApplications.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={32} />}
            title="No leave applications found"
            subtitle={activeTab === 'my' ? "You haven't submitted any leave requests for this period." : "No applications match your selected filters."}
            action={
              activeTab === 'my' ? (
                <button className="btn btn-primary" onClick={() => openApplyModal('EL')}>
                  <Plus size={16} /> Apply for Leave
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredApplications.map((app) => {
              const statusCfg = STATUS_CONFIG[app.status] || STATUS_CONFIG.pending;
              const typeCfg = LEAVE_TYPES.find((t) => t.id === app.leave_type) || LEAVE_TYPES[0];
              const StatusIcon = statusCfg.icon;
              const isMine = app.user_id === me?.id;

              return (
                <div
                  key={app.id}
                  className="card card-hover p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <Avatar name={app.applicant_name} src={app.applicant_avatar} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-ink1">{app.applicant_name}</span>
                        {isMine && <span className="text-[10px] font-bold text-brand px-1.5 py-0.2 rounded bg-brand/10">You</span>}
                        <span className={cx('text-[11px] font-extrabold px-2 py-0.5 rounded-lg border', typeCfg.badgeClass)}>
                          {app.leave_type} · {typeCfg.shortName}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-card2 text-ink2">
                          {app.days_count} {app.days_count === 1 ? 'day' : 'days'}
                          {app.duration_type !== 'full_day' && ` (${app.duration_type === 'half_day_morning' ? '1st Half' : '2nd Half'})`}
                        </span>
                        {app.applicant_weekend_days && (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex items-center gap-1" title={`Applicant's weekend: ${formatWeekendDaysFull(app.applicant_weekend_days)}`}>
                            <Calendar size={11} className="text-amber-500" />
                            <span>Weekend: {formatWeekendDays(app.applicant_weekend_days)}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-ink3 mt-1.5">
                        <span className="flex items-center gap-1 font-semibold text-ink2">
                          <CalendarDays size={13} className="text-brand" />
                          {prettyDate(app.start_date)}
                          {app.start_date !== app.end_date && ` → ${prettyDate(app.end_date)}`}
                        </span>
                        {app.department_name && (
                          <span className="flex items-center gap-1">
                            <Building2 size={12} /> {app.department_name}
                          </span>
                        )}
                        {app.reliever_name && (
                          <span className="flex items-center gap-1 text-ink2">
                            <UserIcon size={12} className="text-ink3" /> Reliever: <b>{app.reliever_name}</b>
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-ink2 mt-2 bg-card2/60 p-2 rounded-lg border border-line/60 line-clamp-2">
                        <span className="font-semibold text-ink3 mr-1">Reason:</span>
                        {app.reason}
                      </p>

                      {app.admin_remarks && (
                        <div className="text-[11px] text-ink3 mt-1.5 flex items-center gap-1.5">
                          <span className="font-semibold text-ink2">Remarks:</span>
                          <span className="text-ink2">{app.admin_remarks}</span>
                          {app.approver_name && <span>(by {app.approver_name})</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex flex-wrap items-center justify-between md:justify-end gap-2.5 w-full md:w-auto shrink-0 border-t md:border-t-0 pt-2.5 md:pt-0 border-line/60">
                    <Badge color={statusCfg.color} className="text-xs !py-1 !px-2.5 flex items-center gap-1.5">
                      <StatusIcon size={13} />
                      <span>{statusCfg.label}</span>
                    </Badge>

                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => setDetailTarget(app)}
                    >
                      Details
                    </button>

                    {/* Owner cancel action */}
                    {app.status === 'pending' && isMine && (
                      <button
                        className="btn btn-ghost btn-xs text-amber-600 hover:!bg-amber-500/10"
                        onClick={() => setCancelTarget(app)}
                      >
                        Cancel
                      </button>
                    )}

                    {/* Admin Approval Quick Actions */}
                    {isAdmin && app.status === 'pending' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn btn-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                          onClick={() => {
                            setReviewTarget(app);
                            setReviewAction('approved');
                            setAdminRemarks('');
                          }}
                        >
                          <Check size={13} /> Approve
                        </button>
                        <button
                          className="btn btn-xs bg-rose-600 hover:bg-rose-700 text-white font-bold"
                          onClick={() => {
                            setReviewTarget(app);
                            setReviewAction('rejected');
                            setAdminRemarks('');
                          }}
                        >
                          <X size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : activeTab === 'calendar' ? (
        /* Team Calendar View */
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                className="p-1.5 rounded-lg hover:bg-card2 text-ink2"
                onClick={() => setCalMonth((m) => (m === 1 ? 12 : m - 1))}
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-base font-extrabold">
                {monthNames[calMonth - 1]} {selectedYear}
              </h2>
              <button
                className="p-1.5 rounded-lg hover:bg-card2 text-ink2"
                onClick={() => setCalMonth((m) => (m === 12 ? 1 : m + 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> EL (Earned)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> CL (Casual)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-pink-500" /> SL (Sick)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-ink3 border-b border-line pb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[85px] rounded-lg bg-card2/20 p-1 opacity-20" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${selectedYear}-${String(calMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayLeaves = calEvents.filter((e) => e.start_date <= dateStr && e.end_date >= dateStr);
              const isToday = new Date().toISOString().slice(0, 10) === dateStr;

              return (
                <div
                  key={dayNum}
                  className={cx(
                    'min-h-[85px] rounded-xl p-1.5 border border-line/60 flex flex-col justify-between transition-colors',
                    isToday ? 'bg-brand/5 border-brand/40 shadow-sm' : 'bg-card hover:bg-card2/50'
                  )}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className={cx('font-bold', isToday ? 'text-brand' : 'text-ink2')}>
                      {dayNum}
                    </span>
                    {dayLeaves.length > 0 && (
                      <span className="text-[10px] font-bold text-ink3">
                        {dayLeaves.length} away
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 mt-1 overflow-y-auto max-h-14 text-[10px]">
                    {dayLeaves.map((l) => {
                      const color = l.leave_type === 'EL' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : l.leave_type === 'CL' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-pink-500/20 text-pink-600 dark:text-pink-400';
                      return (
                        <div
                          key={l.id}
                          className={cx('truncate px-1.5 py-0.5 rounded font-semibold cursor-pointer', color)}
                          onClick={() => setDetailTarget(l)}
                          title={`${l.applicant_name} - ${l.leave_type}`}
                        >
                          {l.applicant_name?.split(' ')[0]} ({l.leave_type})
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Staff Balance Ledger View (Admin View) */
        <div className="card p-5 space-y-5">
          {/* Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-brand/10 text-brand">
                  <Building2 size={18} />
                </div>
                <h2 className="text-base font-extrabold text-ink1">Staff Annual Leave Ledger ({selectedYear})</h2>
              </div>
              <p className="text-xs text-ink3 mt-0.5">
                Overview of quota consumption, remaining balances, and assigned weekend schedules for all staff members.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-secondary btn-sm"
                onClick={exportLedgerCSV}
                title="Export filtered staff leave ledger to CSV"
              >
                <Download size={14} /> Export CSV ({filteredBalances.length})
              </button>
            </div>
          </div>

          {/* Search and Filters Bar (Branch-wise, Employee-wise, Keyword Search, Sort, Reset) */}
          <div className="bg-card2/50 p-3.5 rounded-xl border border-line space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
              {/* Employee-wise text search */}
              <div className="lg:col-span-4 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  className="input !py-2 !pl-8.5 !pr-8 !text-xs w-full"
                  placeholder="Search staff name, email, employee ID, title..."
                  value={ledgerSearchQuery}
                  onChange={(e) => setLedgerSearchQuery(e.target.value)}
                />
                {ledgerSearchQuery && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink1 p-0.5 rounded-full"
                    onClick={() => setLedgerSearchQuery('')}
                    title="Clear search query"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Branch-wise selector */}
              <div className="lg:col-span-3">
                <div className="relative">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
                  <select
                    className="input !py-2 !pl-8.5 !text-xs w-full font-semibold"
                    value={ledgerBranch}
                    onChange={(e) => {
                      setLedgerBranch(e.target.value);
                      if (ledgerEmployee !== 'all') {
                        setLedgerEmployee('all');
                      }
                    }}
                    title="Filter by Branch"
                  >
                    <option value="all">All Branches ({allBalances.length})</option>
                    {branchOptions.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.count})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Employee-wise dropdown selector */}
              <div className="lg:col-span-3">
                <div className="relative">
                  <UserIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
                  <select
                    className="input !py-2 !pl-8.5 !text-xs w-full font-semibold"
                    value={ledgerEmployee}
                    onChange={(e) => setLedgerEmployee(e.target.value)}
                    title="Filter by Specific Employee"
                  >
                    <option value="all">
                      {ledgerBranch !== 'all' ? `All Staff in Branch (${employeeOptions.length})` : `All Employees (${employeeOptions.length})`}
                    </option>
                    {employeeOptions.map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.name} {u.department_name ? `(${u.department_name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Sort Order & Reset */}
              <div className="lg:col-span-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <select
                    className="input !py-2 !text-xs w-full font-semibold"
                    value={ledgerSort}
                    onChange={(e) => setLedgerSort(e.target.value as any)}
                    title="Sort staff ledger"
                  >
                    <option value="name_asc">Name (A-Z)</option>
                    <option value="annual_bal_desc">Balance (High-Low)</option>
                    <option value="annual_bal_asc">Balance (Low-High)</option>
                    <option value="used_desc">Leave Taken (Most)</option>
                  </select>
                </div>

                {hasActiveLedgerFilters && (
                  <button
                    className="btn btn-ghost btn-sm text-xs text-ink3 hover:text-rose-500 flex items-center gap-1 shrink-0 px-2.5"
                    onClick={resetLedgerFilters}
                    title="Reset all search filters"
                  >
                    <RotateCcw size={13} />
                    <span className="hidden sm:inline">Reset</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Filter Info & Metrics Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line/60 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink3 font-medium">Showing:</span>
                <span className="font-bold text-ink1 bg-card px-2 py-0.5 rounded border border-line text-[11px]">
                  {filteredBalances.length} of {allBalances.length} staff members
                </span>
                {ledgerBranch !== 'all' && (
                  <span className="font-semibold text-brand bg-brand/10 px-2 py-0.5 rounded text-[11px] flex items-center gap-1">
                    <Building2 size={11} /> {branchOptions.find((b) => b.id === ledgerBranch)?.name || 'Selected Branch'}
                  </span>
                )}
                {ledgerEmployee !== 'all' && (
                  <span className="font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-[11px] flex items-center gap-1">
                    <UserIcon size={11} /> {employeeOptions.find((u) => String(u.id) === ledgerEmployee)?.name || 'Selected Employee'}
                  </span>
                )}
                {ledgerSearchQuery && (
                  <span className="font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-[11px]">
                    Keyword: "{ledgerSearchQuery}"
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-[11px] text-ink3">
                <span>Total Quota: <b className="text-ink1">{ledgerMetrics.totalAnnualQuota}d</b></span>
                <span>Consumed: <b className="text-amber-600 dark:text-amber-400">{ledgerMetrics.totalAnnualApproved}d</b></span>
                <span>Available: <b className="text-brand font-bold">{ledgerMetrics.totalAnnualBalance}d</b> (avg {ledgerMetrics.avgRemaining}d/staff)</span>
              </div>
            </div>
          </div>

          {/* Table or Empty State */}
          {filteredBalances.length === 0 ? (
            <div className="py-8">
              <EmptyState
                icon={<Search size={32} />}
                title="No staff members found"
                subtitle="No employees match your active branch or employee search criteria."
                action={
                  <button className="btn btn-secondary btn-sm" onClick={resetLedgerFilters}>
                    <RotateCcw size={14} /> Clear Search & Filters
                  </button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-line bg-card2/70 text-ink2 font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-3">Employee</th>
                    <th className="p-3">Branch</th>
                    <th className="p-3 text-center">Assigned Weekend</th>
                    <th className="p-3 text-center">EL (14d)<br /><span className="text-[9px] font-normal lowercase text-ink3">used / rem</span></th>
                    <th className="p-3 text-center">CL (10d)<br /><span className="text-[9px] font-normal lowercase text-ink3">used / rem</span></th>
                    <th className="p-3 text-center bg-brand/5 text-brand">Annual Quota (24d)<br /><span className="text-[9px] font-normal lowercase">used / rem</span></th>
                    <th className="p-3 text-center">Sick Leave (14d)<br /><span className="text-[9px] font-normal lowercase text-ink3">used / rem</span></th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {filteredBalances.map((item) => (
                    <tr key={item.user.id} className="hover:bg-card2/40 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={item.user.name} src={item.user.avatar} size={30} />
                          <div>
                            <div className="font-bold text-ink1 flex items-center gap-1.5">
                              <span>{item.user.name}</span>
                              {item.user.employee_id && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-card2 text-ink3 border border-line">
                                  {item.user.employee_id}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink3">{item.user.email}</div>
                            {item.user.title && <div className="text-[10px] text-ink3 italic">{item.user.title}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-ink2">
                        <div className="font-semibold text-ink1 flex items-center gap-1">
                          <Building2 size={12} className="text-ink3" />
                          <span>{item.user.department_name || 'No Branch'}</span>
                        </div>
                        {item.user.team_name && <div className="text-[10px] text-ink3 ml-4">{item.user.team_name}</div>}
                      </td>
                      <td className="p-3 text-center">
                        <span className="font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 text-[11px] inline-flex items-center gap-1">
                          <Calendar size={11} className="text-amber-500" />
                          {formatWeekendDays(item.user.weekend_days)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-ink2">{item.balance.el.approved}d</span> / <b className="text-blue-600 dark:text-blue-400">{item.balance.el.balance}d</b>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-ink2">{item.balance.cl.approved}d</span> / <b className="text-amber-600 dark:text-amber-400">{item.balance.cl.balance}d</b>
                      </td>
                      <td className="p-3 text-center bg-brand/5">
                        <span className="text-ink2">{item.balance.annual.approved}d</span> / <b className="text-brand font-extrabold">{item.balance.annual.balance}d</b>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-ink2">{item.balance.sl.approved}d</span> / <b className="text-pink-600 dark:text-pink-400">{item.balance.sl.balance}d</b>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          className="btn btn-ghost btn-xs text-brand font-bold"
                          onClick={() => openApplyModal('EL', item.user.id)}
                        >
                          Apply For Staff
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Apply for Leave Modal */}
      <Modal
        open={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        title={
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-brand" />
            <span>Apply for Leave</span>
          </div>
        }
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setApplyModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitApplication} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Application'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Admin User Selector (if applying for someone else) */}
          {isAdmin && (
            <div>
              <label className="label font-bold text-ink1">Employee *</label>
              <select
                className="input font-semibold"
                value={applyForm.user_id}
                onChange={(e) => handleUserChange(e.target.value)}
              >
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.department_name || u.role}) — Weekend: {formatWeekendDays(u.weekend_days)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Applicant Weekend Info Banner */}
          <div className="p-3 rounded-xl bg-card2/80 border border-line flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar name={targetApplicant?.name || me?.name} src={targetApplicant?.avatar || me?.avatar} size={28} />
              <div className="min-w-0">
                <div className="font-bold text-ink1 truncate">{targetApplicant?.name || me?.name}</div>
                <div className="text-[11px] text-ink3">
                  Assigned Weekend: <span className="font-semibold text-amber-600 dark:text-amber-400">{formatWeekendDaysFull(targetApplicant?.weekend_days || me?.weekend_days)}</span>
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] text-ink3 uppercase tracking-wider font-semibold">Active Balance</div>
              <div className="font-bold text-brand">{currentModalBalance}d remaining</div>
            </div>
          </div>

          {/* Leave Type Selector with Interactive Buttons and Native Select */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="leave_type_select" className="label !mb-0 font-bold text-ink1">
                Select Leave Type *
              </label>
              <span className="text-xs text-ink3">
                Remaining: <b className="text-brand font-extrabold">{currentModalBalance} days</b>
              </span>
            </div>

            {/* Direct 3-Option Button Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              {LEAVE_TYPES.map((t) => {
                const isSelected = applyForm.leave_type === t.id;
                const bal = activeBalance ? (activeBalance[t.id.toLowerCase() as 'el' | 'cl' | 'sl']?.balance ?? t.quota) : t.quota;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setApplyForm((prev) => ({ ...prev, leave_type: t.id }))}
                    className={cx(
                      'p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between',
                      isSelected
                        ? 'border-brand bg-brand/10 ring-2 ring-brand/30 shadow-sm'
                        : 'border-line bg-card hover:bg-card2 hover:border-line2'
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-extrabold text-sm text-ink1">{t.id}</span>
                      <span className={cx('text-[10px] font-bold px-1.5 py-0.2 rounded', isSelected ? 'bg-brand text-white' : 'bg-card2 text-ink2')}>
                        {bal}d left
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold text-ink2 mt-1 truncate">{t.shortName}</div>
                  </button>
                );
              })}
            </div>

            {/* Native dropdown backup for accessibility & clear form selection */}
            <select
              id="leave_type_select"
              className="input font-semibold text-xs"
              value={applyForm.leave_type}
              onChange={(e) => setApplyForm((prev) => ({ ...prev, leave_type: e.target.value as LeaveType }))}
            >
              {LEAVE_TYPES.map((t) => {
                const bal = activeBalance ? (activeBalance[t.id.toLowerCase() as 'el' | 'cl' | 'sl']?.balance ?? t.quota) : t.quota;
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} — {bal} days available (Quota: {t.quota}d/yr)
                  </option>
                );
              })}
            </select>
          </div>

          {/* Duration Type Selector */}
          <div>
            <label className="label">Duration Type</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { id: 'full_day' as DurationType, label: 'Full Day(s)' },
                { id: 'half_day_morning' as DurationType, label: '1st Half (0.5d)' },
                { id: 'half_day_afternoon' as DurationType, label: '2nd Half (0.5d)' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleDurationTypeChange(opt.id)}
                  className={cx(
                    'p-2 text-xs rounded-lg border font-semibold transition-all text-center',
                    applyForm.duration_type === opt.id
                      ? 'bg-brand text-white border-brand shadow-xs'
                      : 'bg-card border-line text-ink2 hover:bg-card2 hover:text-ink1'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Pickers & Days Count */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Start Date *</label>
              <input
                type="date"
                className="input"
                value={applyForm.start_date}
                onChange={(e) => handleStartDateChange(e.target.value)}
              />
            </div>
            <div>
              <label className="label">End Date *</label>
              <input
                type="date"
                className="input"
                min={applyForm.start_date}
                value={applyForm.end_date}
                onChange={(e) => handleEndDateChange(e.target.value)}
              />
            </div>
            <div>
              <label className="label flex items-center justify-between">
                <span>Deductible Days</span>
                {calcLoading && <span className="text-[10px] text-brand">Calculating...</span>}
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                className="input font-bold text-brand text-base"
                value={applyForm.days_count}
                onChange={(e) => setApplyForm((prev) => ({ ...prev, days_count: Math.max(0.5, Number(e.target.value) || 1) }))}
              />
            </div>
          </div>

          {/* Dynamic Leave Calculation Breakdown Card */}
          {calcResult && (
            <div className="p-3 rounded-xl bg-card2/90 border border-line space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-ink1">
                  <Sparkles size={14} className="text-brand" />
                  <span>Dynamic Leave Calculation</span>
                </div>
                <span className="font-mono text-ink3 text-[11px]">
                  {calcResult.totalCalendarDays} calendar day(s)
                </span>
              </div>

              {/* Formula summary */}
              <div className="p-2 rounded-lg bg-card border border-line/70 text-ink2">
                <div className="font-semibold text-ink1">
                  {calcResult.weekendDaysCount > 0 || calcResult.holidayDaysCount > 0 ? (
                    <span>
                      {calcResult.totalCalendarDays} calendar days
                      {calcResult.weekendDaysCount > 0 && ` − ${calcResult.weekendDaysCount} weekend day${calcResult.weekendDaysCount > 1 ? 's' : ''}`}
                      {calcResult.holidayDaysCount > 0 && ` − ${calcResult.holidayDaysCount} holiday${calcResult.holidayDaysCount > 1 ? 's' : ''}`}
                      {' = '}
                      <b className="text-brand font-extrabold">{calcResult.daysCount} deductible day{calcResult.daysCount === 1 ? '' : 's'}</b>
                    </span>
                  ) : (
                    <span>
                      {calcResult.totalCalendarDays} calendar days = <b className="text-brand font-extrabold">{calcResult.daysCount} deductible day{calcResult.daysCount === 1 ? '' : 's'}</b>
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink3 mt-0.5">
                  Calculated based on {targetApplicant?.name || 'applicant'}'s assigned weekend ({formatWeekendDaysFull(targetApplicant?.weekend_days || me?.weekend_days)}).
                </div>
              </div>

              {/* Excluded dates pills */}
              {calcResult.excludedDates && calcResult.excludedDates.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[11px] font-semibold text-ink3">
                    Excluded Non-Working Days ({calcResult.excludedDates.length}):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {calcResult.excludedDates.map((item) => (
                      <span
                        key={item.date}
                        className={cx(
                          'text-[11px] px-2 py-0.5 rounded-md border font-medium flex items-center gap-1',
                          item.type === 'weekend'
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                            : 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20'
                        )}
                      >
                        <Calendar size={10} />
                        <span>{item.date} ({item.dayName} — {item.label})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reliever & Emergency Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Work Reliever (Optional)</label>
              <select
                className="input"
                value={applyForm.reliever_user_id}
                onChange={(e) => setApplyForm((prev) => ({ ...prev, reliever_user_id: e.target.value }))}
              >
                <option value="">No reliever selected</option>
                {usersList
                  .filter((u) => u.id !== (isAdmin && applyForm.user_id ? Number(applyForm.user_id) : me?.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.department_name || u.role})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Emergency Contact Phone</label>
              <input
                className="input"
                placeholder="+880 1..."
                value={applyForm.emergency_contact}
                onChange={(e) => setApplyForm((prev) => ({ ...prev, emergency_contact: e.target.value }))}
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="label">Reason for Leave *</label>
            <textarea
              className="input !h-20"
              placeholder="Provide a clear description for your leave request..."
              value={applyForm.reason}
              onChange={(e) => setApplyForm((prev) => ({ ...prev, reason: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* Admin Approve / Reject Modal */}
      <Modal
        open={!!reviewTarget && !!reviewAction}
        onClose={() => {
          setReviewTarget(null);
          setReviewAction(null);
        }}
        title={
          <div className="flex items-center gap-2">
            {reviewAction === 'approved' ? (
              <CheckCircle2 size={18} className="text-emerald-500" />
            ) : (
              <XCircle size={18} className="text-rose-500" />
            )}
            <span>{reviewAction === 'approved' ? 'Approve Leave Application' : 'Reject Leave Application'}</span>
          </div>
        }
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setReviewTarget(null);
                setReviewAction(null);
              }}
            >
              Cancel
            </button>
            <button
              className={cx('btn text-white font-bold', reviewAction === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700')}
              onClick={handleReviewAction}
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing...' : reviewAction === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <div className="p-3 rounded-xl bg-card2 border border-line space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-ink3">Applicant:</span>
              <b className="text-ink1">{reviewTarget?.applicant_name}</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink3">Leave Type:</span>
              <b className="text-ink1">{reviewTarget?.leave_type} ({reviewTarget?.days_count} days)</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink3">Dates:</span>
              <span>{reviewTarget?.start_date} to {reviewTarget?.end_date}</span>
            </div>
            {reviewTarget?.applicant_weekend_days && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">Assigned Weekend:</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {formatWeekendDaysFull(reviewTarget.applicant_weekend_days)}
                </span>
              </div>
            )}
            <div className="flex items-start justify-between gap-4 pt-1 border-t border-line/60">
              <span className="text-ink3 shrink-0">Reason:</span>
              <span className="text-right text-ink2">{reviewTarget?.reason}</span>
            </div>
          </div>

          <div>
            <label className="label">Admin Remarks ({reviewAction === 'rejected' ? 'Required' : 'Optional'})</label>
            <textarea
              className="input !h-20"
              placeholder={reviewAction === 'approved' ? 'Optional remarks...' : 'Reason for rejection...'}
              value={adminRemarks}
              onChange={(e) => setAdminRemarks(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* Leave Detail Modal */}
      <Modal
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title="Leave Application Details"
        footer={<button className="btn btn-primary" onClick={() => setDetailTarget(null)}>Close</button>}
      >
        {detailTarget && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between p-3 rounded-xl bg-card2 border border-line">
              <div className="flex items-center gap-3">
                <Avatar name={detailTarget.applicant_name} src={detailTarget.applicant_avatar} size={36} />
                <div>
                  <div className="font-bold text-sm text-ink1">{detailTarget.applicant_name}</div>
                  <div className="text-ink3">{detailTarget.applicant_email}</div>
                </div>
              </div>
              <Badge color={STATUS_CONFIG[detailTarget.status]?.color}>
                {STATUS_CONFIG[detailTarget.status]?.label}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="card p-3">
                <div className="text-ink3 text-[11px]">Leave Type</div>
                <div className="font-bold text-sm mt-0.5 text-ink1">{detailTarget.leave_type} - {LEAVE_TYPES.find((t) => t.id === detailTarget.leave_type)?.shortName}</div>
              </div>
              <div className="card p-3">
                <div className="text-ink3 text-[11px]">Deductible Duration</div>
                <div className="font-bold text-sm mt-0.5 text-brand">{detailTarget.days_count} Day(s)</div>
              </div>
              <div className="card p-3">
                <div className="text-ink3 text-[11px]">Start Date</div>
                <div className="font-bold text-sm mt-0.5 text-ink1">{prettyDate(detailTarget.start_date)}</div>
              </div>
              <div className="card p-3">
                <div className="text-ink3 text-[11px]">End Date</div>
                <div className="font-bold text-sm mt-0.5 text-ink1">{prettyDate(detailTarget.end_date)}</div>
              </div>
            </div>

            {detailTarget.applicant_weekend_days && (
              <div className="card p-3 flex items-center justify-between bg-amber-500/5 border-amber-500/20">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-amber-500" />
                  <span className="text-ink3">Applicant's Assigned Weekend:</span>
                </div>
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {formatWeekendDaysFull(detailTarget.applicant_weekend_days)}
                </span>
              </div>
            )}

            <div className="card p-3 space-y-1">
              <div className="font-bold text-ink1">Reason for Leave:</div>
              <p className="text-ink2 whitespace-pre-wrap">{detailTarget.reason}</p>
            </div>

            {detailTarget.reliever_name && (
              <div className="card p-2.5 flex items-center justify-between">
                <span className="text-ink3">Reliever:</span>
                <span className="font-bold text-ink1">{detailTarget.reliever_name}</span>
              </div>
            )}

            {detailTarget.emergency_contact && (
              <div className="card p-2.5 flex items-center justify-between">
                <span className="text-ink3">Emergency Contact:</span>
                <span className="font-mono text-ink1">{detailTarget.emergency_contact}</span>
              </div>
            )}

            {detailTarget.admin_remarks && (
              <div className="card p-3 bg-amber-500/5 border-amber-500/20 space-y-1">
                <div className="font-bold text-amber-600 dark:text-amber-400">Admin Remarks:</div>
                <p className="text-ink2">{detailTarget.admin_remarks}</p>
                {detailTarget.approver_name && (
                  <div className="text-[10px] text-ink3">Reviewed by {detailTarget.approver_name}</div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Cancel Confirmation */}
      <ConfirmModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelApplication}
        title="Cancel Leave Application?"
        message={`Are you sure you want to cancel your ${cancelTarget?.leave_type} leave application for ${cancelTarget?.start_date} to ${cancelTarget?.end_date}?`}
        confirmLabel="Yes, Cancel Application"
        danger
      />
    </div>
  );
}
