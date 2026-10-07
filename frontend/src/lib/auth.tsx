import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { api } from './api';
import type { User, LiveStatusType } from './types';
import { createActivityTracker, getActivityTracker, trackImmediateActivity } from './activityTracker';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isSuper: boolean;
  hasPermission: (permission: string | string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  canAll: (...permissions: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateLiveStatus: (status: LiveStatusType, message?: string) => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>('/auth/me');
      setUserState(data.user);
    } catch {
      setUserState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const onLogout = () => setUserState(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [refreshUser]);

  // Centralized Activity Tracker for Live Status
  const trackerRef = useRef<ReturnType<typeof createActivityTracker> | null>(null);

  useEffect(() => {
    if (!user) {
      if (trackerRef.current) {
        trackerRef.current.stopTracking();
        trackerRef.current = null;
      }
      return;
    }

    // Initialize or reuse tracker
    if (!trackerRef.current) {
      trackerRef.current = createActivityTracker({
        minHeartbeatInterval: 10_000,
        activityDebounce: 1_000,
      });
    }

    const tracker = trackerRef.current;
    tracker.setUserId(user.id);
    tracker.startTracking();

    // Sync heartbeat responses back to auth state
    const unsubscribeHeartbeat = tracker.onHeartbeat(({ live_status, last_active_at }) => {
      setUserState((prev) => {
        if (!prev) return prev;
        return { ...prev, live_status, last_active_at: last_active_at ?? prev.last_active_at };
      });
    });

    return () => {
      unsubscribeHeartbeat();
      tracker.stopTracking();
      trackerRef.current = null;
    };
  }, [user?.id]);

  const updateLiveStatus = useCallback(async (status: LiveStatusType, message?: string) => {
    setUserState((prev) => prev ? { ...prev, live_status: status, status_message: message ?? prev.status_message } : null);
    try {
      const res = await api.post<{ ok: boolean; user: User }>('/live-status/status', {
        status,
        status_message: message,
      });
      if (res.user) {
        setUserState((prev) => ({ ...prev, ...res.user }));
      }
    } catch (err) {
      refreshUser();
      throw err;
    }
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: User }>('/auth/login', { email, password });
    setUserState(data.user);
    try {
      await updateLiveStatus('active');
    } catch {
      await refreshUser();
    }
  }, [updateLiveStatus, refreshUser]);

  const logout = useCallback(() => {
    api.post('/auth/logout', {}).catch(() => {});
    setUserState(null);
  }, []);

  const hasPermission = useCallback((permission: string | string[]): boolean => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.role_group_slug === 'super_admin') return true;

    const perms = Array.isArray(user.permissions)
      ? user.permissions
      : Array.isArray(user.role_group_permissions)
      ? user.role_group_permissions
      : [];

    if (perms.includes('*')) return true;

    const targetList = Array.isArray(permission) ? permission : [permission];
    return targetList.some((reqPerm) => {
      if (perms.includes(reqPerm)) return true;
      const [module] = reqPerm.split('.');
      if (perms.includes(`${module}.*`)) return true;
      return false;
    });
  }, [user]);

  const canAny = useCallback((...permissions: string[]): boolean => {
    return permissions.some((p) => hasPermission(p));
  }, [hasPermission]);

  const canAll = useCallback((...permissions: string[]): boolean => {
    return permissions.every((p) => hasPermission(p));
  }, [hasPermission]);

  const value = useMemo<AuthCtx>(() => ({
    user,
    loading,
    isAdmin: !!user && (
      user.role === 'admin' ||
      user.role === 'super_admin' ||
      user.role === 'sub_admin' ||
      user.role_group_slug === 'admin' ||
      user.role_group_slug === 'super_admin' ||
      user.role_group_slug === 'sub_admin' ||
      hasPermission([
        'admin.access',
        'settings.manage',
        'settings.view',
        'roles.manage',
        'users.manage',
        'teams.manage',
        'departments.manage',
        'kpi.manage',
        'leaves.approve',
        'priority_tasks.manage',
      ])
    ),
    isSuper: !!user && (user.role === 'super_admin' || user.role_group_slug === 'super_admin'),
    hasPermission,
    canAny,
    canAll,
    login,
    logout,
    refreshUser,
    updateLiveStatus,
    setUser: setUserState,
  }), [user, loading, hasPermission, canAny, canAll, login, logout, refreshUser, updateLiveStatus]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
