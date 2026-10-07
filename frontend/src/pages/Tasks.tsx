import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutGrid, List, Kanban, CalendarDays, Rows3, Plus, ListTodo, UserPlus, FolderKanban } from 'lucide-react';
import { api } from '../lib/api';
import type { Task, User, Team, Department } from '../lib/types';
import { useAuth } from '../lib/auth';
import { FilterBar } from '../components/FilterBar';
import { defaultFilters, filterToParams } from '../lib/filters';
import type { FilterState } from '../lib/filters';
import { EmptyState, Skeleton, useToast, OwnTaskLegend } from '../components/ui';
import { cx } from '../lib/utils';

const ListView = React.lazy(() => import('../components/views/ListView').then(m => ({ default: m.ListView })));
const GridView = React.lazy(() => import('../components/views/GridView').then(m => ({ default: m.GridView })));
const KanbanView = React.lazy(() => import('../components/views/KanbanView').then(m => ({ default: m.KanbanView })));
const CalendarView = React.lazy(() => import('../components/views/CalendarView').then(m => ({ default: m.CalendarView })));
const TimelineView = React.lazy(() => import('../components/views/TimelineView').then(m => ({ default: m.TimelineView })));
const TaskForm = React.lazy(() => import('../components/TaskForm').then(m => ({ default: m.default })));

const VIEWS = [
  { key: 'list', label: 'List', icon: List },
  { key: 'grid', label: 'Grid', icon: LayoutGrid },
  { key: 'kanban', label: 'Kanban', icon: Kanban },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'timeline', label: 'Timeline', icon: Rows3 },
];

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin, hasPermission } = useAuth();
  // Every create entry point below is gated on this so roles without
  // tasks.create (e.g. Branch Asst.) see a read-only task list.
  const canCreate = hasPermission('tasks.create');
  const [view, setView] = useState<string>(params.get('view') || 'kanban');
  const [filters, setFilters] = useState<FilterState>(() => {
    const search = params.get('search');
    return search ? { ...defaultFilters, search } : { ...defaultFilters };
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(canCreate && params.get('new') === '1');
  const [selfFormOpen, setSelfFormOpen] = useState(canCreate && params.get('self') === '1');

  const load = useCallback(async (f: FilterState) => {
    setLoading(true);
    try {
      const data = await api.get<Task[]>('/tasks', filterToParams(f));
      setTasks(data);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load(filters);
    api.get<User[]>('/users').then(setUsers).catch(() => { });
    api.get<Team[]>('/teams').then(setTeams).catch(() => { });
    api.get<Department[]>('/departments').then(setDepts).catch(() => { });
  }, []);

  const onFiltersChange = (f: FilterState) => {
    setFilters(f);
    load(f);
    setParams(f.search ? { search: f.search } : {}, { replace: true });
  };

  const doneCount = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks]);
  const openCount = useMemo(() => tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length, [tasks]);

  const newTask = canCreate && (params.get('new') === '1' || formOpen);
  const canCreateSelfTask = canCreate;

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2"><ListTodo size={24} className="text-brand" /> Tasks</h1>
          <p className="text-sm text-ink2 mt-0.5">{tasks.length} tasks · {openCount} open · {doneCount} completed</p>
        </div>
        <div className="flex items-center gap-2">
          {canCreateSelfTask && (
            <button className="btn btn-ghost" onClick={() => setSelfFormOpen(true)}><UserPlus size={16} /> Self Task</button>
          )}
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setFormOpen(true)}><Plus size={16} /> New Task</button>
          )}
        </div>
      </div>

      <FilterBar value={filters} onChange={onFiltersChange} data={{ users, teams, departments: depts }} onRefresh={() => load(filters)} loading={loading} />

      <div className="flex items-center gap-1 bg-card2 rounded-xl p-1 w-fit flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => { setView(v.key); setParams({ view: v.key }, { replace: true }); }}
            className={cx('tab flex items-center gap-1.5', view === v.key && 'tab-active')}>
            <v.icon size={14} /> <span className="hidden sm:inline">{v.label}</span>
          </button>
        ))}
        <button onClick={() => navigate('/projects')} className="tab flex items-center gap-1.5 text-brand">
          <FolderKanban size={14} /> <span className="hidden sm:inline">Projects</span>
        </button>
      </div>

      {isAdmin && <OwnTaskLegend />}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={<ListTodo size={26} />} title="No tasks match your filters"
          subtitle={canCreate ? 'Try adjusting the filters or create a new task.' : 'Try adjusting the filters.'}
          action={canCreate ? <button className="btn btn-primary" onClick={() => setFormOpen(true)}><Plus size={16} /> Create Task</button> : undefined} />
      ) : (
        <Suspense fallback={<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5"><Skeleton className="h-36" /></div>}>
          {view === 'list' && <ListView tasks={tasks} />}
          {view === 'grid' && <GridView tasks={tasks} />}
          {view === 'kanban' && <KanbanView tasks={tasks} onMoved={() => load(filters)} />}
          {view === 'calendar' && <CalendarView tasks={tasks} />}
          {view === 'timeline' && <TimelineView tasks={tasks} />}
        </Suspense>
      )}

      {canCreate && (
        <Suspense fallback={null}>
          <TaskForm open={newTask} onClose={() => { setFormOpen(false); setParams({}, { replace: true }); }}
            task={null} onSaved={(t) => { load(filters); navigate(`/tasks/${t.id}`); }} />
          {canCreateSelfTask && (
            <TaskForm open={selfFormOpen} onClose={() => { setSelfFormOpen(false); setParams({}, { replace: true }); }}
              task={null} selfTask onSaved={(t) => { load(filters); navigate(`/tasks/${t.id}`); }} />
          )}
        </Suspense>
      )}
    </div>
  );
}
