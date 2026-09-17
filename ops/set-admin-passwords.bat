@echo off

setlocal

title Boomrang Chat - Set Super-Admin Passwords

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

call npm run set-admin-passwords

if errorlevel 1 (

    echo [FATAL] Could not update the passwords. Check the error above.

    pause

    exit /b 1

)

echo.

echo Done. Both super_admin accounts can now log in with the new password.

pause

endlocal
