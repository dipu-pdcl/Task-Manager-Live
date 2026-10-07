import { api } from './api';
import type { LiveStatusType } from './types';

interface ActivityTrackerConfig {
  heartbeatEndpoint: string;
  statusEndpoint: string;
  minHeartbeatInterval: number;
  activityDebounce: number;
  enableVisibilityTracking: boolean;
  enableFocusTracking: boolean;
  enableNavigationTracking: boolean;
  enableApiTracking: boolean;
}

const DEFAULT_CONFIG: ActivityTrackerConfig = {
  heartbeatEndpoint: '/live-status/heartbeat',
  statusEndpoint: '/live-status/status',
  minHeartbeatInterval: 10_000,
  activityDebounce: 1_000,
  enableVisibilityTracking: true,
  enableFocusTracking: true,
  enableNavigationTracking: true,
  enableApiTracking: true,
};

interface HeartbeatResult {
  live_status: LiveStatusType;
  last_active_at: string | null;
}

type ActivityCallback = (activityType: string, metadata?: Record<string, unknown>) => void;
type HeartbeatCallback = (result: HeartbeatResult) => void;

class ActivityTracker {
  private config: ActivityTrackerConfig;
  private lastHeartbeatTime = 0;
  private activityTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private isTracking = false;
  private userId: string | number | null = null;
  private onActivityCallbacks: ActivityCallback[] = [];
  private onHeartbeatCallbacks: HeartbeatCallback[] = [];
  private pendingActivity = false;
  private activityTypes = new Set<string>();
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  private awayAfterMs = 5 * 60_000;

  constructor(config: Partial<ActivityTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setUserId(userId: string | number | null) {
    this.userId = userId;
  }

  onActivity(callback: ActivityCallback) {
    this.onActivityCallbacks.push(callback);
    return () => {
      const idx = this.onActivityCallbacks.indexOf(callback);
      if (idx >= 0) this.onActivityCallbacks.splice(idx, 1);
    };
  }

  onHeartbeat(callback: HeartbeatCallback) {
    this.onHeartbeatCallbacks.push(callback);
    return () => {
      const idx = this.onHeartbeatCallbacks.indexOf(callback);
      if (idx >= 0) this.onHeartbeatCallbacks.splice(idx, 1);
    };
  }

  private notifyActivity(activityType: string, metadata?: Record<string, unknown>) {
    this.activityTypes.add(activityType);
    this.onActivityCallbacks.forEach((cb) => cb(activityType, metadata));
  }

  private async sendHeartbeat(): Promise<boolean> {
    if (!this.userId) return false;

    const now = Date.now();
    if (now - this.lastHeartbeatTime < this.config.minHeartbeatInterval) {
      return false;
    }

    try {
      const res = await api.post<{ ok: boolean; live_status: LiveStatusType; last_active_at: string | null }>(this.config.heartbeatEndpoint, {});
      this.lastHeartbeatTime = now;
      this.pendingActivity = false;

      if (res?.live_status) {
        this.onHeartbeatCallbacks.forEach((cb) => cb({ live_status: res.live_status, last_active_at: res.last_active_at ?? null }));
      }

      return res?.ok === true;
    } catch {
      return false;
    }
  }

  private scheduleHeartbeat(immediate = false) {
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }

    if (immediate) {
      this.sendHeartbeat();
    } else {
      this.activityTimeout = setTimeout(() => {
        this.sendHeartbeat();
      }, this.config.activityDebounce);
    }
  }

  trackActivity(activityType: string, metadata?: Record<string, unknown>) {
    if (!this.userId) return;

    this.notifyActivity(activityType, metadata);
    this.pendingActivity = true;
    this.scheduleHeartbeat();
  }

  trackImmediateActivity(activityType: string, metadata?: Record<string, unknown>) {
    if (!this.userId) return;

    this.notifyActivity(activityType, metadata);
    this.pendingActivity = true;
    this.scheduleHeartbeat(true);
  }

  startTracking() {
    if (this.isTracking || !this.userId) return;

    this.isTracking = true;

    if (this.config.enableVisibilityTracking) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('pagehide', this.handlePageHide);
    }

    if (this.config.enableFocusTracking) {
      window.addEventListener('focus', this.handleFocus);
    }

    this.setupDomActivityListeners();
    this.startHeartbeatInterval();
  }

  stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;

    if (this.config.enableVisibilityTracking) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('pagehide', this.handlePageHide);
    }

    if (this.config.enableFocusTracking) {
      window.removeEventListener('focus', this.handleFocus);
    }

    this.teardownDomActivityListeners();
    this.stopHeartbeatInterval();
    this.clearAwayTimer();

    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      if (this.userId) {
        this.scheduleAwayStatus();
      }
    } else {
      this.clearAwayTimer();
      if (this.userId) {
        this.trackImmediateActivity('visibility_visible');
      }
    }
  };

  private scheduleAwayStatus() {
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.awayTimer = setTimeout(() => {
      if (this.userId && document.hidden) {
        this.setAwayStatus();
      }
    }, this.awayAfterMs);
  }

  private clearAwayTimer() {
    if (this.awayTimer) {
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
    }
  }

  private async setAwayStatus() {
    if (!this.userId) return;
    try {
      const res = await api.post<{ ok: boolean; live_status: LiveStatusType }>(this.config.statusEndpoint, {
        status: 'away',
        status_message: '',
      });
      this.onHeartbeatCallbacks.forEach((cb) => cb({ live_status: res.live_status, last_active_at: null }));
    } catch {
      // best-effort
    }
  }

  private handlePageHide = () => {
    this.clearAwayTimer();
    if (this.userId) {
      this.setInactiveStatus();
    }
  };

  private setInactiveStatus() {
    if (!this.userId) return;
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(
        `/api${this.config.statusEndpoint}`,
        new Blob(
          [JSON.stringify({ status: 'inactive', status_message: '' })],
          { type: 'application/json' },
        ),
      );
    }
  }

  private handleFocus = () => {
    if (this.userId) {
      this.trackImmediateActivity('window_focus');
    }
  };

  private domActivityHandler = (event: Event) => {
    if (!this.userId) return;
    this.trackActivity(event.type, { target: (event.target as HTMLElement)?.tagName });
  };

  private setupDomActivityListeners() {
    const events = [
      'mousemove',
      'mousedown',
      'click',
      'keydown',
      'keyup',
      'scroll',
      'touchstart',
      'touchmove',
      'pointerdown',
      'wheel',
      'input',
      'change',
      'submit',
    ];

    events.forEach((evt) => {
      document.addEventListener(evt, this.domActivityHandler, { passive: true, capture: true });
    });
  }

  private teardownDomActivityListeners() {
    const events = [
      'mousemove',
      'mousedown',
      'click',
      'keydown',
      'keyup',
      'scroll',
      'touchstart',
      'touchmove',
      'pointerdown',
      'wheel',
      'input',
      'change',
      'submit',
    ];

    events.forEach((evt) => {
      document.removeEventListener(evt, this.domActivityHandler, { passive: true, capture: true } as EventListenerOptions);
    });
  }

  private startHeartbeatInterval() {
    this.heartbeatInterval = setInterval(() => {
      if (this.userId && !document.hidden) {
        this.sendHeartbeat();
      }
    }, 30_000);
  }

  private stopHeartbeatInterval() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  trackNavigation(from: string, to: string) {
    this.trackImmediateActivity('navigation', { from, to });
  }

  trackApiRequest(method: string, url: string) {
    if (!this.config.enableApiTracking) return;
    this.trackActivity('api_request', { method, url });
  }

  trackTaskAction(action: string, taskId: string | number) {
    this.trackImmediateActivity('task_action', { action, taskId });
  }

  trackChatAction(action: string, conversationId?: string | number) {
    this.trackImmediateActivity('chat_action', { action, conversationId });
  }

  trackSearch(query: string, context?: string) {
    this.trackActivity('search', { query, context });
  }

  trackFilter(filters: Record<string, unknown>, context?: string) {
    this.trackActivity('filter', { filters, context });
  }

  trackProfileView(userId: string | number) {
    this.trackActivity('profile_view', { viewedUserId: userId });
  }

  getTrackedActivityTypes(): string[] {
    return Array.from(this.activityTypes);
  }

  hasPendingActivity(): boolean {
    return this.pendingActivity;
  }

  flushPendingActivity() {
    if (this.pendingActivity && this.userId) {
      this.sendHeartbeat();
    }
  }
}

let trackerInstance: ActivityTracker | null = null;

export function createActivityTracker(config?: Partial<ActivityTrackerConfig>): ActivityTracker {
  trackerInstance = new ActivityTracker(config);
  return trackerInstance;
}

export function getActivityTracker(): ActivityTracker | null {
  return trackerInstance;
}

export function trackActivity(activityType: string, metadata?: Record<string, unknown>) {
  trackerInstance?.trackActivity(activityType, metadata);
}

export function trackImmediateActivity(activityType: string, metadata?: Record<string, unknown>) {
  trackerInstance?.trackImmediateActivity(activityType, metadata);
}

export function trackNavigation(from: string, to: string) {
  trackerInstance?.trackNavigation(from, to);
}

export function trackApiRequest(method: string, url: string) {
  trackerInstance?.trackApiRequest(method, url);
}

export function trackTaskAction(action: string, taskId: string | number) {
  trackerInstance?.trackTaskAction(action, taskId);
}

export function trackChatAction(action: string, conversationId?: string | number) {
  trackerInstance?.trackChatAction(action, conversationId);
}

export function trackSearch(query: string, context?: string) {
  trackerInstance?.trackSearch(query, context);
}

export function trackFilter(filters: Record<string, unknown>, context?: string) {
  trackerInstance?.trackFilter(filters, context);
}

export function trackProfileView(userId: string | number) {
  trackerInstance?.trackProfileView(userId);
}