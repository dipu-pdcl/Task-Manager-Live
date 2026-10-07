import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSettings } from '../../lib/settings';
import { statusById, cx, bdDateKey } from '../../lib/utils';
import { Badge } from '../ui';

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarView({ tasks }: { tasks: Task[] }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const weeks = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(start));
      start.setDate(start.getDate() + 1);
    }
    const byDate: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (!t.due_date) continue;
      if (!byDate[t.due_date]) byDate[t.due_date] = [];
      byDate[t.due_date].push(t);
    }
    const weeksArr: { date: Date; inMonth: boolean; tasks: Task[] }[][] = [];
    for (let w = 0; w < 6; w++) {
      const row = days.slice(w * 7, w * 7 + 7).map((d) => {
        const key = localDateKey(d);
        return { date: d, inMonth: d.getMonth() === m, tasks: byDate[key] || [] };
      });
      weeksArr.push(row);
    }
    return weeksArr;
  }, [cursor, tasks]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayKey = bdDateKey();

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="font-bold">{monthLabel}</div>
        <div className="flex gap-1.5">
          <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-semibold text-ink3 border-b border-line">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-line last:border-0">
          {week.map((cell, ci) => {
            const key = localDateKey(cell.date);
            const isToday = key === todayKey;
            return (
              <div key={ci} className={cx('min-h-[92px] p-1.5 border-r border-line last:border-0', !cell.inMonth && 'opacity-40 bg-card2/50')}>
                <div className={cx('w-6 h-6 flex items-center justify-center text-xs font-semibold rounded-full mb-1', isToday && 'gradient-bg text-white')}>
                  {cell.date.getDate()}
                </div>
                <div className="space-y-1">
                  {cell.tasks.slice(0, 3).map((t) => {
                    const st = statusById(settings, t.status);
                    return (
                      <div key={t.id} className="w-full">
                        <button onClick={() => navigate(`/tasks/${t.id}`)} title={`${t.title}${t.assignees?.length ? ` — ${t.assignees.map((a: any) => a.user_name ?? a.name).join(', ')}` : ''}`}
                          className="block w-full text-left truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: `${st.color}22`, color: st.color }}>
                          {t.title}
                        </button>
                        {/* The chip is title-only otherwise, so the assigned names
                            are spelled out underneath at this size. */}
                        <div className="px-1 mt-0.5 truncate text-[10px] text-ink3">
                          {t.assignees?.length
                            ? t.assignees.map((a: any) => a.user_name ?? a.name).join(', ')
                            : 'Unassigned'}
                        </div>
                      </div>
                    );
                  })}
                  {cell.tasks.length > 3 && <div className="text-[10px] text-ink3 px-1">+{cell.tasks.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
