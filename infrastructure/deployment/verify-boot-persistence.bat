@echo off
setlocal enabledelayedexpansion

set FAIL=0

echo Checking pm2 managed backend...
where pm2 >nul 2>nul
if not errorlevel 1 (
    pm2 describe boomrang-chat-backend >nul 2>nul
    if errorlevel 1 (
        sc query BoomrangChatBackend >nul 2>nul
        if errorlevel 1 (
            echo Backend process not found under pm2 or NSSM
            set FAIL=1
        ) else (
            sc query BoomrangChatBackend | findstr /i "RUNNING" >nul 2>nul
            if errorlevel 1 (
                echo BoomrangChatBackend service is not running
                set FAIL=1
            ) else (
                echo BoomrangChatBackend service is running
            )
        )
    ) else (
        echo boomrang-chat-backend is running under pm2
    )
) else (
    sc query BoomrangChatBackend >nul 2>nul
    if errorlevel 1 (
        echo pm2 not found and BoomrangChatBackend service not found
        set FAIL=1
    ) else (
        sc query BoomrangChatBackend | findstr /i "RUNNING" >nul 2>nul
        if errorlevel 1 (
            echo BoomrangChatBackend service is not running
            set FAIL=1
        ) else (
            echo BoomrangChatBackend service is running
        )
    )
)

echo Checking frontend service...
sc query BoomrangChatFrontend >nul 2>nul
if errorlevel 1 (
    set "PM2_FRONTEND=0"
    where pm2 >nul 2>nul
    if not errorlevel 1 (
        pm2 describe boomrang-chat-frontend >nul 2>nul
        if not errorlevel 1 set "PM2_FRONTEND=1"
    )
    if "!PM2_FRONTEND!"=="1" (
        echo boomrang-chat-frontend is running under pm2
    ) else (
        echo Frontend process not found under NSSM or pm2
        set FAIL=1
    )
) else (
    sc query BoomrangChatFrontend | findstr /i "RUNNING" >nul 2>nul
    if errorlevel 1 (
        echo BoomrangChatFrontend service is not running
        set FAIL=1
    ) else (
        echo BoomrangChatFrontend service is running
    )
)

echo Checking Nginx...
sc query BoomrangChatNginx >nul 2>nul
if not errorlevel 1 (
    sc query BoomrangChatNginx | findstr /i "RUNNING" >nul 2>nul
    if errorlevel 1 (
        echo BoomrangChatNginx service is installed but not running
        set FAIL=1
    ) else (
        echo BoomrangChatNginx service is running
    )
) else (
    tasklist /fi "imagename eq nginx.exe" 2>nul | findstr /i "nginx.exe" >nul 2>nul
    if errorlevel 1 (
        echo Nginx is not running as a Windows service or as a plain process.
        echo Employees reach the app through nginx, so run ops\start.bat to
        echo install it. Until then the app is still directly reachable on
        echo the frontend port, which forwards /api and /socket.io itself.
        set FAIL=1
    ) else (
        echo nginx.exe is running as a plain process ^(not yet installed as a
        echo Windows service, so it will NOT survive a reboot^). Re-run
        echo ops\start.bat once - it now installs the nginx service automatically.
    )
)

echo Checking Redis service...
sc query Redis >nul 2>nul
if errorlevel 1 (
    echo Redis service not found under the name Redis, verify manually if it runs under a different name
) else (
    sc query Redis | findstr /i "RUNNING" >nul 2>nul
    if errorlevel 1 (
        echo Redis service is not running
        set FAIL=1
    ) else (
        echo Redis service is running
    )
)

echo Checking backend HTTP health endpoint...
set "HEALTH_PORT=1234"
set "BACKEND_ENV_FILE=%~dp0..\..\backend\.env"
if exist "%BACKEND_ENV_FILE%" (
    for /f "tokens=2 delims==" %%P in ('findstr /b /r "PORT=[0-9]*" "%BACKEND_ENV_FILE%"') do set "HEALTH_PORT=%%P"
)
where curl >nul 2>nul
if errorlevel 1 (
    echo curl not found in PATH, skipping HTTP check
) else (
    curl -s -o nul -w "%%{http_code}" http://127.0.0.1:!HEALTH_PORT!/api/health > "%TEMP%\pmc_health_code.txt" 2>nul
    set /p HEALTH_CODE=<"%TEMP%\pmc_health_code.txt"
    del "%TEMP%\pmc_health_code.txt" >nul 2>nul
    if "!HEALTH_CODE!"=="200" (
        echo Backend health endpoint responded 200
    ) else (
        echo Backend health endpoint did not respond with 200, got: !HEALTH_CODE!
        set FAIL=1
    )
)

echo Checking frontend page...
set "FRONTEND_CHECK_PORT=1235"
set "FRONTEND_ENV_FILE=%~dp0..\..\frontend\.env"
if exist "%FRONTEND_ENV_FILE%" (
    for /f "tokens=2 delims==" %%P in ('findstr /b /r "FRONTEND_PORT=[0-9]*" "%FRONTEND_ENV_FILE%"') do set "FRONTEND_CHECK_PORT=%%P"
)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://127.0.0.1:!FRONTEND_CHECK_PORT!/'; if ($r.StatusCode -eq 200 -and $r.Content -match 'lang=.fa.') { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo Frontend on port !FRONTEND_CHECK_PORT! did not render the app page
    set FAIL=1
) else (
    echo Frontend on port !FRONTEND_CHECK_PORT! rendered the app page
)

if %FAIL%==1 (
    echo One or more checks failed
    exit /b 1
) else (
    echo All checks passed
    exit /b 0
)

endlocal
