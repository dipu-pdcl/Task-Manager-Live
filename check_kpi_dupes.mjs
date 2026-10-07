import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db', {readonly: true});

// Check transaction dates for one of the duplicated tasks
const taskId = 211;
const trans = db.prepare(`
  SELECT created_at, COUNT(*) as cnt
  FROM kpi_transactions
  WHERE task_id = ? AND rule_key = 'self_task'
  GROUP BY created_at
  ORDER BY created_at
`).all(taskId);
console.log(`Transaction dates for task ${taskId}:`);
for (const t of trans) {
  console.log(`  ${t.created_at}: ${t.cnt} records`);
}

// Total count per rule_key
const ruleCounts = db.prepare(`
  SELECT rule_key, COUNT(*) as cnt
  FROM kpi_transactions
  GROUP BY rule_key
  ORDER BY cnt DESC
`).all();
console.log('\nTransactions per rule:');
for (const r of ruleCounts) {
  console.log(`  ${r.rule_key}: ${r.cnt}`);
}

// Check unique user/task/rule combinations vs total rows
const uniqueCombo = db.prepare(`
  SELECT COUNT(*) as cnt FROM (
    SELECT DISTINCT user_id, task_id, rule_key FROM kpi_transactions
  )
`).get();
const totalRows = db.prepare('SELECT COUNT(*) as cnt FROM kpi_transactions').get();
console.log(`\nUnique user/task/rule combos: ${uniqueCombo.cnt}`);
console.log(`Total rows: ${totalRows.cnt}`);
console.log(`Duplicate rows: ${totalRows.cnt - uniqueCombo.cnt}`);