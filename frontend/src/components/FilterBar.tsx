import React, { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Search, RefreshCw, Save, X, ChevronDown, Download } from 'lucide-react';
import { FilterState, defaultFilters, filterToParams } from '../lib/filters';
import { DATE_PRESETS, cx, buildQuery } from '../lib/utils';
import { api, downloadExport } from '../lib/api';
import type { Team, Department, User } from '../lib/types';
import { useSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { useToast } from './ui';

interface RefOpt { id: string; name: string; color?: string }

function MultiSelect({ label, options, value, onChange, colorOf }: {
  label: string; options: RefOpt[]; value: string[]; onChange: (v: string[]) => void; colorOf?: (id: string) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((o) => value.includes(o.id));
  const available = options.filter((o) => !value.includes(o.id));
  return (
    <div className="relative">
      <div className="label">{label}</div>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between !py-2 text-left">
        <span className="flex flex-wrap gap-1 truncate">
          {selected.length === 0 && <span className="text-ink3 text-xs">Any</span>}
          {selected.slice(0, 3).map((s) => (
            <span key={s.id} className="chip" style={s.color ? { color: s.color, borderColor: `${s.color}44`, background: `${s.color}14` } : {}}>{s.name}</span>
          ))}
          {selected.length > 3 && <span className="chip">+{selected.length - 3}</span>}
        </span>
        <ChevronDown size={14} className={cx('text-ink3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="card anim-pop absolute z-30 mt-1 w-full max-h-56 overflow-y-auto p-1" style={{ background: 'rgb(var(--card))' }}>
          {selected.map((s) => (
            <div key={s.id} className="menu-item !py-1.5">
              <span className="chip" style={s.color ? { color: s.color, borderColor: `${s.color}44`, background: `${s.color}14` } : {}}>{s.name}</span>
              <button className="ml-auto p-1 text-ink3 hover:text-bad" onClick={() => onChange(value.filter((v) => v !== s.id))}><X size={13} /></button>
            </div>
          ))}
          {available.map((o) => (
            <button key={o.id} type="button" className="menu-item !py-1.5" onClick={() => { onChange([...value, o.id]); setOpen(false); }}>
              {o.name}
            </button>
          ))}
          {available.length === 0 && <div className="text-xs text-ink3 p-2">All selected</div>}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ value, onChange, data, onRefresh, loading }: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  data?: { users?: User[]; teams?: Team[]; departments?: Department[] };
  onRefresh?: () => void;
  loading?: boolean;
}) {
  const settings = useSettings();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ id: number; name: string; payload: FilterState }[]>([]);
  const [saveName, setSaveName] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(value.search || '');

  useEffect(() => {
    api.get<{ id: number; name: string; payload: FilterState }[]>('/settings/saved-filters').then(setSaved).catch(() => {});
  }, []);

  useEffect(() => { setSearchDraft(value.search || ''); }, [value.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== (value.search || '')) set({ search: searchDraft });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const activeCount = useMemo(() => {
    const keys = ['status', 'priority', 'difficulty', 'task_type', 'tags', 'flags', 'assignee', 'created_by', 'reviewer', 'team_id', 'department_id'] as const;
    return keys.filter((k) => (value[k] || []).length).length +
      [value.overdueOnly, value.pendingOnly, value.completedOnly, value.cancelledOnly, value.archived, value.myTasks, value.highPriority, value.criticalOnly, value.blocked].filter(Boolean).length +
      (value.dateKey ? 1 : 0);
  }, [value]);

  const users = data?.users || [];
  const teams = data?.teams || [];
  const depts = data?.departments || [];
  const userOpts = users.map((u) => ({ id: String(u.id), name: u.name }));
  const teamOpts = teams.map((t) => ({ id: String(t.id), name: t.name }));
  const deptOpts = depts.map((d) => ({ id: String(d.id), name: d.name }));
  const statusOpts = (settings?.taskStatuses || []).map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const prioOpts = (settings?.priorities || []).map((p) => ({ id: p.id, name: p.name, color: p.color }));
  const diffOpts = (settings?.difficulties || []).map((d) => ({ id: d.id, name: d.name }));
  const typeOpts = ['task', 'bug', 'feature', 'research', 'design', 'infra'].map((t) => ({ id: t, name: t[0].toUpperCase() + t.slice(1) }));
  const tagOpts = [...new Set(['frontend', 'backend', 'api', 'design', 'research', 'infra', 'marketing', 'data', 'mobile', 'automation'])].map((t) => ({ id: t, name: t }));
  const flagOpts = ['Urgent', 'Client', 'Internal', 'Finance', 'Development', 'Infrastructure', 'Security', 'Bug', 'Enhancement', 'Testing', 'Software', 'Network', 'Design'].map((f) => ({ id: f, name: f }));

  const quickToggles: { key: keyof FilterState; label: string }[] = [
    { key: 'overdueOnly', label: 'Overdue' },
    { key: 'pendingOnly', label: 'Pending' },
    { key: 'completedOnly', label: 'Completed' },
    { key: 'cancelledOnly', label: 'Cancelled' },
    { key: 'myTasks', label: 'My Tasks' },
    { key: 'highPriority', label: 'High Priority' },
    { key: 'criticalOnly', label: 'Critical' },
    { key: 'blocked', label: 'Blocked' },
  ];

  const savePreset = async () => {
    if (!saveName.trim()) return;
    await api.post('/settings/saved-filters', { name: saveName, payload: value });
    setSaveName('');
    toast('Filter preset saved');
    api.get<{ id: number; name: string; payload: FilterState }[]>('/settings/saved-filters').then(setSaved).catch(() => {});
  };

  const applyPreset = (p: FilterState) => {
    onChange({ ...defaultFilters, ...p });
    setPresetOpen(false);
  };

  const doExport = async (fmt: string) => {
    const q = buildQuery(filterToParams(value)).replace(/^\?/, '');
    try { await downloadExport(`/reports/export?type=tasks&format=${fmt}${q ? `&${q}` : ''}`, `tasks.${fmt}`); } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px] sm:min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            className="input !pl-9 !py-2"
            placeholder="Search Task ID (TSK-…), #number, title or description..."
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </div>

        <select className="input !w-auto" value={value.dateKey || ''} onChange={(e) => set({ dateKey: e.target.value || undefined })}>
          <option value="">All Dates</option>
          {DATE_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        {value.dateKey === 'custom' && (
          <>
            <input type="date" className="input !w-auto" value={value.from || ''} onChange={(e) => set({ from: e.target.value })} />
            <input type="date" className="input !w-auto" value={value.to || ''} onChange={(e) => set({ to: e.target.value })} />
          </>
        )}

        <select className="input !w-auto" value={value.sort || 'updated'} onChange={(e) => set({ sort: e.target.value })}>
          <option value="updated">Sort: Updated</option>
          <option value="created">Sort: Created</option>
          <option value="due_date">Sort: Due Date</option>
          <option value="priority">Sort: Priority</option>
          <option value="status">Sort: Status</option>
          <option value="title">Sort: Title</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => set({ sortDir: value.sortDir === 'asc' ? 'desc' : 'asc' })}>
          {value.sortDir === 'asc' ? 'Asc ↑' : 'Desc ↓'}
        </button>

        <button className={cx('btn btn-ghost btn-sm', activeCount > 0 && '!text-brand !border-brand/40')} onClick={() => setOpen((o) => !o)}>
          <SlidersHorizontal size={14} /> Filters {activeCount > 0 && `(${activeCount})`}
        </button>

        <div className="relative">
          <button className="btn btn-ghost btn-sm" onClick={() => setPresetOpen((o) => !o)}>
            <Save size={14} /> Presets
          </button>
          {presetOpen && (
            <div className="card anim-pop absolute right-0 mt-1.5 w-60 z-30 p-2" style={{ background: 'rgb(var(--card))' }}>
              <div className="flex gap-1.5 mb-1.5">
                <input className="input !py-1.5 text-xs" placeholder="Preset name" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                <button className="btn btn-primary btn-xs" onClick={savePreset}>Save</button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {saved.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <button className="menu-item flex-1 !py-1.5 text-xs" onClick={() => applyPreset(s.payload)}>{s.name}</button>
                    <button className="p-1 text-ink3 hover:text-bad" onClick={async () => { await api.delete(`/settings/saved-filters/${s.id}`); setSaved((x) => x.filter((y) => y.id !== s.id)); }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {saved.length === 0 && <div className="text-xs text-ink3 p-2">No saved presets</div>}
              </div>
            </div>
          )}
        </div>

        {onRefresh && (
          <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={cx(loading && 'animate-spin')} />
          </button>
        )}

        <div className="relative">
          <button className="btn btn-primary btn-sm" onClick={() => setExportOpen((o) => !o)}>
            <Download size={14} /> Export
          </button>
          {exportOpen && (
            <div className="card anim-pop absolute right-0 mt-1.5 z-30 p-1.5" style={{ background: 'rgb(var(--card))' }}>
              {(isAdmin ? (['csv', 'xlsx', 'pdf'] as const) : (['csv'] as const)).map((fmt) => (
                <button key={fmt} className="menu-item" onClick={() => { doExport(fmt); setExportOpen(false); }}>
                  <Download size={14} /> {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="card p-4 anim-in">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <MultiSelect label="Status" options={statusOpts} value={value.status || []} onChange={(v) => set({ status: v })} colorOf={(id) => statusOpts.find((o) => o.id === id)?.color} />
            <MultiSelect label="Priority" options={prioOpts} value={value.priority || []} onChange={(v) => set({ priority: v })} colorOf={(id) => prioOpts.find((o) => o.id === id)?.color} />
            <MultiSelect label="Difficulty" options={diffOpts} value={value.difficulty || []} onChange={(v) => set({ difficulty: v })} />
            <MultiSelect label="Task Type" options={typeOpts} value={value.task_type || []} onChange={(v) => set({ task_type: v })} />
            <MultiSelect label="Flags" options={flagOpts} value={value.flags || []} onChange={(v) => set({ flags: v })} />
            <MultiSelect label="Tags" options={tagOpts} value={value.tags || []} onChange={(v) => set({ tags: v })} />
            <MultiSelect label="Assignee" options={userOpts} value={value.assignee || []} onChange={(v) => set({ assignee: v })} />
            <MultiSelect label="Created By" options={userOpts} value={value.created_by || []} onChange={(v) => set({ created_by: v })} />
            <MultiSelect label="Reviewer" options={userOpts} value={value.reviewer || []} onChange={(v) => set({ reviewer: v })} />
            <MultiSelect label="Team" options={teamOpts} value={value.team_id || []} onChange={(v) => set({ team_id: v })} />
            <MultiSelect label="Branch" options={deptOpts} value={value.department_id || []} onChange={(v) => set({ department_id: v })} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {quickToggles.map((q) => (
              <button
                key={q.key}
                onClick={() => set({ [q.key]: !value[q.key] } as Partial<FilterState>)}
                className={cx('chip !py-1.5 !px-3 cursor-pointer transition-all', value[q.key] && '!bg-brand/15 !border-brand/40 !text-brand')}
              >
                {q.label}
              </button>
            ))}
            <button className="chip !py-1.5 !px-3 cursor-pointer hover:!bg-bad/10 hover:!text-bad" onClick={() => onChange({ ...defaultFilters })}>
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { filterToParams };
