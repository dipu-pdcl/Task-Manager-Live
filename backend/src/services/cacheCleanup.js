import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, DB_PATH } from '../db.js';
import { resetSettingsCache } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SAFETY_BACKUP_RETENTION = 5;

const isDevMode = process.env.NODE_ENV !== 'production';

const CACHE_DIRS = isDevMode
  ? [
      path.join(PROJECT_ROOT, 'node_modules', '.cache'),
    ]
  : [
      path.join(PROJECT_ROOT, 'frontend', 'node_modules', '.vite'),
      path.join(PROJECT_ROOT, 'frontend', 'node_modules', '.esbuild'),
      path.join(PROJECT_ROOT, 'frontend', '.vite-cache'),
      path.join(PROJECT_ROOT, 'node_modules', '.cache'),
    ];

const TEMP_FILE_PATTERNS = [
  /^snapshot-\d+-\d+\.db$/,
  /^validate-\d+-\d+\.db$/,
];

const SAFETY_BACKUP_KEEP = [
  /^safety-pre-restore-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.pdcl-ict$/,
  /^safety-pre-restore-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.taskflow$/,
];

const PROTECTED_FILES = new Set([
  path.basename(DB_PATH),
  path.basename(DB_PATH) + '-wal',
  path.basename(DB_PATH) + '-shm',
]);

let lastRun = 0;
let isRunning = false;

function safeRemoveFile(filePath, label = 'file') {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { removed: false, size: 0, reason: 'not a file' };
    fs.unlinkSync(filePath);
    return { removed: true, size: stat.size, reason: 'removed' };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[CacheCleanup] Failed to remove ${label} ${filePath}:`, err.message);
    }
    return { removed: false, size: 0, reason: err.code === 'ENOENT' ? 'not found' : err.message };
  }
}

function safeRemoveDir(dirPath, label = 'directory') {
  try {
    if (!fs.existsSync(dirPath)) return { removed: false, size: 0, reason: 'not found' };
    let totalSize = 0;
    const collect = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(fp);
        else {
          try { totalSize += fs.statSync(fp).size; } catch {}
        }
      }
    };
    collect(dirPath);
    fs.rmSync(dirPath, { recursive: true, force: true });
    return { removed: true, size: totalSize, reason: 'removed' };
  } catch (err) {
    console.error(`[CacheCleanup] Failed to remove ${label} ${dirPath}:`, err.message);
    return { removed: false, size: 0, reason: err.message };
  }
}

function isProtectedFile(filename) {
  return PROTECTED_FILES.has(filename);
}

export function cleanupCache() {
  if (isRunning) {
    return { skipped: true, reason: 'already running' };
  }
  isRunning = true;
  const result = {
    cleanedDirs: [],
    cleanedTempFiles: [],
    cleanedSafetyBackups: [],
    cacheReset: false,
    errors: [],
    totalBytesFreed: 0,
  };

  const now = Date.now();

  try {
    if (DATA_DIR && fs.existsSync(DATA_DIR)) {
      const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (isProtectedFile(entry.name)) continue;

        if (TEMP_FILE_PATTERNS.some((re) => re.test(entry.name))) {
          const fp = path.join(DATA_DIR, entry.name);
          const r = safeRemoveFile(fp, 'temp file');
          result.cleanedTempFiles.push({ name: entry.name, ...r });
          if (r.removed) result.totalBytesFreed += r.size;
        }
      }
    }
  } catch (err) {
    result.errors.push(`DATA_DIR cleanup: ${err.message}`);
    console.error('[CacheCleanup] Error cleaning DATA_DIR temp files:', err);
  }

  for (const dir of CACHE_DIRS) {
    try {
      if (fs.existsSync(dir)) {
        const r = safeRemoveDir(dir, 'cache dir');
        result.cleanedDirs.push({ path: dir, removed: r.removed, size: r.size });
        if (r.removed) result.totalBytesFreed += r.size;
      }
    } catch (err) {
      result.errors.push(`Cache dir ${dir}: ${err.message}`);
    }
  }

  try {
    const backupDir = path.join(DATA_DIR, 'safety-backups');
    if (backupDir && fs.existsSync(backupDir)) {
      const entries = fs.readdirSync(backupDir, { withFileTypes: true });
      const backups = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (isProtectedFile(entry.name)) continue;
        const isSafety = SAFETY_BACKUP_KEEP.some((re) => re.test(entry.name));
        if (!isSafety) continue;
        const fp = path.join(backupDir, entry.name);
        const stat = fs.statSync(fp);
        const age = now - stat.mtime.getTime();
        backups.push({ name: entry.name, path: fp, age, size: stat.size });
      }

      backups.sort((a, b) => a.age - b.age);

      if (backups.length > SAFETY_BACKUP_RETENTION) {
        for (let i = backups.length - 1; i >= SAFETY_BACKUP_RETENTION; i--) {
          const b = backups[i];
          const r = safeRemoveFile(b.path, 'safety backup');
          if (r.removed) {
            result.cleanedSafetyBackups.push({ name: b.name, size: r.size, reason: 'safety backup retention limit reached' });
            result.totalBytesFreed += r.size;
          }
        }
      }

      const cutoff = ONE_DAY_MS * 7;
      for (const b of backups) {
        if (b.age > cutoff) {
          const r = safeRemoveFile(b.path, 'safety backup');
          if (r.removed) {
            result.cleanedSafetyBackups.push({ name: b.name, size: r.size, reason: 'older than 7 days' });
            result.totalBytesFreed += r.size;
          }
        }
      }
    }
  } catch (err) {
    result.errors.push(`Safety backup cleanup: ${err.message}`);
    console.error('[CacheCleanup] Error cleaning safety backups:', err);
  }

  try {
    resetSettingsCache();
    result.cacheReset = true;
  } catch (err) {
    result.errors.push(`Settings cache reset: ${err.message}`);
  }

  lastRun = now;
  isRunning = false;

  const freedKB = (result.totalBytesFreed / 1024).toFixed(0);
  console.log(`[CacheCleanup] Completed. Freed ${freedKB} KB. Temp files: ${result.cleanedTempFiles.length}, Cache dirs: ${result.cleanedDirs.filter((d) => d.removed).length}, Safety backups removed: ${result.cleanedSafetyBackups.length}, Errors: ${result.errors.length}`);

  return result;
}

export function getLastRunTime() {
  return lastRun;
}

let intervalId = null;

export function startCacheCleanup(intervalHours = 24) {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(() => {
    try { cleanupCache(); } catch (err) { console.error('[CacheCleanup] Unexpected error:', err); }
  }, intervalHours * 60 * 60 * 1000);
}

export function stopCacheCleanup() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

export default { cleanupCache, startCacheCleanup, stopCacheCleanup, getLastRunTime };
