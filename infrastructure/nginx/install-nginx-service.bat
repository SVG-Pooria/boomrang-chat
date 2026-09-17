@echo off
setlocal enabledelayedexpansion

set SERVICE_NAME=BoomrangChatNginx
set NGINX_DIR=C:\nginx

where nssm >nul 2>nul
if errorlevel 1 (
    echo NSSM was not found in PATH, download it from nssm.cc and add nssm.exe to PATH first
    exit /b 1
)

if not exist "%NGINX_DIR%\nginx.exe" (
    echo nginx.exe was not found at %NGINX_DIR%, install nginx first
    exit /b 1
)

sc query %SERVICE_NAME% >nul 2>nul
if not errorlevel 1 (
    echo Service %SERVICE_NAME% already installed
    exit /b 0
)

nssm install %SERVICE_NAME% "%NGINX_DIR%\nginx.exe"
nssm set %SERVICE_NAME% AppDirectory "%NGINX_DIR%"
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% AppExit Default Restart
nssm set %SERVICE_NAME% AppRestartDelay 5000
nssm set %SERVICE_NAME% AppStopMethodSkip 6
nssm set %SERVICE_NAME% Description "Nginx reverse proxy for boomrang.lan"

net start %SERVICE_NAME%

echo Service %SERVICE_NAME% installed and started
echo Use "sc query %SERVICE_NAME%" or Services.msc to inspect it
echo Run "%NGINX_DIR%\nginx.exe -t" before restarting the service after any config change

endlocal
