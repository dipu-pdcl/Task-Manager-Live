@echo off
setlocal
title TaskFlow - One-Click Setup & Start
color 0B

REM ============================================================
REM  TaskFlow one-click launcher (Windows)
REM
REM  Automates the deployment steps documented in DEPLOYMENT.md:
REM   1. Verifies Node.js 22.5+ (required for node:sqlite)
REM   2. Installs backend + frontend dependencies (npm)
REM   3. Builds the frontend into frontend/dist
REM   4. Creates backend/.env with a persistent JWT_SECRET
REM      (generated once, kept stable across restarts)
REM   5. Creates the SQLite data directory (DB created on first start)
REM   6. Starts the production server on http://localhost:3001
REM      (serves the built UI and the /api backend on one port)
REM
REM  Usage:   start.bat            (use default port 3001)
REM           start.bat 8080       (use a custom port)
REM  (Pass --rebuild to force dependency install + frontend rebuild.)
REM ============================================================

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "%APP_DIR%"

set "PORT=3001"
set "FORCE=0"

:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--rebuild" set "FORCE=1"
if /i "%~1"=="--force" set "FORCE=1"
for /f "delims=0123456789" %%a in ("%~1") do set "NOTNUM=%%a"
if not "%NOTNUM%"=="" goto :args_done
if not "%~1"=="" set "PORT=%~1"
:args_done

echo.
echo  ==========================================================
echo    TaskFlow  -  One-Click Setup ^& Start
echo    Port: %PORT%
echo  ==========================================================
echo.

REM ---- 1. Check Node.js ----
where node >nul 2>nul
if errorlevel 1 goto :no_node

for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"

node -e "const [m,n]=process.versions.node.split('.').map(Number);process.exit(m<22||(m===22&&n<5)?1:0)" >nul 2>nul
if errorlevel 1 goto :old_node

echo  [1/5] Node.js OK:  %NODE_VERSION%
echo.

REM ---- 2. Install dependencies ----
if exist "%APP_DIR%\node_modules" if "%FORCE%"=="0" goto :deps_done
if exist "%APP_DIR%\backend\node_modules" if exist "%APP_DIR%\frontend\node_modules" if "%FORCE%"=="0" goto :deps_done

echo  [2/5] Installing dependencies...
pushd "%APP_DIR%"
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  [INFO] Root install fallback to backend/frontend direct install...
  pushd "%APP_DIR%\backend"
  call npm install --no-audit --no-fund
  popd
  pushd "%APP_DIR%\frontend"
  call npm install --no-audit --no-fund
  popd
)
popd
:deps_done
echo  [2/5] Dependencies ready.
echo.

REM ---- 3. Build the frontend ----
if not exist "%APP_DIR%\frontend\dist" goto :build_frontend
if "%FORCE%"=="1" goto :build_frontend
echo  [3/5] Frontend build already present.  ^(skip^)
goto :build_done
:build_frontend
echo  [3/5] Building frontend...
cd /d "%APP_DIR%\frontend"
call npm run build
cd /d "%APP_DIR%"
if not exist "%APP_DIR%\frontend\dist" (
  echo  [RETRY] Retrying frontend build from root workspace...
  call npm run build
)
if not exist "%APP_DIR%\frontend\dist" (
  echo  [WARN] Frontend dist build could not be completed. Vite middleware fallback will be used.
)
:build_done
echo.

REM ---- 4. Ensure config + data directories ----
echo  [4/5] Ensuring configuration and data directories...
if not exist "%APP_DIR%\backend\data" mkdir "%APP_DIR%\backend\data"

REM backend\.env with a persistent JWT_SECRET is created automatically
REM on first start by the backend (backend/src/env.js). No manual step needed.
echo.
echo  Configuration: backend\.env  ^(auto-managed, JWT secret generated once^)
echo  Database:      backend\data\taskflow.db  ^(auto-created on first start^)
echo.

REM ---- 5. Launch and Open Browser ----
echo  [5/5] Launching TaskFlow server...
start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:%PORT%"

echo  ==========================================================
echo    TaskFlow is live at: http://localhost:%PORT%
echo    Default logins (all pass: 123456):
echo      - dipu@populardiagnostic.com (Super Admin)
echo      - kowsiq@gmail.com (Admin)
echo      - wattin@gmail.com (Staff User)
echo  ==========================================================
echo  Press Ctrl+C to stop the server.
echo.
cd /d "%APP_DIR%"
set "NODE_ENV=production"
set "PORT=%PORT%"
node "%APP_DIR%\backend\src\index.js"
if errorlevel 1 goto :error

exit /b 0

:no_node
echo.
echo  [ERROR] Node.js was not found on this machine.
echo          TaskFlow requires Node.js 22.5 or newer ^(uses the built-in node:sqlite module^).
echo.
echo          Install it from:  https://nodejs.org/   ^(choose the 22 LTS version^)
echo          Then run this script again.
goto :end

:old_node
echo.
echo  [ERROR] Node.js 22.5 or newer is required.  Found: %NODE_VERSION%
echo          Please upgrade Node.js from:  https://nodejs.org/   ^(choose the 22 LTS version^)
goto :end

:error
echo.
echo  [ERROR] Something went wrong. See the messages above.
echo.
popd 2>nul

:end
echo.
pause
exit /b 1
