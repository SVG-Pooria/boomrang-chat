@echo off

setlocal enabledelayedexpansion

title Boomrang Chat - .env Setup

cd /d "%~dp0"

set "SCRIPT_DIR=%~dp0"

set "ROOT_DIR=%SCRIPT_DIR%.."

set "BACKEND_DIR=%ROOT_DIR%\backend"

set "FRONTEND_DIR=%ROOT_DIR%\frontend"

set "APP_PORT=1234"

set "FRONTEND_PORT=1235"

set "BACKUP_MIRROR_DEFAULT=C:\boomrang_backup\files"

echo ================================================================

echo   Boomrang Chat - .env Setup

echo ================================================================

echo.

where node >nul 2>nul

if errorlevel 1 (

    echo [FATAL] Node.js was not found in PATH. Install Node.js first.

    pause

    exit /b 1

)

if not exist "%BACKEND_DIR%\.env.example" (

    echo [FATAL] Could not find %BACKEND_DIR%\.env.example

    pause

    exit /b 1

)

if exist "%BACKEND_DIR%\.env" (

    echo backend\.env already exists - leaving it untouched.

    echo Delete it first if you really want to regenerate it from scratch.

) else (

    echo -- Backend settings --------------------------------------------------

    echo.

    echo 1^) PostgreSQL

    echo    This is the password you set for the "postgres" user when you

    echo    installed PostgreSQL.

    echo    IMPORTANT: because of how Windows batch files work, avoid the

    echo    exclamation mark and these other characters in the password you

    echo    type here: %% ^^ ^& @ / : " ' space

    echo    If your real password contains any of those, skip this prompt

    echo    ^(leave it empty and press Enter^) and edit backend\.env by hand

    echo    afterwards instead - this script will still create the rest of

    echo    the file for you.

    set "PG_PASSWORD="

    set /p PG_PASSWORD=   Enter the PostgreSQL "postgres" user password:

    set "PG_PLACEHOLDER=0"

    if not defined PG_PASSWORD (

        echo    Left empty - writing a placeholder. You MUST edit the

        echo    DATABASE_URL line in backend\.env by hand before running

        echo    ops\start.bat, or migration will fail.

        set "PG_PASSWORD=CHANGE_ME"

        set "PG_PLACEHOLDER=1"

    )

    set "PG_HOST=localhost"

    set /p PG_HOST=   PostgreSQL host [default: localhost]:

    if not defined PG_HOST set "PG_HOST=localhost"

    set "PG_PORT=5432"

    set /p PG_PORT=   PostgreSQL port [default: 5432]:

    if not defined PG_PORT set "PG_PORT=5432"

    set "PG_DB=boomrang"

    set /p PG_DB=   Database name [default: boomrang]:

    if not defined PG_DB set "PG_DB=boomrang"

    echo.

    echo 2^) Redis

    set "REDIS_HOST=127.0.0.1"

    set /p REDIS_HOST=   Redis host [default: 127.0.0.1]:

    if not defined REDIS_HOST set "REDIS_HOST=127.0.0.1"

    set "REDIS_PORT=6379"

    set /p REDIS_PORT=   Redis port [default: 6379]:

    if not defined REDIS_PORT set "REDIS_PORT=6379"

    echo.

    echo 3^) Ports

    echo    Using the standard ports: backend !APP_PORT!, frontend !FRONTEND_PORT!

    echo    ^(nginx serves both to employees on 80/443^)

    echo.

    echo 4^) Antivirus scanning of uploaded files ^(ClamAV^)

    echo    ClamAV/clamd is not installed by this script. If it is not
    echo    installed and running on this machine, uploads will still work
    echo    normally - the app automatically skips the scan and marks those
    echo    files as unscanned instead of blocking them.

    set "CLAM_ENABLED=true"

    set /p CLAM_ENABLED=   Enable ClamAV scanning? [true/false, default: true]:

    if not defined CLAM_ENABLED set "CLAM_ENABLED=true"

    echo.

    echo Generating JWT_SECRET and PASSWORD_ENCRYPTION_KEY automatically...

    for /f "delims=" %%K in ('node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"') do set "JWT_SECRET_VAL=%%K"

    for /f "delims=" %%K in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set "ENC_KEY_VAL=%%K"

    (

        echo NODE_ENV=production

        echo PORT=!APP_PORT!

        echo HOST=0.0.0.0

        echo CORS_ORIGINS=

        echo DATABASE_URL=postgres://postgres:!PG_PASSWORD!@!PG_HOST!:!PG_PORT!/!PG_DB!

        echo JWT_SECRET=!JWT_SECRET_VAL!

        echo JWT_EXPIRES_IN=12h

        echo PASSWORD_ENCRYPTION_KEY=!ENC_KEY_VAL!

        echo REDIS_URL=redis://!REDIS_HOST!:!REDIS_PORT!

        echo UPLOAD_DIR=./uploads

        echo CLAMSCAN_ENABLED=!CLAM_ENABLED!

        echo CLAMSCAN_BIN=clamdscan

        echo.

        echo # Leave empty to find pg_dump.exe for the nightly backup automatically.

        echo PG_DUMP_BIN=

        echo.

        echo # Every upload is copied here as well. Empty turns the per-file mirror off.

        echo BACKUP_MIRROR_FILES_DIR=!BACKUP_MIRROR_DEFAULT!

        echo.

        echo # Used only once, by "node src/db/seed.js", to set the initial password

        echo # for the two seeded super_admin accounts. Leave blank to have seed.js

        echo # generate and print a random one-time password instead.

        echo SEED_SUPER_ADMIN_1_PASSWORD=

        echo SEED_SUPER_ADMIN_2_PASSWORD=

    ) > "%BACKEND_DIR%\.env"

    echo Verifying DATABASE_URL was written correctly...

    set "ENV_FILE_PATH=%BACKEND_DIR%\.env"

    node -e "const fs=require('fs');const c=fs.readFileSync(process.env.ENV_FILE_PATH,'utf8');const line=(c.split(/\r?\n/).find(l=>l.indexOf('DATABASE_URL=')===0))||'';const val=line.slice('DATABASE_URL='.length);try{const u=new URL(val);console.log('  OK: '+u.protocol+'//'+u.username+':***@'+u.host+u.pathname);}catch(e){console.log('  BROKEN: '+e.message);process.exit(1);}"

    if errorlevel 1 (

        echo [FATAL] backend\.env was written but DATABASE_URL is not a valid

        echo   URL - do NOT run ops\start.bat yet. Open backend\.env, check the

        echo   DATABASE_URL line, and fix it by hand ^(this usually means the

        echo   PostgreSQL password contained a character this script warned

        echo   about^).

        pause

        exit /b 1

    )

    echo.

    echo backend\.env created.

    if "!PG_PLACEHOLDER!"=="1" (

        echo [REMINDER] Open backend\.env and replace CHANGE_ME in the

        echo DATABASE_URL line with your real PostgreSQL password before

        echo running ops\start.bat.

    )

)

echo.

if exist "%FRONTEND_DIR%\.env" (

    echo frontend\.env already exists - leaving it untouched.

    echo Delete it first if you really want to regenerate it from scratch.

) else (

    echo -- Frontend settings ---------------------------------------------------

    echo.

    echo The frontend runs as its own Windows service on port !FRONTEND_PORT!.

    echo Nothing needs to be typed here: employees' browsers always call the

    echo API on the same address they opened the page from ^(nginx sends /api

    echo and /socket.io to the backend^), and ops\start.bat works out the

    echo backend address for the frontend service from backend\.env. This is

    echo also what makes the SAME build work on every employee machine.

    echo.

    node "%SCRIPT_DIR%frontend-env.js" sync !FRONTEND_PORT! !APP_PORT!

    if errorlevel 1 (

        echo [FATAL] Could not create frontend\.env - see the message above.

        pause

        exit /b 1

    )

)

echo.

echo ================================================================

if defined BMC_FROM_START (

    echo   Done. Continuing with ops\start.bat automatically...

) else (

    echo   Done. Now run ops\start.bat to bring the whole system up.

)

echo ================================================================

echo.

if not defined BMC_FROM_START pause

endlocal
