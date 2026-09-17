@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set OUT_DIR=%SCRIPT_DIR%output
set CA_KEY=%OUT_DIR%\boomrangRootCA.key
set CA_CERT=%OUT_DIR%\boomrangRootCA.crt

set "OPENSSL=openssl"
where openssl >nul 2>nul
if errorlevel 1 (
    if exist "%ProgramFiles%\Git\usr\bin\openssl.exe" (
        set "OPENSSL=%ProgramFiles%\Git\usr\bin\openssl.exe"
    ) else if exist "%ProgramFiles(x86)%\Git\usr\bin\openssl.exe" (
        set "OPENSSL=%ProgramFiles(x86)%\Git\usr\bin\openssl.exe"
    ) else (
        echo OpenSSL was not found in PATH and Git for Windows is not installed either.
        echo Install OpenSSL ^(or Git for Windows^) and run this script again.
        exit /b 1
    )
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

if exist "%CA_KEY%" (
    echo Root CA already exists at %CA_KEY%
    exit /b 0
)

"%OPENSSL%" genrsa -aes256 -out "%CA_KEY%" 4096
if errorlevel 1 (
    echo CA private key generation failed
    exit /b 1
)

"%OPENSSL%" req -x509 -new -nodes -key "%CA_KEY%" -sha256 -days 3650 -out "%CA_CERT%" -config "%SCRIPT_DIR%openssl-ca.cnf"
if errorlevel 1 (
    echo CA certificate generation failed
    exit /b 1
)

echo Root CA key:  %CA_KEY%
echo Root CA cert: %CA_CERT%
echo Import boomrangRootCA.crt into the Trusted Root store on every client machine

endlocal
