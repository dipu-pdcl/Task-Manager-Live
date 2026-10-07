import { splitPoints, shareFor } from '../src/services/kpiPoints.js';

let pass = 0, fail = 0;
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); c ? pass++ : fail++; };
const round2 = (n) => Math.round(n * 100) / 100;

console.log('--- 1. the documented example: 10 points, 2 assignees ---');
let r = splitPoints(10, [1, 2]);
check('each gets 5', r.shares[1] === 5 && r.shares[2] === 5, JSON.stringify(r.shares));
check('divisor is 2', r.divisor === 2);
check('sums back to the pool', round2(Object.values(r.shares).reduce((a, b) => a + b, 0)) === 10,
  `${Object.values(r.shares).reduce((a, b) => a + b, 0)}`);

console.log('\n--- 2. uneven split conserves the pool exactly ---');
for (const [total, n] of [[10, 3], [10, 4], [10, 6], [10, 7], [10, 9], [3, 7], [1, 3], [5, 8], [100, 3], [7, 7]]) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const s = splitPoints(total, ids);
  const sum = round2(Object.values(s.shares).reduce((a, b) => a + b, 0));
  check(`${total} pts / ${n} people sums to exactly ${total}`, sum === total,
    `got ${sum} via ${JSON.stringify(Object.values(s.shares))}`);
  const shares = Object.values(s.shares);
  check(`${total}/${n} shares differ by at most 0.01`,
    Math.max(...shares) - Math.min(...shares) <= 0.0101,
    `min ${Math.min(...shares)} max ${Math.max(...shares)}`);
}

console.log('\n--- 3. 10 / 3 = 3.33 as specified ---');
r = splitPoints(10, [1, 2, 3]);
check('shares are 3.34/3.33/3.33 and total 10.00',
  round2(r.shares[1] + r.shares[2] + r.shares[3]) === 10,
  JSON.stringify(r.shares));
check('no one is shortchanged by more than a hundredth',
  Math.min(...Object.values(r.shares)) >= 3.33 && Math.max(...Object.values(r.shares)) <= 3.34);

console.log('\n--- 4. eligibility is by assignment, not by being the creator ---');
check('a non-assignee gets null even if given the id', shareFor(10, [1, 2], 99) === null);
check('an assignee gets a share', shareFor(10, [1, 2], 2).points === 5);
check('the creator is treated identically to anyone else',
  shareFor(10, [7, 8], 7).points === shareFor(10, [7, 8], 8).points);

console.log('\n--- 5. duplicate ids are collapsed, not double-counted ---');
r = splitPoints(10, [1, 1, 2, 2]);
check('repeated ids collapse to the unique set', r.divisor === 2, `divisor ${r.divisor}`);
check('still sums to 10', round2(r.shares[1] + r.shares[2]) === 10);

console.log('\n--- 6. ordering must not change who gets the extra cent ---');
const a = splitPoints(10, [3, 1, 2]);
const b = splitPoints(10, [1, 2, 3]);
check('share per person is independent of assignee ordering',
  a.shares[1] === b.shares[1] && a.shares[2] === b.shares[2] && a.shares[3] === b.shares[3],
  `${JSON.stringify(a.shares)} vs ${JSON.stringify(b.shares)}`);
const again = splitPoints(10, [2, 3, 1]);
check('recalculating gives an identical result (no drift)',
  JSON.stringify(again.shares) === JSON.stringify(a.shares));

console.log('\n--- 7. degenerate input ---');
check('no assignees pays nobody', JSON.stringify(splitPoints(10, []).shares) === '{}');
check('a null assignee list pays nobody', splitPoints(10, null).divisor === 0);
check('zero total is safe', splitPoints(0, [1, 2, 3]).shares[1] === 0);
check('a negative total is clamped to zero', splitPoints(-5, [1, 2]).total === 0);
check('garbage ids are ignored', splitPoints(10, [null, undefined, NaN, 'x', 1]).divisor === 1);

console.log('\n--- 8. transfer re-bases everyone, conserving the pool ---');
const before = splitPoints(10, [1, 2]);
const after = splitPoints(10, [1]);
check('before transfer each had 5', before.shares[1] === 5 && before.shares[2] === 5);
check('after transfer the remaining person has the whole 10', after.shares[1] === 10);
check('the removed person is no longer eligible', shareFor(10, [1], 2) === null);

console.log('\n--- 9. conservation across every realistic pool/assignee combination ---');
{
  let bad = 0, worst = 0, cases = 0;
  for (let total = 0; total <= 200; total++) {
    for (let n = 1; n <= 25; n++) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const s = splitPoints(total, ids);
      const sum = round2(Object.values(s.shares).reduce((a, b) => a + b, 0));
      cases += 1;
      if (sum !== total) { bad += 1; if (bad <= 3) console.log(`   mismatch ${total}/${n} -> ${sum}`); }
      const vals = Object.values(s.shares);
      worst = Math.max(worst, Math.max(...vals) - Math.min(...vals));
    }
  }
  check(`pool conserved for all ${cases} pool/assignee combinations`, bad === 0, `${bad} mismatches`);
  check('no share differs from another by more than 0.01 anywhere', worst <= 0.0101, `worst spread ${worst}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);