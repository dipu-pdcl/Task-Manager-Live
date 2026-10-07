# TaskFlow — Production Deployment & Setup Guide

This guide explains how to deploy TaskFlow (an enterprise task-management application) on your
own server and run it as a production system. Follow the steps in order. Every command is
intended to be run on a fresh Linux server (Ubuntu/Debian shown; adapt paths for your distro).

> **Quick start:** if you want the whole environment set up and the app started with **one
> command**, skip ahead to §0. `start.bat` (Windows) / `start.sh` (Linux) automate everything
> below. The rest of this guide documents each step manually for production hardening.

---

## 0. One-Command Setup & Start

TaskFlow ships two launcher scripts that automate dependency install, frontend build,
JWT configuration, database creation, and server startup. Run either one from the repo root
and the app is live at `http://localhost:3001` (built UI + API on a single port).

| Platform | Command | Result |
|----------|---------|--------|
| Windows | `start.bat` | Full setup + starts server; opens the browser |
| Linux / macOS | `./start.sh` | Full setup + starts server in the foreground |

Both scripts do the same things automatically:

1. **Environment check** — verifies Node.js **22.5+** (required for the built-in `node:sqlite`
   module). `start.sh` auto-installs Node 22 LTS on Debian/Ubuntu when it is missing.
2. **Dependencies** — runs `npm install` in `backend/` and `frontend/` (skipped when already
   installed; pass `--rebuild` to force).
3. **Build** — builds the frontend into `frontend/dist/` (skipped when already built).
4. **Configuration** — on first start the backend generates a persistent `JWT_SECRET`, saves it
   to `backend/.env`, and reuses it on every subsequent start (sessions survive restarts).
   No manual secret generation is required.
5. **Database** — creates `backend/data/`; the SQLite database `taskflow.db` is created and
   seeded automatically on first start.
6. **Startup** — starts the production server (`node backend/src/index.js`) on port `3001`
   (override with an argument, e.g. `start.bat 8080` or `./start.sh 8080`).

### Linux production install (systemd)

On Linux, `start.sh --systemd` additionally installs TaskFlow as a boot-starting, auto-restarting
systemd service (env file at `/etc/taskflow/taskflow.env`, unit `taskflow.service`), which is the
recommended production setup. Example:

```bash
chmod +x start.sh
sudo ./start.sh --systemd        # installs + starts the service
systemctl status taskflow --no-pager
```

> The manual steps below (app user, Nginx/Caddy reverse proxy, HTTPS, firewalls) remain the
> recommended hardening for internet-facing production deployments.

---

## 1. Architecture Overview

TaskFlow is a single-repository, two-package application:

- **Frontend** (`frontend/`): React 18 + TypeScript + Vite + Tailwind CSS 4. Built with Vite into
  static files (`frontend/dist/`).
- **Backend** (`backend/`): Node.js + Express. Serves the JSON API under `/api/*`, serves the
  built frontend as static files, and handles uploads.

In production you run **one Node.js process** on **one port**. The Express server:
1. Serves all `/api/*` requests (auth, tasks, users, teams, departments, KPI, reports, uploads, ...).
2. Serves the static files from `frontend/dist/`.
3. Falls back to `index.html` for any non-`/api` route (SPA routing).

```
Browser  -->  :443 (Nginx/Caddy, TLS)
                  |---> :3001 (Node/Express)
                            |--> SQLite DB  (backend/data/taskflow.db)
                            |--> Uploads    (backend/data/uploads/)
```

There is **no external database** — the app uses Node's built-in `node:sqlite`, so a SQLite file
is created and migrated automatically on first start. There are **no background workers or
scheduled jobs** (see §14).

---

## 2. System & Server Prerequisites

### Recommended minimum (small team)
- **CPU**: 1–2 cores
- **RAM**: 1–2 GB (Node + SQLite are lightweight)
- **Disk**: 20 GB SSD (database and uploaded files grow here)
- **OS**: Ubuntu 22.04/24.04 LTS (or any Linux), x86_64 / ARM64

### Required ports
| Port | Purpose |
|------|---------|
| `3001` | TaskFlow backend (bind to `127.0.0.1` in production) |
| `80` / `443` | Reverse proxy (Nginx or Caddy) for external access |

Only `80`/`443` need to be open to the internet. Keep `3001` bound to localhost.

### Required software
| Software | Version | Why |
|----------|---------|-----|
| Node.js | **>= 22.5.0** (use 22 LTS) | Uses the built-in `node:sqlite` module (requires Node 22.5+) |
| npm | Ships with Node | Package management |
| Nginx or Caddy | Latest | Reverse proxy + TLS termination |
| Git | Latest | Pulling the code |
| systemd | Ships with OS | Running the app as a managed service |
| (Optional) PM2 | Latest | Alternative process manager |

> Do **not** install MySQL/PostgreSQL/MongoDB — none are required.

---

## 3. Software, Runtime & Dependencies

All runtime dependencies are declared in `package.json` and installed with npm. No global
packages are required.

**Backend** (`backend/package.json`): `express`, `cors`, `jsonwebtoken`, `bcryptjs`, `multer`,
`exceljs`, `pdfkit`.

**Frontend** (`frontend/package.json`): `react`, `react-dom`, `react-router-dom`, `recharts`,
`lucide-react`, plus dev/build tooling (`vite`, `typescript`, `tailwindcss`).

### Install Node.js 22 LTS (Ubuntu/Debian)

```bash
# Install NodeSource repo for Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# Install Node.js (includes npm)
sudo apt-get install -y nodejs

# Verify versions (node must be 22.5.0 or higher)
node --version
npm --version
```

### Install the reverse proxy

```bash
# Nginx
sudo apt-get update
sudo apt-get install -y nginx
```

or, if you prefer automatic HTTPS with minimal config (recommended for simplicity):

```bash
sudo apt-get install -y caddy
```

---

## 4. Project Structure Requirements

The application expects the following layout. Deploy the whole repository; do **not** flatten
or move the `frontend`/`backend` folders relative to each other, because the backend locates the
frontend build via a relative path (`../../frontend/dist`).

```
/opt/taskflow/                     # deploy directory (example)
├── package.json                   # root scripts (install:all, build, dev, start)
├── start.bat                      # one-command launcher for Windows (see §0)
├── start.sh                       # one-command launcher for Linux/macOS (see §0)
├── README.md
├── backend/
│   ├── package.json
│   ├── .env                       # CREATED ON FIRST START (gitignored) — JWT_SECRET
│   ├── src/                       # Express application code
│   │   ├── env.js                 # loads backend/.env + generates persistent JWT_SECRET
│   │   ├── index.js               # entry point (reads PORT, JWT_SECRET)
│   │   ├── db.js                  # SQLite schema + data dir paths
│   │   ├── seed.js                # demo data (runs only on empty DB)
│   │   ├── config.js              # defaults (statuses, priorities, KPI formula)
│   │   ├── middleware.js          # JWT auth + RBAC + audit
│   │   └── routes/                # auth, tasks, users, teams, departments,
│   │                              #   kpi, reports, dashboard, settings, uploads, ...
│   └── data/                      # CREATED AT RUNTIME (gitignored)
│       ├── taskflow.db            # SQLite database
│       ├── taskflow.db-wal        # SQLite WAL files
│       ├── taskflow.db-shm
│       └── uploads/               # uploaded task files & avatars
└── frontend/
    ├── package.json
    ├── vite.config.ts             # dev server proxy (dev only)
    ├── index.html
    └── dist/                      # CREATED BY BUILD (gitignored)
        ├── index.html
        └── assets/...
```

Two directories are created **at runtime** and must be writable by the app user:
- `backend/data/` — database + uploads
- `frontend/dist/` — built by the build step

---

## 5. Environment Variable Configuration

TaskFlow reads exactly two environment variables. In addition to the systemd environment file
(see §11), the backend automatically loads a `backend/.env` file if present, and **generates a
persistent `JWT_SECRET` into it on first start** (see §0). Values already set in the process
environment (e.g. via `EnvironmentFile`) always win over the `.env` file.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | generated & persisted to `backend/.env` | Secret used to sign JWT tokens. If unset, a random secret is generated at startup and **every restart invalidates all sessions**. Set a strong fixed value. |
| `PORT` | No | `3001` | TCP port the backend listens on. |

### Generate a strong JWT secret

```bash
# Generate a 64-character random secret
openssl rand -hex 32
```

Example: `JWT_SECRET=9f3b...<generated hex>`

> Do not commit secrets. Set them in the systemd environment file (see §11) and never in the
> repository.

---

## 6. Database Setup & Migration

The database is a SQLite file managed by Node's built-in `node:sqlite` module.

- **Location**: `backend/data/taskflow.db`
- **Creation**: automatic on first start (all tables created via `CREATE TABLE IF NOT EXISTS`)
- **Migration**: the schema code applies new columns automatically (e.g. `is_self_task` uses a
  `PRAGMA table_info` guard) — **no manual migration step is required**
- **Demo data**: on a completely empty database, `seed.js` inserts sample users, teams,
  departments, tasks, comments, etc. On any database that already has users, seeding is skipped.

Because creation and migration are automatic, the only "database setup" tasks are:

1. Ensure `backend/data/` exists and is writable (it is created automatically, but verify).
2. Back up the file (see §17) — it is the single source of truth.

### Verify the database is created

```bash
# After first start, check the file exists
ls -la /opt/taskflow/backend/data/
```

Expected: `taskflow.db` (plus `-wal` / `-shm` files while running).

> The app enables `PRAGMA journal_mode = WAL` for better concurrency. The `-wal` and `-shm`
> files are normal and safe to leave in place.

---

## 7. Backend Configuration & Deployment

### 7.1 Prepare the app user (security best practice)

Run TaskFlow as an unprivileged user, not `root`.

```bash
# Create a system user for the app
sudo useradd --system --create-home --home-dir /opt/taskflow --shell /usr/sbin/nologin taskflow
```

### 7.2 Clone and install

```bash
# Put the code in place (adapt if you copy files instead)
sudo mkdir -p /opt/taskflow
sudo chown taskflow:taskflow /opt/taskflow
sudo -u taskflow git clone <your-repo-url> /opt/taskflow

# Install backend and frontend dependencies
cd /opt/taskflow
sudo -u taskflow npm run install:all
```

> `npm run install:all` runs `cd backend && npm install` then `cd ../frontend && npm install`.

### 7.3 Backend-only notes

- Backend entry point: `backend/src/index.js`.
- CORS is enabled for all origins (`app.use(cors())`). Because the frontend is served by the same
  backend in production, CORS is not needed for normal use. If you prefer stricter CORS, restrict
  it in `backend/src/index.js` before deploying.
- JSON body limit: `10mb`. Upload limits: 25 MB per task file, 5 MB per avatar.

---

## 8. Frontend Configuration & Deployment

The frontend is a standard Vite SPA. In production it is **built to static files** and served by
the Express backend — you do not need to run the Vite dev server (`npm run dev`, port 5173) in
production.

The Vite dev server configuration (`frontend/vite.config.ts`) only affects local development:
it proxies `/api` to `http://localhost:3001`. This is **not** used in production, because in
production both the UI and the API come from the same port.

### Build the frontend

```bash
cd /opt/taskflow/frontend
sudo -u taskflow npm run build
```

This runs `tsc -b && vite build` and produces `frontend/dist/`.

> You normally build once during deployment (and after every code update). The backend serves
> whatever is in `frontend/dist/` at the time the process starts, so **rebuild, then restart the
> backend** to ship a new version.

---

## 9. Build & Production Commands Reference

| Action | Command | Notes |
|--------|---------|-------|
| Install everything | `npm run install:all` | From repo root |
| Build frontend | `npm run build` (root) or `cd frontend && npm run build` | Runs `tsc -b && vite build` |
| Run production server | `node backend/src/index.js` | From repo root; serves API + static UI on `PORT` |
| Quick combined start | `npm start` | Builds frontend then starts backend (use `node backend/src/index.js` for restarts instead, to avoid rebuilding) |
| Dev (local only) | `npm run dev` | Backend :3001 + Vite :5173 with proxy |

For production restarts, run `node backend/src/index.js` directly (under systemd/PM2). Avoid
`npm start` on every restart because it re-runs the frontend build.

---

## 10. Port & Network Configuration

- Backend listens on `PORT` (default `3001`), **all interfaces** by default. In production bind it
  to localhost by setting `PORT=127.0.0.1:3001` in the environment file (Express supports
  `HOST:PORT`).
- The reverse proxy (Nginx/Caddy) listens on `80`/`443` and forwards to `127.0.0.1:3001`.
- Only `80`/`443` should be open in your firewall / cloud security group.

### Firewall (UFW example)

```bash
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP
sudo ufw allow 443/tcp       # HTTPS
sudo ufw enable
```

---

## 11. Run as a Systemd Service (Recommended)

Create a systemd unit so TaskFlow starts on boot, restarts on crash, and logs to journald.

### 11.1 Environment file

```bash
# Create the environment file
sudo mkdir -p /etc/taskflow
```

```bash
# Edit /etc/taskflow/taskflow.env
sudo tee /etc/taskflow/taskflow.env > /dev/null <<'EOF'
JWT_SECRET=<paste your generated hex secret here>
PORT=127.0.0.1:3001
EOF
```

```bash
# Only the app user may read the secret
sudo chown root:taskflow /etc/taskflow/taskflow.env
sudo chmod 640 /etc/taskflow/taskflow.env
```

### 11.2 Systemd unit

```bash
# Create the service unit
sudo tee /etc/systemd/system/taskflow.service > /dev/null <<'EOF'
[Unit]
Description=TaskFlow task management application
After=network.target

[Service]
Type=simple
User=taskflow
Group=taskflow
WorkingDirectory=/opt/taskflow
EnvironmentFile=/etc/taskflow/taskflow.env
ExecStart=/usr/bin/node /opt/taskflow/backend/src/index.js
Restart=on-failure
RestartSec=3
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/taskflow/backend/data
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
```

> `ProtectSystem=strict` makes most of the filesystem read-only. TaskFlow only needs write access
> to `backend/data/`, granted via `ReadWritePaths`. If you upload larger files than expected,
> ensure `backend/data/uploads` is writable (it is under the allowed path).

### 11.3 Start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taskflow
sudo systemctl status taskflow --no-pager
```

### 11.4 Common service commands

```bash
sudo systemctl start taskflow
sudo systemctl stop taskflow
sudo systemctl restart taskflow
sudo systemctl status taskflow
sudo journalctl -u taskflow -f      # tail live logs
sudo journalctl -u taskflow -n 100  # last 100 log lines
```

### PM2 alternative (optional)

```bash
sudo npm install -g pm2
sudo -u taskflow pm2 start /opt/taskflow/backend/src/index.js --name taskflow
sudo -u taskflow pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u taskflow --hp /opt/taskflow
```

---

## 12. Reverse Proxy & SSL Configuration

### 12.1 Option A — Nginx with Let's Encrypt

```bash
# Install certbot
sudo apt-get install -y certbot python3-certbot-nginx
```

Site config — `/etc/nginx/sites-available/taskflow`:

```nginx
server {
    listen 80;
    server_name task.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 30m;   # allow task file uploads (25 MB limit + overhead)
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/taskflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Obtain and install the TLS certificate
sudo certbot --nginx -d task.example.com
```

Certbot automatically rewrites the config for HTTPS and renews the certificate.

### 12.2 Option B — Caddy (automatic HTTPS)

```bash
# Edit Caddyfile
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
task.example.com {
    reverse_proxy 127.0.0.1:3001
}
EOF

sudo systemctl reload caddy
```

Caddy obtains and renews Let's Encrypt certificates automatically.

### 12.3 Point DNS first

Before either option will work, create an **A record** for your domain pointing to the server's
public IP, and let it propagate.

---

## 13. User Permissions & Security Configuration

### Application-level security (built-in)
- **JWT auth**: tokens last 7 days; protected by `JWT_SECRET`. Deploying without a fixed secret
  is the most common production mistake — sessions die on every restart.
- **RBAC**: three roles — `super_admin`, `admin`, `user`. Route-level guards exist across the
  API (e.g. user management requires admin, user deletion requires super admin).
- **Login rate limiting**: 10 attempts per 15 minutes per account+IP (returns 429).
- **Passwords**: bcrypt-hashed; minimum 6 characters (enforced on change).
- **Account control**: admins can deactivate users; deactivated users are rejected on auth and
  API calls.
- **Upload validation**: file type allow-list + 25 MB size limit; stored under randomized names.
- **Audit trail**: every meaningful action is recorded in `audit_logs` with actor and IP.

### Server-level hardening checklist
- Run the app as the unprivileged `taskflow` user (see §7.1).
- Keep `JWT_SECRET` in a root-only-readable environment file.
- Do not expose port 3001 to the internet; let only Nginx/Caddy reach it.
- Keep `backend/data/` and `frontend/dist/` writable only by the `taskflow` user.
- Enable automatic security updates:
  ```bash
  sudo apt-get install -y unattended-upgrades
  sudo dpkg-reconfigure --priority=low unattended-upgrades
  ```
- If you run the app without a reverse proxy on a bare port, set `NODE_ENV` is not read by the
  app; instead rely on the reverse proxy for TLS.

---

## 14. Background Services, Workers & Scheduled Jobs

There are **none**. TaskFlow has no worker processes, message queues, cron jobs, or scheduled
tasks. The only background activity is an in-process `setInterval` that prunes the login
rate-limit map, which is started automatically and needs no configuration.

A single systemd unit (or one PM2 process) is the complete deployment.

---

## 15. Application Startup & Restart Procedures

### First-time start
```bash
# Ensure data dir is writable
sudo -u taskflow mkdir -p /opt/taskflow/backend/data

sudo systemctl start taskflow
sudo journalctl -u taskflow -n 20 --no-pager
```

You should see:
```
TaskFlow backend running on http://127.0.0.1:3001
```

The `[security] JWT_SECRET is not set ...` warning and the SQLite experimental warning only
appear if `JWT_SECRET` is missing or on very old Node. With a valid `JWT_SECRET` and Node 22+,
the JWT warning should not appear.

### Deploying an update (reproducible)
```bash
cd /opt/taskflow
sudo -u taskflow git pull

# Reinstall deps only if package.json changed
sudo -u taskflow npm run install:all

# Rebuild the frontend
cd /opt/taskflow/frontend
sudo -u taskflow npm run build

# Restart the backend to serve the new build
sudo systemctl restart taskflow
```

### Verification after restart
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/            # expect 200 (SPA served)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/tasks  # expect 401 (no token)
```

---

## 16. Logging & Error Monitoring

### Where logs go
- **systemd journal**: all stdout/stderr from the Node process.
  ```bash
  sudo journalctl -u taskflow -f
  sudo journalctl -u taskflow --since "1 hour ago"
  ```
- **PM2** (if used): `pm2 logs taskflow`.

### What the app logs
- Startup banner: `TaskFlow backend running on http://...`
- Unhandled request errors: printed via `console.error(err)` in the error middleware.
- Audit events are stored **in the database** (`audit_logs` table) and are viewable in the admin
  UI under **Audit Logs**.

### Recommended monitoring setup
1. **Uptime**: add a simple cron health check (the app has no `/api/health` endpoint; check the
   login page response or `/api/auth/me`).
2. **Log rotation**: systemd journal does this automatically. For a log file instead, set
   `StandardOutput=append:/var/log/taskflow.log` in the unit and use `logrotate`.
3. **Metric/monitoring agents** (optional): Node exporter + Prometheus, or an uptime monitor
   such as UptimeRobot pinging your domain.

Example logrotate config `/etc/logrotate.d/taskflow`:
```bash
/var/log/taskflow.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
```

---

## 17. Backup & Recovery

### What to back up
| Path | Why |
|------|-----|
| `/opt/taskflow/backend/data/taskflow.db` | All application data (users, tasks, KPI, audit, settings) |
| `/opt/taskflow/backend/data/uploads/` | Uploaded task files and avatars |
| `/etc/taskflow/taskflow.env` | The JWT secret (restoring it keeps sessions valid) |
| `/etc/systemd/system/taskflow.service` | Service definition (regenerate easily, but keep anyway) |

### Safe backup procedure (SQLite)

For a **consistent** backup, use the SQLite online backup API via the `sqlite3` CLI:

```bash
# Install sqlite3 CLI if missing
sudo apt-get install -y sqlite3

# Online backup (safe while the app is running)
sudo -u taskflow sqlite3 /opt/taskflow/backend/data/taskflow.db \
  ".backup /var/backups/taskflow/taskflow-$(date +%F).db"

# Copy uploads
sudo rsync -a /opt/taskflow/backend/data/uploads/ /var/backups/taskflow/uploads/
```

> Do **not** simply `cp` the `taskflow.db` file while the app is running in WAL mode — the
> `-wal` file may contain uncommitted data. Use `.backup` (or stop the service first).

### Automate with a cron job

```bash
# /etc/cron.d/taskflow-backup
0 2 * * * root  mkdir -p /var/backups/taskflow && sudo -u taskflow sqlite3 /opt/taskflow/backend/data/taskflow.db ".backup /var/backups/taskflow/taskflow-\$(date +\%F).db" && sudo rsync -a /opt/taskflow/backend/data/uploads/ /var/backups/taskflow/uploads/
```

Keep backups on a **different machine/disk** (e.g. `rsync` to another server or object storage).

### Recovery procedure
```bash
# Stop the app
sudo systemctl stop taskflow

# Restore database and uploads
sudo -u taskflow cp /var/backups/taskflow/taskflow-<DATE>.db /opt/taskflow/backend/data/taskflow.db
sudo -u taskflow rm -f /opt/taskflow/backend/data/taskflow.db-wal /opt/taskflow/backend/data/taskflow.db-shm
sudo rsync -a /var/backups/taskflow/uploads/ /opt/taskflow/backend/data/uploads/

# Start again
sudo systemctl start taskflow
```

---

## 18. Common Deployment Issues & Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Login works, then you get logged out after a restart | `JWT_SECRET` not set (ephemeral secret) | Set `JWT_SECRET` in `/etc/taskflow/taskflow.env` and restart |
| `[security] JWT_SECRET is not set` warning at startup | Missing `JWT_SECRET` | Add it to the env file |
| `Error: near "..." syntax error` / `ERR_SQLITE_ERROR` on start | Very old Node without `node:sqlite`, or a corrupt/old DB file | Upgrade to Node >= 22.5; if DB is corrupt, restore from backup |
| `ExperimentalWarning: SQLite is an experimental feature` | Expected on Node 22 | No action needed |
| 502 Bad Gateway from Nginx | Backend not running or bound wrong | Check `systemctl status taskflow`; confirm `proxy_pass` target matches `PORT` (e.g. `127.0.0.1:3001`) |
| Blank page / UI served but API calls fail | Served stale `frontend/dist` or wrong reverse proxy path | Rebuild frontend, restart backend; verify `/api/*` reaches the backend |
| File upload fails with "File is too large" | Nginx `client_max_body_size` below 25 MB | Set `client_max_body_size 30m;` and reload Nginx |
| Login returns `429 Too many login attempts` | Rate limiter tripped | Wait 15 minutes; if behind a proxy ensure `X-Forwarded-For` is set so IPs are correct |
| `EACCES` / permission errors writing DB or uploads | `backend/data` owned by wrong user | `sudo chown -R taskflow:taskflow /opt/taskflow/backend/data` |
| Changed UI but browser still shows old version | Browser cache / old build | Hard refresh; rebuild `frontend/dist`; restart backend |
| Port already in use on start | Another instance running | `sudo systemctl stop taskflow`; check `ss -ltnp | grep 3001` |
| Session invalidated immediately | JWT secret changed between restarts | Keep `JWT_SECRET` constant across restarts |

---

## 19. Verifying the Application Is Running Correctly

### 19.1 Server-side checks
```bash
# Service is active
sudo systemctl is-active taskflow

# HTTP responds on the backend port
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/

# Through the domain (after SSL is set up)
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://task.example.com/
```

### 19.2 API check
```bash
# Login and capture a token
TOKEN=$(curl -s -X POST http://127.0.0.1:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@taskflow.io","password":"Taskflow@2026"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

# Verify authenticated access works
curl -s http://127.0.0.1:3001/api/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected: a JSON object with the logged-in user (`id`, `name`, `email`, `role`).

### 19.3 Browser checks
1. Open `https://task.example.com/` — the login page should load.
2. Sign in with `admin@taskflow.io` / `Taskflow@2026` (demo seed admin). **Change this password
   immediately in production** (Profile → Change password).
3. Confirm:
   - Dashboard renders charts and summary cards.
   - Tasks page lists tasks (demo seed creates 20).
   - Admin pages load: Users, Teams, Departments, KPI, Reports, Audit Logs, Settings.
   - A regular user account can log in and only sees their own data.
4. Open the browser developer console — there should be **no** errors, and no `401`/`Failed to
   fetch` API calls.

### 19.4 Verify uploads & exports (optional smoke tests)
- Attach a file to a task — the file should appear and be downloadable.
- Export a task list as CSV from the Reports page.

### 19.5 Final security checklist
- [ ] `JWT_SECRET` is set and stable.
- [ ] Port `3001` is not exposed publicly.
- [ ] `task.example.com` serves the app over HTTPS with a valid certificate.
- [ ] App runs as the unprivileged `taskflow` user.
- [ ] Demo admin password changed.
- [ ] Daily backups verified once by restoring into a scratch directory.

---

## Appendix A — Full Fresh-Install Quick Reference

```bash
# 1. Install Node 22 + Nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# 2. Create app user + deploy code
sudo useradd --system --create-home --home-dir /opt/taskflow --shell /usr/sbin/nologin taskflow
sudo mkdir -p /opt/taskflow
sudo chown taskflow:taskflow /opt/taskflow
sudo -u taskflow git clone <your-repo-url> /opt/taskflow

# 3. Install dependencies and build
cd /opt/taskflow
sudo -u taskflow npm run install:all
cd /opt/taskflow/frontend
sudo -u taskflow npm run build

# 4. Environment + service
sudo mkdir -p /etc/taskflow
printf 'JWT_SECRET=%s\nPORT=127.0.0.1:3001\n' "$(openssl rand -hex 32)" | sudo tee /etc/taskflow/taskflow.env
sudo chown root:taskflow /etc/taskflow/taskflow.env
sudo chmod 640 /etc/taskflow/taskflow.env
sudo tee /etc/systemd/system/taskflow.service > /dev/null <<'EOF'
[Unit]
Description=TaskFlow task management application
After=network.target

[Service]
Type=simple
User=taskflow
Group=taskflow
WorkingDirectory=/opt/taskflow
EnvironmentFile=/etc/taskflow/taskflow.env
ExecStart=/usr/bin/node /opt/taskflow/backend/src/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/taskflow/backend/data
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now taskflow

# 5. Nginx reverse proxy
sudo tee /etc/nginx/sites-available/taskflow > /dev/null <<'EOF'
server {
    listen 80;
    server_name task.example.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 30m;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/taskflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. HTTPS (optional but recommended)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d task.example.com

# 7. Verify
sudo systemctl status taskflow --no-pager
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://task.example.com/
```

---

## Appendix B — Data & Secret Locations Summary

| Item | Location |
|------|----------|
| SQLite database | `/opt/taskflow/backend/data/taskflow.db` |
| Uploaded files | `/opt/taskflow/backend/data/uploads/` |
| JWT secret | `/etc/taskflow/taskflow.env` (`JWT_SECRET=...`) |
| Service unit | `/etc/systemd/system/taskflow.service` |
| Reverse proxy config | `/etc/nginx/sites-available/taskflow` or `/etc/caddy/Caddyfile` |
| Logs | `journalctl -u taskflow` |
| Backups | `/var/backups/taskflow/` (your configured location) |
