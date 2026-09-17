@echo off
setlocal
title Boomrang Chat - Change Database Password

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo This action needs Administrator rights.
    echo Opening the Windows confirmation window ^(UAC^)...
    echo If a window titled "User Account Control" appears, click Yes.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "change-db-password.ps1"

echo.
pause
