// Multi-resolution responsive audit. Drives headless Chrome over the DevTools
// Protocol using Node's built-in WebSocket (no dependencies), loads each page
// at a range of viewports, and reports horizontal overflow plus the specific
// elements responsible.
//
// Usage: node responsive-audit.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = 'http://127.0.0.1:3001';

const VIEWPORTS = [
  { name: 'iPhone SE (375x667)', w: 375, h: 667, mobile: true },
  { name: 'small phone (320x568)', w: 320, h: 568, mobile: true },
  { name: 'iPhone 14 (390x844)', w: 390, h: 844, mobile: true },
  { name: 'landscape phone (667x375)', w: 667, h: 375, mobile: true },
  { name: 'tablet portrait (768x1024)', w: 768, h: 1024, mobile: false },
  { name: 'tablet landscape (1024x768)', w: 1024, h: 768, mobile: false },
  { name: 'laptop (1366x768)', w: 1366, h: 768, mobile: false },
  { name: 'desktop (1920x1080)', w: 1920, h: 1080, mobile: false },
];

// Auth pages first: they must work with no session.
const PAGES = [
  { path: '/login', auth: false },
  { path: '/dashboard', auth: true },
  { path: '/tasks', auth: true },
  { path: '/daily-task', auth: true },
  { path: '/live-status', auth: true },
  { path: '/documents', auth: true },
  { path: '/leaves', auth: true },
  { path: '/users', auth: true },
  { path: '/teams', auth: true },
  { path: '/departments', auth: true },
  { path: '/kpi', auth: true },
  { path: '/reports', auth: true },
  { path: '/projects', auth: true },
  { path: '/priority-tasks', auth: true },
  { path: '/profile', auth: true },
  { path: '/settings', auth: true },
  { path: '/audit', auth: true },
  { path: '/chat', auth: true },
];

// Build a session cookie by signing a token the backend will accept.
const env = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('JWT_SECRET=')).split('=')[1].trim();
const d = new DatabaseSync('data/taskflow.db', { readOnly: true });
const admin = d.prepare("SELECT id,email,role,token_version FROM users WHERE role='super_admin' AND is_active=1 LIMIT 1").get();
d.close();
const token = jwt.sign({ id: admin.id, role: admin.role, email: admin.email, tv: admin.token_version || 0 }, env, { expiresIn: '2h' });

const profileDir = 'C:\\Users\\sdipu\\AppData\\Local\\Temp\\kilo\\chrome-audit';
fs.rmSync(profileDir, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--disable-extensions', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging target');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessionId = null;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  }
}

const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;

  // Two distinct defects, which must not be conflated:
  //  1. content wider than the viewport that the shell CLIPS (overflow:hidden)
  //     -> the user sees content cut off with no way to reach it
  //  2. content wider than the viewport inside a real scroller
  //     (overflow-x:auto/scroll) -> intentional, not a bug
  // The app shell itself uses overflow:hidden, so treating any hidden ancestor
  // as an excuse hides every real problem.
  const clipped = [];
  const scrolled = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const over = Math.round(r.right - vw);
    if (over <= 2) continue;
    let p = el.parentElement, inScroller = false, inHidden = false;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflow === 'auto' || ps.overflow === 'scroll') inScroller = true;
      if (ps.overflowX === 'hidden' || ps.overflow === 'hidden' || ps.overflowX === 'clip') inHidden = true;
      p = p.parentElement;
    }
    const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 64);
    const rec = { over, tag: el.tagName.toLowerCase(), cls, text: (el.textContent || '').trim().slice(0, 30) };
    if (inScroller) scrolled.push(rec); else clipped.push(rec);
  }
  clipped.sort((a, b) => b.over - a.over);

  // Does the main content column itself scroll sideways?
  const main = document.querySelector('main');
  const mainOverflow = main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0;

  return { vw, path: location.pathname, mainOverflow, clipped: clipped.slice(0, 6), scrollerCount: scrolled.length };
})()`;

(async () => {
  const wsUrl = await getTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCookie', { name: 'auth_token', value: token, domain: '127.0.0.1', path: '/' });

  let failures = 0, checks = 0;
  const report = [];

  for (const vp of VIEWPORTS) {
    // `mobile: true` makes Chrome apply the page's viewport meta, like a real
    // phone. It must NOT be combined with a deviceScaleFactor other than 1.
    // The width is verified per page after navigation (see BADSIZE below),
    // because before the first navigation the page is about:blank, which has
    // no viewport meta and always reports the 980px fallback layout width.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
    });
    for (const p of PAGES) {
      // Re-assert the session before every navigation. Each page opens an SSE
      // stream, and those accumulate until the backend drops the session and
      // the app redirects to the login route -- which silently turns the rest of
      // the run into 132 measurements of the login page.
      await cdp.send('Network.setCookie', { name: 'auth_token', value: token, domain: '127.0.0.1', path: '/' }).catch(() => {});

      // The app holds an SSE connection open (/api/notifications/stream), so
      // Page.navigate never reports "load finished". Fire it and poll for the
      // document to be ready instead of awaiting the navigation.
      cdp.send('Page.navigate', { url: BASE + p.path }).catch(() => {});
      for (let i = 0; i < 40; i++) {
        await sleep(150);
        try {
          if (await cdp.evaluate(`document.readyState !== 'loading'`)) break;
        } catch {}
      }
      await sleep(900);
      let r;
      try { r = await cdp.evaluate(PROBE); } catch (e) { report.push(`${vp.name} ${p.path}  EVAL ERROR ${e.message}`); failures++; continue; }
      checks++;
      // Guard the guard: if the emulated width is not what we asked for, every
      // other number from this run is meaningless, so fail loudly.
      if (Math.abs(r.vw - vp.w) > 2) {
        report.push(`BADSIZE ${vp.name} ${p.path}  asked for ${vp.w}px, page reports ${r.vw}px`);
        failures++;
        continue;
      }
      if (r.path !== p.path && !(p.path === '/login' && r.path === '/dashboard')) {
        report.push(`NAVFAIL ${vp.name} asked ${p.path}, landed on ${r.path}`);
        failures++;
        continue;
      }
      const bad = r.clipped || [];
      const ok = bad.length === 0;
      if (!ok) failures++;
      report.push(`${ok ? 'ok  ' : 'FAIL'} ${vp.name.padEnd(24)} ${p.path.padEnd(18)} at ${String(r.path).padEnd(16)} clipped=${bad.length}`);
      if (!ok) for (const b of bad) report.push(`        +${b.over}px <${b.tag} class="${b.cls}"> "${b.text}"`);
    }
  }

  console.log(report.join('\n'));
  console.log(`\n${checks - failures}/${checks} viewport+page combinations free of horizontal overflow`);
  ws.close();
  chrome.kill();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); chrome.kill(); process.exit(2); });