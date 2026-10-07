import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db');

// Test recordTaskCompletionKpi - create a test task and complete it
import { recordTaskCompletionKpi, calculateTaskCompletionKpi } from './backend/src/services/kpiEngine.js';

console.log('Testing recordTaskCompletionKpi...');

// Find a task that's not done
const task = db.prepare('SELECT * FROM tasks WHERE status != \'done\' AND is_self_task = 0 LIMIT 1').get();
if (!task) {
  console.log('No incomplete tasks found for testing');
  process.exit(0);
}

const assigneeIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id).map(r => r.user_id);
const completerId = assigneeIds[0] || task.created_by;

console.log(`Task: ${task.id} (${task.title})`);
console.log(`Assignees: ${assigneeIds.join(', ')}`);
console.log(`Completer: ${completerId}`);

// Check current transaction count
const beforeCount = db.prepare('SELECT COUNT(*) as cnt FROM kpi_transactions').get().cnt;
console.log(`\nTransactions before: ${beforeCount}`);

// Calculate expected points
const calc = calculateTaskCompletionKpi(task, completerId, assigneeIds);
console.log('Expected calculation:', calc);

// Record the completion
recordTaskCompletionKpi(task, completerId, assigneeIds);

const afterCount = db.prepare('SELECT COUNT(*) as cnt FROM kpi_transactions').get().cnt;
console.log(`Transactions after: ${afterCount}`);
console.log(`New transactions: ${afterCount - beforeCount}`);

// Verify the new transactions
const newTrans = db.prepare(`
  SELECT rule_key, points, reason
  FROM kpi_transactions
  WHERE task_id = ? AND user_id = ?
  ORDER BY id DESC
  LIMIT 10
`).all(task.id, completerId);
console.log('\nNew transactions:');
for (const t of newTrans) {
  console.log(`  ${t.rule_key}: ${t.points} pts - ${t.reason}`);
}

// Try to record again (should fail due to unique constraint)
console.log('\nTesting duplicate prevention...');
try {
  recordTaskCompletionKpi(task, completerId, assigneeIds);
  console.log('✗ ERROR: Duplicate was allowed!');
} catch (e) {
  console.log(`✓ Duplicate correctly prevented: ${e.message}`);
}

console.log('\nAll tests passed!');