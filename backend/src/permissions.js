export const PERMISSION_MODULES = [
  {
    id: 'dashboard',
    name: 'Dashboard Overview',
    description: 'Main overview dashboard, productivity metrics, and activity charts',
    permissions: [
      { id: 'dashboard.view', name: 'View Dashboard', description: 'Access dashboard overview, KPIs, and workload metrics' },
    ],
  },
  {
    id: 'tasks',
    name: 'Task Management',
    description: 'Core task workflows, Kanban board, assignments, and tracking',
    permissions: [
      { id: 'tasks.view', name: 'View Tasks', description: 'View task lists, Kanban boards, and task details' },
      { id: 'tasks.create', name: 'Create Tasks', description: 'Create and initiate new tasks' },
      { id: 'tasks.edit', name: 'Edit Tasks', description: 'Update task progress, status, checklists, and time logs' },
      { id: 'tasks.status', name: 'Update Task Status Only', description: 'Change task status and own progress/time only, without editing task details, checklists, or assignees' },
      { id: 'tasks.delete', name: 'Delete Tasks', description: 'Delete tasks and attachments' },
      { id: 'tasks.assign', name: 'Assign Tasks', description: 'Assign tasks to other staff members' },
    ],
  },
  {
    id: 'priority_tasks',
    name: 'Priority Tasks',
    description: 'High-priority task board and urgency action items',
    permissions: [
      { id: 'priority_tasks.view', name: 'View Priority Tasks', description: 'View priority task board and urgency list' },
      { id: 'priority_tasks.manage', name: 'Manage Priority Tasks', description: 'Create, update remarks, transfer, or delete priority tasks' },
    ],
  },
  {
    id: 'live_status',
    name: 'Live Status Tracker',
    description: 'Real-time staff online presence, active tasks, and team tracker',
    permissions: [
      { id: 'live_status.view', name: 'View Live Status', description: 'View team presence and active staff tracker' },
      { id: 'live_status.manage', name: 'Manage Live Status', description: 'Update status messages and presence settings' },
    ],
  },
  {
    id: 'leaves',
    name: 'Leave Management',
    description: 'Annual (EL), casual (CL), and sick (SL) leave workflows and balances',
    permissions: [
      { id: 'leaves.view', name: 'View Leaves & Calendar', description: 'View leave calendar, my leave history, and quota balances' },
      { id: 'leaves.apply', name: 'Apply For Leave', description: 'Submit leave applications for self' },
      { id: 'leaves.approve', name: 'Approve / Reject Leaves', description: 'Review and approve/reject staff leave applications' },
      { id: 'leaves.manage_quotas', name: 'Manage Staff Ledger & Quotas', description: 'Adjust annual leave quotas, staff ledger, and export CSV' },
    ],
  },
  {
    id: 'daily_task',
    name: 'Daily Task',
    description: 'Automatically assigned daily duties, completion tracking, and KPI rewards',
    permissions: [
      { id: 'daily_task.view', name: 'View Daily Tasks', description: 'See the daily tasks assigned to you and their completion status' },
      { id: 'daily_task.manage', name: 'Manage Daily Tasks', description: 'Add or remove group members, enable or disable daily tasks, rename them, and monitor completion' },
    ],
  },
  {
    id: 'users',
    name: 'Staff & User Directory',
    description: 'Employee profiles, authentication, and credentials',
    permissions: [
      { id: 'users.view', name: 'View Staff Directory', description: 'View staff directory, employee profiles, and contacts' },
      { id: 'users.manage', name: 'Manage Users & Roles', description: 'Create/edit users, assign role groups, and reset passwords' },
    ],
  },
  {
    id: 'teams',
    name: 'Team Management',
    description: 'Functional teams and team leads',
    permissions: [
      { id: 'teams.view', name: 'View Teams', description: 'View team structures and assigned members' },
      { id: 'teams.manage', name: 'Manage Teams', description: 'Create, edit, restructure teams, and assign team leads' },
    ],
  },
  {
    id: 'departments',
    name: 'Branches',
    description: 'Branch offices, branch heads, and locations',
    permissions: [
      { id: 'departments.view', name: 'View Branches', description: 'View branch directory' },
      { id: 'departments.manage', name: 'Manage Branches', description: 'Create, edit branches and assign branch heads' },
    ],
  },
  {
    id: 'kpi',
    name: 'KPI & Performance',
    description: 'Employee KPI scoring, leaderboards, and metrics',
    permissions: [
      { id: 'kpi.view', name: 'View KPI Leaderboard', description: 'View staff performance rankings and metrics' },
      { id: 'kpi.manage', name: 'Manage KPI Rules', description: 'Configure KPI formulas, targets, and scoring weights' },
    ],
  },
  {
    id: 'reports',
    name: 'Reports & Analytics',
    description: 'Operational analytics, charts, and report exports',
    permissions: [
      { id: 'reports.view', name: 'View Reports', description: 'Access operational reports and analytical charts' },
      { id: 'reports.export', name: 'Export Reports', description: 'Export Excel, CSV, and PDF reports' },
    ],
  },
  {
    id: 'audit',
    name: 'Audit Logs & Security',
    description: 'Comprehensive system audit trails and action history',
    permissions: [
      { id: 'audit.view', name: 'View Audit Logs', description: 'Inspect system security logs, user actions, and audit trail' },
      { id: 'audit.clear', name: 'Clear Audit Logs', description: 'Permanently delete the entire audit trail. Irreversible; the clear action itself is recorded' },
    ],
  },
  {
    id: 'documents',
    name: 'DMS (Document Management)',
    description: 'Document library, folders, sharing permissions, and version history',
    permissions: [
      { id: 'documents.view', name: 'View Documents', description: 'Browse, search, preview, and download documents shared with you' },
      { id: 'documents.upload', name: 'Upload Documents', description: 'Upload new documents into the library and into folders' },
      { id: 'documents.manage', name: 'Manage Documents', description: 'Edit, replace, move, delete documents and manage folders, sharing, and version history' },
      { id: 'documents.admin', name: 'DMS Administration', description: 'Back up the document store and run DMS maintenance/sync' },
    ],
  },
  {
    id: 'roles',
    name: 'Role & Permission Groups',
    description: 'Custom role groups and the permission catalog',
    permissions: [
      { id: 'roles.manage', name: 'Manage Role & Permission Groups', description: 'Create, edit, delete custom role groups and configure permissions', super_admin_only: true },
    ],
  },
  {
    id: 'settings',
    name: 'Settings & Administration',
    description: 'System configurations, roles, backups, and security',
    permissions: [
      { id: 'settings.view', name: 'View Settings', description: 'View general system settings, statuses, and holidays' },
      { id: 'settings.manage', name: 'Manage System Settings', description: 'Update system configuration, business hours, and backups', super_admin_only: true },
    ],
  },
];

/**
 * Permissions flagged `super_admin_only: true` above. Kept as a separate array
 * because it drives NON_SUPER_PERMISSION_IDS, which filters what a non-super
 * admin is allowed to grant. It must stay in sync with the flags; the
 * permission-catalog test asserts that.
 */
export const SUPER_ADMIN_ONLY_PERMISSIONS = ['settings.manage', 'roles.manage'];

export const ALL_PERMISSION_IDS = PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => p.id));

export const NON_SUPER_PERMISSION_IDS = ALL_PERMISSION_IDS.filter((id) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(id));

/**
 * Hierarchical module filtering:
 * - Super Admin receives all modules and all permissions (including any future ones).
 * - Non-Super users receive ONLY modules and permissions that are explicitly in their assigned scope.
 * - Any permission not granted to the user is completely omitted from the output.
 */
export function getFilteredPermissionModules(userPermissions = [], isSuper = false) {
  if (isSuper) {
    return PERMISSION_MODULES;
  }
  const userPermSet = new Set(Array.isArray(userPermissions) ? userPermissions : []);
  return PERMISSION_MODULES
    .map((m) => ({
      ...m,
      permissions: m.permissions.filter((p) => !p.super_admin_only && userPermSet.has(p.id)),
    }))
    .filter((m) => m.permissions.length > 0);
}

/**
 * Hierarchical permission ID list filtering:
 * - Super Admin receives ALL permission IDs.
 * - Non-Super users receive only the IDs they have been explicitly granted.
 */
export function getFilteredPermissionIds(userPermissions = [], isSuper = false) {
  if (isSuper) {
    return ALL_PERMISSION_IDS;
  }
  const userPermSet = new Set(Array.isArray(userPermissions) ? userPermissions : []);
  return ALL_PERMISSION_IDS.filter((id) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(id) && userPermSet.has(id));
}

export const DEFAULT_ROLE_GROUPS = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Unrestricted master access to all system modules, configuration, role groups, and disaster recovery.',
    color: '#8b5cf6',
    is_system: 1,
    permissions: ALL_PERMISSION_IDS,
  },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Full administrative access to manage tasks, staff, leaves, teams, branches, and view audit reports.',
    color: '#3b82f6',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
      'priority_tasks.view', 'priority_tasks.manage',
      'live_status.view', 'live_status.manage',
      'leaves.view', 'leaves.apply', 'leaves.approve', 'leaves.manage_quotas',
      'users.view', 'users.manage',
      'teams.view', 'teams.manage',
      'departments.view', 'departments.manage',
      'kpi.view', 'kpi.manage',
      'reports.view', 'reports.export',
      'audit.view', 'audit.clear',
      'daily_task.view', 'daily_task.manage',
      // documents.admin is granted here because these routes were previously
      // guarded by requireAdmin, and isAdmin() is true for Admin, Sub-Admin and
      // Super Admin. See the note on sub_admin below.
      'documents.view', 'documents.upload', 'documents.manage', 'documents.admin',
      'settings.view',
    ],
  },
  {
    slug: 'sub_admin',
    name: 'Sub-Admin',
    description: 'Mid-level operational access for team leads and supervisors to manage tasks, approve leaves, and view reports.',
    color: '#06b6d4',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign',
      'priority_tasks.view', 'priority_tasks.manage',
      'live_status.view', 'live_status.manage',
      'leaves.view', 'leaves.apply', 'leaves.approve',
      'users.view',
      'teams.view',
      'departments.view',
      'kpi.view',
      'reports.view', 'reports.export',
      'daily_task.view',
      'documents.view', 'documents.upload', 'documents.manage', 'documents.admin',
    ],
  },
  {
    slug: 'user',
    name: 'User',
    description: 'Standard staff access for everyday work, task execution, time logging, and personal leave applications.',
    color: '#10b981',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'tasks.view', 'tasks.create', 'tasks.edit',
      'priority_tasks.view',
      'live_status.view',
      'leaves.view', 'leaves.apply',
      'daily_task.view',
      'documents.view', 'documents.upload', 'documents.manage',
    ],
  },
  {
    slug: 'it_asst',
    name: 'IT Asst.',
    description: 'View tasks, update task status and comment, view live status, apply for leave, and view own profile and own KPI.',
    color: '#0d9488',
    is_system: 1,
    permissions: [
      // tasks.status without tasks.edit is what restricts this role to
      // status-only updates: every other task write route requires tasks.edit
      // or tasks.assign, both of which are deliberately absent.
      'tasks.view', 'tasks.status',
      'live_status.view',
      // leaves.view is self-scoped (own history and quota balances) and is
      // needed to render the leave application form.
      'leaves.view', 'leaves.apply',
      // Own profile (/auth/me, /users/me/profile) and own KPI (/kpi/me) are
      // auth-only, so they need no permission. kpi.view is intentionally NOT
      // granted because it would expose the whole-staff leaderboard.
      // documents.* is intentionally NOT granted: DMS was previously reachable
      // by anyone holding tasks.view, but the role is specified as "only the
      // functions listed" and DMS is not among them. Grant documents.view
      // here if this role is meant to reach the document library.
    ],
  },
];

/**
 * Permissions that must be ADDED to already-seeded role group rows.
 *
 * The seed loop in db.js only inserts a role group when it is missing, so a
 * permission added to DEFAULT_ROLE_GROUPS after a database was first created
 * would otherwise exist in the catalog while no existing group holds it.
 *
 * This is deliberately an explicit opt-in list rather than derived from
 * DEFAULT_ROLE_GROUPS: deriving it would re-add permissions an admin had
 * deliberately removed from a built-in group through the role manager, on the
 * next restart. Keep it in sync with DEFAULT_ROLE_GROUPS when adding a
 * permission that existing groups are meant to receive. Groups absent from
 * this list are never widened automatically.
 */
export const PERMISSION_GRANTS = {
  // ALL_PERMISSION_IDS rather than a hand-kept list: super_admin resolves to
  // every permission at request time regardless of what is stored here, so a
  // stale stored array is invisible in behaviour but drifts out of step with
  // the catalog and misleads anything that reads the row.
  super_admin: ALL_PERMISSION_IDS,
  // DMS previously had no catalog permissions and was reachable by anyone
  // holding tasks.view, so these reproduce the access these groups already had
  // rather than granting anything new.
  admin: ['audit.clear', 'daily_task.view', 'daily_task.manage',
    'documents.view', 'documents.upload', 'documents.manage', 'documents.admin'],
  // isAdmin() is true for Sub-Admin, so /documents/admin/* was already
  // reachable here through requireAdmin.
  sub_admin: ['daily_task.view',
    'documents.view', 'documents.upload', 'documents.manage', 'documents.admin'],
  user: ['daily_task.view', 'documents.view', 'documents.upload', 'documents.manage'],
  // it_asst is intentionally absent. Its permissions are a fixed minimal set,
  // and listing it here would widen it on every deploy.
};
