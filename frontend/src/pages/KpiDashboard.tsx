import React, { useEffect, useState, useMemo } from 'react';
import { TrendingUp, Trophy, Users, Award, ArrowUp, ArrowDown, Minus, Calendar, Download, RefreshCw, Search, Filter, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/ui';
import { cx, bdDateKey, fmtDate } from '../lib/utils';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
];

interface KpiRuleBreakdown {
  self_task?: number;
  create_task?: number;
  assignee_task?: number;
  task_bonus?: number;
  create_task_bonus?: number;
  assign_task_bonus?: number;
  overdue_task?: number;
  incomplete_task?: number;
  daily_task_complete?: number;
  daily_task_overdue?: number;
  create_project?: number;
  project_task_complete?: number;
  project_overdue?: number;
}

interface KpiUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  team_name?: string;
  department_name?: string;
  kpiBreakdown: KpiRuleBreakdown;
  kpiTotal: number;
  kpiRank: number;
}

interface KpiDashboardResponse {
  period: string;
  range: { start: string; end: string };
  users: KpiUser[];
}

interface MyKpiResponse {
  kpi: {
    totalPoints: number;
    rank: number;
    totalUsers: number;
    completed: number;
    onTime: number;
    overdue: number;
    penalties: number;
    avgHours: number;
  };
}

function TrendIcon({ change }: { change: number }) {
  if (change > 0) return <ArrowUp size={14} className="text-green-500" />;
  if (change < 0) return <ArrowDown size={14} className="text-red-500" />;
  return <Minus size={14} className="text-ink3" />;
}

function PointsCell({ points, isTotal = false }: { points: number; isTotal?: boolean }) {
  const color = points > 0 ? 'text-green-600' : points < 0 ? 'text-red-600' : 'text-ink3';
  const prefix = points > 0 && !isTotal ? '+' : '';
  return (
    <span className={cx('font-mono font-bold', isTotal ? 'text-lg' : '', color)}>
      {prefix}{points}
    </span>
  );
}

function BreakdownCell({ breakdown, ruleName }: { breakdown: KpiRuleBreakdown; ruleName: keyof KpiRuleBreakdown }) {
  const value = breakdown?.[ruleName] || 0;
  if (value === 0) return <span className="text-ink3 text-xs">-</span>;
  const color = value > 0 ? 'text-green-500' : 'text-red-500';
  const prefix = value > 0 ? '+' : '';
  return <span className={cx('font-mono text-xs', color)}>{prefix}{value}</span>;
}

export default function KpiDashboard() {
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState<KpiDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [myKpi, setMyKpi] = useState<MyKpiResponse['kpi'] | null>(null);
  const [myLoading, setMyLoading] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const canViewAll = hasPermission('kpi.view') || hasPermission('kpi.manage');

  // Get unique teams and departments for filter dropdowns
  const teams = useMemo(() => {
    if (!data) return [];
    const uniqueTeams = [...new Set(data.users.map(u => (u.team_name || '').trim()).filter(Boolean))];
    return uniqueTeams.sort();
  }, [data]);

  const departments = useMemo(() => {
    if (!data) return [];
    const uniqueDepts = [...new Set(data.users.map(u => (u.department_name || '').trim()).filter(Boolean))];
    return uniqueDepts.sort();
  }, [data]);

  // Filter users based on search criteria
  const filteredUsers = useMemo(() => {
    if (!data) return [];
    return data.users.filter(u => {
      const nameMatch = !searchName || u.name.toLowerCase().includes(searchName.toLowerCase());
      const userTeam = (u.team_name || '').trim().toLowerCase();
      const userDept = (u.department_name || '').trim().toLowerCase();
      const filterTeamNorm = (filterTeam || '').trim().toLowerCase();
      const filterDeptNorm = (filterDept || '').trim().toLowerCase();
      const teamMatch = !filterTeam || userTeam === filterTeamNorm;
      const deptMatch = !filterDept || userDept === filterDeptNorm;
      return nameMatch && teamMatch && deptMatch;
    });
  }, [data, searchName, filterTeam, filterDept]);

  const clearFilters = () => {
    setSearchName('');
    setFilterTeam('');
    setFilterDept('');
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get<KpiDashboardResponse>('/kpi/dashboard', { period });
      setData(res);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadMyKpi = async () => {
    setMyLoading(true);
    try {
      const res = await api.get<MyKpiResponse>('/kpi/me', { period });
      setMyKpi(res.kpi);
    } catch (e: any) {
      console.error('Failed to load my KPI:', e);
    } finally {
      setMyLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadMyKpi();
  }, [period]);

  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const headers = ['Rank', 'Name', 'Role', 'Team', 'Department', 'Total Points'];
      const ruleKeys: (keyof KpiRuleBreakdown)[] = ['self_task', 'create_task', 'assignee_task', 'task_bonus', 'create_task_bonus', 'assign_task_bonus', 'overdue_task', 'incomplete_task', 'daily_task_complete', 'daily_task_overdue', 'create_project', 'project_task_complete', 'project_overdue'];
      const ruleHeaders = ruleKeys.filter(k => data.users[0]?.kpiBreakdown?.[k] !== undefined);
      const csvHeaders = [...headers, ...ruleHeaders];
      
      const rows = data.users.map((u) => [
        u.kpiRank,
        u.name,
        u.role,
        u.team_name || '',
        u.department_name || '',
        u.kpiTotal,
        ...ruleHeaders.map(k => u.kpiBreakdown[k] || 0)
      ]);
      
      const csv = [csvHeaders.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kpi-dashboard-${period}-${bdDateKey()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('KPI Dashboard exported');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!canViewAll && myLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 rounded-full border-2 border-brand border-t-transparent" /></div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Trophy size={24} className="text-brand" /> KPI Dashboard
          </h1>
          <p className="text-sm text-ink2 mt-0.5">Real-time performance metrics calculated from task completions</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input !w-auto"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            disabled={loading}
          >
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button
            className="btn btn-outline btn-sm"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {canViewAll && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleExport}
              disabled={exporting || loading}
            >
              <Download size={14} /> {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          )}
        </div>
      </div>

      {/* My KPI Card */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Award size={20} className="text-brand" />
            <h3 className="font-bold">Your KPI Summary</h3>
          </div>
          <span className="text-xs text-ink3">Period: {PERIODS.find(p => p.key === period)?.label}</span>
        </div>
        {myLoading ? (
          <div className="flex items-center justify-center py-8"><div className="animate-spin w-6 h-6 rounded-full border-2 border-brand border-t-transparent" /></div>
        ) : myKpi ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card2 p-4 rounded-xl">
              <div className="text-xs text-ink3 mb-1">Total Points</div>
              <div className="text-3xl font-extrabold gradient-text">{myKpi.totalPoints}</div>
              <div className="text-xs text-ink3 mt-1">Rank: #{myKpi.rank || 'N/A'} of {myKpi.totalUsers || 'N/A'}</div>
            </div>
            <div className="card2 p-4 rounded-xl">
              <div className="text-xs text-ink3 mb-1">Tasks Completed</div>
              <div className="text-3xl font-extrabold text-brand">{myKpi.completed || 0}</div>
              <div className="text-xs text-ink3 mt-1">This period</div>
            </div>
            <div className="card2 p-4 rounded-xl">
              <div className="text-xs text-ink3 mb-1">On Time</div>
              <div className="text-3xl font-extrabold text-green-500">{myKpi.onTime || 0}</div>
              <div className="text-xs text-ink3 mt-1">{myKpi.completed ? `${Math.round((myKpi.onTime / myKpi.completed) * 100)}%` : '0%'}</div>
            </div>
            <div className="card2 p-4 rounded-xl">
              <div className="text-xs text-ink3 mb-1">Overdue</div>
              <div className="text-3xl font-extrabold text-red-500">{myKpi.overdue || 0}</div>
              <div className="text-xs text-ink3 mt-1">Penalties applied</div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-ink3">
            <p>No KPI data available for this period.</p>
          </div>
        )}
      </div>

      {!canViewAll ? (
        <div className="card p-5 text-center">
          <Users size={32} className="mx-auto text-ink3/30 mb-3" />
          <h3 className="font-bold text-ink mb-2">KPI Leaderboard</h3>
          <p className="text-sm text-ink3 mb-4">Contact your administrator to view the full KPI leaderboard.</p>
        </div>
      ) : loading ? (
        <div className="card p-5 flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 rounded-full border-2 border-brand border-t-transparent" /></div>
      ) : data ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={20} className="text-brand" />
              <h3 className="font-bold">KPI Leaderboard</h3>
            </div>
            <div className="flex items-center gap-4 text-xs text-ink3">
              <span>{filteredUsers.length} of {data.users.length} users</span>
              <span>Period: {PERIODS.find(p => p.key === period)?.label}</span>
              <span>{data.range?.start} to {data.range?.end}</span>
            </div>
          </div>

          {/* Search by User - Always visible */}
          <div className="mb-4">
            <div className="relative max-w-xs">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                type="text"
                placeholder="Search by user name..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="input pl-8 text-sm w-full"
              />
            </div>
          </div>

          {/* Advanced Filters (Team, Branch, Department) */}
          <div className={cx('mb-4 transition-all duration-200', showFilters ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 overflow-hidden')}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-card2/50 rounded-xl border border-line">
              <div>
                <label className="label text-xs mb-1">Team</label>
                <select
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                  className="input text-sm"
                >
                  <option value="">All Teams</option>
                  {teams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs mb-1">Branch</label>
                <select
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  className="input text-sm"
                >
                  <option value="">All Branches</option>
                  {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs mb-1">Department</label>
                <select
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  className="input text-sm"
                >
                  <option value="">All Departments</option>
                  {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-3">
                <button
                  onClick={clearFilters}
                  disabled={!searchName && !filterTeam && !filterDept}
                  className="btn btn-ghost btn-sm text-xs flex items-center gap-1"
                >
                  <X size={12} /> Clear Filters
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="btn btn-outline btn-sm text-xs flex items-center gap-1"
                >
                  <Filter size={12} /> {showFilters ? 'Hide' : 'Show'} Advanced Filters
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                  <th className="pb-2 w-12">Rank</th>
                  <th className="pb-2">User</th>
                  <th className="pb-2 text-center w-24">Role</th>
                  <th className="pb-2 text-center w-24">Team</th>
                  <th className="pb-2 text-center w-24">Dept</th>
                  <th className="pb-2 text-right w-28">Total</th>
                  <th className="pb-2 text-center w-20">Self</th>
                  <th className="pb-2 text-center w-20">Creator</th>
                  <th className="pb-2 text-center w-20">Assignee</th>
                  <th className="pb-2 text-center w-20">Bonus</th>
                  <th className="pb-2 text-center w-20">Penalty</th>
                  <th className="pb-2 text-center w-20">Daily</th>
                  <th className="pb-2 text-center w-20">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className={cx('hover:bg-card2/50 transition-colors', u.id === user?.id && 'bg-brand/5')}>
                    <td className="py-3 font-bold text-brand">{u.kpiRank}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.name}</span>
                        {u.id === user?.id && <span className="badge badge-brand text-[10px]">You</span>}
                      </div>
                      <div className="text-[11px] text-ink3">{u.email}</div>
                    </td>
                    <td className="py-3 text-center">
                      <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-medium',
                        u.role === 'super_admin' && 'bg-purple/15 text-purple',
                        u.role === 'admin' && 'bg-blue/15 text-blue',
                        u.role === 'sub_admin' && 'bg-cyan/15 text-cyan',
                        u.role === 'user' && 'bg-green/15 text-green'
                      )}>{u.role}</span>
                    </td>
                    <td className="py-3 text-center text-ink3 text-xs truncate max-w-[80px]">{u.team_name || '-'}</td>
                    <td className="py-3 text-center text-ink3 text-xs truncate max-w-[80px]">{u.department_name || '-'}</td>
                    <td className="py-3 text-right font-mono font-bold" style={{ color: u.kpiTotal >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                      {u.kpiTotal >= 0 ? '+' : ''}{u.kpiTotal}
                    </td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="self_task" /></td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="create_task" /></td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="assignee_task" /></td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="task_bonus" /></td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="overdue_task" /></td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="daily_task_complete" /></td>
                    <td className="py-3 text-center"><BreakdownCell breakdown={u.kpiBreakdown} ruleName="project_task_complete" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-5 text-center text-ink3">No data available</div>
      )}
    </div>
  );
}