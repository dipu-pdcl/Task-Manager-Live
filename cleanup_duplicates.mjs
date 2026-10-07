import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db');

// First, let's check the current duplicate situation
console.log('Checking duplicates before cleanup...');
const dupesBefore = db.prepare(`
  SELECT user_id, task_id, rule_key, COUNT(*) as cnt
  FROM kpi_transactions
  GROUP BY user_id, task_id, rule_key
  HAVING COUNT(*) > 1
`).all();
console.log(`Found ${dupesBefore.length} duplicate groups`);

// Keep the first (earliest) record for each duplicate group, delete the rest
console.log('\nCleaning up duplicates...');
const deleted = db.prepare(`
  DELETE FROM kpi_transactions
  WHERE id NOT IN (
    SELECT MIN(id)
    FROM kpi_transactions
    GROUP BY user_id, task_id, rule_key
  )
`).run();
console.log(`Deleted ${deleted.changes} duplicate rows`);

// Verify no more duplicates
const dupesAfter = db.prepare(`
  SELECT user_id, task_id, rule_key, COUNT(*) as cnt
  FROM kpi_transactions
  GROUP BY user_id, task_id, rule_key
  HAVING COUNT(*) > 1
`).all();
console.log(`Remaining duplicate groups: ${dupesAfter.length}`);

// Total rows after cleanup
const totalAfter = db.prepare('SELECT COUNT(*) as cnt FROM kpi_transactions').get();
console.log(`Total rows after cleanup: ${totalAfter.cnt}`);

// Now add unique constraint
console.log('\nAdding unique constraint...');
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_transactions_unique
    ON kpi_transactions(user_id, task_id, rule_key)
    WHERE task_id IS NOT NULL
  `);
  console.log('Unique constraint added for task_id NOT NULL');
} catch (e) {
  console.error('Error adding constraint for task_id NOT NULL:', e.message);
}

// For overdue_task (task_id IS NULL), we need a different constraint
// Since overdue penalties are per-user per-period, we should allow multiple over time
// But we should prevent duplicates for the same user/date/rule
// Let's add a partial index for task_id IS NULL with date range
try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_transactions_overdue_unique
    ON kpi_transactions(user_id, rule_key, date(created_at))
    WHERE task_id IS NULL AND rule_key = 'overdue_task'
  `);
  console.log('Unique constraint added for overdue_task');
} catch (e) {
  console.error('Error adding constraint for overdue_task:', e.message);
}

console.log('\nDone!');