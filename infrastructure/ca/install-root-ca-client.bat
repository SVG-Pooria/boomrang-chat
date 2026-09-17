@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set CERT_FILE=%SCRIPT_DIR%boomrangRootCA.crt
set CERT_SUBJECT=boomrang

if not exist "%CERT_FILE%" (
    echo Certificate file not found at %CERT_FILE%
    echo Copy boomrangRootCA.crt from the server output folder next to this script first
    exit /b 1
)

net session >nul 2>nul
if errorlevel 1 (
    echo This script must be run as Administrator
    exit /b 1
)

certutil -store Root "%CERT_SUBJECT%" >nul 2>nul
if not errorlevel 1 (
    echo Root certificate is already trusted on this machine
    exit /b 0
)

certutil -addstore Root "%CERT_FILE%"
if errorlevel 1 (
    echo Failed to install the root certificate
    exit /b 1
)

echo Root certificate installed into the Trusted Root Certification Authorities store

endlocal
