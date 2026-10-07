import type { User } from './types';

/**
 * Filters the assignee list in the task form.
 *
 * Every whitespace-separated word the user typed has to match, against the
 * person's name, branch or email taken together as one haystack:
 *
 *   "Dhanmondi"        everyone in that branch
 *   "Rahim"            everyone with that name
 *   "Rahim Dhanmondi"  Rahim, in that branch
 *
 * Matching each field independently would be wrong for the last case: the
 * second word would search the branch for a name that never matched it.
 * A person with no branch set simply contributes an empty segment.
 */
export function filterAssignees(users: User[], search: string): User[] {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return users;
  return users.filter((u) => {
    const haystack = `${u.name || ''} ${u.department_name || ''} ${u.email || ''}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}