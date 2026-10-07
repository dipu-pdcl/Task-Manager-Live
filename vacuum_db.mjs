import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db');

// Run WAL checkpoint and VACUUM to reclaim space
console.log('Running WAL checkpoint...');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

console.log('Running VACUUM...');
db.exec('VACUUM;');

console.log('Done!');

// Check size again
const pageCount = db.prepare('PRAGMA page_count').get();
const pageSize = db.prepare('PRAGMA page_size').get();
console.log(`\nPage count: ${pageCount.page_count}`);
console.log(`Page size: ${pageSize.page_size} bytes`);
console.log(`Database size: ${(pageCount.page_count * pageSize.page_size / 1024 / 1024).toFixed(2)} MB`);