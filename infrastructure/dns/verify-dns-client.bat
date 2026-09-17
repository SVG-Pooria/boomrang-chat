@echo off
setlocal enabledelayedexpansion

set HOSTNAME=boomrang.lan
set FAIL=0

echo Checking DNS resolution for %HOSTNAME%...
nslookup %HOSTNAME% >"%TEMP%\boomrang_nslookup.txt" 2>&1
findstr /i "can't find" "%TEMP%\boomrang_nslookup.txt" >nul 2>nul
if not errorlevel 1 (
    echo DNS resolution failed for %HOSTNAME%
    type "%TEMP%\boomrang_nslookup.txt"
    set FAIL=1
) else (
    echo DNS resolution succeeded
    type "%TEMP%\boomrang_nslookup.txt"
)
del "%TEMP%\boomrang_nslookup.txt" >nul 2>nul

echo Checking reachability for %HOSTNAME%...
where curl >nul 2>nul
if errorlevel 1 (
    echo curl not found in PATH, skipping HTTPS check
) else (
    curl -s -o nul -w "%%{http_code}" http://%HOSTNAME%/api/health > "%TEMP%\boomrang_http_code.txt" 2>nul
    set /p HTTP_CODE=<"%TEMP%\boomrang_http_code.txt"
    del "%TEMP%\boomrang_http_code.txt" >nul 2>nul
    if "!HTTP_CODE!"=="200" (
        echo Reachability check succeeded, status 200
    ) else (
        echo Reachability check did not return 200, got: !HTTP_CODE!
        echo If this is a certificate error, run infrastructure\ca\install-root-ca-client.bat on this machine
        set FAIL=1
    )
)

if %FAIL%==1 (
    echo One or more checks failed
    exit /b 1
) else (
    echo All checks passed
    exit /b 0
)

endlocal
