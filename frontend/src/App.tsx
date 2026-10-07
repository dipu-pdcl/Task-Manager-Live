import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TaskDetail from './pages/TaskDetail';
import Profile from './pages/Profile';
import { Skeleton } from './components/ui';

const Tasks = lazy(() => import('./pages/Tasks'));
const PriorityTasks = lazy(() => import('./pages/PriorityTasks'));
const LiveStatus = lazy(() => import('./pages/LiveStatus'));
const Leaves = lazy(() => import('./pages/Leaves'));
const Users = lazy(() => import('./pages/Users'));
const Teams = lazy(() => import('./pages/Teams'));
const Departments = lazy(() => import('./pages/Departments'));
const Kpi = lazy(() => import('./pages/Kpi'));
const Reports = lazy(() => import('./pages/Reports'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const DailyTask = lazy(() => import('./pages/DailyTask'));
const Chat = lazy(() => import('./pages/Chat'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Documents = lazy(() => import('./pages/Documents'));

function PageSuspense() {
  return (
    <div className="h-full flex items-center justify-center">
      <Skeleton className="w-24 h-24" />
    </div>
  );
}

function Protected({
  children,
  permission,
  permissions,
  adminOnly,
}: {
  children: React.ReactNode;
  permission?: string;
  permissions?: string[];
  adminOnly?: boolean;
}) {
  const { user, loading, isAdmin, hasPermission } = useAuth();
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin w-8 h-8 rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/dashboard" replace />;
  if (permissions && !permissions.some((p) => hasPermission(p))) return <Navigate to="/dashboard" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tasks" element={<Protected permissions={['tasks.view', 'tasks.create', 'tasks.edit']}><Suspense fallback={<PageSuspense />}><Tasks /></Suspense></Protected>} />
        <Route path="/tasks/new" element={<Protected permissions={['tasks.create']}><Suspense fallback={<PageSuspense />}><Tasks /></Suspense></Protected>} />
        <Route path="/tasks/:id" element={<Protected permissions={['tasks.view', 'tasks.edit']}><TaskDetail /></Protected>} />
        <Route path="/priority-tasks" element={<Protected permissions={['priority_tasks.view', 'priority_tasks.manage']}><Suspense fallback={<PageSuspense />}><PriorityTasks /></Suspense></Protected>} />
        <Route path="/live-status" element={<Protected permissions={['live_status.view', 'live_status.manage']}><Suspense fallback={<PageSuspense />}><LiveStatus /></Suspense></Protected>} />
        <Route path="/leaves" element={<Protected permissions={['leaves.view', 'leaves.apply', 'leaves.approve', 'leaves.manage_quotas']}><Suspense fallback={<PageSuspense />}><Leaves /></Suspense></Protected>} />
        <Route path="/users" element={<Protected permissions={['users.view', 'users.manage']}><Suspense fallback={<PageSuspense />}><Users /></Suspense></Protected>} />
        <Route path="/teams" element={<Protected permissions={['teams.view', 'teams.manage']}><Suspense fallback={<PageSuspense />}><Teams /></Suspense></Protected>} />
        <Route path="/departments" element={<Protected permissions={['departments.view', 'departments.manage']}><Suspense fallback={<PageSuspense />}><Departments /></Suspense></Protected>} />
        <Route path="/kpi" element={<Protected permissions={['kpi.view', 'kpi.manage']}><Suspense fallback={<PageSuspense />}><Kpi /></Suspense></Protected>} />
        <Route path="/reports" element={<Protected permissions={['reports.view', 'reports.export']}><Suspense fallback={<PageSuspense />}><Reports /></Suspense></Protected>} />
        <Route path="/audit" element={<Protected permission="audit.view"><Suspense fallback={<PageSuspense />}><Audit /></Suspense></Protected>} />
        <Route path="/daily-task" element={<Protected permissions={['daily_task.view', 'daily_task.manage']}><Suspense fallback={<PageSuspense />}><DailyTask /></Suspense></Protected>} />
        <Route path="/settings" element={<Protected permissions={['settings.view', 'settings.manage', 'roles.manage']}><Suspense fallback={<PageSuspense />}><SettingsPage /></Suspense></Protected>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/chat" element={<Suspense fallback={<PageSuspense />}><Chat /></Suspense>} />
        <Route path="/projects" element={<Protected permissions={['tasks.view', 'tasks.create', 'tasks.edit']}><Suspense fallback={<PageSuspense />}><Projects /></Suspense></Protected>} />
        <Route path="/projects/:id" element={<Protected permissions={['tasks.view', 'tasks.create', 'tasks.edit']}><Suspense fallback={<PageSuspense />}><ProjectDetail /></Suspense></Protected>} />
        <Route path="/documents" element={<Protected permissions={['documents.view', 'documents.upload', 'documents.manage', 'documents.admin']}><Suspense fallback={<PageSuspense />}><Documents /></Suspense></Protected>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
