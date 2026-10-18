import { db } from './src/db.js';

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
for (const table of tables) {
  const count = db.prepare('SELECT COUNT(*) as c FROM ' + table.name).get();
  console.log(table.name + ': ' + count.c + ' rows');
}