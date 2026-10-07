import type { Task } from './types';

/**
 * Which "own task" highlight a task gets.
 *
 *  - `self`     the task was created by the signed-in user
 *  - `assigned` the user is an assignee, or is @mentioned in a comment
 *
 * A task the user both created and is assigned to is shown as `self`, since
 * authorship is the stronger "this is mine" signal.
 */
export type OwnTaskKind = 'self' | 'assigned';

export function ownTaskKind(
  t: Pick<Task, 'created_by' | 'assignees' | 'mentioned_me'>,
  userId: number | null | undefined,
): OwnTaskKind | null {
  if (!userId) return null;
  if (t.created_by === userId) return 'self';
  if (t.mentioned_me || (t.assignees || []).some((a) => a.user_id === userId)) return 'assigned';
  return null;
}

/** Row/card class for a task, or '' when it should keep the default look. */
export function ownTaskClass(t: Task, userId: number | null | undefined): string {
  const kind = ownTaskKind(t, userId);
  return kind ? `task-own task-own-${kind}` : '';
}

export const OWN_TASK_LABEL: Record<OwnTaskKind, string> = {
  self: 'Created by you',
  assigned: 'Assigned to you / mentioned',
};