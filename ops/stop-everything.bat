@echo off
setlocal enabledelayedexpansion
title Boomrang Chat - Full Shutdown

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Right-click this file and choose "Run as administrator".
    pause
    exit /b 1
)

echo ================================================================
echo   Stopping nginx service (BoomrangChatNginx)
echo ================================================================
net stop BoomrangChatNginx
sc config BoomrangChatNginx start= disabled

echo.
echo ================================================================
echo   Stopping frontend service (BoomrangChatFrontend)
echo ================================================================
net stop BoomrangChatFrontend
sc config BoomrangChatFrontend start= disabled

echo.
echo ================================================================
echo   Stopping backend service (BoomrangChatBackend)
echo   (this also stops the nightly in-app backup)
echo ================================================================
net stop BoomrangChatBackend
sc config BoomrangChatBackend start= disabled

echo.
echo ================================================================
echo   Stopping the old external backup tasks (only present on servers
echo   where the updated ops\start.bat has not run yet)
echo ================================================================
schtasks /End /TN "\ChatBackupAutomation\FileMirror" >nul 2>nul
schtasks /Change /TN "\ChatBackupAutomation\FileMirror" /DISABLE >nul 2>nul
schtasks /End /TN "\ChatBackupAutomation\DatabaseBackup" >nul 2>nul
schtasks /Change /TN "\ChatBackupAutomation\DatabaseBackup" /DISABLE >nul 2>nul
echo   Done.

echo.
echo ================================================================
echo   Stopping health-check task (if it was ever installed)
echo ================================================================
schtasks /End /TN "BoomrangChatHealthCheck"
schtasks /Change /TN "BoomrangChatHealthCheck" /DISABLE

echo.
echo ================================================================
echo   Cleaning up any pm2 fallback process (if NSSM was unavailable)
echo ================================================================
where pm2 >nul 2>nul
if not errorlevel 1 (
    pm2 delete boomrang-chat-frontend
    pm2 delete boomrang-chat-backend
    pm2 save
) else (
    echo   pm2 not found on this machine - nothing to clean up here.
)

echo.
echo ================================================================
echo   Killing any leftover node.exe just in case
echo ================================================================
taskkill /F /IM node.exe >nul 2>nul

echo.
echo ================================================================
echo   Removing firewall rules
echo ================================================================
netsh advfirewall firewall delete rule name="Boomrang Chat (app port)"
netsh advfirewall firewall delete rule name="Boomrang Chat (frontend port)"
netsh advfirewall firewall delete rule name="Boomrang Chat (web 80/443)"

echo.
echo ================================================================
echo   Final status check
echo ================================================================
sc query BoomrangChatBackend
sc query BoomrangChatFrontend
sc query BoomrangChatNginx

echo.
echo Done. Redis and PostgreSQL were left running on purpose since they
echo are shared system services - stop them yourself only if you are sure
echo nothing else on this machine needs them:
echo   net stop Redis
echo   net stop "exact-postgres-service-name"   (find it with: sc query state= all ^| findstr -i postgres)
echo.
pause
endlocal
