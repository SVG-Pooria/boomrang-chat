@echo off

setlocal

title Boomrang Chat - Change Port

set "NEW_PORT=1234"

set "NEW_FRONTEND_PORT=1235"

cd /d "%~dp0..\backend"

if not exist ".env" (

    echo [FATAL] Missing backend\.env - run ops\setup-env.bat first.

    pause

    exit /b 1

)

if not exist "node_modules" (

    echo Installing backend dependencies first ^(npm install^)...

    call npm install --omit=dev

    if errorlevel 1 (

        echo [FATAL] npm install failed.

        pause

        exit /b 1

    )

)

call npm run set-port -- %NEW_PORT%

if errorlevel 1 (

    echo [FATAL] Could not change the backend port. Check the error above.

    pause

    exit /b 1

)

node "%~dp0frontend-env.js" sync %NEW_FRONTEND_PORT% %NEW_PORT%

if errorlevel 1 (

    echo [FATAL] Could not change the frontend port. Check the error above.

    pause

    exit /b 1

)

echo.

echo Backend port: %NEW_PORT%   Frontend port: %NEW_FRONTEND_PORT%

echo.

echo Now run ops\start.bat to restart both services on these ports and

echo re-sync nginx to match. If you changed the numbers at the top of this

echo file, change APP_PORT / FRONTEND_PORT at the top of ops\start.bat to the

echo same values, otherwise it puts the standard ports back.

pause

endlocal
