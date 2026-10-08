import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, FileText, FileSpreadsheet, FileJson, Activity } from 'lucide-react';
import { api, downloadExport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Skeleton, Badge, Tabs } from '../components/ui';
import { ChartCard, DonutChartCard, AreaChartCard } from '../components/charts';
import SelfTaskReport from '../components/SelfTaskReport';
import KpiReports from '../components/KpiReports';
import { DATE_PRESETS, timeAgo } from '../lib/utils';

export default function Reports() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'overview' | 'selftasks' | 'kpi'>('overview');
  const [dateKey, setDateKey] = useState('30d');
  const [analytics, setAnalytics] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (dk: string) => {
    setLoading(true);
try {
        const [an, ac] = await Promise.all([
          api.get<any>('/reports/analytics', { dateKey: dk }),
          api.get<any[]>('/reports/activity', { dateKey: dk }),
        ]);
        setAnalytics(an); setActivity(ac);
      } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(dateKey); }, [dateKey, load]);

  const tzOffset = 360;
  const exp = (type: string, format: string) => `/reports/export?type=${type}&format=${format}&dateKey=${dateKey}&tzOffset=${tzOffset}`;
  const doExport = async (path: string, file: string) => {
    try { await downloadExport(path, file); } catch (e: any) { toast(e.message, 'error'); }
  };
  const exports = [
    { label: 'Self Task Report (CSV)', file: 'self-task-report.csv', path: `/reports/export?type=selftasks&format=csv&dateKey=${dateKey}&tzOffset=${tzOffset}` },
    { label: 'Self Task Report (Excel)', file: 'self-task-report.xlsx', path: `/reports/export?type=selftasks&format=xlsx&dateKey=${dateKey}&tzOffset=${tzOffset}` },
    { label: 'Self Task Report (PDF)', file: 'self-task-report.pdf', path: `/reports/export?type=selftasks&format=pdf&dateKey=${dateKey}&tzOffset=${tzOffset}` },
    { label: 'Tasks CSV', file: 'tasks.csv', path: exp('tasks', 'csv') },
    { label: 'Tasks Excel', file: 'tasks.xlsx', path: exp('tasks', 'xlsx') },
    { label: 'Tasks PDF', file: 'tasks.pdf', path: exp('tasks', 'pdf') },
    { label: 'Leaves & Weekend Log', file: 'leaves.csv', path: exp('leaves', 'csv') },
    { label: 'Leaves Excel', file: 'leaves.xlsx', path: exp('leaves', 'xlsx') },
    { label: 'Activity Log', file: 'activity.csv', path: exp('activity', 'csv') },
    { label: 'Activity PDF', file: 'activity.pdf', path: exp('activity', 'pdf') },
  ].filter((e) => (isAdmin || e.file.endsWith('.csv')) && (!e.file.startsWith('self-task-report') || isAdmin));

  const quickExports = exports;

return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><BarChart3 size={24} className="text-brand" /> Reports & Analytics</h1>
          <p className="text-sm text-ink2 mt-0.5">{isAdmin ? 'Organization-wide analytics' : 'Your personal insights'}</p>
        </div>
        {tab === 'overview' && (
          <div className="flex gap-2">
            <select className="input !w-auto" value={dateKey} onChange={(e) => setDateKey(e.target.value)}>
              {DATE_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <div className="flex gap-1.5">
              {(isAdmin
                ? [
                    { icon: FileText, label: 'CSV', p: exp('tasks', 'csv'), f: 'tasks.csv' },
                    { icon: FileSpreadsheet, label: 'XLSX', p: exp('tasks', 'xlsx'), f: 'tasks.xlsx' },
                    { icon: FileJson, label: 'PDF', p: exp('tasks', 'pdf'), f: 'tasks.pdf' },
                  ]
                : [{ icon: FileText, label: 'CSV', p: exp('tasks', 'csv'), f: 'tasks.csv' }]
              ).map((e) => (
                <button key={e.label} className="btn btn-ghost btn-sm" onClick={() => doExport(e.p, e.f)} title={`Export ${e.label}`}>
                  <e.icon size={14} /> <span className="hidden sm:inline">{e.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'selftasks', label: 'Self Task Report' },
          { key: 'kpi', label: 'KPI Reports' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as 'overview' | 'selftasks' | 'kpi')}
      />

      {tab === 'selftasks' ? (
        <SelfTaskReport />
      ) : tab === 'kpi' ? (
        <KpiReports />
      ) : (
        <>
          {loading && !analytics ? (
            <div className="space-y-4"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <DonutChartCard title="Status Distribution" centerLabel="Tasks"
                  data={(analytics?.status || []).map((s: any) => ({ name: s.status, value: s.c, color: statusColor(s.status) }))} />
                <DonutChartCard title="Priority Distribution"
                  data={(analytics?.priority || []).map((p: any) => ({ name: p.priority, value: p.c, color: prioColor(p.priority) }))} />
                <DonutChartCard title="Task Type Distribution"
                  data={(analytics?.type || []).map((t: any) => ({ name: t.task_type, value: t.c, color: '#6366f1' }))} />
              </div>

              <AreaChartCard title="Monthly Productivity" subtitle="Added vs completed over the last 12 months"
                data={analytics?.monthly || []} xKey="month"
                series={[{ key: 'added', name: 'Added', color: '#6366f1' }, { key: 'done', name: 'Completed', color: '#22c55e' }]} />

              <ChartCard title="Workload Management" subtitle="Open task count per user">
                <div className="space-y-2.5">
                  {(analytics?.workload || []).map((w: any) => (
                    <div key={w.id} className="flex items-center gap-3">
                      <span className="text-sm w-32 truncate">{w.name}</span>
                      <div className="flex-1">
                        <div className="progress-bar"><div style={{ width: `${Math.min(100, w.open_count * 10)}%` }} /></div>
                      </div>
                      <span className="text-sm font-bold w-6 text-right">{w.open_count}</span>
                    </div>
                  ))}
                </div>
              </ChartCard>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <ChartCard title="User Activity" subtitle="Recent audit trail" action={<Badge color="#6366f1"><Activity size={11} /> {activity.length} events</Badge>}>
                  <div className="space-y-1 max-h-[360px] overflow-y-auto">
                    {activity.slice(0, 30).map((a) => (
                      <div key={a.id} className="flex items-start gap-2 p-1.5">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand/60 shrink-0" />
                        <div className="text-xs">
                          <span className="font-semibold">{a.user_name || 'System'}</span>
                          <span className="text-ink2"> {a.action.replace('.', ' ')}</span>
                          {a.details && <span className="text-ink3"> · {String(a.details).slice(0, 50)}</span>}
                          <div className="text-[10px] text-ink3">{timeAgo(a.created_at)}</div>
                        </div>
                      </div>
                    ))}
                    {activity.length === 0 && <div className="text-sm text-ink3 p-4 text-center">No activity</div>}
                  </div>
                </ChartCard>

                <div className="space-y-3">
                  <ChartCard title="Quick Export" subtitle="Export filtered reports">
                    <div className="space-y-2">
                      {exports.map((e) => (
                        <button key={e.label} onClick={() => doExport(e.path, e.file)}
                          className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-card2/60 hover:bg-card2 transition-colors text-sm">
                          <Download size={14} className="text-brand" />
                          <span className="font-medium flex-1 text-left">{e.label}</span>
                          <span className="text-xs text-ink3">{e.file.split('.').pop()}</span>
                        </button>
                      ))}
                    </div>
                  </ChartCard>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function statusColor(s: string) {
  return ({ todo: '#3b82f6', discussion: '#eab308', in_progress: '#f97316', in_review: '#a855f7', done: '#22c55e', cancelled: '#ef4444' } as Record<string, string>)[s] || '#94a3b8';
}
function prioColor(p: string) {
  return ({ low: '#64748b', medium: '#3b82f6', high: '#f97316', critical: '#ef4444' } as Record<string, string>)[p] || '#94a3b8';
}
