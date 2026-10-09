const loginRes = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dipu@populardiagnostic.com', password: '@dmin5066' })
});
const loginData = await loginRes.json();
console.log('Login:', loginRes.status);

const cookie = loginRes.headers.get('set-cookie');

const dashRes = await fetch('http://localhost:3001/api/dashboard?dateKey=30d', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie }
});
const dashData = await dashRes.json();
console.log('Dashboard Status:', dashRes.status);
console.log('Dashboard keys:', Object.keys(dashData));