@echo off
setlocal
title TaskFlow Server Launcher

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

set "PORT=3001"
set "LOG=%APP_DIR%\backend\server.log"

REM ---- Optional custom port: start-bg.bat 8080 ----
if not "%~1"=="" set "PORT=%~1"

echo.
echo  ==========================================================
echo    TaskFlow  -  Background Server Launcher
echo  ==========================================================
echo.

REM ---- 1. Node check ----
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js not found. Install from https://nodejs.org/ ^(22 LTS or newer^)
  goto :end
)
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
node -e "const [m,n]=process.versions.node.split('.').map(Number);process.exit(m<22||(m===22&&n<5)?1:0)" >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js 22.5+ required. Found %NODE_VERSION%
  goto :end
)
echo  [1/4] Node.js OK: %NODE_VERSION%

REM ---- 2. Stop anything already on the port ----
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT%"') do (
  echo  [2/4] Port %PORT% in use by PID %%p - stopping it...
  taskkill /PID %%p /F >nul 2>&1
  timeout /t 2 /nobreak >nul
)

REM ---- 3. Start the server detached ----
echo  [3/4] Starting server on port %PORT%...
if exist "%LOG%" del /q "%LOG%" >nul 2>&1
cd /d "%APP_DIR%\backend"
start "TaskFlow Server" /min cmd /c "node "%APP_DIR%\backend\src\index.js"" > "%LOG%" 2>&1

REM ---- 4. Wait for it to answer ----
set "READY=0"
for /l %%i in (1,1,30) do (
  if "%READY%"=="0" (
    powershell -NoProfile -Command "try { if ((Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 ( set "READY=1" ) else ( timeout /t 1 /nobreak >nul )
  )
)

if "%READY%"=="0" (
  echo  [ERROR] Server did not start. Last log lines:
  echo  ----------------------------------------
  powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content '%LOG%' -Tail 30 }"
  echo  ----------------------------------------
  goto :end
)

echo  [4/4] Server is UP.
echo.
echo  ==========================================================
echo    Local:    http://localhost:%PORT%
echo    Network:  http://192.168.130.61:%PORT%
echo    Log file: backend\server.log
echo.
echo    Admin login: dipu@populardiagnostic.com  /  @dmin5066
echo  ==========================================================
echo.

start "" "http://192.168.130.61:%PORT%"
echo  Browser opened. This window can be closed - the server keeps running.
echo  To stop the server, run stop-server.bat
echo.
pause
exit /b 0

:end
echo.
pause
exit /b 1
