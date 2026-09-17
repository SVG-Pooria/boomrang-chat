@echo off
setlocal enabledelayedexpansion

set SERVICE_NAME=BoomrangChatBackend
set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%..\..\backend

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

if not exist "%BACKEND_DIR%\.env" (
    echo Missing .env file in %BACKEND_DIR%, copy .env.example to .env and fill in the values first
    exit /b 1
)

sc query %SERVICE_NAME% >nul 2>nul
if not errorlevel 1 (
    echo Service %SERVICE_NAME% already installed
    exit /b 0
)

for /f "delims=" %%i in ('where node') do set NODE_PATH=%%i

nssm install %SERVICE_NAME% "%NODE_PATH%" "src\server.js"
nssm set %SERVICE_NAME% AppDirectory "%BACKEND_DIR%"
nssm set %SERVICE_NAME% AppEnvironmentExtra NODE_ENV=production
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 5000
nssm set %SERVICE_NAME% AppStdout "%BACKEND_DIR%\logs\service-stdout.log"
nssm set %SERVICE_NAME% AppStderr "%BACKEND_DIR%\logs\service-stderr.log"

if not exist "%BACKEND_DIR%\logs" mkdir "%BACKEND_DIR%\logs"

net start %SERVICE_NAME%

echo Service %SERVICE_NAME% installed and started
echo Use "sc query %SERVICE_NAME%" or Services.msc to inspect it

endlocal
