@echo off
setlocal enabledelayedexpansion

title Boomrang Chat - point this PC at the chat server

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo This script must run as Administrator ^(it edits the Windows hosts file^).
    echo Right-click add-client-hosts-entry.bat and choose "Run as administrator".
    pause
    exit /b 1
)

set "SERVER_IP=%~1"
if "%SERVER_IP%"=="" (
    set /p SERVER_IP=Enter the chat server IP address (for example 192.168.1.50):
)

if "%SERVER_IP%"=="" (
    echo No IP address given - nothing changed.
    pause
    exit /b 1
)

set "HOSTS=%SystemRoot%\System32\drivers\etc\hosts"
set "MARKER=# boomrang chat"
set "TMP_HOSTS=%TEMP%\boomrang-hosts.tmp"

findstr /v /c:"%MARKER%" "%HOSTS%" > "%TMP_HOSTS%"
echo %SERVER_IP% boomrang.lan boomrang %MARKER%>> "%TMP_HOSTS%"
copy /y "%TMP_HOSTS%" "%HOSTS%" >nul
del "%TMP_HOSTS%" >nul 2>nul

ipconfig /flushdns >nul 2>nul

echo.
echo   Done. This PC now resolves:
echo     boomrang.lan  -^> %SERVER_IP%
echo     boomrang      -^> %SERVER_IP%
echo.
echo   Open the chat with:  http://boomrang.lan
echo.
ping -n 1 boomrang.lan >nul 2>nul
if errorlevel 1 (
    echo   [WARNING] boomrang.lan still does not resolve. Check that %SERVER_IP% is correct
    echo   and that this PC is on the same network as the server.
) else (
    echo   Name check passed.
)
echo.
pause
endlocal
