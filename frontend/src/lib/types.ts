export type Role = 'super_admin' | 'admin' | 'sub_admin' | 'user';
export type LiveStatusType = 'active' | 'away' | 'inactive';

export interface PermissionItem {
  id: string;
  name: string;
  description: string;
  level?: 'view' | 'edit' | 'manage' | 'admin';
  super_admin_only?: boolean;
}

export interface PermissionModule {
  id: string;
  name: string;
  description: string;
  icon?: string;
  permissions: PermissionItem[];
}

export interface RoleGroup {
  id: number;
  slug: string;
  name: string;
  description: string;
  color: string;
  is_system: boolean;
  is_default?: boolean;
  permissions: string[];
  user_count?: number;
  total_user_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  role_group_id?: number;
  role_group_name?: string;
  role_group_slug?: string;
  role_group_color?: string;
  role_group_permissions?: string[];
  permissions?: string[];
  title?: string;
  phone?: string;
  avatar?: string;
  employee_id?: string;
  live_status?: LiveStatusType;
  last_active_at?: string | null;
  status_message?: string;
  status_updated_at?: string | null;
   weekend_days?: number[];
   duty_time?: string;
   team_id?: number | null;
  department_id?: number | null;
  team_name?: string;
  is_daily_task_member?: boolean;
  department_name?: string;
  department_hotline?: string;
  department_ext?: string;
  department_manager_name?: string;
  department_manager_ext?: string;
  is_active?: boolean;
  last_login?: string;
  created_at?: string;
  initials?: string;
  open_tasks?: number;
  completed_tasks?: number;
  tasks_created?: number;
  /**
   * Present only when the list was requested with assignable=1. False means the
   * user is on approved leave or on their weekend and must not be assigned.
   */
  availability?: { available: boolean; reason?: string; status?: 'leave' | 'weekend' | null };
}

export interface LiveStatusSummary {
  total: number;
  active: number;
  away: number;
  inactive: number;
}

export interface LiveStatusUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  title?: string;
  avatar?: string;
  initials?: string;
  employee_id: string;
  department_id?: number | null;
  department_name: string;
  department_hotline?: string;
  department_ext?: string;
  team_id?: number | null;
  team_name?: string;
  weekend_days?: number[];
  duty_time?: string;
  is_daily_task_member?: boolean;
  live_status: LiveStatusType;
  last_active_at?: string | null;
  last_login?: string | null;
  status_message?: string;
  status_updated_at?: string | null;
  is_active?: boolean;
}

export interface Team {
  id: number;
  name: string;
  description?: string;
  lead_id?: number | null;
  lead_name?: string;
  member_count?: number;
  task_count?: number;
  done_count?: number;
}

export interface Department {
  id: number;
  name: string;
  description?: string;
  head_id?: number | null;
  head_name?: string;
  hotline?: string;
  ext?: string;
  hotline_ext?: string;
  manager_name?: string;
  manager_ext?: string;
  member_count?: number;
  task_count?: number;
  done_count?: number;
}

export interface Assignee {
  id: number;
  task_id: number;
  user_id: number;
  progress: number;
  status: string;
  assigned_at: string;
  completed_at?: string | null;
  user_name: string;
  avatar?: string;
  team_id?: number | null;
}

export interface StatusMeta { id: string; name: string; color: string; icon?: string; }
export interface PriorityMeta { id: string; name: string; color: string; weight: number; }
export interface DifficultyMeta { id: string; name: string; points: number; enabled?: boolean; }

export interface PriorityTaskRemark {
  id: number;
  priority_task_id: number;
  user_id?: number | null;
  user_name: string;
  user_avatar?: string;
  user_role?: string;
  remark: string;
  created_at: string;
}

export interface PriorityTask {
  id: number;
  task_code?: string;
  work_title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee_name?: string;
  assignee_user_id?: number | null;
  assignee_user_name?: string;
  assignee_user_email?: string;
  assignee_user_avatar?: string;
  assignee_user_title?: string;
  assignee_user_role?: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
  due_date?: string | null;
  remarks?: string;
  remarks_list?: PriorityTaskRemark[];
  transferred_to_task_id?: number | null;
  transferred_at?: string | null;
  created_by?: number | null;
  creator_name?: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  task_code?: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  difficulty: string;
  task_type: string;
  flags: string[];
  tags: string[];
  budget?: number;
  estimated_hours?: number;
  due_date?: string | null;
  start_date?: string | null;
  created_by: number;
  reviewer_id?: number | null;
  team_id?: number | null;
  department_id?: number | null;
  parent_task_id?: number | null;
  progress: number;
  approval_status: string;
  is_blocked: boolean;
  is_recurring: boolean;
  recurring_rule?: string;
  archived: boolean;
  is_self_task?: number | boolean;
  daily_task_key?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  completed_by?: number | null;
  completed_by_name?: string;
  completed_by_avatar?: string;
  created_by_name?: string;
  reviewer_name?: string;
  team_name?: string;
  department_name?: string;
  assigned_names?: string;
  assignees?: Assignee[];
  /** 1 when the signed-in user is @mentioned in a comment on this task. */
  mentioned_me?: number;
  comments_count?: number;
  attachments_count?: number;
  checklist?: { total: number; done: number };
  status_meta?: StatusMeta;
  priority_meta?: PriorityMeta;
  difficulty_meta?: DifficultyMeta;
}

export interface Comment {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  mentions: number[];
  created_at: string;
  user_name?: string;
  avatar?: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  link?: string;
  read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_name?: string;
  action: string;
  entity_type: string;
  entity_id?: number;
  details: string;
  ip?: string;
  created_at: string;
}

export interface KpiEntry {
  userId: number;
  name: string;
  role: string;
  avatar?: string;
  team_name?: string;
  department_name?: string;
  completed: number;
  selfCompleted: number;
  totalAssigned: number;
  totalDone: number;
  completionRate: number;
  /** How many of the paid tasks were shared, so the points are a split share. */
  splitTasks: number;
  onTime: number;
  late: number;
  overdueCount: number;
  avgCompletionHours: number;
  points: number;
  bonus: number;
  penalty: number;
  productivity: number;
  rating: number;
  score: number;
  creatorPoints?: number;
  assigneePoints?: number;
  selfTaskPoints?: number;
}

export interface KpiConfigRule {
  id: number;
  rule_key: string;
  rule_name: string;
  rule_category: string;
  points: number;
  enabled: number;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface KpiTransaction {
  id: number;
  user_id: number;
  task_id: number | null;
  rule_key: string;
  rule_name: string;
  points: number;
  config_value: number;
  config_enabled: number;
  reason: string;
  created_at: string;
  created_by: number | null;
  user_name?: string;
  user_email?: string;
  task_title?: string;
  task_code?: string;
  created_by_name?: string;
}

export interface KpiTransactionSummary {
  rule_key: string;
  rule_name: string;
  total_points: number;
  count: number;
}

export interface ProjectMember {
  id: number;
  user_id: number;
  name: string;
  email: string;
  user_role: string;
  avatar?: string;
  live_status?: string;
  role_group_color?: string;
  role: 'lead' | 'member' | 'viewer';
  joined_at: string;
}

export interface ProjectTaskSummary {
  id: number;
  title: string;
  status: string;
  priority: string;
  due_date?: string | null;
  start_date?: string | null;
  progress: number;
  completed_at?: string | null;
  updated_at: string;
  assignees: { id: number; name: string; avatar?: string }[];
}

export interface Project {
  id: number;
  name: string;
  description?: string;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  start_date?: string | null;
  deadline?: string | null;
  budget: number;
  spent: number;
  progress: number;
  color: string;
  created_by: number;
  archived: number;
  created_at: string;
  updated_at: string;
  member_count?: number;
  task_count?: number;
  done_count?: number;
  wip_count?: number;
  todo_count?: number;
  cancelled_count?: number;
  creator?: { id: number; name: string; avatar?: string; role: string } | null;
  is_member?: boolean;
}

export interface ProjectDetail extends Project {
  can_manage: boolean;
  members: ProjectMember[];
  tasks: ProjectTaskSummary[];
}

export interface Settings {
  taskStatuses: StatusMeta[];
  priorities: PriorityMeta[];
  difficulties: DifficultyMeta[];
  kpiConfig: KpiConfigRule[];
  workingDays: number[];
  businessHours: { start: string; end: string };
  notificationRules: Record<string, boolean | number>;
  security: { twoFactorEnabled: boolean; sessionTimeoutMinutes: number };
  dashboard: Record<string, unknown>;
}

export interface TaskHistory {
  id: number;
  task_id: number;
  user_id?: number;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  created_at: string;
  user_name?: string;
}

export interface ChecklistItem {
  id: number;
  task_id: number;
  title: string;
  done: number;
  created_by?: number;
  created_at: string;
}

export interface Attachment {
  id: number;
  task_id: number;
  user_id: number;
  filename: string;
  stored_name: string;
  size: number;
  mime?: string;
  uploaded_at: string;
}

export interface Approval {
  id: number;
  task_id: number;
  requester_id: number;
  approver_id?: number;
  status: string;
  comment?: string;
  created_at: string;
  updated_at?: string;
  requester_name?: string;
  approver_name?: string;
}

export interface TimeEntry {
  id: number;
  task_id: number;
  user_id: number;
  hours: number;
  note?: string;
  date: string;
  created_at: string;
  user_name?: string;
}

export interface TaskDetail extends Task {
  comments: Comment[];
  checklist_items: ChecklistItem[];
  attachments: Attachment[];
  history: TaskHistory[];
  dependencies: { depends_on: number; title: string; status: string }[];
  dependents: { task_id: number; title: string }[];
  approvals: Approval[];
  time_entries: TimeEntry[];
}

export interface DashboardData {
  summary: {
    total: number; open: number; done: number; cancelled: number; overdue: number;
    pending: number; inProgress: number; inReview: number; dueToday: number; dueWeek: number;
    blocked: number; critical: number; doneToday: number; activeUsers: number;
    completionRate: number; avgCompletionHours: number;
    budgetUtil: { budget: number; hours: number };
  };
  daily: { day: string; date: string; added: number; done: number }[];
  monthly: { day: string; date: string; added: number; done: number }[];
  completionTrend: { day: string; date: string; completed: number }[];
  overdueTrend: { day: string; date: string; overdue: number }[];
  teamPerf: { id: number; name: string; total: number; done: number }[];
  deptPerf: { id: number; name: string; total: number; done: number }[];
  userPerf: { id: number; name: string; avatar?: string; assigned: number; done: number }[];
  statusDist: { status: string; name: string; color: string; count: number }[];
  prioDist: { priority: string; name: string; color: string; count: number }[];
  recentTasks: Task[];
  activities: { id: number; action: string; field: string; old_value: string; new_value: string; user_name?: string; created_at: string }[];
  notifications: Notification[];
  kpi: KpiEntry[];
  calendar: { id: number; title: string; due_date: string; status: string; priority: string }[];
}

export type LeaveType = 'EL' | 'CL' | 'SL';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type DurationType = 'full_day' | 'half_day_morning' | 'half_day_afternoon';

export interface LeaveBalanceCategory {
  quota: number;
  approved: number;
  pending: number;
  balance: number;
  label: string;
  note?: string;
}

export interface LeaveBalance {
  year: number;
  quotas: {
    el_quota: number;
    cl_quota: number;
    sl_quota: number;
    annual_quota: number;
  };
  el: LeaveBalanceCategory;
  cl: LeaveBalanceCategory;
  annual: LeaveBalanceCategory;
  sl: LeaveBalanceCategory;
}

export interface LeaveApplication {
  id: number;
  user_id: number;
  applicant_name?: string;
  applicant_email?: string;
  applicant_avatar?: string;
  applicant_title?: string;
  applicant_role?: string;
  applicant_weekend_days?: number[];
  team_name?: string;
  department_name?: string;
  leave_type: LeaveType;
  duration_type: DurationType;
  start_date: string;
  end_date: string;
  days_count: number;
  year: number;
  reason: string;
  reliever_user_id?: number | null;
  reliever_name?: string;
  reliever_email?: string;
  emergency_contact?: string;
  attachment_url?: string;
  status: LeaveStatus;
  admin_remarks?: string;
  approved_by?: number | null;
  approver_name?: string;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExcludedDateInfo {
  date: string;
  type: 'weekend' | 'holiday';
  dayOfWeek?: number;
  dayName: string;
  label: string;
}

export interface LeaveCalculationResult {
  daysCount: number;
  totalCalendarDays: number;
  workingDays: number;
  weekendDaysCount: number;
  holidayDaysCount: number;
  excludedDates: ExcludedDateInfo[];
  weekendDays: number[];
  weekend_names?: string[];
}

export interface LeaveSummaryResponse {
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    avatar?: string;
    title?: string;
  };
  year: number;
  balance: LeaveBalance;
  counts: {
    userPending: number;
    userApproved: number;
    adminPending: number;
  };
  monthlyUsage: {
    month: string;
    leave_type: LeaveType;
    total_days: number;
  }[];
}

export interface EmployeeLeaveLedger {
  user: User;
  balance: LeaveBalance;
}

export interface ChatAttachment {
  id: number;
  message_id: number;
  filename: string;
  stored_name: string;
  size: number;
  mime?: string;
  uploaded_at: string;
}

export interface ChatMessage {
  id: number;
  task_id: number | null;
  sender_id: number;
  recipient_id?: number | null;
  conversation_id?: string;
  content: string;
  mentions?: number[] | string;
  created_at: string;
  updated_at: string;
  sender_name: string;
  sender_role: string;
  sender_avatar?: string;
  sender_email?: string;
  sender_color?: string;
  recipient_name?: string;
  recipient_email?: string;
  task_title?: string;
  group_id?: number | null;
  group_name?: string;
  attachments?: ChatAttachment[];
}

export interface ChatUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  live_status?: string;
  role_group_color?: string;
  /**
   * Absent on endpoints that do not check availability (e.g. conversation
   * lists). Present wherever a user can be picked for a mention or assignment.
   */
  availability?: { available: boolean; reason?: string; status?: 'leave' | 'weekend' | null };
}

export interface ChatGroupMember {
  id: number;
  user_id: number;
  name: string;
  email: string;
  user_role: string;
  avatar?: string;
  live_status?: string;
  role_group_color?: string;
  availability?: { available: boolean; reason?: string; status?: 'leave' | 'weekend' | null };
  role: 'admin' | 'member';
  joined_at: string;
}

export interface ChatGroup {
  id: number;
  name: string;
  description?: string;
  created_by: number;
  member_count?: number;
  message_count?: number;
  member_role?: 'admin' | 'member';
  created_at: string;
  updated_at?: string;
}

export interface ChatGroupConversation {
  group: ChatGroup;
  conversation_id: string;
  last_message: { id: number; content: string; sender_id: number; created_at: string } | null;
  unread_count: number;
  type: 'group';
}

export interface ChatConversation {
  other_user: ChatUser;
  conversation_id: string;
  last_message: { id: number; content: string; sender_id: number; created_at: string } | null;
  unread_count: number;
  type: 'direct';
}

export interface ChatStats {
  total: number;
  today: number;
  last7Days: number;
  last30Days: number;
  direct?: number;
  group?: number;
  topSenders: { id: number; name: string; role: string; message_count: number }[];
}

export interface DocumentMeta {
  id: number;
  filename: string;
  stored_name: string;
  original_name: string;
  file_type: string;
  mime?: string;
  size: number;
  file_path: string;
  uploaded_by: number;
  upload_date: string;
  last_updated: string;
  project_id?: number | null;
  department_id?: number | null;
  team_id?: number | null;
  tags: string[];
  description: string;
  vendor_name?: string;
  version: string;
  access_permission: 'private' | 'public' | 'authenticated' | 'team' | 'department';
  is_active: number;
  view_count: number;
  download_count: number;
  uploader?: { id: number; name: string; avatar?: string };
  project_name?: string | null;
  department_name?: string | null;
  team_name?: string | null;
  folder?: { id: number; name: string; parent_id: number | null; path: string } | null;
  folder_id?: number | null;
}

export interface DocumentPermission {
  id: number;
  document_id: number;
  user_id?: number | null;
  team_id?: number | null;
  department_id?: number | null;
  permission: string;
  granted_by?: number | null;
  granted_at: string;
  user_name?: string | null;
  team_name?: string | null;
  department_name?: string | null;
}

export interface DocumentHistoryEntry {
  id: number;
  document_id: number;
  user_id?: number | null;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  ip: string;
  created_at: string;
  user_name?: string | null;
}

