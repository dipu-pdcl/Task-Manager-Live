// KPI points are a fixed pool per task, split evenly across the people taking
// part in it. The caller decides who those participants are: for a task that is
// the creator plus the people currently assigned to it, so this function stays a
// plain pool splitter and takes whatever id list it is handed.
//
// Rounding: shares must sum back to the pool exactly, or a 10-point task with
// 3 participants would pay 9.99 (losing a point) or 10.02 (creating one). Any
// division that does not land cleanly hands the remainder to the first
// participants in a stable order, so the total is conserved and re-running the
// calculation cannot drift.
export function splitPoints(totalPoints, assigneeIds) {
  const total = Math.max(0, Number(totalPoints) || 0);
  const ids = [...new Set((assigneeIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    .sort((a, b) => a - b);
  const n = ids.length;
  if (!n) return { total: 0, divisor: 0, shares: {} };
  if (n === 1) return { total, divisor: 1, shares: { [ids[0]]: total } };

  // Work in hundredths so the split is exact and independent of float drift.
  // The remainder can exceed n (10 points over 6 people leaves 4 hundredths to
  // place but only 6 shares to place them in, and 10/6 rounds down to 1.66 six
  // times over), so distribute it round-robin over successive passes rather
  // than dropping it or piling it all onto the first person.
  const pool = Math.round(total * 100);
  const base = Math.floor(pool / n);
  let remainder = pool - base * n;
  const shares = {};
  const extra = {};
  ids.forEach((id, i) => {
    extra[id] = 0;
    shares[id] = (base + extra[id]) / 100;
  });
  let i = 0;
  while (remainder > 0) {
    const id = ids[i % n];
    extra[id] += 1;
    remainder -= 1;
    i += 1;
  }
  ids.forEach((id) => { shares[id] = (base + extra[id]) / 100; });
  return { total, divisor: n, shares };
}

// One person's share of a single task, and why it is what it is. Returns null
// when the person is not a participant, because taking part is what makes
// someone eligible for a share at all.
export function shareFor(totalPoints, participantIds, userId) {
  const { shares, divisor, total } = splitPoints(totalPoints, participantIds);
  const points = shares[Number(userId)];
  if (points === undefined) return null;
  return { points, divisor, taskTotal: total };
}
