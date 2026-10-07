#!/usr/bin/env bash
#
# TaskFlow one-click launcher (Linux / macOS)
#
# Automates the deployment steps documented in DEPLOYMENT.md:
#   1. Verifies Node.js 22.5+ (required for node:sqlite); installs Node 22
#      automatically on Debian/Ubuntu when missing
#   2. Installs backend + frontend dependencies (npm)
#   3. Builds the frontend into frontend/dist
#   4. Creates backend/.env with a persistent JWT_SECRET
#      (generated once, kept stable across restarts)
#   5. Creates the SQLite data directory (DB created on first start)
#   6. Starts the production server on http://localhost:3001
#      (serves the built UI and the /api backend on one port)
#
# Usage:
#   ./start.sh                 use default port 3001
#   ./start.sh 8080            use a custom port
#   ./start.sh --rebuild       force dependency reinstall + frontend rebuild
#   ./start.sh --systemd       (Linux) also install + enable a systemd service
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=3001
FORCE=0
SYSTEMD=0

for arg in "$@"; do
  case "$arg" in
    --rebuild|--force) FORCE=1 ;;
    --systemd) SYSTEMD=1 ;;
    *)
      if [[ "$arg" =~ ^[0-9]+$ ]]; then PORT="$arg"; fi
      ;;
  esac
done

say()  { printf '\n  [%s] %s\n' "$1" "$2"; }
info() { say "i" "$1"; }
ok()   { say "ok" "$1"; }
die()  { printf '\n  [ERROR] %s\n' "$1" >&2; exit 1; }

echo
echo "  ================================================"
echo "    TaskFlow  -  One-Click Setup & Start"
echo "    Port: $PORT"
echo "  ================================================"

# ---- 1. Node.js: detect, report version, install if missing ----
if ! command -v node >/dev/null 2>&1; then
  info "Node.js not found. Installing Node.js 22 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      die "curl is required to install Node.js. Install Node.js 22.5+ manually, then re-run."
    fi
  else
    die "Node.js not found. Install Node.js 22.5+ manually (https://nodejs.org/), then re-run."
  fi
fi

NODE_VERSION="$(node --version)"
if ! node -e "const [m,n]=process.versions.node.split('.').map(Number);process.exit(m<22||(m===22&&n<5)?1:0)"; then
  die "Node.js 22.5 or newer is required. Found $NODE_VERSION. Please upgrade from https://nodejs.org/ (22 LTS)."
fi
ok "Node.js $NODE_VERSION"

# ---- 2. Install dependencies ----
if [[ (-d "$APP_DIR/node_modules" || (-d "$APP_DIR/backend/node_modules" && -d "$APP_DIR/frontend/node_modules")) && "$FORCE" != 1 ]]; then
  info "Dependencies already installed (skip; pass --rebuild to force)"
else
  info "Installing dependencies..."
  if (cd "$APP_DIR" && npm install --no-audit --no-fund); then
    ok "Dependencies installed via workspace"
  else
    info "Falling back to installing backend and frontend separately..."
    (cd "$APP_DIR/backend" && npm install --no-audit --no-fund)
    (cd "$APP_DIR/frontend" && npm install --no-audit --no-fund)
  fi
fi

# ---- 3. Build the frontend ----
if [[ -d "$APP_DIR/frontend/dist" && "$FORCE" != 1 ]]; then
  info "Frontend build already present (skip; pass --rebuild to force)"
else
  info "Building frontend..."
  if (cd "$APP_DIR/frontend" && npm run build); then
    ok "Frontend built successfully"
  else
    info "Retrying frontend build from workspace root..."
    (cd "$APP_DIR" && npm run build) || info "Frontend build will fallback to dynamic Vite serving if dist is absent"
  fi
fi

# ---- 4. Ensure config + data directories ----
info "Ensuring configuration and data directories..."
mkdir -p "$APP_DIR/backend/data"

# backend/.env with a persistent JWT_SECRET is created automatically on first
# start by the backend (backend/src/env.js). No manual step needed.
info "Configuration: backend/.env (auto-managed, JWT secret generated once)"
info "Database:      backend/data/taskflow.db (auto-created on first start)"

# ---- Optional: install as a systemd service (Linux) ----
if [[ "$SYSTEMD" == 1 ]]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    die "--systemd requested but systemd is not available on this machine."
  fi
  info "Installing TaskFlow as a systemd service..."
  SUDO=""
  if [[ "$(id -u)" -ne 0 ]]; then SUDO="sudo"; fi

  SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  $SUDO mkdir -p /etc/taskflow
  echo "JWT_SECRET=$SECRET" | $SUDO tee /etc/taskflow/taskflow.env >/dev/null
  echo "PORT=127.0.0.1:$PORT" | $SUDO tee -a /etc/taskflow/taskflow.env >/dev/null
  echo "NODE_ENV=production" | $SUDO tee -a /etc/taskflow/taskflow.env >/dev/null

  RUN_USER="$(id -un)"
  USER_LINE=""
  if [[ "$RUN_USER" != "root" ]]; then
    USER_LINE="User=$RUN_USER
Group=$RUN_USER"
  fi

  $SUDO tee /etc/systemd/system/taskflow.service >/dev/null <<EOF
[Unit]
Description=TaskFlow task management application
After=network.target

[Service]
Type=simple
$USER_LINE
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/taskflow/taskflow.env
ExecStart=/usr/bin/env node $APP_DIR/backend/src/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now taskflow
  ok "TaskFlow service installed and started (systemctl status taskflow)"
  exit 0
fi

# ---- 5. Open browser in background (if desktop display available) ----
(
  sleep 2
  if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT" >/dev/null 2>&1 || true
  fi
) &

# ---- 6. Start the server (foreground) ----
echo
echo "  ========================================================"
echo "    TaskFlow is live at: http://localhost:$PORT"
echo "    Default logins (all pass: 123456):"
echo "      - dipu@populardiagnostic.com (Super Admin)"
echo "      - kowsiq@gmail.com (Admin)"
echo "      - wattin@gmail.com (Staff User)"
echo "  ========================================================"
echo "  Press Ctrl+C to stop the server."
echo
cd "$APP_DIR"
NODE_ENV=production PORT="$PORT" node backend/src/index.js
