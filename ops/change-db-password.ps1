$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot "..\backend\.env"

function Get-ChatDbConfig {
    param([string]$EnvPath)
    if (-not (Test-Path $EnvPath)) { return $null }
    $line = Get-Content $EnvPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if (-not $line) { return $null }
    $value = ($line -split '=', 2)[1].Trim()
    if ($value -notmatch '^postgres(ql)?://([^:@/]+)(:([^@/]*))?@([^:/]+)(:(\d+))?/([^\?\s]+)') { return $null }
    return @{
        User     = $matches[2]
        Password = $matches[4]
        HostName = $matches[5]
        Port     = $(if ($matches[7]) { $matches[7] } else { "5432" })
        Database = $matches[8]
    }
}

function Get-PgToolPath {
    param([string]$ToolName)
    $cmd = Get-Command $ToolName -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $pgRoot = "C:\Program Files\PostgreSQL"
    if (Test-Path $pgRoot) {
        $dirs = Get-ChildItem $pgRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
        foreach ($d in $dirs) {
            $candidate = Join-Path $d.FullName "bin\$ToolName.exe"
            if (Test-Path $candidate) { return $candidate }
        }
    }
    return $null
}

Write-Host "================================================"
Write-Host "  Boomrang Chat - Change Database Password"
Write-Host "================================================"
Write-Host ""

if (-not (Test-Path $envPath)) {
    Write-Host "[ERROR] .env file not found at: $envPath" -ForegroundColor Red
    exit 1
}

$cfg = Get-ChatDbConfig -EnvPath $envPath
if ($null -eq $cfg) {
    Write-Host "[ERROR] Could not read DATABASE_URL from $envPath" -ForegroundColor Red
    exit 1
}

Write-Host "Database user:     $($cfg.User)"
Write-Host "Database name:     $($cfg.Database)"
Write-Host "Database host:     $($cfg.HostName):$($cfg.Port)"
Write-Host ""

$newSecure1 = Read-Host "Enter the NEW database password" -AsSecureString
$newSecure2 = Read-Host "Enter it again to confirm" -AsSecureString
$newPlain1 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($newSecure1))
$newPlain2 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($newSecure2))

if ([string]::IsNullOrEmpty($newPlain1)) {
    Write-Host "[ERROR] No password entered. Cancelled, nothing was changed." -ForegroundColor Red
    exit 1
}
if ($newPlain1 -ne $newPlain2) {
    Write-Host "[ERROR] The two passwords did not match. Cancelled, nothing was changed." -ForegroundColor Red
    exit 1
}
$newPassword = $newPlain1

$psqlExe = Get-PgToolPath -ToolName "psql"
if (-not $psqlExe) {
    Write-Host "[ERROR] Could not find psql.exe (PostgreSQL command line tool)." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "PostgreSQL will now ask for the CURRENT password of the '$($cfg.User)' role"
Write-Host "to authenticate before changing it."
Write-Host ""

$alterSql = "ALTER USER " + $cfg.User + " WITH PASSWORD '" + ($newPassword -replace "'", "''") + "';"
& $psqlExe -h $cfg.HostName -p $cfg.Port -U $cfg.User -d postgres -c $alterSql
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Failed to change the password on the database server. Nothing in .env was changed." -ForegroundColor Red
    exit 1
}

$backupName = $envPath + ".bak." + (Get-Date -Format "yyyyMMdd_HHmmss")
Copy-Item $envPath $backupName
Write-Host ""
Write-Host "Backed up current .env to $backupName"

$envLines = Get-Content $envPath
$encodedPassword = [uri]::EscapeDataString($newPassword)
$newUrl = "postgres://" + $cfg.User + ":" + $encodedPassword + "@" + $cfg.HostName + ":" + $cfg.Port + "/" + $cfg.Database
$newLines = $envLines | ForEach-Object {
    if ($_ -match '^\s*DATABASE_URL\s*=') { "DATABASE_URL=$newUrl" } else { $_ }
}
Set-Content -Path $envPath -Value $newLines -Encoding UTF8

Write-Host "Verifying the new password works..."
$env:PGPASSWORD = $newPassword
& $psqlExe -h $cfg.HostName -p $cfg.Port -U $cfg.User -d $cfg.Database -c "SELECT 1;" | Out-Null
$verifyCode = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($verifyCode -ne 0) {
    Write-Host "[ERROR] Could not connect with the new password. Restoring the previous .env." -ForegroundColor Red
    Copy-Item $backupName $envPath -Force
    exit 1
}

Write-Host ""
Write-Host "Password changed successfully." -ForegroundColor Green
Write-Host ""

$serviceName = "BoomrangChatBackend"
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc) {
    $restart = Read-Host "Restart the $serviceName service now so it uses the new password? (Y/N)"
    if ($restart -match "^[Yy]") {
        Restart-Service -Name $serviceName -Force
        Write-Host "Restarted $serviceName."
    } else {
        Write-Host "Remember: $serviceName still uses the OLD password until you restart it."
    }
} else {
    Write-Host "Note: service '$serviceName' was not found, restart the chat application manually so it picks up the new password."
}

Write-Host ""
Write-Host "The in-app backup reads DATABASE_URL from the running backend, so restarting the service is all it needs."
