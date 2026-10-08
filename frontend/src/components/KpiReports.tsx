import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Trophy, Users, Building2, Calendar, TrendingUp, PieChart as PieIcon,
  Download, FileSpreadsheet, FileText, RefreshCw, Search, Filter, X,
  Award, BarChart3, LineChart as LineIcon, ChevronDown,
} from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Skeleton, EmptyState, Tabs } from '../components/ui';
import { BarChartCard, LineChartCard, DonutChartCard, ChartCard } from '../components/charts';
import { DATE_PRESETS, bdDateKey } from '../lib/utils';

interface KpiEmployee {
  rank: number;
  id: number;
  name: string;
  email: string;
  role: string;
  team: string;
  branch: string;
  points: number;
  completed: number;
  onTime: number;
  overdue: number;
  completionRate: number;
  avgHours: number;
  breakdown: Record<string, number>;
}

interface KpiGroup {
  rank: number;
  name: string;
  points: number;
  users: number;
  completed: number;
  onTime: number;
  overdue: number;
  avgPoints: number;
}

interface KpiMonth {
  month: number;
  monthName: string;
  points: number;
  totalCompleted: number;
  totalOnTime: number;
  totalOverdue: number;
  completionRate: number;
  avgPointsPerUser: number;
  avgHours: number;
}

interface KpiYear {
  year: number;
  points: number;
  totalCompleted: number;
  totalOnTime: number;
  totalOverdue: number;
  completionRate: number;
  avgPointsPerUser: number;
  avgHours: number;
  activeUsers: number;
}

interface KpiDistribution {
  category: string;
  points: number;
  percentage: number;
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
];

const PIE_COLORS = ['#6366f1', '#22c55e', '#f97316', '#3b82f6', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];

const SUB_TABS = [
  { key: 'employee', label: 'Employee Ranking' },
  { key: 'team', label: 'Team Ranking' },
  { key: 'branch', label: 'Branch Ranking' },
  { key: 'monthly', label: 'Monthly KPI' },
  { key: 'yearly', label: 'Yearly KPI' },
  { key: 'distribution', label: 'Distribution' },
];

function PointsBadge({ value }: { value: number }) {
  const color = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-ink3';
  return (
    <span className={`font-mono font-bold ${color}`}>
      {value}
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const style =
    rank === 1 ? 'bg-amber-100 text-amber-700 border-amber-300' :
    rank === 2 ? 'bg-slate-100 text-slate-600 border-slate-300' :
    rank === 3 ? 'bg-orange-100 text-orange-700 border-orange-300' :
    'bg-card2 text-ink2 border-line';
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold border ${style}`}>
      {rank}
    </span>
  );
}

export default function KpiReports() {
  const { isAdmin, hasPermission, user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('employee');
  const [period, setPeriod] = useState('month');
  const [year, setYear] = useState(new Date().getFullYear());
  const [startYear, setStartYear] = useState(new Date().getFullYear() - 2);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const [filterTeam, setFilterTeam] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [employees, setEmployees] = useState<KpiEmployee[]>([]);
  const [teams, setTeams] = useState<KpiGroup[]>([]);
  const [branches, setBranches] = useState<KpiGroup[]>([]);
  const [months, setMonths] = useState<KpiMonth[]>([]);
  const [years, setYears] = useState<KpiYear[]>([]);
  const [distribution, setDistribution] = useState<KpiDistribution[]>([]);

  const canExport = isAdmin && hasPermission('reports.export');

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.team && e.team !== '—') set.add(e.team); });
    teams.forEach((t) => { if (t.name && t.name !== 'Unassigned') set.add(t.name); });
    return [...set].sort();
  }, [employees, teams]);

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.branch && e.branch !== '—') set.add(e.branch); });
    branches.forEach((b) => { if (b.name && b.name !== 'Unassigned') set.add(b.name); });
    return [...set].sort();
  }, [employees, branches]);

  const employeeOptions = useMemo(() => {
    return employees.map((e) => ({ id: e.id, name: e.name }));
  }, [employees]);

  const loadEmployee = useCallback(async () => {
    const res = await api.get<{ period: string; employees: KpiEmployee[] }>('/reports/kpi/employee-ranking', {
      period, team: filterTeam, branch: filterBranch, search,
    });
    setEmployees(res.employees);
  }, [period, filterTeam, filterBranch, search]);

  const loadTeam = useCallback(async () => {
    const res = await api.get<{ period: string; teams: KpiGroup[] }>('/reports/kpi/team-ranking', { period });
    setTeams(res.teams);
  }, [period]);

  const loadBranch = useCallback(async () => {
    const res = await api.get<{ period: string; branches: KpiGroup[] }>('/reports/kpi/branch-ranking', { period });
    setBranches(res.branches);
  }, [period]);

  const loadMonthly = useCallback(async () => {
    const res = await api.get<{ year: number; months: KpiMonth[] }>('/reports/kpi/monthly-trends', {
      year, team: filterTeam, branch: filterBranch, employee: filterEmployee,
    });
    setMonths(res.months);
  }, [year, filterTeam, filterBranch, filterEmployee]);

  const loadYearly = useCallback(async () => {
    const res = await api.get<{ startYear: number; endYear: number; years: KpiYear[] }>('/reports/kpi/yearly-comparison', {
      startYear, endYear, team: filterTeam, branch: filterBranch, employee: filterEmployee,
    });
    setYears(res.years);
  }, [startYear, endYear, filterTeam, filterBranch, filterEmployee]);

  const loadDistribution = useCallback(async () => {
    const res = await api.get<{ period: string; distribution: KpiDistribution[] }>('/reports/kpi/distribution', { period });
    setDistribution(res.distribution);
  }, [period]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadEmployee(),
        loadTeam(),
        loadBranch(),
        loadMonthly(),
        loadYearly(),
        loadDistribution(),
      ]);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [loadEmployee, loadTeam, loadBranch, loadMonthly, loadYearly, loadDistribution, toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const clearFilters = () => {
    setFilterTeam('');
    setFilterBranch('');
    setFilterEmployee('');
    setSearch('');
  };

  const hasFilters = filterTeam || filterBranch || filterEmployee || search;

  const buildExportPath = (format: string) => {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('type', tab === 'distribution' ? 'employee' : tab);
    params.set('period', period);
    if (filterTeam) params.set('team', filterTeam);
    if (filterBranch) params.set('branch', filterBranch);
    if (filterEmployee) params.set('employee', filterEmployee);
    if (tab === 'monthly') params.set('year', String(year));
    if (tab === 'yearly') {
      params.set('year', String(startYear));
      params.set('endYear', String(endYear));
    }
    return `/reports/kpi/export?${params.toString()}`;
  };

  const doExport = async (format: string) => {
    if (!canExport) return;
    setExporting(true);
    try {
      const ext = format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv';
      await downloadExport(buildExportPath(format), `kpi-${tab}-${period}-${bdDateKey()}.${ext}`);
      toast('KPI report exported');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const pieData = useMemo(() =>
    distribution.map((d, i) => ({
      name: d.category,
      value: d.points,
      color: PIE_COLORS[i % PIE_COLORS.length],
    })),
    [distribution]
  );

  const totalPoints = useMemo(() =>
    distribution.reduce((s, d) => s + d.points, 0),
    [distribution]
  );

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    const opts: number[] = [];
    for (let y = cur - 5; y <= cur + 1; y++) opts.push(y);
    return opts;
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold flex items-center gap-2">
            <Trophy size={22} className="text-brand" /> KPI Reports
          </h2>
          <p className="text-sm text-ink2 mt-0.5">Leaderboard rankings, trends and KPI distribution</p>
        </div>
        {/* Export buttons - top right corner */}
        <div className="flex items-center gap-1.5">
          <select
            className="input !w-auto text-sm"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            disabled={loading}
          >
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button
            className="btn btn-outline btn-sm"
            onClick={loadAll}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {canExport && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => doExport('csv')}
                disabled={exporting || loading}
                title="Export CSV"
              >
                <FileText size={14} /> <span className="hidden sm:inline">CSV</span>
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => doExport('xlsx')}
                disabled={exporting || loading}
                title="Export Excel"
              >
                <FileSpreadsheet size={14} /> <span className="hidden sm:inline">Excel</span>
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => doExport('pdf')}
                disabled={exporting || loading}
                title="Export PDF"
              >
                <Download size={14} /> <span className="hidden sm:inline">PDF</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              type="text"
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-8 text-sm w-48"
            />
          </div>
          <div>
            <label className="label text-xs mb-1">Team</label>
            <select
              value={filterTeam}
              onChange={(e) => setFilterTeam(e.target.value)}
              className="input text-sm !w-auto"
            >
              <option value="">All Teams</option>
              {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs mb-1">Branch</label>
            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="input text-sm !w-auto"
            >
              <option value="">All Branches</option>
              {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs mb-1">Employee</label>
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="input text-sm !w-auto"
            >
              <option value="">All Employees</option>
              {employeeOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="btn btn-ghost btn-sm text-xs flex items-center gap-1">
              <X size={12} /> Clear
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-xs text-ink3">
            <Filter size={12} />
            <span>{employees.length} employees</span>
          </div>
        </div>
      </div>

      {/* Sub tabs */}
      <Tabs tabs={SUB_TABS} active={tab} onChange={setTab} />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {/* Employee Ranking */}
          {tab === 'employee' && (
            employees.length === 0 ? (
              <EmptyState icon={<Users size={28} />} title="No employee data" subtitle="No KPI data available for the selected filters." />
            ) : (
              <div className="space-y-5">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="card p-4">
                    <div className="text-xs text-ink3 mb-1">Points</div>
                    <div className="text-2xl font-extrabold gradient-text">
                      {employees.reduce((s, e) => s + e.points, 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="card p-4">
                    <div className="text-xs text-ink3 mb-1">Completed</div>
                    <div className="text-2xl font-extrabold text-brand">
                      {employees.reduce((s, e) => s + e.completed, 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="card p-4">
                    <div className="text-xs text-ink3 mb-1">On Time</div>
                    <div className="text-2xl font-extrabold text-green-500">
                      {employees.reduce((s, e) => s + e.onTime, 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="card p-4">
                    <div className="text-xs text-ink3 mb-1">Overdue</div>
                    <div className="text-2xl font-extrabold text-red-500">
                      {employees.reduce((s, e) => s + e.overdue, 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Bar chart - top employees */}
                <BarChartCard
                  title="Top Employee Performance"
                  subtitle="KPI points by employee"
                  data={employees.slice(0, 10).map((e) => ({ name: e.name, points: e.points, completed: e.completed }))}
                  xKey="name"
                  series={[
                    { key: 'points', name: 'Points', color: '#6366f1' },
                    { key: 'completed', name: 'Completed', color: '#22c55e' },
                  ]}
                  layout="horizontal"
                />

                {/* Employee table */}
                <div className="card p-4">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Award size={16} className="text-brand" /> Employee Leaderboard
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                          <th className="pb-2 w-12">Rank</th>
                          <th className="pb-2">Employee</th>
                          <th className="pb-2 text-center">Team</th>
                          <th className="pb-2 text-center">Branch</th>
                          <th className="pb-2 text-right">Points</th>
                          <th className="pb-2 text-right">Completed</th>
                          <th className="pb-2 text-right">On Time</th>
                          <th className="pb-2 text-right">Overdue</th>
                          <th className="pb-2 text-right">Rate</th>
                          <th className="pb-2 text-right">Avg Hrs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {employees.map((e) => (
                          <tr key={e.id} className="hover:bg-card2/50 transition-colors">
                            <td className="py-2.5"><RankBadge rank={e.rank} /></td>
                            <td className="py-2.5">
                              <div className="font-medium">{e.name}</div>
                              <div className="text-[11px] text-ink3">{e.email}</div>
                            </td>
                            <td className="py-2.5 text-center text-ink2 text-xs">{e.team}</td>
                            <td className="py-2.5 text-center text-ink2 text-xs">{e.branch}</td>
                            <td className="py-2.5 text-right"><PointsBadge value={e.points} /></td>
                            <td className="py-2.5 text-right font-mono">{e.completed}</td>
                            <td className="py-2.5 text-right font-mono text-green-600">{e.onTime}</td>
                            <td className="py-2.5 text-right font-mono text-red-600">{e.overdue}</td>
                            <td className="py-2.5 text-right font-mono">{e.completionRate}%</td>
                            <td className="py-2.5 text-right font-mono">{e.avgHours}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Team Ranking */}
          {tab === 'team' && (
            teams.length === 0 ? (
              <EmptyState icon={<Users size={28} />} title="No team data" subtitle="No KPI data available for the selected period." />
            ) : (
              <div className="space-y-5">
                <BarChartCard
                  title="Team Performance Comparison"
                  subtitle="KPI points by team"
                  data={teams.map((t) => ({ name: t.name, points: t.points, avgPoints: t.avgPoints }))}
                  xKey="name"
                  series={[
                    { key: 'points', name: 'Points', color: '#6366f1' },
                    { key: 'avgPoints', name: 'Avg Points/User', color: '#22c55e' },
                  ]}
                  layout="horizontal"
                />
                <div className="card p-4">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Users size={16} className="text-brand" /> Team Leaderboard
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                          <th className="pb-2 w-12">Rank</th>
                          <th className="pb-2">Team</th>
                          <th className="pb-2 text-right">Members</th>
                          <th className="pb-2 text-right">Points</th>
                          <th className="pb-2 text-right">Avg/User</th>
                          <th className="pb-2 text-right">Completed</th>
                          <th className="pb-2 text-right">On Time</th>
                          <th className="pb-2 text-right">Overdue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {teams.map((t) => (
                          <tr key={t.name} className="hover:bg-card2/50 transition-colors">
                            <td className="py-2.5"><RankBadge rank={t.rank} /></td>
                            <td className="py-2.5 font-medium">{t.name}</td>
                            <td className="py-2.5 text-right font-mono">{t.users}</td>
                            <td className="py-2.5 text-right"><PointsBadge value={t.points} /></td>
                            <td className="py-2.5 text-right font-mono">{t.avgPoints}</td>
                            <td className="py-2.5 text-right font-mono">{t.completed}</td>
                            <td className="py-2.5 text-right font-mono text-green-600">{t.onTime}</td>
                            <td className="py-2.5 text-right font-mono text-red-600">{t.overdue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Branch Ranking */}
          {tab === 'branch' && (
            branches.length === 0 ? (
              <EmptyState icon={<Building2 size={28} />} title="No branch data" subtitle="No KPI data available for the selected period." />
            ) : (
              <div className="space-y-5">
                <BarChartCard
                  title="Branch Performance Comparison"
                  subtitle="KPI points by branch"
                  data={branches.map((b) => ({ name: b.name, points: b.points, avgPoints: b.avgPoints }))}
                  xKey="name"
                  series={[
                    { key: 'points', name: 'Points', color: '#f97316' },
                    { key: 'avgPoints', name: 'Avg Points/User', color: '#3b82f6' },
                  ]}
                  layout="horizontal"
                />
                <div className="card p-4">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Building2 size={16} className="text-brand" /> Branch Leaderboard
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                          <th className="pb-2 w-12">Rank</th>
                          <th className="pb-2">Branch</th>
                          <th className="pb-2 text-right">Members</th>
                          <th className="pb-2 text-right">Points</th>
                          <th className="pb-2 text-right">Avg/User</th>
                          <th className="pb-2 text-right">Completed</th>
                          <th className="pb-2 text-right">On Time</th>
                          <th className="pb-2 text-right">Overdue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {branches.map((b) => (
                          <tr key={b.name} className="hover:bg-card2/50 transition-colors">
                            <td className="py-2.5"><RankBadge rank={b.rank} /></td>
                            <td className="py-2.5 font-medium">{b.name}</td>
                            <td className="py-2.5 text-right font-mono">{b.users}</td>
                            <td className="py-2.5 text-right"><PointsBadge value={b.points} /></td>
                            <td className="py-2.5 text-right font-mono">{b.avgPoints}</td>
                            <td className="py-2.5 text-right font-mono">{b.completed}</td>
                            <td className="py-2.5 text-right font-mono text-green-600">{b.onTime}</td>
                            <td className="py-2.5 text-right font-mono text-red-600">{b.overdue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Monthly KPI */}
          {tab === 'monthly' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <label className="label text-xs mb-0">Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="input text-sm !w-auto"
                >
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <LineChartCard
                title="Monthly KPI Trend"
                subtitle={`KPI points, completed and on-time tasks for ${year}`}
                data={months.map((m) => ({ name: m.monthName, points: m.points, totalCompleted: m.totalCompleted, totalOnTime: m.totalOnTime }))}
                xKey="name"
                series={[
                  { key: 'points', name: 'Points', color: '#6366f1' },
                  { key: 'totalCompleted', name: 'Completed', color: '#22c55e' },
                  { key: 'totalOnTime', name: 'On Time', color: '#3b82f6' },
                ]}
              />
              <div className="card p-4">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Calendar size={16} className="text-brand" /> Monthly Breakdown
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                        <th className="pb-2">Month</th>
                        <th className="pb-2 text-right">Points</th>
                        <th className="pb-2 text-right">Completed</th>
                        <th className="pb-2 text-right">On Time</th>
                        <th className="pb-2 text-right">Overdue</th>
                        <th className="pb-2 text-right">Completion Rate</th>
                        <th className="pb-2 text-right">Avg Points/User</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {months.map((m) => (
                        <tr key={m.month} className="hover:bg-card2/50 transition-colors">
                          <td className="py-2.5 font-medium">{m.monthName}</td>
                          <td className="py-2.5 text-right"><PointsBadge value={m.points} /></td>
                          <td className="py-2.5 text-right font-mono">{m.totalCompleted}</td>
                          <td className="py-2.5 text-right font-mono text-green-600">{m.totalOnTime}</td>
                          <td className="py-2.5 text-right font-mono text-red-600">{m.totalOverdue}</td>
                          <td className="py-2.5 text-right font-mono">{m.completionRate}%</td>
                          <td className="py-2.5 text-right font-mono">{m.avgPointsPerUser}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Yearly KPI */}
          {tab === 'yearly' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="label text-xs mb-0">From</label>
                  <select
                    value={startYear}
                    onChange={(e) => setStartYear(Number(e.target.value))}
                    className="input text-sm !w-auto"
                  >
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="label text-xs mb-0">To</label>
                  <select
                    value={endYear}
                    onChange={(e) => setEndYear(Number(e.target.value))}
                    className="input text-sm !w-auto"
                  >
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <LineChartCard
                title="Yearly KPI Comparison"
                subtitle={`KPI points and completed tasks (${startYear}–${endYear})`}
                data={years.map((y) => ({ name: String(y.year), points: y.points, totalCompleted: y.totalCompleted, totalOnTime: y.totalOnTime }))}
                xKey="name"
                series={[
                  { key: 'points', name: 'Points', color: '#6366f1' },
                  { key: 'totalCompleted', name: 'Completed', color: '#22c55e' },
                  { key: 'totalOnTime', name: 'On Time', color: '#3b82f6' },
                ]}
              />
              <div className="card p-4">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <TrendingUp size={16} className="text-brand" /> Yearly Breakdown
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                        <th className="pb-2">Year</th>
                        <th className="pb-2 text-right">Active Users</th>
                        <th className="pb-2 text-right">Points</th>
                        <th className="pb-2 text-right">Completed</th>
                        <th className="pb-2 text-right">On Time</th>
                        <th className="pb-2 text-right">Overdue</th>
                        <th className="pb-2 text-right">Completion Rate</th>
                        <th className="pb-2 text-right">Avg Points/User</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {years.map((y) => (
                        <tr key={y.year} className="hover:bg-card2/50 transition-colors">
                          <td className="py-2.5 font-medium">{y.year}</td>
                          <td className="py-2.5 text-right font-mono">{y.activeUsers}</td>
                          <td className="py-2.5 text-right"><PointsBadge value={y.points} /></td>
                          <td className="py-2.5 text-right font-mono">{y.totalCompleted}</td>
                          <td className="py-2.5 text-right font-mono text-green-600">{y.totalOnTime}</td>
                          <td className="py-2.5 text-right font-mono text-red-600">{y.totalOverdue}</td>
                          <td className="py-2.5 text-right font-mono">{y.completionRate}%</td>
                          <td className="py-2.5 text-right font-mono">{y.avgPointsPerUser}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Distribution */}
          {tab === 'distribution' && (
            distribution.length === 0 ? (
              <EmptyState icon={<PieIcon size={28} />} title="No distribution data" subtitle="No KPI distribution data available for the selected period." />
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <DonutChartCard
                    title="KPI Distribution"
                    subtitle="Points contribution by category"
                    data={pieData}
                    centerLabel={totalPoints.toLocaleString()}
                  />
                  <BarChartCard
                    title="Category Contribution"
                    subtitle="Total points per KPI category"
                    data={distribution.map((d, i) => ({
                      name: d.category,
                      points: d.points,
                      percentage: d.percentage,
                    }))}
                    xKey="name"
                    series={[{ key: 'points', name: 'Points', color: '#a855f7' }]}
                    layout="horizontal"
                  />
                </div>
                <div className="card p-4">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <PieIcon size={16} className="text-brand" /> Distribution Breakdown
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs text-ink3 uppercase tracking-wider">
                          <th className="pb-2">Category</th>
                          <th className="pb-2 text-right">Points</th>
                          <th className="pb-2 text-right">Share</th>
                          <th className="pb-2 w-1/3">Contribution</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {distribution.map((d, i) => (
                          <tr key={d.category} className="hover:bg-card2/50 transition-colors">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                <span className="font-medium">{d.category}</span>
                              </div>
                            </td>
                            <td className="py-2.5 text-right font-mono">{d.points.toLocaleString()}</td>
                            <td className="py-2.5 text-right font-mono">{d.percentage}%</td>
                            <td className="py-2.5">
                              <div className="progress-bar"><div style={{ width: `${d.percentage}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} /></div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
