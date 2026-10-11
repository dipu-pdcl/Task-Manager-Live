const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync('E:/Task Manager - TEST/backend/data/taskflow.db', { readOnly: true });
console.log('page_size:', d.prepare('PRAGMA page_size').get().page_size);
console.log('page_count:', d.prepare('PRAGMA page_count').get().page_count);
console.log('freelist_count:', d.prepare('PRAGMA freelist_count').get().freelist_count);
console.log('journal_mode:', d.prepare('PRAGMA journal_mode').get().journal_mode);
console.log('total MB:', (d.prepare('PRAGMA page_count').get().page_count * d.prepare('PRAGMA page_size').get().page_size / 1048576).toFixed(2));
console.log('free MB:', (d.prepare('PRAGMA freelist_count').get().freelist_count * d.prepare('PRAGMA page_size').get().page_size / 1048576).toFixed(2));
console.log('\ntable row counts:');
for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)) {
  try { console.log(`  ${t}: ${d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c}`); } catch {}
}
d.close();
