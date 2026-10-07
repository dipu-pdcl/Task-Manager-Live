import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db', {readonly: true});
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='kpi_transactions'").get();
console.log(schema.sql);

// Check indexes
const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='kpi_transactions'").all();
for (const idx of indexes) {
  console.log(idx.sql);
}

// Check for duplicate transactions
const dupes = db.prepare(`
  SELECT user_id, task_id, rule_key, COUNT(*) as cnt
  FROM kpi_transactions
  GROUP BY user_id, task_id, rule_key
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 20
`).all();
console.log('\nDuplicates:', dupes.length);
for (const d of dupes) {
  console.log(`  user=${d.user_id}, task=${d.task_id}, rule=${d.rule_key}: ${d.cnt} times`);
}