const loginRes = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dipu@populardiagnostic.com', password: '@dmin5066' })
});
const loginData = await loginRes.json();
console.log('Login:', loginRes.status);

const cookie = loginRes.headers.get('set-cookie');

// Get projects
const projectsRes = await fetch('http://localhost:3001/api/projects', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
});
const projectsData = await projectsRes.json();
console.log('Projects:', projectsData.projects?.map(p => ({ id: p.id, name: p.name, status: p.status, tasks: p.task_count, done: p.done_count })));

// Get first project stats
if (projectsData.projects?.length > 0) {
  const pid = projectsData.projects[0].id;
  const statsRes = await fetch(`http://localhost:3001/api/projects/${pid}/stats`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
  });
  const statsData = await statsRes.json();
  console.log('\nProject stats for', pid, ':', statsData);
}