import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, Users, Building2, UserCog, Award, BarChart3,
  ScrollText, Settings as SettingsIcon, LogOut, Bell, Search, Sun, Moon,
  Menu, X, ChevronRight, UserCircle, CalendarDays, ShieldCheck, Flame,
  MessageSquare, MessageCircle, Clock, Cpu, ShieldAlert, Info, ArrowUpRight, CheckCheck,
  Radio, Trophy, FolderKanban, ChevronDown, FileText, CalendarCheck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { api } from '../lib/api';
import { playNotificationSound } from '../lib/notificationSound';
import type { Notification, LiveStatusType } from '../lib/types';
import { timeAgo, cx, statusById } from '../lib/utils';
import { useSettings } from '../lib/settings';
import { trackNavigation } from '../lib/activityTracker';
import { Avatar, Badge } from './ui';
import { LiveStatusDot, LiveStatusBadge } from './LiveStatusIndicator';

const roleLabel: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  user: 'User',
};

const NOTIF_TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string; label: string }> = {
  task: {
    icon: ListTodo,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10 dark:bg-blue-500/20',
    border: 'border-blue-500/30',
    label: 'Task',
  },
  comment: {
    icon: MessageSquare,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10 dark:bg-amber-500/20',
    border: 'border-amber-500/30',
    label: 'Comment',
  },
  approval: {
    icon: ShieldCheck,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    border: 'border-emerald-500/30',
    label: 'Approval',
  },
  deadline: {
    icon: Clock,
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/10 dark:bg-rose-500/20',
    border: 'border-rose-500/30',
    label: 'Deadline',
  },
  system: {
    icon: Cpu,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-500/10 dark:bg-purple-500/20',
    border: 'border-purple-500/30',
    label: 'System',
  },
  security: {
    icon: ShieldAlert,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10 dark:bg-red-500/20',
    border: 'border-red-500/30',
    label: 'Security',
  },
  priority_task: {
    icon: Flame,
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500/10 dark:bg-orange-500/20',
    border: 'border-orange-500/30',
    label: 'Priority',
  },
  info: {
    icon: Info,
    color: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/10 dark:bg-sky-500/20',
    border: 'border-sky-500/30',
    label: 'Info',
  },
};

export function Layout() {
  const { user, isAdmin, hasPermission, logout, setUser } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifs = () => {
    api.get<Notification[]>('/notifications').then((d) => {
      setNotifs(d);
      setUnread(d.filter((n) => !n.read).length);
    }).catch(() => {});
  };

  const loadChatUnread = () => {
    api.get<{ total: number }>('/chat/unread').then((d) => {
      setChatUnread(d.total || 0);
    }).catch(() => {});
  };

  // Real-time Push via SSE + Click outside handler
  useEffect(() => {
    loadNotifs();
    loadChatUnread();

    let es: EventSource | null = null;

    if (user) {
      try {
        es = new EventSource(`/api/notifications/stream`);

        es.addEventListener('notification', (e) => {
          try {
            const newNotif: Notification = JSON.parse(e.data);
            setNotifs((prev) => {
              if (prev.some((item) => item.id === newNotif.id)) return prev;
              return [newNotif, ...prev];
            });
            setUnread((prev) => prev + 1);
            playNotificationSound(newNotif.type as any);
          } catch {}
        });

        es.addEventListener('unread-count', (e) => {
          try {
            const { count } = JSON.parse(e.data);
            setUnread(Number(count) || 0);
          } catch {}
        });

        es.addEventListener('read-status', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.all) {
              setNotifs((prev) => prev.map((item) => ({ ...item, read: true })));
              setUnread(0);
            } else if (data.id) {
              setNotifs((prev) => prev.map((item) => item.id === data.id ? { ...item, read: true } : item));
            }
          } catch {}
        });

        es.addEventListener('chat', (e) => {
          try {
            const data = JSON.parse(e.data);
            loadChatUnread();
            window.dispatchEvent(new CustomEvent('chat:new-message', { detail: data }));
          } catch {
            loadChatUnread();
            window.dispatchEvent(new CustomEvent('chat:new-message'));
          }
        });

        es.addEventListener('live-status', (e) => {
          try {
            const data = JSON.parse(e.data);
            setUser((prev) => prev ? { ...prev, live_status: data.live_status, last_active_at: data.last_active_at ?? prev.last_active_at } : prev);
          } catch {}
        });
      } catch {}
    }

    // Periodic backup poll every 60s
    const iv = setInterval(() => {
      loadNotifs();
      loadChatUnread();
    }, 60000);

    return () => {
      clearInterval(iv);
      if (es) {
        es.close();
      }
    };
  }, [user?.id]);

  // Listen for chat unread count changes (when user reads messages in chat page)
  useEffect(() => {
    const handler = () => loadChatUnread();
    window.addEventListener('chat:unread-changed', handler);
    return () => window.removeEventListener('chat:unread-changed', handler);
  }, []);

  // Track navigation as activity for Live Status
  const location = useLocation();
  useEffect(() => {
    if (user) {
      trackNavigation(location.pathname, location.pathname);
    }
  }, [location.pathname, user?.id]);

  // Click outside to close notification dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [notifOpen]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return;
    navigate(`/tasks?search=${encodeURIComponent(search.trim())}`);
    setSearch('');
  };

  const markAll = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await api.put('/notifications/read-all');
    } catch {}
    loadNotifs();
  };

  const markOne = async (n: Notification) => {
    // 1. Optimistically mark as read
    setNotifs((prev) =>
      prev.map((item) => (item.id === n.id ? { ...item, read: true } : item))
    );
    if (!n.read) {
      setUnread((prev) => Math.max(0, prev - 1));
      try {
        await api.put(`/notifications/${n.id}/read`);
      } catch {}
    }

    // 2. Auto-close dropdown after viewing
    setNotifOpen(false);

    // 3. Navigate if link is present; if no link, just stay on page
    if (n.link && typeof n.link === 'string' && n.link.trim()) {
      navigate(n.link.trim());
    }
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/tasks']));

  const toggleExpanded = (to: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      return next;
    });
  };

  const navGroups = useMemo(() => {
    const main = [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: true },
      { 
        to: '/tasks', 
        label: 'Tasks', 
        icon: ListTodo, 
        visible: hasPermission(['tasks.view', 'tasks.create', 'tasks.edit']),
        children: [
          { to: '/priority-tasks', label: 'Priority Tasks', icon: Flame, visible: hasPermission(['priority_tasks.view', 'priority_tasks.manage']) }
        ]
      },
      // Daily Tasks are their own module and are not listed under Tasks.
      { to: '/daily-task', label: 'My Daily Task', icon: CalendarCheck, visible: hasPermission(['daily_task.view', 'daily_task.manage']) },
      { to: '/projects', label: 'Projects', icon: FolderKanban, visible: hasPermission(['tasks.view', 'tasks.create', 'tasks.edit']) },
        { to: '/documents', label: 'DMS', icon: FileText, visible: hasPermission(['documents.view', 'documents.upload', 'documents.manage', 'documents.admin']) },
      { to: '/live-status', label: 'Live Status', icon: Radio, visible: hasPermission(['live_status.view', 'live_status.manage']) },
      { to: '/leaves', label: 'Leave Management', icon: CalendarDays, visible: hasPermission(['leaves.view', 'leaves.apply', 'leaves.approve', 'leaves.manage_quotas']) },
    ].filter((i) => i.visible);

    const admin = [
      { to: '/users', label: 'Users', icon: UserCog, visible: hasPermission(['users.view', 'users.manage']) },
      { to: '/teams', label: 'Teams', icon: Users, visible: hasPermission(['teams.view', 'teams.manage']) },
      { to: '/departments', label: 'Branches', icon: Building2, visible: hasPermission(['departments.view', 'departments.manage']) },
      { to: '/reports', label: 'Reports', icon: BarChart3, visible: hasPermission(['reports.view', 'reports.export']) },
      { to: '/kpi', label: 'KPI Dashboard', icon: Trophy, visible: hasPermission(['kpi.view', 'kpi.manage']) },
      { to: '/audit', label: 'Audit Logs', icon: ScrollText, visible: hasPermission('audit.view') },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, visible: hasPermission(['settings.view', 'settings.manage', 'roles.manage']) },
    ].filter((i) => i.visible);

    const groups: { title?: string; items: any[] }[] = [];
    if (main.length > 0) groups.push({ items: main });
    if (admin.length > 0) groups.push({ title: 'Administration', items: admin });
    groups.push({ title: 'Account', items: [{ to: '/profile', label: 'Profile', icon: UserCircle }] });
    return groups;
  }, [hasPermission]);

  const currentLiveStatus = (user?.live_status as LiveStatusType) || 'active';

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center text-white shadow-lg">
          <ListTodo size={20} />
        </div>
        <div>
          <div className="font-bold text-lg leading-none gradient-text">PDCL ICT</div>
          <div className="text-[10px] text-ink3 mt-0.5">Enterprise Task Manager</div>
        </div>
      </div>
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto pb-4">
        {navGroups.map((g, gi) => (
          <div key={gi} className="mb-3">
            {g.title && <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink3">{g.title}</div>}
            {g.items.map((item) => {
              const hasChildren = item.children && item.children.length > 0;
              const isExpanded = expanded.has(item.to);
              return (
                <div key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/dashboard'}
                    onClick={() => {
                      if (hasChildren) toggleExpanded(item.to);
                      setMobileOpen(false);
                    }}
                    className={({ isActive }) => cx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                      isActive
                        ? 'bg-gradient-to-r from-brand/20 to-brand2/10 text-brand shadow-inner border border-brand/20'
                        : 'text-ink2 hover:bg-card2 hover:text-ink',
                    )}
                  >
                    <item.icon size={17} />
                    <span className="flex-1">{item.label}</span>
                    {item.to === '/live-status' && (
                      <LiveStatusDot status={currentLiveStatus} size="xs" pulse={currentLiveStatus === 'active'} />
                    )}
                    {item.to === '/tasks' && <span className="text-[10px] text-ink3">⌘K</span>}
                    {hasChildren ? (
                      <ChevronRight size={13} className={`opacity-40 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                    ) : (
                      <ChevronRight size={13} className="opacity-40" />
                    )}
                  </NavLink>
                  {hasChildren && isExpanded && (
                    <div className="ml-4 mt-1 space-y-0.5 border-l border-line pl-3">
                      {item.children.filter((child: any) => child.visible).map((child: any) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          onClick={() => setMobileOpen(false)}
                          className={({ isActive }) => cx(
                            'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                            isActive
                              ? 'bg-gradient-to-r from-brand/20 to-brand2/10 text-brand shadow-inner border border-brand/20'
                              : 'text-ink2 hover:bg-card2 hover:text-ink',
                          )}
                        >
                          <child.icon size={17} />
                          <span className="flex-1">{child.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="p-3 border-t border-line">
        <div className="card p-2.5 flex items-center gap-2.5" style={{ background: 'rgb(var(--card-2))' }}>
          <div className="relative shrink-0 cursor-pointer" onClick={() => navigate('/live-status')} title="Click to manage Live Status">
            <Avatar name={user?.name} src={user?.avatar} size={36} />
            <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-card ring-1 ring-card">
              <LiveStatusDot status={currentLiveStatus} size="xs" pulse={true} />
            </span>
          </div>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate('/profile')}>
            <div className="text-sm font-semibold truncate text-ink">{user?.name}</div>
            <div className="text-[11px] text-ink3 truncate leading-tight mt-0.5 flex items-center gap-1">
              <span className="font-medium truncate" style={{ color: user?.role_group_color || undefined }}>
                {user?.role_group_name || roleLabel[user?.role || 'user']}
              </span>
              <span>•</span>
              <span className="font-mono text-ink2">{user?.employee_id || `EMP${String(user?.id || 0).padStart(3, '0')}`}</span>
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }} className="p-1.5 rounded-lg hover:bg-bad/10 text-ink2 hover:text-bad shrink-0 transition-colors" title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex overflow-hidden">
      <aside className="hidden lg:flex w-64 shrink-0 h-full border-r border-line glass">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-[min(18rem,85vw)] glass anim-slide" style={{ background: 'rgb(var(--bg))' }}>
            <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-3 p-1.5 rounded-lg text-ink2 hover:bg-card2"><X size={18} /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header className="glass sticky top-0 z-40 border-b border-line px-3 sm:px-4 md:px-6 h-16 flex items-center gap-2 sm:gap-3">
          <button className="lg:hidden p-2 rounded-lg hover:bg-card2 text-ink2 shrink-0" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>

          {/* min-w-0 lets the field shrink instead of forcing the icon buttons
              off the edge of a narrow screen. */}
          <form onSubmit={onSearch} className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Task ID, #number, title..."
              className="input !pl-9 !py-2 rounded-full"
            />
          </form>

          <div className="hidden sm:block flex-1" />

          <div className="relative shrink-0">
            <button
              onClick={() => navigate('/chat')}
              className="relative p-2 rounded-lg hover:bg-card2 text-ink2 transition-colors"
              title="Team Chat"
            >
              <MessageSquare size={19} />
              {chatUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </button>
          </div>

          <div className="relative shrink-0" ref={notifRef}>
            <button
              onClick={() => setNotifOpen((o) => !o)}
              className="relative p-2 rounded-lg hover:bg-card2 text-ink2 transition-colors"
              title="Notifications"
            >
              <Bell size={19} />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="card anim-pop absolute right-0 mt-2 w-96 max-w-[90vw] z-50 overflow-hidden shadow-2xl border border-line" style={{ background: 'rgb(var(--card))' }}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-card2/50">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    <Bell size={15} className="text-brand" />
                    <span>Notifications</span>
                    {unread > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand font-bold">
                        {unread} new
                      </span>
                    )}
                  </div>
                  {unread > 0 && (
                    <button
                      onClick={markAll}
                      className="text-xs text-brand font-medium hover:underline flex items-center gap-1"
                    >
                      <CheckCheck size={13} />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>
                <div className="max-h-[380px] overflow-y-auto divide-y divide-line">
                  {notifs.length === 0 ? (
                    <div className="p-8 text-center text-sm text-ink3">
                      <Bell size={24} className="mx-auto mb-2 opacity-30" />
                      No notifications yet
                    </div>
                  ) : (
                    notifs.map((n) => {
                      const typeCfg = NOTIF_TYPE_CONFIG[n.type] || NOTIF_TYPE_CONFIG.info;
                      const Icon = typeCfg.icon;
                      const hasLink = Boolean(n.link && String(n.link).trim());

                      return (
                        <button
                          key={n.id}
                          onClick={() => markOne(n)}
                          className={cx(
                            'w-full text-left px-4 py-3 hover:bg-card2 transition-colors flex items-start gap-3 group relative',
                            !n.read && 'bg-brand/5 dark:bg-brand/10'
                          )}
                        >
                          {/* Type Icon Badge */}
                          <div
                            className={cx(
                              'w-8 h-8 rounded-xl shrink-0 flex items-center justify-center border mt-0.5',
                              typeCfg.bg,
                              typeCfg.border,
                              typeCfg.color
                            )}
                          >
                            <Icon size={16} />
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className={cx('text-xs font-semibold truncate', !n.read ? 'text-ink' : 'text-ink2')}>
                                {n.title}
                              </span>
                              {hasLink && (
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-brand shrink-0">
                                  <ArrowUpRight size={13} />
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-ink3 line-clamp-2 leading-relaxed">
                              {n.message}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-ink3">
                                {timeAgo(n.created_at)}
                              </span>
                              {hasLink && (
                                <span className="text-[10px] font-medium text-brand hover:underline">
                                  View details →
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Read status dot */}
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full bg-brand shrink-0 mt-2" title="Unread" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={toggle} className="p-2 rounded-lg hover:bg-card2 text-ink2 transition-colors" title="Toggle theme">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="relative">
            <button
              onClick={() => navigate('/live-status')}
              className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-card2 border border-transparent hover:border-line transition-all"
              title={`Status: ${currentLiveStatus.toUpperCase()} (Click to toggle)`}
            >
              <div className="relative shrink-0">
                <Avatar name={user?.name} src={user?.avatar} size={34} />
                <span className="absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-card ring-1 ring-card">
                  <LiveStatusDot status={currentLiveStatus} size="xs" pulse={true} />
                </span>
              </div>
              <div className="hidden md:flex flex-col text-left justify-center">
                <span className="text-xs font-bold text-ink leading-tight truncate max-w-[130px]">
                  {user?.name}
                </span>
                <span className="text-[10px] text-ink3 font-mono leading-tight mt-0.5">
                  {user?.employee_id || `EMP${String(user?.id || 0).padStart(3, '0')}`}
                </span>
              </div>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
