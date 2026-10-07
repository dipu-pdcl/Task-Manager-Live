import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Flag, CalendarDays } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSettings } from '../../lib/settings';
import { statusById, priorityById, fmtDate, isOverdue, cx, parseBd } from '../../lib/utils';
import { AssigneeList, Badge } from '../ui';
import { useAuth } from '../../lib/auth';
import { ownTaskClass } from '../../lib/ownTasks';

export function TimelineView({ tasks }: { tasks: Task[] }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const ownId = isAdmin ? user?.id : null;
  const key = (v?: string | null) => (parseBd(v) || new Date(0)).getTime();
  const sorted = [...tasks].sort((a, b) => key(a.due_date || a.created_at) - key(b.due_date || b.created_at));

  return (
    <div className="relative space-y-0">
      <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-line" />
      {sorted.map((t) => {
        const st = statusById(settings, t.status);
        const pr = priorityById(settings, t.priority);
        const overdue = isOverdue(t);
        return (
          <div key={t.id} className="relative pl-8 pb-4 anim-in">
            <span className="absolute left-[6px] top-1.5 w-3 h-3 rounded-full border-2 border-card" style={{ background: st.color }} />
            <button onClick={() => navigate(`/tasks/${t.id}`)} className={cx('card card-hover p-3.5 w-full text-left', ownTaskClass(t, ownId))}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={st.color} dot>{st.name}</Badge>
                <span className="text-xs text-ink2 font-medium inline-flex items-center gap-1"><Flag size={11} style={{ color: pr.color }} /> {pr.name}</span>
                {t.due_date && (
                  <span className={cx('text-xs inline-flex items-center gap-1', overdue ? 'text-bad font-semibold' : 'text-ink2')}>
                    <CalendarDays size={12} /> {fmtDate(t.due_date)}
                  </span>
                )}
                <AssigneeList assignees={t.assignees} max={3} size={22} className="ml-auto max-w-[45%]" />
              </div>
              <div className="font-semibold mt-1.5">{t.title}</div>
              {t.team_name && <div className="text-xs text-ink3 mt-0.5">{t.team_name} · {t.department_name || '—'}</div>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
