const loginRes = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dipu@populardiagnostic.com', password: '@dmin5066' })
});
const loginData = await loginRes.json();
console.log('Login:', loginRes.status);

const cookie = loginRes.headers.get('set-cookie');
console.log('Cookie:', cookie);

const kpiRes = await fetch('http://localhost:3001/api/kpi/me', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
});
const kpiData = await kpiRes.json();
console.log('KPI Status:', kpiRes.status);
console.log('KPI Response:', JSON.stringify(kpiData, null, 2));