@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
set LOG_FILE=%LOG_DIR%\health-check.log
set DISK_WARN_PERCENT=85
set BACKEND_DIR=%SCRIPT_DIR%..\..\backend

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value ^| findstr "="') do set DATETIME=%%a
set TIMESTAMP=%DATETIME:~0,4%-%DATETIME:~4,2%-%DATETIME:~6,2% %DATETIME:~8,2%:%DATETIME:~10,2%:%DATETIME:~12,2%

echo ---------------------------------------------- >> "%LOG_FILE%"
echo %TIMESTAMP% >> "%LOG_FILE%"

call "%SCRIPT_DIR%verify-boot-persistence.bat" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo WARNING: one or more services failed the boot persistence check >> "%LOG_FILE%"
)

for %%D in ("%BACKEND_DIR%") do set BACKEND_DRIVE=%%~dD

set FREE_BYTES=
set TOTAL_BYTES=
for /f "tokens=1,2 delims==" %%a in ('wmic logicaldisk where "DeviceID='%BACKEND_DRIVE%'" get FreeSpace^,Size /value ^| findstr "="') do (
    if "%%a"=="FreeSpace" set FREE_BYTES=%%b
    if "%%a"=="Size" set TOTAL_BYTES=%%b
)

if defined FREE_BYTES if defined TOTAL_BYTES (
    set FREE_SCALED=%FREE_BYTES:~0,-6%
    set TOTAL_SCALED=%TOTAL_BYTES:~0,-6%
    if "!FREE_SCALED!"=="" set FREE_SCALED=0
    if "!TOTAL_SCALED!"=="" set TOTAL_SCALED=1
    set /a USED_PERCENT=100-(!FREE_SCALED!*100/!TOTAL_SCALED!)
    echo Disk usage on %BACKEND_DRIVE% : !USED_PERCENT! percent used >> "%LOG_FILE%"
    if !USED_PERCENT! GEQ %DISK_WARN_PERCENT% (
        echo WARNING: disk usage on %BACKEND_DRIVE% is at or above %DISK_WARN_PERCENT% percent >> "%LOG_FILE%"
    )
) else (
    echo WARNING: could not determine disk usage for %BACKEND_DRIVE% >> "%LOG_FILE%"
)

echo Health check completed, see %LOG_FILE% for details

endlocal
