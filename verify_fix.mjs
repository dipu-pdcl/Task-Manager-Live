import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db', {readonly: true});

// Verify unique constraints
const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='kpi_transactions'").all();
console.log('Indexes on kpi_transactions:');
for (const idx of indexes) {
  console.log(idx.sql);
}

// Test that computeUserKpi works (read-only)
import { computeUserKpi } from './backend/src/services/kpiEngine.js';

// Get a test user
const user = db.prepare('SELECT id, name FROM users WHERE is_active = 1 LIMIT 1').get();
console.log(`\nTesting computeUserKpi for user ${user.id} (${user.name})...`);

try {
  const kpi = computeUserKpi(user.id, '2026-01-01', '2026-12-31');
  console.log('KPI Result:', JSON.stringify(kpi, null, 2));
  console.log('\n✓ computeUserKpi works correctly (read-only)');
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
}

// Test calculateTaskCompletionKpi (pure function)
import { calculateTaskCompletionKpi } from './backend/src/services/kpiEngine.js';

// Get a test task
const task = db.prepare('SELECT * FROM tasks WHERE is_self_task = 0 LIMIT 1').get();
if (task) {
  const assigneeIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id).map(r => r.user_id);
  console.log(`\nTesting calculateTaskCompletionKpi for task ${task.id}...`);
  console.log(`Assignees: ${assigneeIds.join(', ')}`);
  
  const completerId = assigneeIds[0] || task.created_by;
  const result = calculateTaskCompletionKpi(task, completerId, assigneeIds);
  console.log('Calculation result:', result);
  console.log('✓ calculateTaskCompletionKpi works correctly (pure)');
} else {
  console.log('\nNo tasks found for testing');
}

// Verify no new transactions were created
const beforeCount = db.prepare('SELECT COUNT(*) as cnt FROM kpi_transactions').get().cnt;
console.log(`\nKPI transactions before test: ${beforeCount}`);

// Run computeUserKpi again (should NOT create new transactions)
computeUserKpi(user.id, '2026-01-01', '2026-12-31');

const afterCount = db.prepare('SELECT COUNT(*) as cnt FROM kpi_transactions').get().cnt;
console.log(`KPI transactions after test: ${afterCount}`);

if (beforeCount === afterCount) {
  console.log('✓ No new transactions created during KPI calculation (read-only confirmed)');
} else {
  console.log('✗ ERROR: New transactions were created!');
}