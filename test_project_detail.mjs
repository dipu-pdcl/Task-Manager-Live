import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/PDCL ICT Task Manager/backend/data/taskflow.db');
const id = 10;
const rows = db.prepare(`SELECT * FROM tasks WHERE project_id = ?`).all(id);
console.log(rows.map(r => ({ id: r.id, status: r.status, assignees: db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(r.id).map(x => x.user_id) })));
db.close();
