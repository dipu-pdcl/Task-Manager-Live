import React from 'react';
import type { LiveStatusType } from '../lib/types';
import { cx } from '../lib/utils';

interface Props {
  status?: LiveStatusType | string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showDotOnly?: boolean;
  pulse?: boolean;
  className?: string;
}

export function LiveStatusDot({
  status = 'inactive',
  size = 'md',
  pulse = true,
  className = '',
}: {
  status?: LiveStatusType | string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}) {
  const normStatus: LiveStatusType = status === 'active' || status === 'away' ? status : 'inactive';

  const sizeClasses = {
    xs: 'w-2 h-2',
    sm: 'w-2.5 h-2.5',
    md: 'w-3 h-3',
    lg: 'w-3.5 h-3.5',
  }[size];

  const colors = {
    active: {
      dot: 'bg-emerald-500',
      ping: 'bg-emerald-400',
      shadow: 'shadow-[0_0_8px_rgba(16,185,129,0.7)]',
      title: 'Active (Online)',
    },
    away: {
      dot: 'bg-amber-400',
      ping: 'bg-amber-300',
      shadow: 'shadow-[0_0_8px_rgba(251,191,36,0.7)]',
      title: 'Away (AFK)',
    },
    inactive: {
      dot: 'bg-rose-500',
      ping: 'bg-rose-400',
      shadow: 'shadow-[0_0_8px_rgba(244,63,94,0.6)]',
      title: 'Inactive (Offline)',
    },
  }[normStatus];

  return (
    <span
      className={cx('relative inline-flex items-center justify-center shrink-0 select-none', sizeClasses, className)}
      title={colors.title}
    >
      {pulse && (
        <span
          className={cx(
            'absolute inset-0 rounded-full animate-ping opacity-75',
            colors.ping
          )}
        />
      )}
      <span
        className={cx(
          'relative inline-block rounded-full',
          sizeClasses,
          colors.dot,
          colors.shadow
        )}
      />
    </span>
  );
}

export function LiveStatusBadge({
  status = 'inactive',
  size = 'md',
  showLabel = true,
  showDotOnly = false,
  pulse = true,
  className = '',
}: Props) {
  const normStatus: LiveStatusType = status === 'active' || status === 'away' ? status : 'inactive';

  if (showDotOnly || !showLabel) {
    return <LiveStatusDot status={normStatus} size={size} pulse={pulse} className={className} />;
  }

  const configs = {
    active: {
      label: 'Active',
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50',
    },
    away: {
      label: 'Away',
      bg: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50',
    },
    inactive: {
      label: 'Inactive',
      bg: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800/40',
    },
  }[normStatus];

  const padding = size === 'xs'
    ? 'px-1.5 py-0.5 text-[10px] gap-1'
    : size === 'sm'
    ? 'px-2 py-0.5 text-xs gap-1.5'
    : size === 'lg'
    ? 'px-3 py-1.5 text-sm gap-2'
    : 'px-2.5 py-1 text-xs gap-1.5';

  return (
    <span
      className={cx(
        'inline-flex items-center font-medium rounded-full border transition-all select-none whitespace-nowrap shrink-0',
        padding,
        configs.bg,
        className
      )}
    >
      <LiveStatusDot status={normStatus} size={size === 'lg' ? 'md' : size === 'xs' ? 'xs' : 'sm'} pulse={pulse} />
      <span>{configs.label}</span>
    </span>
  );
}
