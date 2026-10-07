import './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.js';
import { ensureSchema } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import teamRoutes from './routes/teams.js';
import deptRoutes from './routes/departments.js';
import taskRoutes from './routes/tasks.js';
import notifRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import dataResetRoutes from './routes/dataReset.js';
import settingsRoutes from './routes/settings.js';
import kpiRoutes from './routes/kpi.js';
import kpiConfigRoutes from './routes/kpiConfig.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import uploadRoutes from './routes/uploads.js';
import backupRoutes from './routes/backup.js';
import priorityTaskRoutes from './routes/priorityTasks.js';
import leaveRoutes from './routes/leaves.js';
import liveStatusRoutes from './routes/liveStatus.js';
import chatRoutes from './routes/chat.js';
import projectRoutes, { updateProjectProgressForTask } from './routes/projects.js';
import documentRoutes from './routes/documents.js';
import { startBackgroundIndexer } from './services/documentIndexer.js';
import { startCacheCleanup } from './services/cacheCleanup.js';
import dailyTaskRoutes from './routes/dailyTasks.js';
import { startDailyTaskService } from './services/dailyTaskService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await ensureSchema();
await seed();

const app = express();
app.use(cookieParser());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? (process.env.CORS_ORIGIN.includes(',') ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : process.env.CORS_ORIGIN)
    : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/172\.16\.\d+\.\d+(:\d+)?$/, /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/],
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderError: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
// Scoped to /api only. Applying this globally also throttled static asset and
// SPA route requests, so normal frontend traffic could exhaust the window and
// lock users out of the whole app with 429s. Brute-force login protection is
// handled separately by authLimiter below.
app.use('/api', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
  skipSuccessfulRequests: true,
});
app.use('/api/auth', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/departments', deptRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/priority-tasks', priorityTaskRoutes);
app.use('/api/live-status', liveStatusRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/data-reset', dataResetRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/kpi', kpiConfigRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', backupRoutes);
app.use('/api/chat', chatRoutes); // Added chat routes
app.use('/api/projects', projectRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/daily-task', dailyTaskRoutes);

const frontendDir = path.join(__dirname, '..', '..', 'frontend');
const distDir = path.join(frontendDir, 'dist');
const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
const isDev = process.env.NODE_ENV !== 'production';

if (hasDist && !isDev) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  try {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, host: '0.0.0.0', allowedHosts: true },
      root: frontendDir,
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } catch (err) {
    if (hasDist) {
      console.log('Vite middleware unavailable, serving pre-built frontend from dist.');
      app.use(express.static(distDir));
      app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
    } else {
      console.error('Frontend dist not found and Vite middleware unavailable:', err);
    }
  }
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed' });
  }
  console.error('[ERROR]', err?.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDCL ICT running on http://0.0.0.0:${PORT}`);
  startBackgroundIndexer(10);
  startCacheCleanup(24);
  startDailyTaskService(15);
});
