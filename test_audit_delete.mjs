const loginRes = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dipu@populardiagnostic.com', password: '@dmin5066' })
});
const loginData = await loginRes.json();
console.log('Login:', loginRes.status);

if (loginRes.status !== 200) {
  process.exit(1);
}

const cookie = loginRes.headers.get('set-cookie');

// Get audit logs
await new Promise(r => setTimeout(r, 1000));
const auditRes = await fetch('http://localhost:3001/api/audit?limit=5', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
});
const auditData = await auditRes.json();
console.log('Audit Status:', auditRes.status);
console.log('Audit logs:', Array.isArray(auditData) ? auditData.slice(0, 3).map(a => ({ id: a.id, action: a.action, user_name: a.user_name })) : auditData);

if (Array.isArray(auditData) && auditData.length > 0) {
  const logId = auditData[0].id;
  console.log('\nAttempting to delete audit log:', logId);
  
  await new Promise(r => setTimeout(r, 1000));
  const delRes = await fetch(`http://localhost:3001/api/audit/${logId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
  });
  const delData = await delRes.json();
  console.log('Delete Status:', delRes.status);
  console.log('Delete Response:', delData);
}