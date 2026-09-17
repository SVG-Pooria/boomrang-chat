@echo off

setlocal enabledelayedexpansion

title Boomrang Chat - Full System Startup

if not defined BMC_KEEP_OPEN (

    set "BMC_KEEP_OPEN=1"

    set "BMC_SELF=%~f0"

    start "Boomrang Chat Startup" cmd /k call "!BMC_SELF!"

    exit /b

)

net session >nul 2>&1

if %errorLevel% neq 0 (

    echo This script needs Administrator rights ^(to start Windows services

    echo such as PostgreSQL / Redis / nginx if needed^).

    echo Opening the Windows confirmation window ^(UAC^)...

    echo If a window titled "User Account Control" appears, click Yes.

    set "BMC_SELF=%~f0"

    set "BMC_SELFDIR=%~dp0"

    powershell -NoProfile -Command "try { Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k','call',$env:BMC_SELF) -WorkingDirectory $env:BMC_SELFDIR -Verb RunAs } catch { exit 1 }"

    if errorlevel 1 (

        echo.

        echo ================================================================

        echo   [FATAL] Did not get Administrator rights.

        echo ================================================================

        echo   The "User Account Control" prompt was closed/cancelled instead

        echo   of clicking Yes, or Windows blocked it. Nothing was installed

        echo   or started. Run ops\start.bat again and click "Yes" when the

        echo   UAC prompt appears.

        pause

    ) else (

        echo   A new Administrator window was opened - continue there.

        echo   This window is no longer needed and will now close.

    )

    exit

)

cd /d "%~dp0"

set "SCRIPT_DIR=%~dp0"

set "ROOT_DIR=%SCRIPT_DIR%.."

set "BACKEND_DIR=%ROOT_DIR%\backend"

set "FRONTEND_DIR=%ROOT_DIR%\frontend"

set "APP_PORT=1234"

set "FRONTEND_PORT=1235"

set "BACKEND_SERVICE=BoomrangChatBackend"

set "FRONTEND_SERVICE=BoomrangChatFrontend"

set "FRONTEND_PM2_NAME=boomrang-chat-frontend"

set "BACKUP_MIRROR_DEFAULT=C:\boomrang_backup\files"

set "NGINX_DIR=C:\nginx"

set "NGINX_VERSION=1.30.4"

set OVERALL_WARN=0

rem ---------------------------------------------------------------
rem  One-time cleanup: drop anything left behind by the previous
rem  chat system so its services never fight over ports 80/1234/1235.
rem ---------------------------------------------------------------
for %%S in (ParsianMelalChatBackend ParsianMelalChatFrontend ParsianMelalChatNginx) do (
    sc query %%S >nul 2>nul
    if not errorlevel 1 (
        echo   Removing leftover service %%S from the previous chat system...
        net stop %%S >nul 2>nul
        sc delete %%S >nul 2>nul
    )
)

schtasks /Query /TN "ParsianMelalChatHealthCheck" >nul 2>nul
if not errorlevel 1 schtasks /Delete /TN "ParsianMelalChatHealthCheck" /F >nul 2>nul


echo ================================================================

echo   Boomrang Chat - Full System Startup

echo   ^(script build: 2026-09-15-r9-two-services^)

echo ================================================================

echo.

where node >nul 2>nul

if errorlevel 1 (

    echo [FATAL] Node.js was not found in PATH. Install Node.js first.

    pause

    exit /b 1

)

where npm >nul 2>nul

if errorlevel 1 (

    echo [FATAL] npm was not found in PATH. Install Node.js first.

    pause

    exit /b 1

)

echo [1/11] Environment files

set "NEED_ENV_SETUP=0"

if not exist "%BACKEND_DIR%\.env" set "NEED_ENV_SETUP=1"

if not exist "%FRONTEND_DIR%\.env" set "NEED_ENV_SETUP=1"

if "%NEED_ENV_SETUP%"=="1" (

    echo   backend\.env and/or frontend\.env not found - running ops\setup-env.bat

    echo   automatically to create them now ^(a couple of short questions, like

    echo   your PostgreSQL password - nothing else to do separately^)...

    echo.

    set "BMC_FROM_START=1"

    call "%SCRIPT_DIR%setup-env.bat"

    set "BMC_FROM_START="

    echo.

    if not exist "%BACKEND_DIR%\.env" (

        echo [FATAL] backend\.env is still missing - cannot continue. See any

        echo   [FATAL]/[REMINDER] messages above from ops\setup-env.bat.

        pause

        exit /b 1

    )

    if not exist "%FRONTEND_DIR%\.env" (

        echo [FATAL] frontend\.env is still missing - cannot continue.

        pause

        exit /b 1

    )

    echo   Environment files created.

) else (

    echo   backend\.env and frontend\.env already exist.

)

echo.

echo [1b/11] Checking frontend\.env for a stale port or hardcoded address

rem The frontend is its own Node service now. frontend\.env only holds
rem FRONTEND_PORT and an optional BACKEND_ORIGIN override. Old VITE_API_BASE_URL/
rem VITE_SOCKET_URL lines are removed (the browser always calls /api and
rem /socket.io on the address it loaded the page from), and a BACKEND_ORIGIN
rem left pointing at a wrong port on this machine is cleared so it is
rem detected automatically again. The previous file is kept as a .bak copy.

node "%SCRIPT_DIR%frontend-env.js" sync %FRONTEND_PORT% %APP_PORT%

if errorlevel 1 (

    echo [FATAL] Could not check/repair frontend\.env - see the message above.

    pause

    exit /b 1

)

echo.

echo [2/11] PostgreSQL

set "PG_SERVICE="

for /f "tokens=2 delims=: " %%S in ('sc query state^= all ^| findstr /i "SERVICE_NAME.*postgres"') do (

    if not defined PG_SERVICE set "PG_SERVICE=%%S"

)

if defined PG_SERVICE (

    echo   Found service: !PG_SERVICE!

    sc config "!PG_SERVICE!" start= auto >nul 2>nul

    sc query "!PG_SERVICE!" | findstr /i "RUNNING" >nul 2>nul

    if errorlevel 1 (

        echo   Starting !PG_SERVICE!...

        net start "!PG_SERVICE!" >nul 2>nul

        if errorlevel 1 (

            echo   [WARNING] Could not start !PG_SERVICE!. Start it manually and check its logs.

            set OVERALL_WARN=1

        ) else (

            echo   PostgreSQL is now running.

        )

    ) else (

        echo   Already running.

    )

) else (

    echo   [WARNING] No local PostgreSQL Windows service was found.

    echo   If PostgreSQL runs on this machine, install it first ^(this script

    echo   will not install a database engine for you^). If it runs on another

    echo   server, this is expected - just make sure DATABASE_URL in backend\.env

    echo   points to it.

    set OVERALL_WARN=1

)

echo.

echo [3/11] Redis

set "REDIS_MSI_VERSION=5.0.14.1"

set "REDIS_MSI_URL=https://github.com/tporadowski/redis/releases/download/v%REDIS_MSI_VERSION%/Redis-x64-%REDIS_MSI_VERSION%.msi"

set "REDIS_MSI_PATH=%TEMP%\Redis-x64-%REDIS_MSI_VERSION%.msi"

sc query Redis >nul 2>nul

if errorlevel 1 (

    echo   No Windows service named "Redis" was found - installing it now

    echo   ^(Redis for Windows, unofficial build by tporadowski, used by many

    echo   Windows deployments since Redis itself does not ship an official

    echo   Windows build^)...

    echo   Downloading %REDIS_MSI_URL% ...

    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%REDIS_MSI_URL%' -OutFile '%REDIS_MSI_PATH%'" >nul 2>nul

    if not exist "%REDIS_MSI_PATH%" (

        echo   [WARNING] Could not download Redis installer. Check your internet

        echo   connection, or install Redis/Memurai manually and make sure

        echo   REDIS_URL in backend\.env points to it.

        set OVERALL_WARN=1

    ) else (

        echo   Installing Redis ^(silent, port 6379, Windows service "Redis"^)...

        msiexec /quiet /i "%REDIS_MSI_PATH%"

        timeout /t 3 /nobreak >nul

        sc query Redis >nul 2>nul

        if errorlevel 1 (

            echo   [WARNING] Redis installer ran but the "Redis" service did not

            echo   appear. Try running ops\start.bat again, or install it manually

            echo   from %REDIS_MSI_URL%

            set OVERALL_WARN=1

        ) else (

            echo   Redis installed.

        )

    )

)

sc query Redis >nul 2>nul

if errorlevel 1 (

    echo   Skipping Redis start/verify - see warning above.

) else (

    sc config Redis start= auto >nul 2>nul

    sc query Redis | findstr /i "RUNNING" >nul 2>nul

    if errorlevel 1 (

        echo   Starting Redis...

        net start Redis >nul 2>nul

        if errorlevel 1 (

            echo   [WARNING] Could not start Redis. Start it manually and check its logs.

            set OVERALL_WARN=1

        ) else (

            echo   Redis is now running.

        )

    ) else (

        echo   Already running.

    )

)

echo.

echo [4/11] Antivirus scanning (ClamAV)

set "CLAM_BIN=clamdscan"

if exist "%BACKEND_DIR%\.env" (

    for /f "usebackq tokens=1,* delims==" %%A in ("%BACKEND_DIR%\.env") do (

        if /i "%%A"=="CLAMSCAN_BIN" set "CLAM_BIN=%%B"

    )

)

where "%CLAM_BIN%" >nul 2>nul

if errorlevel 1 (

    echo   [WARNING] "%CLAM_BIN%" was not found in PATH - ClamAV is not
    echo   installed or not on PATH on this machine. File and avatar uploads
    echo   will still work: the app automatically skips the antivirus scan
    echo   when the scanner is unavailable and simply marks those files as
    echo   "unscanned" instead of blocking them. Install ClamAV for Windows
    echo   and make sure clamd is running as a Windows service if you want
    echo   uploads to actually be scanned.
    set OVERALL_WARN=1

) else (

    "%CLAM_BIN%" --version >nul 2>nul

    if errorlevel 1 (

        echo   [WARNING] "%CLAM_BIN%" was found but could not run correctly -
        echo   the clamd service is probably not running. Uploads will still
        echo   work in degraded mode ^(files are accepted and marked as
        echo   "unscanned"^). Start the clamd Windows service to re-enable
        echo   scanning.
        set OVERALL_WARN=1

    ) else (

        echo   ClamAV is installed and responding.

    )

)

echo.

echo [5/11] Backend ^(%BACKEND_DIR%^)

if not exist "%BACKEND_DIR%" (

    echo [FATAL] Backend folder not found: %BACKEND_DIR%

    pause

    exit /b 1

)

cd /d "%BACKEND_DIR%"

if not exist ".env" (

    echo [FATAL] Missing backend\.env - this should have been created in step

    echo   [1/11] above. Something went wrong with ops\setup-env.bat - check

    echo   the messages above, fix the issue, and run ops\start.bat again.

    pause

    exit /b 1

)

set NODE_ENV=production

set NEED_BACKEND_INSTALL=0

if not exist "node_modules" set NEED_BACKEND_INSTALL=1

rem Instead of only checking a hardcoded handful of package folders (which
rem silently skips npm install whenever package.json gains a NEW dependency,
rem e.g. "archiver" for the user-export feature - node_modules already
rem existed from before, so the old check passed and the missing package
rem was never installed, crashing the backend at startup with
rem "Cannot find module 'archiver'"), compare a hash of package.json against
rem a marker saved after the last successful install. Any change to
rem package.json - added, removed, or version-bumped dependency - now
rem reliably triggers a reinstall.

set "BMC_PKG_HASH="
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile package.json SHA256 2^>nul ^| findstr /v /i "hash CertUtil"') do if not defined BMC_PKG_HASH set "BMC_PKG_HASH=%%H"
set "BMC_PKG_HASH=%BMC_PKG_HASH: =%"

if not exist "node_modules\.pmc-install-marker" (
    set NEED_BACKEND_INSTALL=1
) else if defined BMC_PKG_HASH (
    set "BMC_MARKER_HASH="
    set /p BMC_MARKER_HASH=<"node_modules\.pmc-install-marker"
    if not "!BMC_MARKER_HASH!"=="!BMC_PKG_HASH!" set NEED_BACKEND_INSTALL=1
)

if "!NEED_BACKEND_INSTALL!"=="1" (

    echo   Installing/repairing backend dependencies ^(npm install^) - package.json

    echo   is new/changed or node_modules is incomplete since the last run...

    call npm install --omit=dev

    if errorlevel 1 (

        echo [FATAL] Backend npm install failed.

        pause

        exit /b 1

    )

    if defined BMC_PKG_HASH (>"node_modules\.pmc-install-marker" echo !BMC_PKG_HASH!)

) else (

    echo   Backend dependencies already installed and match package.json, skipping npm install.

)

echo   Making sure the backend uses port !APP_PORT! everywhere ^(npm run set-port^)...

call npm run set-port -- !APP_PORT!

if errorlevel 1 (

    echo [FATAL] Could not set the backend port. Check the error above.

    pause

    exit /b 1

)

rem Every upload is copied into BACKUP_MIRROR_FILES_DIR by the backend itself
rem (and restored from there if the original ever goes missing). The default
rem is the same folder the old external file mirror used, so copies made
rem before this version stay restorable. A value already in backend\.env is
rem never overwritten; an empty value means the mirror was turned off on purpose.

echo   Checking the upload backup mirror folder ^(BACKUP_MIRROR_FILES_DIR^)...

findstr /b /c:"BACKUP_MIRROR_FILES_DIR=" ".env" >nul 2>nul

if errorlevel 1 (

    call npm run set-backup-mirror-dir -- "%BACKUP_MIRROR_DEFAULT%"

    if errorlevel 1 (

        echo [FATAL] Could not set BACKUP_MIRROR_FILES_DIR in backend\.env. Check the error above.

        pause

        exit /b 1

    )

)

set "BMC_MIRROR_DIR="

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (

    if /i "%%A"=="BACKUP_MIRROR_FILES_DIR" set "BMC_MIRROR_DIR=%%B"

)

if defined BMC_MIRROR_DIR (

    if not exist "!BMC_MIRROR_DIR!" mkdir "!BMC_MIRROR_DIR!" >nul 2>nul

    if exist "!BMC_MIRROR_DIR!" (

        echo   Uploads are mirrored to !BMC_MIRROR_DIR!

    ) else (

        echo   [WARNING] Could not create !BMC_MIRROR_DIR! - uploads still work,

        echo   but no backup copy of each file will be kept until that folder exists.

        set OVERALL_WARN=1

    )

) else (

    echo   BACKUP_MIRROR_FILES_DIR is empty in backend\.env - per-file mirror is off.

)

echo.

echo   Checking that the backend port is free ^(npm run check-port^)...

call npm run check-port

if errorlevel 1 (

    echo [FATAL] The configured backend port is already taken - see details above.

    pause

    exit /b 1

)

echo   Making sure the database exists ^(npm run ensure-db^)...

call npm run ensure-db

if errorlevel 1 (

    echo [FATAL] Could not verify/create the database. Check DATABASE_URL in backend\.env

    echo   and that PostgreSQL is reachable with those credentials.

    pause

    exit /b 1

)

echo   Running database migration ^(npm run migrate^)...

call npm run migrate

if errorlevel 1 (

    echo [FATAL] Migration failed. Check DATABASE_URL and that PostgreSQL is reachable.

    pause

    exit /b 1

)

echo   Running database seed ^(npm run seed^)...

echo   ^(safe to re-run - already-seeded users/settings are skipped^)

call npm run seed

if errorlevel 1 (

    echo [FATAL] Seed failed. Check the error above.

    pause

    exit /b 1

)

echo   NOTE: if any one-time super-admin passwords were printed above,

echo   copy them now - they cannot be recovered later.

echo   Making sure the two seeded super_admin accounts have a known password...

if not exist ".super-admin-password-set" (

    call npm run set-admin-passwords

    if errorlevel 1 (

        echo   [WARNING] Could not set the super_admin password. Check the error

        echo   above - you can retry later by running ops\set-admin-passwords.bat.

        set OVERALL_WARN=1

    ) else (

        echo installed> ".super-admin-password-set"

        echo   Done ^(see backend\src\db\set-super-admin-passwords.js for the

        echo   password - only done once; later runs of ops\start.bat will

        echo   NOT reset it again, so an admin's own password change sticks^).

    )

) else (

    echo   Already set on a previous run - skipping.

)

echo.

echo [6/11] Frontend build ^(%FRONTEND_DIR%^)

if not exist "%FRONTEND_DIR%" (

    echo [FATAL] Frontend folder not found: %FRONTEND_DIR%

    pause

    exit /b 1

)

cd /d "%FRONTEND_DIR%"

set "NODE_ENV="

if not exist ".env" (

    echo [FATAL] Missing frontend\.env - this should have been created in step

    echo   [1/11] above. Something went wrong with ops\setup-env.bat - check

    echo   the messages above, fix the issue, and run ops\start.bat again.

    pause

    exit /b 1

)

set NEED_FRONTEND_INSTALL=0

if not exist "node_modules\.bin\vite.cmd" set NEED_FRONTEND_INSTALL=1

set "BMC_FPKG_HASH="
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile package.json SHA256 2^>nul ^| findstr /v /i "hash CertUtil"') do if not defined BMC_FPKG_HASH set "BMC_FPKG_HASH=%%H"
set "BMC_FPKG_HASH=%BMC_FPKG_HASH: =%"

if not exist "node_modules\.pmc-install-marker" (
    set NEED_FRONTEND_INSTALL=1
) else if defined BMC_FPKG_HASH (
    set "BMC_FMARKER_HASH="
    set /p BMC_FMARKER_HASH=<"node_modules\.pmc-install-marker"
    if not "!BMC_FMARKER_HASH!"=="!BMC_FPKG_HASH!" set NEED_FRONTEND_INSTALL=1
)

if "!NEED_FRONTEND_INSTALL!"=="1" (

    echo   Installing/repairing frontend dependencies ^(npm install^) - package.json
    echo   is new/changed or node_modules is incomplete since the last run...

    call npm install --include=dev

    if errorlevel 1 (

        echo [FATAL] Frontend npm install failed.

        pause

        exit /b 1

    )

    if defined BMC_FPKG_HASH (>"node_modules\.pmc-install-marker" echo !BMC_FPKG_HASH!)

) else (

    echo   Frontend dependencies already installed and match package.json, skipping npm install.

)

echo   Checking that the frontend port is free ^(npm run check-port^)...

pushd "%BACKEND_DIR%"

call npm run check-port -- --port %FRONTEND_PORT% --service %FRONTEND_SERVICE% --pm2 %FRONTEND_PM2_NAME% --label frontend

set "BMC_FE_PORT_RC=!errorlevel!"

popd

if not "!BMC_FE_PORT_RC!"=="0" (

    echo [FATAL] The configured frontend port %FRONTEND_PORT% is already taken - see details above.

    pause

    exit /b 1

)

sc query "%FRONTEND_SERVICE%" >nul 2>nul
set "BMC_FE_SVC_EXISTED=1"
if errorlevel 1 set "BMC_FE_SVC_EXISTED=0"

if "!BMC_FE_SVC_EXISTED!"=="1" (
    echo   %FRONTEND_SERVICE% is already installed - stopping it before the rebuild so
    echo   it never serves a half-old/half-new build while .output is replaced...
    net stop "%FRONTEND_SERVICE%" >nul 2>nul
    set "BMC_FE_SVC_STOPPED=0"
    for /l %%i in (1,1,20) do (
        if "!BMC_FE_SVC_STOPPED!"=="0" (
            sc query "%FRONTEND_SERVICE%" | findstr /i "STOPPED" >nul 2>nul
            if not errorlevel 1 (
                set "BMC_FE_SVC_STOPPED=1"
            ) else (
                timeout /t 1 /nobreak >nul
            )
        )
    )
    if "!BMC_FE_SVC_STOPPED!"=="0" (
        echo   [WARNING] %FRONTEND_SERVICE% did not report STOPPED in time -
        echo   killing any leftover node.exe process using it before continuing.
        taskkill /f /fi "SERVICES eq %FRONTEND_SERVICE%" >nul 2>nul
    )
)

where pm2 >nul 2>nul
if not errorlevel 1 (
    call pm2 describe %FRONTEND_PM2_NAME% >nul 2>nul
    if not errorlevel 1 (
        echo   Stopping the pm2 fallback copy of the frontend before the rebuild...
        call pm2 stop %FRONTEND_PM2_NAME% >nul 2>nul
    )
)

echo   Removing any previous frontend build ^(.output and dist^) so the build is always 100%% fresh...

if exist ".output" rmdir /s /q ".output" >nul 2>nul

if exist "dist" rmdir /s /q "dist" >nul 2>nul

if exist ".output" (

    echo [FATAL] Could not delete frontend\.output - a process still has files open
    echo   in it. Close anything started from that folder ^(or reboot^), then run
    echo   ops\start.bat again.

    pause

    exit /b 1

)

echo   Building the frontend Node server ^(npm run build^)...

call npm run build

if errorlevel 1 (

    echo [FATAL] Frontend build failed.

    pause

    exit /b 1

)

if not exist ".output\server\index.mjs" (

    echo [FATAL] The build finished but frontend\.output\server\index.mjs is missing -
    echo   the frontend service has nothing to run. Check the build output above
    echo   and the nitro preset in frontend\vite.config.ts ^(it must be node-server^).

    pause

    exit /b 1

)

echo   Verifying the browser files have no hardcoded localhost/127.0.0.1 address...

set "BMC_LEAK_FOUND=0"
set "BMC_LEAK_FILE="

for /f "delims=" %%F in ('powershell -NoProfile -Command "Get-ChildItem -Path '.output\public' -Recurse -File -Include *.js,*.html,*.css | Select-String -Pattern 'https?://(localhost|127\.0\.0\.1)[:/]' | Select-Object -First 1 -ExpandProperty Path"') do set "BMC_LEAK_FILE=%%F"

if defined BMC_LEAK_FILE set "BMC_LEAK_FOUND=1"

if "!BMC_LEAK_FOUND!"=="1" (

    echo.

    echo ================================================================

    echo   [FATAL] The frontend build still contains a hardcoded

    echo   localhost/127.0.0.1 address ^(found in: !BMC_LEAK_FILE!^).

    echo   Those files run in each employee's browser, so this build would

    echo   only work on this PC and break on every other PC.

    echo.

    echo   The app itself always calls /api and /socket.io on the address the

    echo   page was loaded from, so this means an address was added to the

    echo   frontend source code by hand. Remove it, then run ops\start.bat

    echo   again.

    echo ================================================================

    set "BMC_LEAK_FILE="

    pause

    exit /b 1

)

set "BMC_LEAK_FILE="

echo   OK - no hardcoded localhost/127.0.0.1 address in the browser files.

echo   Frontend build ready: .output\server\index.mjs ^(Node server^) and

echo   .output\public ^(static files^) - served by %FRONTEND_SERVICE% in step [8/11].

echo.

echo [7/11] Backend process ^(persistent Windows Service^)
cd /d "%BACKEND_DIR%"

set "NSSM_DIR=C:\nssm"
set "NSSM_EXE=%NSSM_DIR%\nssm.exe"
set "NSSM_VERSION=2.24"

if not exist "%NSSM_EXE%" (
    where nssm >nul 2>nul
    if not errorlevel 1 (
        for /f "delims=" %%N in ('where nssm') do set "NSSM_EXE=%%N"
    ) else (
        echo   nssm.exe not found - downloading it now ^(official build from nssm.cc,
        echo   used to install the backend and frontend as real, reboot-proof Windows Services^)...
        set "NSSM_ZIP_URL=https://nssm.cc/release/nssm-%NSSM_VERSION%.zip"
        set "NSSM_ZIP_PATH=%TEMP%\nssm-%NSSM_VERSION%.zip"
        set "NSSM_EXTRACT_TMP=%TEMP%\nssm-extract-%NSSM_VERSION%"
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!NSSM_ZIP_URL!' -OutFile '!NSSM_ZIP_PATH!'" >nul 2>nul
        if not exist "!NSSM_ZIP_PATH!" (
            echo   [WARNING] Could not download NSSM ^(check your internet connection^).
            echo   The backend and frontend will still be started below for right now, but
            echo   will NOT automatically survive a reboot until NSSM is available -
            echo   simply re-run ops\start.bat once you have internet access.
            set OVERALL_WARN=1
            set "NSSM_EXE="
        ) else (
            if exist "!NSSM_EXTRACT_TMP!" rmdir /s /q "!NSSM_EXTRACT_TMP!" >nul 2>nul
            powershell -NoProfile -Command "Expand-Archive -Path '!NSSM_ZIP_PATH!' -DestinationPath '!NSSM_EXTRACT_TMP!' -Force" >nul 2>nul
            if not exist "%NSSM_DIR%" mkdir "%NSSM_DIR%" >nul 2>nul
            if exist "!NSSM_EXTRACT_TMP!\nssm-%NSSM_VERSION%\win64\nssm.exe" (
                copy /y "!NSSM_EXTRACT_TMP!\nssm-%NSSM_VERSION%\win64\nssm.exe" "%NSSM_EXE%" >nul
            ) else if exist "!NSSM_EXTRACT_TMP!\nssm-%NSSM_VERSION%\win32\nssm.exe" (
                copy /y "!NSSM_EXTRACT_TMP!\nssm-%NSSM_VERSION%\win32\nssm.exe" "%NSSM_EXE%" >nul
            )
            if exist "%NSSM_EXE%" (
                echo   NSSM installed at %NSSM_EXE%.
            ) else (
                echo   [WARNING] NSSM extraction did not produce nssm.exe.
                set OVERALL_WARN=1
                set "NSSM_EXE="
            )
        )
    )
)

set "BMC_NODE_EXE="
for /f "delims=" %%N in ('where node') do if not defined BMC_NODE_EXE set "BMC_NODE_EXE=%%N"

if not exist "%BACKEND_DIR%\logs" mkdir "%BACKEND_DIR%\logs" >nul 2>nul

if defined NSSM_EXE if exist "%NSSM_EXE%" (
    for %%L in ("%BACKEND_DIR%\logs\service-stdout.log" "%BACKEND_DIR%\logs\service-stderr.log") do (
        if exist "%%~L" for %%S in ("%%~L") do if %%~zS GTR 10485760 del /f /q "%%~L" >nul 2>nul
    )

    sc query "%BACKEND_SERVICE%" >nul 2>nul
    set "BMC_SVC_EXISTED=1"
    if errorlevel 1 set "BMC_SVC_EXISTED=0"

    if "!BMC_SVC_EXISTED!"=="1" (
        echo   %BACKEND_SERVICE% is already installed - stopping it first so the
        echo   files on disk can't be half-old/half-new while we reconfigure it...
        net stop "%BACKEND_SERVICE%" >nul 2>nul
        set "BMC_SVC_STOPPED=0"
        for /l %%i in (1,1,20) do (
            if "!BMC_SVC_STOPPED!"=="0" (
                sc query "%BACKEND_SERVICE%" | findstr /i "STOPPED" >nul 2>nul
                if not errorlevel 1 (
                    set "BMC_SVC_STOPPED=1"
                ) else (
                    timeout /t 1 /nobreak >nul
                )
            )
        )
        if "!BMC_SVC_STOPPED!"=="0" (
            echo   [WARNING] %BACKEND_SERVICE% did not report STOPPED in time -
            echo   killing any leftover node.exe process using it before continuing.
            taskkill /f /fi "SERVICES eq %BACKEND_SERVICE%" >nul 2>nul
        )
    ) else (
        echo   Installing %BACKEND_SERVICE% as a Windows Service...
        "%NSSM_EXE%" install "%BACKEND_SERVICE%" "!BMC_NODE_EXE!" "src\server.js" >nul
    )

    "%NSSM_EXE%" set "%BACKEND_SERVICE%" Application "!BMC_NODE_EXE!" >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppParameters "src\server.js" >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppDirectory "%BACKEND_DIR%" >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppEnvironmentExtra NODE_ENV=production >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" Start SERVICE_AUTO_START >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppExit Default Restart >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppRestartDelay 5000 >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppStdout "%BACKEND_DIR%\logs\service-stdout.log" >nul
    "%NSSM_EXE%" set "%BACKEND_SERVICE%" AppStderr "%BACKEND_DIR%\logs\service-stderr.log" >nul

    echo   Making sure no other node.exe is still bound to port %APP_PORT%
    echo   before starting %BACKEND_SERVICE% ^(covers a stray process started
    echo   outside this service, e.g. by hand or by a previous pm2 run^)...
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%APP_PORT% "') do (
        if not "%%P"=="0" (
            tasklist /fi "PID eq %%P" /fi "IMAGENAME eq node.exe" 2>nul | findstr /i "node.exe" >nul 2>nul
            if not errorlevel 1 taskkill /f /pid %%P >nul 2>nul
        )
    )

    net start "%BACKEND_SERVICE%" >nul 2>nul
    set "BMC_SVC_STARTED=0"
    for /l %%i in (1,1,20) do (
        if "!BMC_SVC_STARTED!"=="0" (
            sc query "%BACKEND_SERVICE%" | findstr /i "RUNNING" >nul 2>nul
            if not errorlevel 1 (
                set "BMC_SVC_STARTED=1"
            ) else (
                timeout /t 1 /nobreak >nul
            )
        )
    )
    if "!BMC_SVC_STARTED!"=="1" (
        if "!BMC_SVC_EXISTED!"=="1" (
            echo   %BACKEND_SERVICE% restarted and running from %BACKEND_DIR%.
        ) else (
            echo   %BACKEND_SERVICE% installed and started as a Windows Service,
            echo   running from %BACKEND_DIR%.
            echo   It will now start automatically on every future boot - you do
            echo   NOT need to run ops\start.bat again after a restart.
        )

        for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%APP_PORT% "') do set "BMC_LIVE_PID=%%P"
        if defined BMC_LIVE_PID (
            for /f "delims=" %%T in ('powershell -NoProfile -Command "try { (Get-Process -Id !BMC_LIVE_PID!).StartTime } catch { '' }"') do set "BMC_LIVE_STARTTIME=%%T"
            echo   Process actually listening on port %APP_PORT%: PID !BMC_LIVE_PID!, started !BMC_LIVE_STARTTIME!
            echo   ^(if that start time is not from just now, the old process never
            echo   died and is still the one answering requests - re-run this script^)
        )
        set "BMC_LIVE_PID="
        set "BMC_LIVE_STARTTIME="

        echo   Verifying the running backend actually serves the routes that are
        echo   in the source files right now ^(catches "files were replaced but the
        echo   old process/old copy is still what answers", not just "is something
        echo   listening on the port"^)...
        set "BMC_ROUTE_CHECK=0"
        findstr /c:"router.get('/tags'" "%BACKEND_DIR%\src\routes\admin.routes.js" >nul 2>nul
        if not errorlevel 1 set "BMC_ROUTE_CHECK=1"
        if "!BMC_ROUTE_CHECK!"=="1" (
            set "BMC_TAGS_CODE="
            where curl >nul 2>nul
            if not errorlevel 1 (
                for /f "delims=" %%C in ('curl.exe -s -o nul -m 5 -w "%%{http_code}" "http://127.0.0.1:%APP_PORT%/api/admin/tags"') do set "BMC_TAGS_CODE=%%C"
            ) else (
                for /f "delims=" %%C in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://127.0.0.1:%APP_PORT%/api/admin/tags').StatusCode } catch { $_.Exception.Response.StatusCode.value__ }"') do set "BMC_TAGS_CODE=%%C"
            )
            if "!BMC_TAGS_CODE!"=="401" (
                echo   OK - /api/admin/tags answered 401 ^(needs login, as expected^),
                echo   so the route from the current source files is really live.
            ) else if "!BMC_TAGS_CODE!"=="404" (
                echo.
                echo   ================================================================
                echo   [FATAL-LOOKING] /api/admin/tags exists in
                echo   "%BACKEND_DIR%\src\routes\admin.routes.js" on disk, but the running
                echo   backend just answered 404 for it - the live process is NOT
                echo   actually running these files, even though it was just restarted.
                echo   Most likely cause: the file copy/replace step did not fully
                echo   overwrite everything under backend\src ^(e.g. Windows Explorer's
                echo   "Skip" was chosen on a conflict, or files were copied into a
                echo   different folder than %BACKEND_DIR%^). Re-copy the ENTIRE backend
                echo   folder contents ^(overwrite all^), then run ops\start.bat again.
                echo   ================================================================
                echo.
                set OVERALL_WARN=1
            ) else (
                echo   [WARNING] Could not confirm route status ^(got "!BMC_TAGS_CODE!"^
                echo   instead of 401/404^) - check manually if something still seems off.
                set OVERALL_WARN=1
            )
            set "BMC_TAGS_CODE="
        ) else (
            echo   [WARNING] "%BACKEND_DIR%\src\routes\admin.routes.js" does not even
            echo   contain the /tags route on disk - the file replace step itself is
            echo   incomplete. Re-copy the full backend folder and run this again.
            set OVERALL_WARN=1
        )
        set "BMC_ROUTE_CHECK="
    ) else (
        echo   [WARNING] %BACKEND_SERVICE% did not report RUNNING after start -
        echo   check "%BACKEND_DIR%\logs\service-stderr.log" and
        echo   "sc query %BACKEND_SERVICE%" for details.
        set OVERALL_WARN=1
    )
) else (
    echo   [WARNING] Falling back to pm2 for this run only - will not survive a reboot.
    where pm2 >nul 2>nul
    if errorlevel 1 call npm install -g pm2
    call pm2 describe boomrang-chat-backend >nul 2>nul
    if errorlevel 1 (
        call pm2 start src\server.js --name boomrang-chat-backend
    ) else (
        call pm2 restart boomrang-chat-backend
    )
    call pm2 save
)
echo.

echo [8/11] Frontend process ^(persistent Windows Service^)
cd /d "%FRONTEND_DIR%"

rem The frontend service needs its own port and the address of the backend.
rem The browser never uses that address (it always calls /api and /socket.io on
rem the page's own address, which nginx routes to the backend); the frontend
rem service uses it to forward /api and /socket.io requests that reach it
rem directly, so http://<this server>:FRONTEND_PORT also works without nginx.
rem It is derived from PORT/HOST in backend\.env unless frontend\.env sets
rem BACKEND_ORIGIN to a backend on another machine.

set "BMC_BACKEND_ORIGIN="
for /f "delims=" %%O in ('node "%SCRIPT_DIR%frontend-env.js" origin') do set "BMC_BACKEND_ORIGIN=%%O"

if not defined BMC_BACKEND_ORIGIN (
    echo [FATAL] Could not work out the backend address for the frontend service -
    echo   check PORT in backend\.env and BACKEND_ORIGIN in frontend\.env.
    pause
    exit /b 1
)

echo   Frontend service: port %FRONTEND_PORT%, backend reached at !BMC_BACKEND_ORIGIN!

if not exist "%FRONTEND_DIR%\logs" mkdir "%FRONTEND_DIR%\logs" >nul 2>nul

set "BMC_FE_RUNNING=0"

if defined NSSM_EXE if exist "%NSSM_EXE%" (
    for %%L in ("%FRONTEND_DIR%\logs\service-stdout.log" "%FRONTEND_DIR%\logs\service-stderr.log") do (
        if exist "%%~L" for %%S in ("%%~L") do if %%~zS GTR 10485760 del /f /q "%%~L" >nul 2>nul
    )

    sc query "%FRONTEND_SERVICE%" >nul 2>nul
    if errorlevel 1 (
        echo   Installing %FRONTEND_SERVICE% as a Windows Service...
        "%NSSM_EXE%" install "%FRONTEND_SERVICE%" "!BMC_NODE_EXE!" ".output\server\index.mjs" >nul
    ) else (
        sc query "%FRONTEND_SERVICE%" | findstr /i "STOPPED" >nul 2>nul
        if errorlevel 1 (
            echo   %FRONTEND_SERVICE% is running again - stopping it before reconfiguring...
            net stop "%FRONTEND_SERVICE%" >nul 2>nul
            timeout /t 3 /nobreak >nul
            taskkill /f /fi "SERVICES eq %FRONTEND_SERVICE%" >nul 2>nul
        )
    )

    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" Application "!BMC_NODE_EXE!" >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppParameters ".output\server\index.mjs" >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppDirectory "%FRONTEND_DIR%" >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppEnvironmentExtra NODE_ENV=production PORT=%FRONTEND_PORT% HOST=0.0.0.0 BACKEND_ORIGIN=!BMC_BACKEND_ORIGIN! >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" Start SERVICE_AUTO_START >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppExit Default Restart >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppRestartDelay 5000 >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppStdout "%FRONTEND_DIR%\logs\service-stdout.log" >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" AppStderr "%FRONTEND_DIR%\logs\service-stderr.log" >nul
    "%NSSM_EXE%" set "%FRONTEND_SERVICE%" Description "Boomrang Chat web frontend (Node server)" >nul

    echo   Making sure no other node.exe is still bound to port %FRONTEND_PORT%
    echo   before starting %FRONTEND_SERVICE%...
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%FRONTEND_PORT% "') do (
        if not "%%P"=="0" (
            tasklist /fi "PID eq %%P" /fi "IMAGENAME eq node.exe" 2>nul | findstr /i "node.exe" >nul 2>nul
            if not errorlevel 1 taskkill /f /pid %%P >nul 2>nul
        )
    )

    net start "%FRONTEND_SERVICE%" >nul 2>nul
    set "BMC_FE_SVC_STARTED=0"
    for /l %%i in (1,1,20) do (
        if "!BMC_FE_SVC_STARTED!"=="0" (
            sc query "%FRONTEND_SERVICE%" | findstr /i "RUNNING" >nul 2>nul
            if not errorlevel 1 (
                set "BMC_FE_SVC_STARTED=1"
            ) else (
                timeout /t 1 /nobreak >nul
            )
        )
    )
    if "!BMC_FE_SVC_STARTED!"=="1" (
        set "BMC_FE_RUNNING=1"
        if "!BMC_FE_SVC_EXISTED!"=="1" (
            echo   %FRONTEND_SERVICE% restarted and running from %FRONTEND_DIR%.
        ) else (
            echo   %FRONTEND_SERVICE% installed and started as a Windows Service,
            echo   running from %FRONTEND_DIR%.
            echo   It will now start automatically on every future boot together
            echo   with the backend - no manual step needed after a restart.
        )
    ) else (
        echo   [WARNING] %FRONTEND_SERVICE% did not report RUNNING after start -
        echo   check "%FRONTEND_DIR%\logs\service-stderr.log" and
        echo   "sc query %FRONTEND_SERVICE%" for details.
        set OVERALL_WARN=1
    )
) else (
    echo   [WARNING] Falling back to pm2 for this run only - will not survive a reboot.
    where pm2 >nul 2>nul
    if errorlevel 1 call npm install -g pm2
    set "PORT=%FRONTEND_PORT%"
    set "HOST=0.0.0.0"
    set "BACKEND_ORIGIN=!BMC_BACKEND_ORIGIN!"
    set "NODE_ENV=production"
    call pm2 describe %FRONTEND_PM2_NAME% >nul 2>nul
    if errorlevel 1 (
        call pm2 start .output\server\index.mjs --name %FRONTEND_PM2_NAME%
    ) else (
        call pm2 restart %FRONTEND_PM2_NAME% --update-env
    )
    call pm2 save
    set "PORT="
    set "HOST="
    set "BACKEND_ORIGIN="
    set "NODE_ENV="
    set "BMC_FE_RUNNING=1"
)

if "!BMC_FE_RUNNING!"=="1" (
    echo   Waiting for the frontend to answer on port %FRONTEND_PORT% ...
    set "BMC_FE_UP=0"
    for /l %%i in (1,1,20) do (
        if "!BMC_FE_UP!"=="0" (
            powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:%FRONTEND_PORT%/'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
            if not errorlevel 1 (
                set "BMC_FE_UP=1"
            ) else (
                timeout /t 1 /nobreak >nul
            )
        )
    )

    for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%FRONTEND_PORT% "') do set "BMC_LIVE_PID=%%P"
    if defined BMC_LIVE_PID (
        for /f "delims=" %%T in ('powershell -NoProfile -Command "try { (Get-Process -Id !BMC_LIVE_PID!).StartTime } catch { '' }"') do set "BMC_LIVE_STARTTIME=%%T"
        echo   Process actually listening on port %FRONTEND_PORT%: PID !BMC_LIVE_PID!, started !BMC_LIVE_STARTTIME!
        echo   ^(if that start time is not from just now, an old process never
        echo   died and is still the one answering requests - re-run this script^)
    )
    set "BMC_LIVE_PID="
    set "BMC_LIVE_STARTTIME="

    echo   Verifying the running frontend serves the build that was just made
    echo   ^(the page it returns must reference script files that exist in
    echo   frontend\.output\public right now, not ones from an older build^)...
    set "BMC_FE_BUILD="
    for /f "delims=" %%R in ('powershell -NoProfile -Command "try { $h = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://127.0.0.1:%FRONTEND_PORT%/').Content; $m = [regex]::Match($h, '/assets/[A-Za-z0-9_.-]+\.js'); if (-not $m.Success) { 'UNKNOWN' } elseif (Test-Path (Join-Path '%FRONTEND_DIR%\.output\public' $m.Value.Substring(1))) { 'OK' } else { 'STALE' } } catch { 'DOWN' }"') do set "BMC_FE_BUILD=%%R"
    if "!BMC_FE_BUILD!"=="OK" (
        echo   OK - the page on port %FRONTEND_PORT% comes from the build just made.
    ) else if "!BMC_FE_BUILD!"=="STALE" (
        echo.
        echo   ================================================================
        echo   [FATAL-LOOKING] The frontend on port %FRONTEND_PORT% answered, but with
        echo   a page from an OLDER build - its script files do not exist in
        echo   "%FRONTEND_DIR%\.output\public". Something other than the service
        echo   just configured still owns the port, or the service points at a
        echo   different folder. Run: sc qc %FRONTEND_SERVICE%   and compare its
        echo   folder with %FRONTEND_DIR%, then run ops\start.bat again.
        echo   ================================================================
        echo.
        set OVERALL_WARN=1
    ) else if "!BMC_FE_BUILD!"=="DOWN" (
        echo   [WARNING] The frontend did not answer on port %FRONTEND_PORT%. Last 15
        echo   lines from its log:
        echo   ------------------------------------------------------------
        if exist "%FRONTEND_DIR%\logs\service-stderr.log" (
            powershell -NoProfile -Command "Get-Content -Path '%FRONTEND_DIR%\logs\service-stderr.log' -Tail 15" 2>nul
        ) else (
            call pm2 logs %FRONTEND_PM2_NAME% --lines 15 --nostream 2>nul
        )
        echo   ------------------------------------------------------------
        set OVERALL_WARN=1
    ) else (
        echo   [WARNING] Could not confirm which build the frontend serves ^(no script
        echo   file reference found in its page^) - check manually if something seems off.
        set OVERALL_WARN=1
    )
    set "BMC_FE_BUILD="
)
echo.

echo [9/11] Windows Firewall

netsh advfirewall firewall show rule name="Boomrang Chat (app port)" >nul 2>nul

if not errorlevel 1 (

    echo   Removing old rule to refresh it with the current port...

    netsh advfirewall firewall delete rule name="Boomrang Chat (app port)" >nul 2>nul

)

netsh advfirewall firewall add rule name="Boomrang Chat (app port)" dir=in action=allow protocol=TCP localport=%APP_PORT% >nul 2>nul

if errorlevel 1 (

    echo   [WARNING] Could not create the firewall rule for port %APP_PORT%. Other

    echo   PCs on the network may not be able to reach this server. Re-run this

    echo   script as Administrator, or add the rule manually: Windows Defender

    echo   Firewall with Advanced Security -^> Inbound Rules -^> New Rule -^>

    echo   Port -^> TCP -^> %APP_PORT%.

    set OVERALL_WARN=1

) else (

    echo   Allowed inbound TCP %APP_PORT% ^(direct backend access from other PCs^).

)

netsh advfirewall firewall show rule name="Boomrang Chat (frontend port)" >nul 2>nul

if not errorlevel 1 (

    netsh advfirewall firewall delete rule name="Boomrang Chat (frontend port)" >nul 2>nul

)

netsh advfirewall firewall add rule name="Boomrang Chat (frontend port)" dir=in action=allow protocol=TCP localport=%FRONTEND_PORT% >nul 2>nul

if errorlevel 1 (

    echo   [WARNING] Could not create the firewall rule for port %FRONTEND_PORT%. Re-run

    echo   as Administrator, or add it manually as above ^(TCP %FRONTEND_PORT%^).

    set OVERALL_WARN=1

) else (

    echo   Allowed inbound TCP %FRONTEND_PORT% ^(direct app access from other PCs without nginx^).

)

netsh advfirewall firewall show rule name="Boomrang Chat (web 80/443)" >nul 2>nul

if errorlevel 1 (

    netsh advfirewall firewall add rule name="Boomrang Chat (web 80/443)" dir=in action=allow protocol=TCP localport=80,443 >nul 2>nul

    if errorlevel 1 (

        echo   [WARNING] Could not create the firewall rule for ports 80/443 ^(used

        echo   by nginx^). Re-run as Administrator, or add it manually as above.

        set OVERALL_WARN=1

    ) else (

        echo   Allowed inbound TCP 80/443 ^(for nginx, once nginx is set up^).

    )

) else (

    echo   Rule for ports 80/443 already present.

)

echo.

echo [10/11] nginx

if not exist "%NGINX_DIR%\nginx.exe" (

    echo   nginx.exe not found at %NGINX_DIR% - installing it now ^(official

    echo   nginx for Windows build, version %NGINX_VERSION%, from nginx.org^)...

    set "NGINX_ZIP_URL=https://nginx.org/download/nginx-%NGINX_VERSION%.zip"

    set "NGINX_ZIP_PATH=%TEMP%\nginx-%NGINX_VERSION%.zip"

    set "NGINX_EXTRACT_TMP=%TEMP%\nginx-extract-%NGINX_VERSION%"

    echo   Downloading !NGINX_ZIP_URL! ...

    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!NGINX_ZIP_URL!' -OutFile '!NGINX_ZIP_PATH!'" >nul 2>nul

    if not exist "!NGINX_ZIP_PATH!" (

        echo   [WARNING] Could not download nginx. Check your internet connection,

        echo   or extract the nginx for Windows zip into %NGINX_DIR% by hand and

        echo   run ops\start.bat again.

        set OVERALL_WARN=1

    ) else (

        echo   Extracting nginx to %NGINX_DIR% ...

        if exist "!NGINX_EXTRACT_TMP!" rmdir /s /q "!NGINX_EXTRACT_TMP!" >nul 2>nul

        powershell -NoProfile -Command "Expand-Archive -Path '!NGINX_ZIP_PATH!' -DestinationPath '!NGINX_EXTRACT_TMP!' -Force" >nul 2>nul

        if not exist "%NGINX_DIR%" mkdir "%NGINX_DIR%" >nul 2>nul

        for /d %%D in ("!NGINX_EXTRACT_TMP!\nginx-*") do (

            xcopy "%%D\*" "%NGINX_DIR%\" /e /i /y >nul

        )

        if exist "%NGINX_DIR%\nginx.exe" (

            echo   nginx installed at %NGINX_DIR%.

        ) else (

            echo   [WARNING] nginx extraction did not produce %NGINX_DIR%\nginx.exe.

            echo   Extract the nginx for Windows zip into %NGINX_DIR% by hand and run

            echo   ops\start.bat again.

            set OVERALL_WARN=1

        )

    )

)

if exist "%NGINX_DIR%\nginx.exe" (

    echo   Found nginx at %NGINX_DIR%

    echo   Syncing nginx config: /api and /socket.io to the backend ^(port %APP_PORT%^),

    echo   everything else to the frontend ^(port %FRONTEND_PORT%^), plus the TLS certificate...

    node "%ROOT_DIR%\ops\nginx-setup.js" "%NGINX_DIR%"

    if errorlevel 1 (

        echo   [WARNING] nginx config sync/test failed - leaving nginx as-is. Fix

        echo   the issue reported above and re-run this script.

        set OVERALL_WARN=1

    ) else (

        sc query BoomrangChatNginx >nul 2>nul
        if not errorlevel 1 (
            echo   Reloading the BoomrangChatNginx service...
            net stop BoomrangChatNginx >nul 2>nul
            net start BoomrangChatNginx >nul 2>nul
            echo   nginx reloaded.
        ) else (
            tasklist /fi "imagename eq nginx.exe" | findstr /i "nginx.exe" >nul 2>nul
            if not errorlevel 1 (
                echo   Stopping the temporary nginx process so it can be
                echo   registered as a proper Windows Service instead...
                taskkill /f /im nginx.exe >nul 2>nul
            )
            if defined NSSM_EXE if exist "%NSSM_EXE%" (
                echo   Installing BoomrangChatNginx as a Windows Service...
                "%NSSM_EXE%" install BoomrangChatNginx "%NGINX_DIR%\nginx.exe" >nul
                "%NSSM_EXE%" set BoomrangChatNginx AppDirectory "%NGINX_DIR%" >nul
                "%NSSM_EXE%" set BoomrangChatNginx Start SERVICE_AUTO_START >nul
                "%NSSM_EXE%" set BoomrangChatNginx AppExit Default Restart >nul
                "%NSSM_EXE%" set BoomrangChatNginx AppRestartDelay 5000 >nul
                "%NSSM_EXE%" set BoomrangChatNginx AppStopMethodSkip 6 >nul
                "%NSSM_EXE%" set BoomrangChatNginx Description "Nginx reverse proxy for boomrang.lan" >nul
                net start BoomrangChatNginx >nul 2>nul
                echo   BoomrangChatNginx installed and started as a Windows
                echo   Service. It will now start automatically on every future
                echo   boot along with the backend and frontend - no manual step needed.
            ) else (
                echo   [WARNING] NSSM is not available, so nginx was started as
                echo   a plain process for right now - it will NOT survive a
                echo   reboot. Re-run ops\start.bat once NSSM can be downloaded
                echo   ^(see the backend step above^) to make it permanent.
                start "" /d "%NGINX_DIR%" "%NGINX_DIR%\nginx.exe"
                set OVERALL_WARN=1
            )
        )

        echo   Checking that nginx really routes both halves of the app...
        timeout /t 2 /nobreak >nul
        set "BMC_NGX_URL=http://boomrang.lan"
        set "BMC_NGX_RESOLVE=boomrang.lan:80:127.0.0.1"
        findstr /r /c:"listen *443" "%NGINX_DIR%\conf\boomrang.lan.conf" >nul 2>nul
        if not errorlevel 1 (
            set "BMC_NGX_URL=https://boomrang.lan"
            set "BMC_NGX_RESOLVE=boomrang.lan:443:127.0.0.1"
        )
        where curl >nul 2>nul
        if errorlevel 1 (
            echo   curl not found - skipping the nginx routing check.
        ) else (
            curl -s -k -o nul -m 5 -w "%%{http_code}" --resolve !BMC_NGX_RESOLVE! "!BMC_NGX_URL!/api/health" > "%TEMP%\pmc_ngx_api.txt" 2>nul
            set "BMC_NGX_API="
            set /p BMC_NGX_API=<"%TEMP%\pmc_ngx_api.txt"
            curl -s -k -o "%TEMP%\pmc_ngx_page.html" -m 5 -w "%%{http_code}" --resolve !BMC_NGX_RESOLVE! "!BMC_NGX_URL!/" > "%TEMP%\pmc_ngx_page.txt" 2>nul
            set "BMC_NGX_PAGE="
            set /p BMC_NGX_PAGE=<"%TEMP%\pmc_ngx_page.txt"
            set "BMC_NGX_PAGE_OK=0"
            if "!BMC_NGX_PAGE!"=="200" findstr /r /c:"lang=.fa." "%TEMP%\pmc_ngx_page.html" >nul 2>nul && set "BMC_NGX_PAGE_OK=1"
            if "!BMC_NGX_API!"=="200" (
                echo   OK - !BMC_NGX_URL!/api/health reaches the backend through nginx.
            ) else (
                echo   [WARNING] !BMC_NGX_URL!/api/health through nginx answered "!BMC_NGX_API!"
                echo   instead of 200 - check %NGINX_DIR%\logs\error.log.
                set OVERALL_WARN=1
            )
            if "!BMC_NGX_PAGE_OK!"=="1" (
                echo   OK - !BMC_NGX_URL!/ renders the app page from the frontend through nginx.
            ) else (
                echo   [WARNING] !BMC_NGX_URL!/ through nginx answered "!BMC_NGX_PAGE!" without
                echo   the app page - check %NGINX_DIR%\logs\error.log.
                set OVERALL_WARN=1
            )
            del "%TEMP%\pmc_ngx_page.html" "%TEMP%\pmc_ngx_page.txt" "%TEMP%\pmc_ngx_api.txt" >nul 2>nul
        )

    )

) else (

    echo   [WARNING] nginx could not be installed automatically - see above.

    echo   Until that's fixed, the app is still directly reachable on this

    echo   server at http://localhost:!FRONTEND_PORT! because the frontend

    echo   service forwards /api and /socket.io to the backend by itself.

    set OVERALL_WARN=1

)

echo.

echo [11/11] Backups

rem The backend's own backup module is the only backup system. It runs a full
rem database + uploaded files backup every night at 03:00 (Tehran time) into
rem backend\backups, can be started on demand and downloaded from the
rem super_admin panel, and copies every new upload into BACKUP_MIRROR_FILES_DIR
rem the moment it is stored. The old external ops\backup-automation scheduled
rem tasks did the same job a second time (a full robocopy of the whole app
rem folder and a pg_dump every few seconds that were never cleaned up), so they
rem are removed here. Backups they already wrote are left untouched.

set "BMC_OLD_TASKS=0"

for %%T in ("\ChatBackupAutomation\FileMirror" "\ChatBackupAutomation\DatabaseBackup") do (

    schtasks /Query /TN "%%~T" >nul 2>nul

    if not errorlevel 1 (

        schtasks /End /TN "%%~T" >nul 2>nul

        schtasks /Delete /TN "%%~T" /F >nul 2>nul

        echo   Removed the old external backup task %%~T

        set "BMC_OLD_TASKS=1"

    )

)

if "!BMC_OLD_TASKS!"=="1" (

    echo   Anything it had already written to C:\boomrang_backup was left in place.

    echo   Files under C:\boomrang_backup\files stay in use as the upload mirror;

    echo   the old database dumps under C:\boomrang_backup\database can be deleted

    echo   by hand once you no longer need them.

) else (

    echo   No old external backup tasks found - nothing to remove.

)

set "BMC_PG_DUMP="

for /f "usebackq tokens=1,* delims==" %%A in ("%BACKEND_DIR%\.env") do (

    if /i "%%A"=="PG_DUMP_BIN" set "BMC_PG_DUMP=%%B"

)

if defined BMC_PG_DUMP (

    if not exist "!BMC_PG_DUMP!" (

        echo   [WARNING] PG_DUMP_BIN in backend\.env points at "!BMC_PG_DUMP!", which does

        echo   not exist - the nightly backup will fail until it is fixed or emptied.

        set OVERALL_WARN=1

        set "BMC_PG_DUMP="

    )

) else (

    for /f "delims=" %%D in ('where pg_dump 2^>nul') do if not defined BMC_PG_DUMP set "BMC_PG_DUMP=%%D"

    if not defined BMC_PG_DUMP (

        for /d %%V in ("%ProgramFiles%\PostgreSQL\*") do if exist "%%V\bin\pg_dump.exe" set "BMC_PG_DUMP=%%V\bin\pg_dump.exe"

    )

    if not defined BMC_PG_DUMP (

        echo   [WARNING] pg_dump.exe was not found ^(not in PATH and not under

        echo   %ProgramFiles%\PostgreSQL^). The nightly backup and the "backup now"

        echo   button in the super_admin panel will fail until PostgreSQL's client

        echo   tools are installed, or PG_DUMP_BIN in backend\.env points at pg_dump.exe.

        set OVERALL_WARN=1

    )

)

if defined BMC_PG_DUMP (

    echo   Database backup tool: !BMC_PG_DUMP!

    echo   Full database + files backup: every night at 03:00 into backend\backups

    echo   ^(also on demand from the super_admin panel, where each one can be downloaded^).

)

if defined BMC_MIRROR_DIR (

    echo   Every new upload is also copied right away into !BMC_MIRROR_DIR!

)

echo.

echo ================================================================

echo   Final health check

echo ================================================================

set "BMC_HEALTH_OK=0"
set "BMC_FE_OK=0"
set "BMC_FE_PROXY_OK=0"

where curl >nul 2>nul
if errorlevel 1 (set "BMC_USE_CURL=0") else (set "BMC_USE_CURL=1")

echo   Waiting for the backend to respond on port %APP_PORT% ...

for /l %%i in (1,1,15) do (

    if "!BMC_HEALTH_OK!"=="0" (

        if "!BMC_USE_CURL!"=="1" (
            curl -s -o nul -m 1 -w "%%{http_code}" "http://localhost:%APP_PORT%/api/health" > "%TEMP%\pmc_health_code.txt" 2>nul
            set /p BMC_CODE=<"%TEMP%\pmc_health_code.txt"
            if "!BMC_CODE!"=="200" (set "BMC_HEALTH_OK=1")
        ) else (
            powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri 'http://localhost:%APP_PORT%/api/health').StatusCode | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
            if not errorlevel 1 (set "BMC_HEALTH_OK=1")
        )

        if "!BMC_HEALTH_OK!"=="0" (
            timeout /t 1 /nobreak >nul
        )

    )

)

rem A listening port only proves some process is there. The frontend check
rem requests the real page and requires the rendered Persian app document
rem (lang="fa"), then asks the frontend for /api/health to prove it can reach
rem the backend as well.

echo   Waiting for the frontend to render the app on port %FRONTEND_PORT% ...

for /l %%i in (1,1,15) do (

    if "!BMC_FE_OK!"=="0" (

        powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:%FRONTEND_PORT%/'; if ($r.StatusCode -eq 200 -and $r.Content -match 'lang=.fa.' -and $r.Content -match '/assets/') { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
        if not errorlevel 1 (set "BMC_FE_OK=1")

        if "!BMC_FE_OK!"=="0" (
            timeout /t 1 /nobreak >nul
        )

    )

)

if "!BMC_FE_OK!"=="1" (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://127.0.0.1:%FRONTEND_PORT%/api/health'; if ($r.StatusCode -eq 200 -and $r.Content -match 'ok') { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 set "BMC_FE_PROXY_OK=1"
)

if "!BMC_HEALTH_OK!"=="1" (
    echo   OK - backend answers /api/health on port %APP_PORT%.
) else (
    echo   [WARNING] Backend did not answer /api/health within 15 seconds.
    echo   Last 15 lines from the backend's own log:
    echo   ------------------------------------------------------------
    if exist "%BACKEND_DIR%\logs\service-stderr.log" (
        powershell -NoProfile -Command "Get-Content -Path '%BACKEND_DIR%\logs\service-stderr.log' -Tail 15" 2>nul
    ) else (
        call pm2 logs boomrang-chat-backend --lines 15 --nostream 2>nul
    )
    echo   ------------------------------------------------------------
    echo   If nothing useful printed above, check
    echo   "%BACKEND_DIR%\logs\service-stdout.log" and "...\service-stderr.log"
    echo   by hand, or run "sc query %BACKEND_SERVICE%" to see the service state.
    set OVERALL_WARN=1
)

if "!BMC_FE_OK!"=="1" (
    echo   OK - frontend renders the app page on port %FRONTEND_PORT%.
) else (
    echo   [WARNING] Frontend did not render the app page within 15 seconds.
    echo   Last 15 lines from the frontend's own log:
    echo   ------------------------------------------------------------
    if exist "%FRONTEND_DIR%\logs\service-stderr.log" (
        powershell -NoProfile -Command "Get-Content -Path '%FRONTEND_DIR%\logs\service-stderr.log' -Tail 15" 2>nul
    ) else (
        call pm2 logs %FRONTEND_PM2_NAME% --lines 15 --nostream 2>nul
    )
    echo   ------------------------------------------------------------
    echo   If nothing useful printed above, check
    echo   "%FRONTEND_DIR%\logs\service-stdout.log" and "...\service-stderr.log"
    echo   by hand, or run "sc query %FRONTEND_SERVICE%" to see the service state.
    set OVERALL_WARN=1
)

if "!BMC_FE_OK!"=="1" if "!BMC_HEALTH_OK!"=="1" (
    if "!BMC_FE_PROXY_OK!"=="1" (
        echo   OK - the frontend reaches the backend ^(/api/health through port %FRONTEND_PORT%^).
    ) else (
        echo   [WARNING] The frontend renders, but /api/health through port %FRONTEND_PORT%
        echo   failed - it cannot reach the backend at !BMC_BACKEND_ORIGIN!. Pages
        echo   opened directly on port %FRONTEND_PORT% will not be able to log in. Check
        echo   BACKEND_ORIGIN in frontend\.env and run ops\start.bat again.
        set OVERALL_WARN=1
    )
)

echo.

echo ================================================================

echo   Opening the app in your browser

echo ================================================================

set "BMC_ALL_OK=0"

if "!BMC_HEALTH_OK!"=="1" if "!BMC_FE_OK!"=="1" set "BMC_ALL_OK=1"

if "!BMC_ALL_OK!"=="1" (

    rem /api/health only proves SOME node process answers on the port -
    rem it says nothing about whether it is running the code that was
    rem just deployed. Hitting a route with no token deliberately expects
    rem 401 (route exists, auth required); getting 404 back instead means
    rem the running process does not have this route at all, i.e. it is
    rem still the previous version - most commonly because the service
    rem was pointed at a different folder than the one just updated.
    set "BMC_ROUTE_CODE="
    if "!BMC_USE_CURL!"=="1" (
        curl -s -o nul -m 2 -w "%%{http_code}" "http://localhost:%APP_PORT%/api/admin/tags" > "%TEMP%\pmc_route_code.txt" 2>nul
        set /p BMC_ROUTE_CODE=<"%TEMP%\pmc_route_code.txt"
    )
    if "!BMC_ROUTE_CODE!"=="404" (
        echo.
        echo   ================================================================
        echo   [WARNING] The backend answered /api/health, but
        echo   /api/admin/tags came back 404 instead of the expected 401.
        echo   That route exists in this project's code, so a 404 here means
        echo   %BACKEND_SERVICE% is still running an OLDER copy of the backend
        echo   from a different folder than %BACKEND_DIR%.
        echo   Run: sc qc %BACKEND_SERVICE%   and check the BINARY_PATH_NAME /
        echo   working directory it prints against %BACKEND_DIR% by hand.
        echo   ================================================================
        set OVERALL_WARN=1
    )

    if defined BMC_NO_AUTO_OPEN (
        echo   BMC_NO_AUTO_OPEN is set - skipping, open http://localhost:%FRONTEND_PORT% manually.
    ) else (
        echo   Backend and frontend are both up - opening http://localhost:%FRONTEND_PORT% ...
        start "" "http://localhost:%FRONTEND_PORT%"
    )

    echo.
    echo   Employees normally open https://boomrang.lan ^(through nginx^).
    echo   Checking which network address other PCs could use directly instead...
    for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
        set "BMC_IP=%%A"
        set "BMC_IP=!BMC_IP: =!"
        if not "!BMC_IP!"=="127.0.0.1" (
            powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://!BMC_IP!:%FRONTEND_PORT%/api/health').StatusCode | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
            if errorlevel 1 (
                echo     !BMC_IP!:%FRONTEND_PORT%  -^>  NOT reachable from this same machine either - do not give this address to other PCs.
            ) else (
                echo     !BMC_IP!:%FRONTEND_PORT%  -^>  OK, app and API both answer. This is a valid address for other PCs to use.
            )
        )
    )
    echo.
    echo   If the address you are handing out to other PCs is not one of
    echo   the "OK" ones above, that mismatch alone explains "works on
    echo   this PC, nothing on every other PC" - use one of the OK
    echo   addresses instead ^(check ipconfig for which network adapter it
    echo   belongs to^).
    echo   If the correct address DID show as reachable here but other PCs
    echo   on the same network still can't load it, this machine can see
    echo   itself but the network path between it and them is being
    echo   blocked somewhere else - the most common causes, in order:
    echo     1^) Third-party antivirus/firewall software ^(Windows Defender
    echo        Firewall was already opened for %FRONTEND_PORT%, %APP_PORT% and 80/443
    echo        by step [9/11] above, but Kaspersky/ESET/etc. filter separately
    echo        and often block unlisted inbound ports by default^).
    echo     2^) The OTHER PCs and this server are on different
    echo        VLANs/subnets or behind client/AP isolation, so they
    echo        cannot route to each other at all regardless of firewall
    echo        rules - ask IT/networking to confirm both sides are on the
    echo        same broadcast domain.
    echo     3^) This server's Windows network profile for that adapter is
    echo        set to "Public" - Settings -^> Network ^&Internet -^> ^(the
    echo        adapter^) -^> Network profile -^> switch it to "Private".
    echo.

) else (

    echo   Not opening the browser automatically - the backend and/or the
    echo   frontend did not pass the health check above. Once both answer,
    echo   open http://localhost:%FRONTEND_PORT%.

)

echo.

echo ================================================================

if "%OVERALL_WARN%"=="1" (

    echo   Startup finished WITH WARNINGS - scroll up for [WARNING]/[FATAL] lines.

) else (

    echo   Startup finished cleanly. Everything this script can control is up.

)

echo.

echo   Topology:
echo     nginx 80/443 ^(BoomrangChatNginx^)
echo       /api, /socket.io -^> backend  port %APP_PORT%  ^(%BACKEND_SERVICE%^)
echo       everything else  -^> frontend port %FRONTEND_PORT%  ^(%FRONTEND_SERVICE%^)
echo.
echo   The backend, the frontend, nginx, PostgreSQL and Redis now all survive
echo   a reboot automatically, and the backend runs its own nightly backup -
echo   you do NOT need to run this script again after the server restarts,
echo   unless you had run a "stop" script.
echo.
echo   Still outside what any script should silently automate ^(one-time,
echo   whole-network admin work - see the matching folder for each^):

echo     - Installing the PostgreSQL ENGINE itself, if not done yet

echo       ^(Redis and nginx are now both auto-installed by this script^)

echo     - infrastructure\ca         - generating a REAL, network-trusted TLS

echo       certificate ^(nginx already has a working, if self-signed/browser-

echo       warned, certificate in the meantime^)

echo     - infrastructure\dns        - publishing DNS to every client

echo     - infrastructure\dhcp       - reserving a static IP for this server

echo ================================================================

echo.

pause

endlocal
