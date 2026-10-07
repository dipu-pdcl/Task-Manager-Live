export interface FilterState {
  search?: string;
  dateKey?: string;
  from?: string;
  to?: string;
  status?: string[];
  priority?: string[];
  difficulty?: string[];
  task_type?: string[];
  tags?: string[];
  flags?: string[];
  assignee?: string[];
  created_by?: string[];
  reviewer?: string[];
  team_id?: string[];
  department_id?: string[];
  overdueOnly?: boolean;
  pendingOnly?: boolean;
  completedOnly?: boolean;
  cancelledOnly?: boolean;
  archived?: boolean;
  myTasks?: boolean;
  highPriority?: boolean;
  criticalOnly?: boolean;
  blocked?: boolean;
  sort?: string;
  sortDir?: string;
}

export const defaultFilters: FilterState = {
  dateKey: 'today',
  status: [],
  priority: [],
  difficulty: [],
  task_type: [],
  tags: [],
  flags: [],
  assignee: [],
  created_by: [],
  reviewer: [],
  team_id: [],
  department_id: [],
  overdueOnly: false,
  pendingOnly: false,
  completedOnly: false,
  cancelledOnly: false,
  archived: false,
  myTasks: false,
  highPriority: false,
  criticalOnly: false,
  blocked: false,
  sort: 'updated',
  sortDir: 'desc',
};

export function filterToParams(f: FilterState): Record<string, string | string[]> {
  const p: Record<string, string | string[]> = {};
  if (f.search) p.search = f.search;
  if (f.dateKey) {
    p.dateKey = f.dateKey;
    if (f.dateKey === 'custom' && f.from) p.date_from = f.from;
    if (f.dateKey === 'custom' && f.to) p.date_to = f.to;
  }
  if (f.status?.length) p.status = f.status;
  if (f.priority?.length) p.priority = f.priority;
  if (f.difficulty?.length) p.difficulty = f.difficulty;
  if (f.task_type?.length) p.task_type = f.task_type;
  if (f.tags?.length) p.tag = f.tags;
  if (f.flags?.length) p.flag = f.flags;
  if (f.assignee?.length) p.assignee = f.assignee;
  if (f.created_by?.length) p.created_by = f.created_by;
  if (f.reviewer?.length) p.reviewer = f.reviewer;
  if (f.team_id?.length) p.team_id = f.team_id;
  if (f.department_id?.length) p.department_id = f.department_id;
  if (f.overdueOnly) p.overdueOnly = 'true';
  if (f.pendingOnly) p.pendingOnly = 'true';
  if (f.completedOnly) p.completedOnly = 'true';
  if (f.cancelledOnly) p.status = [...(f.status || []), 'cancelled'];
  if (f.archived) p.archived = 'true';
  if (f.myTasks) p.myTasks = 'true';
  if (f.highPriority) p.highPriority = 'true';
  if (f.criticalOnly) p.criticalOnly = 'true';
  if (f.blocked) p.is_blocked = 'true';
  if (f.sort) { p.sort = f.sort; p.sortDir = f.sortDir === 'asc' ? 'asc' : 'desc'; }
  return p;
}
