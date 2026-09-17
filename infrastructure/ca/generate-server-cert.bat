@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set OUT_DIR=%SCRIPT_DIR%output
set CA_KEY=%OUT_DIR%\boomrangRootCA.key
set CA_CERT=%OUT_DIR%\boomrangRootCA.crt
set SERVER_KEY=%OUT_DIR%\boomrang.lan.key
set SERVER_CSR=%OUT_DIR%\boomrang.lan.csr
set SERVER_CERT=%OUT_DIR%\boomrang.lan.crt

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

if not exist "%CA_KEY%" (
    echo Root CA not found, run generate-root-ca.bat first
    exit /b 1
)

"%OPENSSL%" genrsa -out "%SERVER_KEY%" 2048
if errorlevel 1 (
    echo Server key generation failed
    exit /b 1
)

"%OPENSSL%" req -new -key "%SERVER_KEY%" -out "%SERVER_CSR%" -config "%SCRIPT_DIR%openssl-server.cnf"
if errorlevel 1 (
    echo Certificate signing request generation failed
    exit /b 1
)

"%OPENSSL%" x509 -req -in "%SERVER_CSR%" -CA "%CA_CERT%" -CAkey "%CA_KEY%" -CAcreateserial -out "%SERVER_CERT%" -days 825 -sha256 -extfile "%SCRIPT_DIR%openssl-server.cnf" -extensions v3_req
if errorlevel 1 (
    echo Server certificate signing failed
    exit /b 1
)

echo Server key:  %SERVER_KEY%
echo Server cert: %SERVER_CERT%
echo Run ops\start.bat next - its nginx step finds these two files automatically
echo and copies them into C:\nginx\ssl for you, no manual copy needed.

endlocal
