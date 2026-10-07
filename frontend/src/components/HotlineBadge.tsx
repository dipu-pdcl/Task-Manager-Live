import React, { useState } from 'react';
import { PhoneCall, Copy, Check } from 'lucide-react';
import { parsePhoneAndExtension, initiatePhoneCall } from '../lib/phone';
import { useToast } from './ui';

interface HotlineBadgeProps {
  hotline?: string;
  branchName?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'card' | 'chip' | 'button';
  showCopy?: boolean;
  className?: string;
}

export function HotlineBadge({
  hotline,
  branchName,
  size = 'md',
  variant = 'card',
  showCopy = true,
  className = '',
}: HotlineBadgeProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [calling, setCalling] = useState(false);

  const parsed = parsePhoneAndExtension(hotline);
  const displayHotline = parsed.displayMain || hotline || '';

  if (!displayHotline) {
    if (variant === 'card') {
      return (
        <div className={`flex items-center gap-2 text-xs text-ink3/70 px-2.5 py-1.5 rounded-lg bg-card2/40 border border-line/50 ${className}`}>
          <PhoneCall size={12} className="text-ink3/50 shrink-0" />
          <span className="text-[11px] italic">No Hotline configured</span>
        </div>
      );
    }
    return null;
  }

  const handleCallHotline = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!parsed.mainPhone) return;
    setCalling(true);
    initiatePhoneCall(parsed.mainPhone);
    const targetDesc = branchName ? `${branchName} (${displayHotline})` : displayHotline;
    toast(`Initiating call to ${targetDesc}...`, 'info');
    setTimeout(() => setCalling(false), 2000);
  };

  const handleCopyHotline = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(displayHotline).then(() => {
      setCopied(true);
      toast(`Copied "${displayHotline}" to clipboard`, 'success');
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {
      toast('Failed to copy', 'error');
    });
  };

  // Chip variant (for user lists, staff dossiers, and profile)
  if (variant === 'chip') {
    return (
      <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
        <a
          href={parsed.telUri}
          onClick={handleCallHotline}
          title={`Click to call ${branchName ? `${branchName} ` : ''}Hotline: ${displayHotline}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 active:scale-95 border border-emerald-500/25 transition-all text-xs font-mono font-semibold cursor-pointer group"
        >
          <PhoneCall size={11} className={`text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform ${calling ? 'animate-bounce' : ''}`} />
          <span className="truncate group-hover:underline">{displayHotline}</span>
        </a>

        {showCopy && (
          <button
            type="button"
            onClick={handleCopyHotline}
            title="Copy Hotline"
            className="p-0.5 rounded hover:bg-card2 text-ink3 hover:text-ink1 transition-colors"
          >
            {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
          </button>
        )}
      </span>
    );
  }

  // Button variant
  if (variant === 'button') {
    return (
      <a
        href={parsed.telUri}
        onClick={handleCallHotline}
        title={`Click to call ${branchName ? `${branchName}: ` : ''}${displayHotline}`}
        className={`btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm inline-flex items-center gap-1.5 active:scale-95 transition-all ${className}`}
      >
        <PhoneCall size={14} className={calling ? 'animate-bounce' : ''} />
        <span>Call {displayHotline}</span>
      </a>
    );
  }

  // Default 'card' variant (for Departments/Branches page)
  return (
    <div
      className={`flex items-center justify-between gap-2 text-xs bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-1.5 rounded-lg transition-colors ${className}`}
    >
      <a
        href={parsed.telUri}
        onClick={handleCallHotline}
        title={`Click to call ${branchName ? `${branchName} ` : ''}Hotline: ${displayHotline}`}
        className="flex items-center gap-2 min-w-0 group cursor-pointer"
      >
        <div className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
          <PhoneCall size={12} className={calling ? 'animate-bounce' : ''} />
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-ink3">Hotline:</span>
          <span className="font-mono font-bold text-xs text-ink1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline truncate tracking-tight transition-colors">
            {displayHotline}
          </span>
        </div>
      </a>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopyHotline}
          title="Copy Hotline"
          className="p-1 rounded hover:bg-card2 text-ink3 hover:text-ink1 transition-colors shrink-0"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}
