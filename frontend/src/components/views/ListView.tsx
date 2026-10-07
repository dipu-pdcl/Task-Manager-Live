import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, MessageSquare, Paperclip, ListChecks, Flag } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSettings } from '../../lib/settings';
import { statusById, priorityById, fmtDate, isOverdue, cx, taskCodeLabel } from '../../lib/utils';
import { AssigneeList, Badge } from '../ui';
import { useAuth } from '../../lib/auth';
import { ownTaskClass } from '../../lib/ownTasks';

export function ListView({ tasks }: { tasks: Task[] }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  // Highlighting is an admin affordance: a regular user is only ever shown the
  // tasks they are involved in anyway, so the tint would be noise.
  const ownId = isAdmin ? user?.id : null;
  return (
    <div className="card overflow-hidden">
      <div className="table-wrap">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink3 uppercase tracking-wider border-b border-line">
            <th className="px-4 py-3 font-semibold">Task</th>
            <th className="px-4 py-3 font-semibold hidden md:table-cell">Status</th>
            <th className="px-4 py-3 font-semibold hidden lg:table-cell">Priority</th>
            <th className="px-4 py-3 font-semibold hidden lg:table-cell">Assignees</th>
            <th className="px-4 py-3 font-semibold hidden md:table-cell">Team</th>
            <th className="px-4 py-3 font-semibold">Due</th>
            <th className="px-4 py-3 font-semibold hidden sm:table-cell">Progress</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const st = statusById(settings, t.status);
            const pr = priorityById(settings, t.priority);
            const overdue = isOverdue(t);
            return (
              <tr key={t.id} onClick={() => navigate(`/tasks/${t.id}`)}
                className={cx('border-b border-line last:border-0 hover:bg-card2 cursor-pointer transition-colors', ownTaskClass(t, ownId))}>
                <td className="px-4 py-3">
                  <div className="font-semibold flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: st.color }} />
                    <span className="truncate">{t.title}</span>
                    {t.is_self_task && <Badge color="#10b981">Self Task</Badge>}
                    {t.is_blocked && <Badge color="#ef4444">blocked</Badge>}
                    {t.flags?.includes('Urgent') && <Badge color="#f97316">urgent</Badge>}
                  </div>
                  <div className="text-xs text-ink3 mt-0.5 flex items-center gap-3">
                    <span className="font-mono font-semibold">{taskCodeLabel(t.task_code, t.id)}</span> · {t.task_type}
                    <span className="hidden sm:inline-flex items-center gap-2">
                      {t.comments_count ? <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{t.comments_count}</span> : null}
                      {t.attachments_count ? <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{t.attachments_count}</span> : null}
                      {t.checklist?.total ? <span className="inline-flex items-center gap-0.5"><ListChecks size={11} />{t.checklist.done}/{t.checklist.total}</span> : null}
</span>
                  </div>
                  {/* The Assignees column is hidden below lg, so the names are
                      repeated here to keep them visible on phones and tablets. */}
                  <div className="lg:hidden mt-1">
                    <AssigneeList assignees={t.assignees} max={3} size={18} />
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell"><Badge color={st.color} dot>{st.name}</Badge></td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className="inline-flex items-center gap-1 font-semibold text-xs" style={{ color: pr.color }}>
                    <Flag size={11} /> {pr.name}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <AssigneeList assignees={t.assignees} max={4} size={22} className="max-w-[240px]" />
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-ink2">{t.team_name || '—'}</td>
                <td className="px-4 py-3">
                  <span className={cx('inline-flex items-center gap-1 text-xs', overdue ? 'text-bad font-semibold' : 'text-ink2')}>
                    <CalendarDays size={12} /> {fmtDate(t.due_date)}
                  </span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="flex items-center gap-2 min-w-[90px]">
                    <div className="progress-bar flex-1"><div style={{ width: `${t.progress}%` }} /></div>
                    <span className="text-xs font-semibold w-8">{t.progress}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
