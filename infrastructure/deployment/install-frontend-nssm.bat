@echo off
setlocal enabledelayedexpansion

set SERVICE_NAME=BoomrangChatFrontend
set FRONTEND_PORT=1235
set SCRIPT_DIR=%~dp0
set FRONTEND_DIR=%SCRIPT_DIR%..\..\frontend
set OPS_DIR=%SCRIPT_DIR%..\..\ops

where nssm >nul 2>nul
if errorlevel 1 (
    echo NSSM was not found in PATH, download it from nssm.cc and add nssm.exe to PATH first
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found in PATH
    exit /b 1
)

if not exist "%FRONTEND_DIR%\.output\server\index.mjs" (
    echo Missing %FRONTEND_DIR%\.output\server\index.mjs, run "npm run build" in the frontend folder first
    exit /b 1
)

sc query %SERVICE_NAME% >nul 2>nul
if not errorlevel 1 (
    echo Service %SERVICE_NAME% already installed
    exit /b 0
)

for /f "delims=" %%i in ('where node') do if not defined NODE_PATH set NODE_PATH=%%i
for /f "delims=" %%o in ('node "%OPS_DIR%\frontend-env.js" origin') do set BACKEND_ORIGIN=%%o

nssm install %SERVICE_NAME% "%NODE_PATH%" ".output\server\index.mjs"
nssm set %SERVICE_NAME% AppDirectory "%FRONTEND_DIR%"
nssm set %SERVICE_NAME% AppEnvironmentExtra NODE_ENV=production PORT=%FRONTEND_PORT% HOST=0.0.0.0 BACKEND_ORIGIN=%BACKEND_ORIGIN%
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 5000
nssm set %SERVICE_NAME% AppStdout "%FRONTEND_DIR%\logs\service-stdout.log"
nssm set %SERVICE_NAME% AppStderr "%FRONTEND_DIR%\logs\service-stderr.log"

if not exist "%FRONTEND_DIR%\logs" mkdir "%FRONTEND_DIR%\logs"

net start %SERVICE_NAME%

echo Service %SERVICE_NAME% installed and started on port %FRONTEND_PORT%, backend at %BACKEND_ORIGIN%
echo Use "sc query %SERVICE_NAME%" or Services.msc to inspect it

endlocal
