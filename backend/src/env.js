process.env.TZ = process.env.TZ || 'Asia/Dhaka';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function loadEnv() {
  const lines = [];
  if (fs.existsSync(ENV_PATH)) {
    const text = fs.readFileSync(ENV_PATH, 'utf8');
    lines.push(...text.split(/\r?\n/));
    const parsed = parseEnv(text);
    for (const [k, v] of Object.entries(parsed)) {
      if (!(k in process.env)) process.env[k] = v;
    }
  }

  if (!process.env.JWT_SECRET) {
    const secret = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = secret;
    const alreadySet = lines.some((l) => l.trim().startsWith('JWT_SECRET='));
    if (!alreadySet) {
      if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
      lines.push(`# Generated automatically on first start. Keep this file secret and back it up.`);
      lines.push(`JWT_SECRET=${secret}`);
      try { fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n'); } catch { /* best effort */ }
    }
  }
}

loadEnv();
