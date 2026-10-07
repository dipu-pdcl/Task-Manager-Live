@echo off
setlocal
title TaskFlow - Stop Server

set "PORT=3001"
if not "%~1"=="" set "PORT=%~1"

echo.
echo  Stopping TaskFlow server on port %PORT%...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT%"') do (
  echo  Killing PID %%p...
  taskkill /PID %%p /F >nul 2>&1
)

echo  Done. Port %PORT% is now free.
echo.
pause
exit /b 0
