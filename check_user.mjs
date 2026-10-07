import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:\\PDCL ICT Task Manager\\backend\\data\\taskflow.db', {readonly: true});
const user = db.prepare("SELECT id, email, name, role, is_active, password_hash, password_must_change FROM users WHERE lower(email) = 'dipu@populardiagnostic.com'").get();
console.log('Super admin user:', JSON.stringify(user, null, 2));