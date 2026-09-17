@echo off
setlocal enabledelayedexpansion

set TASK_NAME=BoomrangChatHealthCheck
set SCRIPT_DIR=%~dp0
set SCRIPT_PATH=%SCRIPT_DIR%check-server-health.bat

if not exist "%SCRIPT_PATH%" (
    echo check-server-health.bat not found next to this script
    exit /b 1
)

schtasks /query /tn "%TASK_NAME%" >nul 2>nul
if not errorlevel 1 (
    echo Scheduled task %TASK_NAME% already exists
    exit /b 0
)

schtasks /create /tn "%TASK_NAME%" /tr "\"%SCRIPT_PATH%\"" /sc minute /mo 30 /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 (
    echo Failed to create scheduled task %TASK_NAME%
    exit /b 1
)

echo Scheduled task %TASK_NAME% created, runs check-server-health.bat every 30 minutes

endlocal
