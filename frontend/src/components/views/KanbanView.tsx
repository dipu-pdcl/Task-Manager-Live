import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Paperclip, MessageSquare, GripVertical } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSettings } from '../../lib/settings';
import { statusById, priorityById, fmtDate, isOverdue, cx, taskCodeLabel } from '../../lib/utils';
import { AssigneeList, Badge, useToast } from '../ui';
import { useAuth } from '../../lib/auth';
import { ownTaskClass } from '../../lib/ownTasks';
import { api } from '../../lib/api';

type DragState = {
  taskId: number;
  fromStatus: string;
  hasMoved: boolean;
};

type DropPos = { status: string; taskId: number | null; position: 'before' | 'after' | 'empty' };

export function KanbanView({ tasks, onMoved }: { tasks: Task[]; onMoved?: () => void }) {
  const { user, isAdmin } = useAuth();
  const ownId = isAdmin ? user?.id : null;
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropPos, setDropPos] = useState<DropPos | null>(null);
  const clickGuard = useRef<{ id: number; x: number; y: number; t: number } | null>(null);

  const statuses = settings?.taskStatuses || [];
  const cols = statuses.map((s) => ({ ...s, tasks: tasks.filter((t) => t.status === s.id) }));

  const onDragStart = (e: React.DragEvent<HTMLDivElement>, t: Task) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(t.id));
    if (e.dataTransfer.setDragImage) {
      const target = e.currentTarget as HTMLElement;
      if (target) e.dataTransfer.setDragImage(target, 20, 20);
    }
    setDrag({ taskId: t.id, fromStatus: t.status, hasMoved: false });
  };

  const onDragEnd = () => {
    setDrag(null);
    setDropPos(null);
  };

  const onColumnDragOver = (e: React.DragEvent<HTMLDivElement>, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!drag) return;

    const col = cols.find((c) => c.id === status);
    if (!col) return;

    if (col.tasks.length === 0) {
      setDropPos({ status, taskId: null, position: 'empty' });
      return;
    }

    const cards = e.currentTarget.querySelectorAll<HTMLElement>('[data-kanban-card]');
    let placed: DropPos = { status, taskId: col.tasks[col.tasks.length - 1].id, position: 'after' };
    for (const card of Array.from(cards)) {
      const cardId = Number(card.dataset.kanbanCard);
      if (cardId === drag.taskId) continue;
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (e.clientY < midpoint) {
        placed = { status, taskId: cardId, position: 'before' };
        break;
      }
    }
    setDropPos(placed);
  };

  const onColumnDragLeave = (e: React.DragEvent<HTMLDivElement>, status: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dropPos?.status === status) setDropPos(null);
  };

  const onColumnDrop = async (e: React.DragEvent<HTMLDivElement>, status: string) => {
    e.preventDefault();
    if (!drag) {
      setDropPos(null);
      return;
    }
    const target = dropPos && dropPos.status === status ? dropPos : { status, taskId: null, position: 'empty' as const };
    setDropPos(null);

    const fromStatus = drag.fromStatus;
    const draggedTask = tasks.find((x) => x.id === drag.taskId);
    if (!draggedTask) {
      setDrag(null);
      return;
    }

    const targetCol = cols.find((c) => c.id === status);
    if (!targetCol) {
      setDrag(null);
      return;
    }

    const isSameColumn = fromStatus === status;
    if (isSameColumn && target.position === 'empty') {
      setDrag(null);
      return;
    }

    const reordered = (() => {
      const list = targetCol.tasks.filter((t) => t.id !== drag.taskId);
      if (target.position === 'empty' || target.taskId == null) {
        list.push(draggedTask);
      } else if (target.position === 'before') {
        const idx = list.findIndex((t) => t.id === target.taskId);
        list.splice(idx === -1 ? list.length : idx, 0, draggedTask);
      } else {
        const idx = list.findIndex((t) => t.id === target.taskId);
        list.splice(idx === -1 ? list.length : idx + 1, 0, draggedTask);
      }
      return list;
    })();

    const newIndex = reordered.findIndex((t) => t.id === drag.taskId);
    const prevTask = newIndex > 0 ? reordered[newIndex - 1] : null;
    const nextTask = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;

    const statusChanged = fromStatus !== status;
    try {
      if (statusChanged) {
        await api.post(`/tasks/${drag.taskId}/status`, { status });
      }
      try {
        await api.post(`/tasks/${drag.taskId}/reorder`, {
          status,
          before_id: prevTask?.id ?? null,
          after_id: nextTask?.id ?? null,
        });
      } catch {
      }
      const statusName = statuses.find((s) => s.id === status)?.name || status;
      toast(statusChanged ? `Moved to ${statusName}` : 'Reordered');
      onMoved?.();
    } catch (err: any) {
      toast(err?.message || 'Failed to move task', 'error');
    } finally {
      setDrag(null);
    }
  };

  const handleCardClick = (e: React.MouseEvent, id: number) => {
    const g = clickGuard.current;
    if (g && g.id === id) {
      const dx = Math.abs(e.clientX - g.x);
      const dy = Math.abs(e.clientY - g.y);
      const dt = Date.now() - g.t;
      if (dx < 6 && dy < 6 && dt < 350) {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/tasks/${id}`);
      }
    }
  };

  const recordClickStart = (id: number, e: React.MouseEvent) => {
    clickGuard.current = { id, x: e.clientX, y: e.clientY, t: Date.now() };
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 items-start select-none">
      {cols.map((col) => {
        const isDropTarget = dropPos?.status === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => onColumnDragOver(e, col.id)}
            onDragLeave={(e) => onColumnDragLeave(e, col.id)}
            onDrop={(e) => onColumnDrop(e, col.id)}
            className={cx(
              'w-[280px] shrink-0 rounded-2xl p-2.5 transition-all border min-h-[200px]',
              isDropTarget ? 'bg-brand/10 border-brand/50 ring-2 ring-brand/20' : 'bg-card2/60 border-line'
            )}
          >
            <div className="flex items-center gap-2 px-1.5 pb-2.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
              <span className="font-semibold text-sm flex-1">{col.name}</span>
              <span className="text-xs text-ink3 font-bold">{col.tasks.length}</span>
            </div>
            <div className="space-y-2">
              {col.tasks.map((t) => {
                const pr = priorityById(settings, t.priority);
                const overdue = isOverdue(t);
                const isDragging = drag?.taskId === t.id;
                const showBefore = isDropTarget && dropPos?.position === 'before' && dropPos.taskId === t.id;
                const showAfter = isDropTarget && dropPos?.position === 'after' && dropPos.taskId === t.id;
                return (
                  <React.Fragment key={t.id}>
                    {showBefore && <DropIndicator />}
                    <div
                      data-kanban-card={t.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, t)}
                      onDragEnd={onDragEnd}
                      onMouseDown={(e) => recordClickStart(t.id, e)}
                      onClick={(e) => handleCardClick(e, t.id)}
                      className={cx(
                        'card p-3 cursor-grab active:cursor-grabbing anim-in',
                        !isDragging && 'card-hover',
                        isDragging && 'opacity-40 ring-2 ring-brand',
                        ownTaskClass(t, ownId)
                      )}
                    >
                      <div className="flex items-start gap-1.5 mb-1.5">
                        <GripVertical size={14} className="text-ink3 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono font-semibold text-ink3">{taskCodeLabel(t.task_code, t.id)}</div>
                          <h5 className="font-semibold text-sm leading-snug">{t.title}</h5>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {t.flags?.slice(0, 2).map((f) => <Badge key={f} color="#f59e0b">{f}</Badge>)}
                        <Badge color={pr.color}>{pr.name}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-3">
                        <AssigneeList assignees={t.assignees} max={3} size={22} className="min-w-0" />
                        <div className="flex items-center gap-2 text-ink3 text-[11px] shrink-0">
                          {t.due_date && <span className={cx('flex items-center gap-1', overdue && 'text-bad font-semibold')}><CalendarDays size={11} />{fmtDate(t.due_date)}</span>}
                          {t.comments_count ? <span className="flex items-center gap-0.5"><MessageSquare size={11} />{t.comments_count}</span> : null}
                          {t.attachments_count ? <span className="flex items-center gap-0.5"><Paperclip size={11} />{t.attachments_count}</span> : null}
                        </div>
                      </div>
                    </div>
                    {showAfter && <DropIndicator />}
                  </React.Fragment>
                );
              })}
              {(isDropTarget && dropPos?.position === 'empty') && (
                <div className="border-2 border-dashed border-brand rounded-xl py-8 text-center text-xs text-brand font-semibold bg-brand/5">
                  Drop task here
                </div>
              )}
              {col.tasks.length === 0 && !isDropTarget && (
                <div className="border-2 border-dashed border-line rounded-xl py-8 text-center text-xs text-ink3">
                  Drop tasks here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DropIndicator() {
  return (
    <div className="h-1 rounded-full bg-gradient-to-r from-transparent via-brand to-transparent my-1 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
  );
}
