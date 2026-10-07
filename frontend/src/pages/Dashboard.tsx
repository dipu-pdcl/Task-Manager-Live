import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ListTodo, CircleDashed, Target, CheckCircle2, CalendarClock, Clock3, Timer,
  CalendarDays, AlertOctagon, Activity, Trophy, TrendingUp, Gauge,
  Sparkles, ChevronRight
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSettings } from '../lib/settings';
import type { DashboardData, User, Team, Department } from '../lib/types';
import { StatCard, Skeleton, Badge, Avatar, useToast, OwnTaskLegend } from '../components/ui';
import { AreaChartCard, BarChartCard, DonutChartCard, ChartCard } from '../components/charts';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { statusById, priorityById, timeAgo, cx } from '../lib/utils';
import { FilterBar } from '../components/FilterBar';
import { defaultFilters, filterToParams } from '../lib/filters';
import { ownTaskClass } from '../lib/ownTasks';
import type { FilterState } from '../lib/filters';

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const ownId = isAdmin ? user?.id : null;
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [filters, setFilters] = useState<FilterState>({ ...defaultFilters, dateKey: '30d' });

  const load = useCallback(async (f: FilterState) => {
    setLoading(true);
    try {
      const params = filterToParams(f);
      const d = await api.get<DashboardData>('/dashboard', params);
      setData(d);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(filters); }, [filters]);

  useEffect(() => {
    api.get<User[]>('/users').then(setUsers).catch(() => {});
    api.get<Team[]>('/teams').then(setTeams).catch(() => {});
    api.get<Department[]>('/departments').then(setDepts).catch(() => {});
  }, []);

  if (!user) return null;
  if (loading && !data) return <PageLoader />;

  const s = data?.summary;
  const brand = '#6366f1';
  const cards = isAdmin ? [
    { label: 'Total Tasks', value: s?.total, icon: <ListTodo size={19} />, color: '#6366f1', sub: `${s?.done} completed` },
    { label: 'Open Tasks', value: s?.open, icon: <CircleDashed size={19} />, color: '#3b82f6', sub: `${s?.pending} pending` },
    { label: 'Completion Rate', value: `${s?.completionRate}%`, icon: <Target size={19} />, color: '#22c55e', sub: `${s?.doneToday} done today` },
    { label: 'Done / Day', value: s?.doneToday, icon: <CheckCircle2 size={19} />, color: '#14b8a6', sub: 'today' },
    { label: 'Overdue Tasks', value: s?.overdue, icon: <Clock3 size={19} />, color: '#ef4444', sub: `${s?.dueToday} due today` },
    { label: 'Pending Tasks', value: s?.pending, icon: <Timer size={19} />, color: '#eab308', sub: 'todo + discussion' },
    { label: 'Avg. Completion', value: `${s?.avgCompletionHours}h`, icon: <Timer size={19} />, color: '#a855f7', sub: 'avg hours' },
    { label: 'Active Users', value: s?.activeUsers, icon: <Gauge size={19} />, color: '#f97316', sub: 'in system' },
  ] : [
    { label: 'My Tasks', value: s?.total, icon: <ListTodo size={19} />, color: '#6366f1', sub: `${s?.done} completed` },
    { label: "Today's Tasks", value: s?.dueToday, icon: <CalendarDays size={19} />, color: '#3b82f6', sub: `${s?.dueWeek} this week` },
    { label: 'Overdue Tasks', value: s?.overdue, icon: <Clock3 size={19} />, color: '#ef4444', sub: 'needs attention' },
    { label: 'Completed', value: s?.done, icon: <CheckCircle2 size={19} />, color: '#22c55e', sub: `${s?.doneToday} today` },
    { label: 'In Progress', value: s?.inProgress, icon: <Activity size={19} />, color: '#f97316', sub: `${s?.inReview} in review` },
    { label: 'Avg. Completion', value: `${s?.avgCompletionHours}h`, icon: <Timer size={19} />, color: '#a855f7', sub: 'avg hours' },
    { label: 'My KPI Score', value: data?.kpi?.[0]?.score ?? 0, icon: <Trophy size={19} />, color: '#eab308', sub: `${data?.kpi?.[0]?.completionRate ?? 0}% completion` },
    { label: 'Blocked Tasks', value: s?.blocked, icon: <AlertOctagon size={19} />, color: '#ef4444', sub: 'awaiting unblock' },
  ];

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 anim-in">
        <div>
          <div className="flex items-center gap-2 text-sm text-ink2 mb-1">
            <Sparkles size={15} className="text-brand" />
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Dhaka' })}
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold">
            {isAdmin ? 'Executive Dashboard' : `Welcome back, ${user.name.split(' ')[0]}`}
          </h1>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/kpi')}><Trophy size={14} /> KPI</button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/reports')}><TrendingUp size={14} /> Reports</button>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/tasks/new')}><ChevronRight size={14} /> Quick action</button>
        </div>
      </div>

      <FilterBar value={filters} onChange={setFilters} data={{ users, teams, departments: depts }} onRefresh={() => load(filters)} loading={loading} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => <StatCard key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <AreaChartCard
            title="Daily Completed vs Added"
            subtitle="Task throughput over the last 14 days"
            data={data?.daily || []}
            xKey="day"
            series={[{ key: 'added', name: 'Added', color: brand }, { key: 'done', name: 'Completed', color: '#22c55e' }]}
          />
        </div>
        <DonutChartCard title="Task Status Distribution" data={(data?.statusDist || []).map((x) => ({ name: x.name, value: x.count, color: x.color }))} centerLabel={String(s?.total)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <DonutChartCard title="Priority Distribution" data={(data?.prioDist || []).map((x) => ({ name: x.name, value: x.count, color: x.color }))} />
        <BarChartCard title="Team Performance" subtitle="Tasks completed per team" data={(data?.teamPerf || []).map((t) => ({ name: t.name, total: t.total, completed: t.done }))} xKey="name"
          series={[{ key: 'completed', name: 'Completed', color: '#22c55e' }, { key: 'total', name: 'Total', color: '#94a3b8' }]} />
        <BarChartCard title="Branch Performance" subtitle="Tasks completed per branch" data={(data?.deptPerf || []).map((t) => ({ name: t.name, done: t.done }))} xKey="name"
          series={[{ key: 'done', name: 'Completed', color: brand }]} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <AreaChartCard title="Monthly Productivity" subtitle="Added vs completed per month" data={data?.monthly || []} xKey="day"
          series={[{ key: 'added', name: 'Added', color: brand }, { key: 'done', name: 'Completed', color: '#14b8a6' }]} />
        <BarChartCard title="User Performance Ranking" subtitle="Completed tasks by user" data={(data?.userPerf || []).map((u) => ({ name: u.name, done: u.done }))} xKey="name"
          series={[{ key: 'done', name: 'Completed', color: '#f97316' }]} />
        <BarChartCard title="KPI Score Chart" subtitle="Performance scores this period" data={(data?.kpi || []).slice(0, 10).map((k) => ({ name: (k.name || 'User').split(' ')[0], score: k.score }))} xKey="name"
          series={[{ key: 'score', name: 'KPI Score', color: '#8b5cf6' }]} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <LineChartComp data={data?.completionTrend || []} />
        <LineChartComp data={data?.overdueTrend || []} overdue />
        <RecentActivities data={data} />
      </div>

      {isAdmin && (
        <ChartCard title="Task Timeline" subtitle="Recently updated tasks">
          <OwnTaskLegend className="mb-3" />
          <div className="space-y-2">
            {(data?.recentTasks || []).map((t) => {
              const st = statusById(settings, t.status);
              const pr = priorityById(settings, t.priority);
              return (
                <button key={t.id} onClick={() => navigate(`/tasks/${t.id}`)}
                  className={cx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-card2 transition-colors text-left', ownTaskClass(t, ownId))}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{t.title}</div>
                    <div className="text-xs text-ink3 truncate">{t.team_name || 'No team'} · {t.department_name || 'No branch'} · updated {timeAgo(t.updated_at)}</div>
                    <div className="text-xs text-ink2 truncate mt-0.5">
                      Assigned to: {t.assigned_names || 'Unassigned'}
                    </div>
                  </div>
                  <Badge color={st.color} dot>{st.name}</Badge>
                  <Badge color={pr.color}>{pr.name}</Badge>
                </button>
              );
            })}
          </div>
        </ChartCard>
      )}

      {!isAdmin && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <DonutChartCard title="My Task Progress" subtitle="Distribution of your tasks" centerLabel={String(s?.total)}
            data={(data?.statusDist || []).map((x) => ({ name: x.name, value: x.count, color: x.color }))} />
          <ChartCard title="My Recent Notifications">
            <div className="space-y-1.5">
              {(data?.notifications || []).map((n) => (
                <div key={n.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-card2">
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-brand shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-ink3 truncate">{n.message} · {timeAgo(n.created_at)}</div>
                  </div>
                </div>
              ))}
              {(data?.notifications || []).length === 0 && <div className="text-sm text-ink3 p-4 text-center">No notifications</div>}
            </div>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function LineChartComp({ data, overdue }: { data: any[]; overdue?: boolean }) {
  return <ChartCard title={overdue ? 'Overdue Trend' : 'Task Completion Trend'} subtitle={overdue ? 'Overdue tasks per day (last 14 days)' : 'Tasks completed per day (last 14 days)'}>
    <div style={{ width: '100%', height: 200 }}>
      <TrendMini data={data} color={overdue ? '#ef4444' : '#22c55e'} keyName={overdue ? 'overdue' : 'completed'} />
    </div>
  </ChartCard>;
}

function TrendMini({ data, color, keyName }: { data: any[]; color: string; keyName: string }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--border),0.5)" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'rgb(var(--text-3))' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'rgb(var(--text-3))' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: 'rgb(var(--card))', border: '1px solid rgba(var(--border),0.6)', borderRadius: '0.75rem', fontSize: 12 }} cursor={{ fill: 'rgba(var(--accent),0.08)' }} />
        <Bar dataKey={keyName} fill={color} radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RecentActivities({ data }: { data: DashboardData | null }) {
  const navigate = useNavigate();
  return (
    <ChartCard title="Recent Activities" subtitle="Latest task changes" action={
      <button className="btn btn-ghost btn-xs" onClick={() => navigate('/audit')}>View audit</button>
    }>
      <div className="space-y-1">
        {(data?.activities || []).slice(0, 8).map((a) => (
          <div key={a.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-card2">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand/60 shrink-0" />
            <div className="text-xs min-w-0">
              <span className="font-semibold text-ink">{a.user_name || 'System'} </span>
              <span className="text-ink2">{a.action.replace('.', ' ')}</span>
              {a.new_value && <span className="text-ink2"> to </span>}
              {a.new_value && <span className="font-medium text-brand">{String(a.new_value).slice(0, 40)}</span>}
              <div className="text-[10px] text-ink3 mt-0.5">{timeAgo(a.created_at)}</div>
            </div>
          </div>
        ))}
        {(data?.activities || []).length === 0 && <div className="text-sm text-ink3 p-4 text-center">No recent activity</div>}
      </div>
    </ChartCard>
  );
}

function PageLoader() {
  return (
    <div className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-96" /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
      </div>
    </div>
  );
}
