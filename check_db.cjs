const Database = require('better-sqlite3');
const db = new Database('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db', {readonly: true});

// Get all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// Get row counts for each table
for (const t of tables) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
    console.log(`${t.name}: ${count.cnt} rows`);
  } catch (e) {
    console.log(`${t.name}: ERROR - ${e.message}`);
  }
}

// Check page count and size
const pageCount = db.prepare('PRAGMA page_count').get();
const pageSize = db.prepare('PRAGMA page_size').get();
console.log(`\nPage count: ${pageCount.page_count}`);
console.log(`Page size: ${pageSize.page_size} bytes`);
console.log(`Database size: ${(pageCount.page_count * pageSize.page_size / 1024 / 1024).toFixed(2)} MB`);

// Check for large tables by estimating size
console.log('\n--- Table size estimation ---');
for (const t of tables) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get().cnt;
    if (count > 0) {
      // Get first row to estimate row size
      const row = db.prepare(`SELECT * FROM "${t.name}" LIMIT 1`).get();
      if (row) {
        const rowSize = JSON.stringify(row).length;
        const estSize = (count * rowSize) / 1024 / 1024;
        console.log(`${t.name}: ${count} rows, ~${estSize.toFixed(2)} MB (est)`);
      }
    }
  } catch (e) {
    // ignore
  }
}