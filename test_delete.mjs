const loginRes = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dipu@populardiagnostic.com', password: '@dmin5066' })
});
const loginData = await loginRes.json();
console.log('Login:', loginRes.status);

const cookie = loginRes.headers.get('set-cookie');

// Get tasks first
const tasksRes = await fetch('http://localhost:3001/api/tasks?limit=5', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
});
const tasksData = await tasksRes.json();
console.log('Tasks:', tasksData.slice(0, 3).map(t => ({ id: t.id, title: t.title, created_by: t.created_by, is_self_task: t.is_self_task })));

// Test deleting a self-task created by another user
const selfTask = tasksData.find(t => t.is_self_task === 1 && t.created_by !== 1);
if (selfTask) {
  console.log('\nAttempting to delete self-task (created by another user):', selfTask.id);
  const delRes = await fetch(`http://localhost:3001/api/tasks/${selfTask.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
  });
  const delData = await delRes.json();
  console.log('Delete Status:', delRes.status);
  console.log('Delete Response:', delData);
}