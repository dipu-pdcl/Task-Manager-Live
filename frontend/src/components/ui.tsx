import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, AlertTriangle, Info } from 'lucide-react';
import { cx, avatarColor, initials } from '../lib/utils';
import { OWN_TASK_LABEL } from '../lib/ownTasks';

export function Avatar({ name, src, size = 36, className }: { name?: string; src?: string; size?: number; className?: string }) {
  return (
    <span
      className={cx('avatar', className)}
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: src ? 'transparent' : avatarColor(name),
        overflow: 'hidden',
      }}
    >
      {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
    </span>
  );
}

/**
 * Explains the admin "own task" highlight. Rendered only for admins, and only
 * where their own tasks can actually appear.
 */
export function OwnTaskLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 flex-wrap text-[11px] text-ink2', className)}>
      <span className="font-semibold text-ink3">My tasks:</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="legend-swatch legend-swatch-self" />
        {OWN_TASK_LABEL.self}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="legend-swatch legend-swatch-assigned" />
        {OWN_TASK_LABEL.assigned}
      </span>
    </div>
  );
}

export function Badge({ color, children, dot, className }: { color?: string; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cx('badge', className)}
      style={{
        color, background: `${color}1a`, border: `1px solid ${color}33`,
      }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, settings, className }: { status: string; settings?: { taskStatuses: { id: string; name: string; color: string }[] }; className?: string }) {
  const meta = settings?.taskStatuses.find((s) => s.id === status) || { name: status, color: '#94a3b8' };
  return <Badge color={meta.color} dot className={className}>{meta.name}</Badge>;
}

/**
 * Assigned people, rendered the same way everywhere a task appears.
 *
 * The backend describes an assignee two different ways -- the task endpoints
 * return { user_id, user_name }, the project endpoint returns { id, name } -- so
 * both are accepted here rather than forcing every caller to reshape the data.
 *
 * Names are shown rather than only avatars: initials alone are not enough to
 * tell people apart, and the whole list stays reachable through the title
 * tooltip when the cell is too narrow to spell everyone out.
 */
export function AssigneeList({
  assignees,
  max = 3,
  size = 22,
  showNames = true,
  emptyLabel = 'Unassigned',
  className,
}: {
  assignees?: ({ user_id: number; user_name?: string; avatar?: string } | { id: number; name?: string; avatar?: string })[] | null;
  max?: number;
  size?: number;
  showNames?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const people = (assignees || []).map((a: any) => ({
    id: a.user_id ?? a.id,
    name: a.user_name ?? a.name ?? 'Unknown',
    avatar: a.avatar,
  })).filter((p: { id?: number }) => p.id != null);

  if (!people.length) {
    return <span className={cx('text-[11px] text-ink3', className)}>{emptyLabel}</span>;
  }

  const shown = max > 0 ? people.slice(0, max) : people;
  const hidden = people.length - shown.length;
  const allNames = people.map((p: { name: string }) => p.name).join(', ');

  return (
    <span className={cx('inline-flex items-center gap-1.5 min-w-0', className)} title={`Assigned to: ${allNames}`}>
      <span className="flex -space-x-1.5 shrink-0">
        {shown.map((p: { id: number; name: string; avatar?: string }) => (
          <span key={p.id} className="ring-1 ring-card rounded-full">
            <Avatar name={p.name} src={p.avatar} size={size} />
          </span>
        ))}
        {hidden > 0 && (
          <span
            className="rounded-full bg-card2 border border-line text-[10px] font-bold text-ink2 flex items-center justify-center"
            style={{ width: size, height: size }}
          >
            +{hidden}
          </span>
        )}
      </span>
      {showNames && (
        <span className="text-[11px] text-ink2 truncate min-w-0">
          {hidden > 0 ? `${shown.map((p: { name: string }) => p.name).join(', ')}, +${hidden} more` : allNames}
        </span>
      )}
    </span>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 560 }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number | string;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* Flex column with the body as the only scroller, so the title and the
          action buttons stay reachable on a short screen. dvh tracks the
          mobile browser chrome, which vh does not. */}
      <div className="card anim-pop w-full flex flex-col" style={{ maxWidth: width, maxHeight: '90dvh', overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0 bg-card z-10" style={{ background: 'rgb(var(--card))' }}>
          <h3 className="font-bold text-base">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-card2 text-ink2"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 overscroll-contain">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line flex justify-end gap-2 shrink-0 flex-wrap">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Dropdown({ trigger, children, align = 'right', width = 200 }: {
  trigger: React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); align?: 'left' | 'right'; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {/* min() keeps a fixed-width menu inside a narrow viewport instead of
          hanging off the right edge, and max-h keeps a long menu on screen. */}
      {open && (
        <div
          className="card anim-pop absolute z-40 mt-1.5 p-1.5 overflow-y-auto overscroll-contain"
          style={{ [align]: 0, width: `min(${width}px, calc(100vw - 2rem))`, maxHeight: 'min(60vh, 28rem)', background: 'rgb(var(--card))' }}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 group"
      aria-pressed={checked}
    >
      <span
        className="relative inline-flex items-center h-5.5 w-10 rounded-full transition-colors"
        style={{ background: checked ? 'rgb(var(--accent))' : 'rgb(var(--border))', width: 40, height: 22 }}
      >
        <span
          className="inline-block w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </span>
      {label && <span className="text-sm text-ink2 group-hover:text-ink">{label}</span>}
    </button>
  );
}

export function EmptyState({ icon, title, subtitle, action }: { icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center anim-in">
      {icon && <div className="w-14 h-14 rounded-2xl gradient-bg flex items-center justify-center text-white mb-4 opacity-80">{icon}</div>}
      <h4 className="font-semibold text-ink">{title}</h4>
      {subtitle && <p className="text-sm text-ink2 mt-1 max-w-sm">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-card2', className)} style={{ background: 'rgba(var(--border),0.45)' }} />;
}

type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; type: ToastType; message: string }

let toastId = 0;
const ToastCtx = React.createContext<(t: string, type?: ToastType) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const icons: Record<ToastType, React.ReactNode> = {
    success: <Check size={16} className="text-ok" />,
    error: <AlertTriangle size={16} className="text-bad" />,
    warning: <AlertTriangle size={16} className="text-warn" />,
    info: <Info size={16} className="text-inf" />,
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="card anim-slide px-4 py-3 flex items-center gap-3 max-w-sm shadow-lg" style={{ background: 'rgb(var(--card))' }}>
            {icons[t.type]}
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() { return React.useContext(ToastCtx); }

export function ConfirmModal({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title?: string; message?: string; confirmLabel?: string; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} width={420}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={cx('btn', danger ? 'btn-danger' : 'btn-primary')} disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); onClose(); } catch { /* surfaced by the caller */ } finally { setBusy(false); }
            }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className="text-sm text-ink2">{message}</p>}
    </Modal>
  );
}

export function StatCard({ label, value, icon, color, sub, onClick }: {
  label: string; value: React.ReactNode; icon: React.ReactNode; color: string; sub?: React.ReactNode; onClick?: () => void;
}) {
  return (
    <div className={cx('card card-hover p-4 flex items-start gap-3', onClick && 'cursor-pointer')} onClick={onClick}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs font-medium text-ink2 truncate">{label}</div>
        {sub && <div className="text-[11px] text-ink3 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange, className }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void; className?: string }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto no-scrollbar', className)}>
      {tabs.map((t) => (
        <button key={t.key} className={cx('tab', active === t.key && 'tab-active')} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="ml-1 text-[11px] opacity-70">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
