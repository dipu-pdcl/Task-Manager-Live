// Isolated test for the assignee search in the Create New Task form. Runs the
// real filterAssignees against a realistic roster, including the duplicate-name
// case the branch display exists to disambiguate. No database is involved.
import assert from 'node:assert/strict';

const { filterAssignees } = await import('../../frontend/src/lib/assigneeSearch.ts');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };
const names = (r) => r.map((u) => u.name);

const users = [
  { id: 1, name: 'Rahim Ahmed', email: 'rahim@t.test', department_name: 'Dhanmondi' },
  { id: 2, name: 'Rahim Ahmed', email: 'rahim.ahmed@t.test', department_name: 'Uttara' },
  { id: 3, name: 'Karim Hasan', email: 'karim@t.test', department_name: 'Dhanmondi' },
  { id: 4, name: 'Sakib Khan', email: 'sakib@t.test', department_name: 'Mirpur' },
  { id: 5, name: 'Nusrat Jahan', email: 'nusrat@t.test', department_name: null },
  { id: 6, name: 'Tanvir Ahmed', email: 'tanvir@t.test', department_name: 'Uttara' },
];

console.log('--- 1. searching by name still works ---');
check('a full name finds them', names(filterAssignees(users, 'Rahim Ahmed')).length === 2,
  names(filterAssignees(users, 'Rahim Ahmed')).join(', '));
check('a partial name finds them', names(filterAssignees(users, 'karim')).join() === 'Karim Hasan',
  names(filterAssignees(users, 'karim')).join(', '));
check('searching is case insensitive', filterAssignees(users, 'sakib').length === 1);
check('an unknown name finds nobody', filterAssignees(users, 'Nobody').length === 0);

console.log('\n--- 2. searching by branch name works ---');
const dhaka = filterAssignees(users, 'Dhanmondi');
check('a branch finds everyone in it', dhaka.length === 2, names(dhaka).join(', '));
check('and only those people', names(dhaka).every((n) => ['Rahim Ahmed', 'Karim Hasan'].includes(n)), names(dhaka).join(', '));
check('branch search is case insensitive', filterAssignees(users, 'dhanmondi').length === 2);
check('a different branch finds its own people', names(filterAssignees(users, 'Mirpur')).join() === 'Sakib Khan',
  names(filterAssignees(users, 'Mirpur')).join(', '));

console.log('\n--- 3. branch disambiguates people with the same name ---');
const rahimDhanmondi = filterAssignees(users, 'Rahim Dhanmondi');
check('name plus branch picks exactly one of the two Rahims',
  rahimDhanmondi.length === 1 && rahimDhanmondi[0].department_name === 'Dhanmondi',
  names(rahimDhanmondi).join(', '));
const rahimUttara = filterAssignees(users, 'Rahim Uttara');
check('the other branch picks the other Rahim',
  rahimUttara.length === 1 && rahimUttara[0].department_name === 'Uttara',
  names(rahimUttara).join(', '));

console.log('\n--- 4. both fields work together ---');
check('a name from one branch paired with another branch finds nobody',
  filterAssignees(users, 'Karim Uttara').length === 0);
check('order does not matter', filterAssignees(users, 'Dhanmondi Karim').length === 1);
check('extra words still narrow', filterAssignees(users, 'Ahmed Dhanmondi').length === 1,
  names(filterAssignees(users, 'Ahmed Dhanmondi')).join(', '));

console.log('\n--- 5. email search still works ---');
check('an email fragment finds them', names(filterAssignees(users, 'nusrat@')).join() === 'Nusrat Jahan',
  names(filterAssignees(users, 'nusrat@')).join(', '));

console.log('\n--- 6. edge cases ---');
check('an empty search lists everyone', filterAssignees(users, '').length === users.length);
check('whitespace only lists everyone', filterAssignees(users, '   ').length === users.length);
check('surrounding spaces are ignored', filterAssignees(users, '  Karim  ').length === 1);
check('a person with no branch is still searchable by name', names(filterAssignees(users, 'Nusrat')).join() === 'Nusrat Jahan');
check('and a branch search simply does not return them',
  !filterAssignees(users, 'Dhanmondi').some((u) => u.id === 5));
check('a missing name does not throw', filterAssignees([{ id: 9, email: 'x@t.test' }], 'x').length === 1);
check('an empty list is handled', filterAssignees([], 'anything').length === 0);

// The function must not mutate or reorder the list it was given.
const original = users.map((u) => u.id);
filterAssignees(users, 'Dhanmondi');
assert.deepEqual(users.map((u) => u.id), original);
check('the source list is left untouched', true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;