# Starts the E-Boses local Redis server.
# Idempotent: safe to run on every boot / logon / after a crash.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-redis.ps1
$ErrorActionPreference = 'Stop'
$ApiDir = Split-Path -Parent $PSScriptRoot
$Conf   = Join-Path $PSScriptRoot 'redis.conf'
$RedisExe = Join-Path $env:USERPROFILE 'redis\redis-server.exe'
$RedisCli = Join-Path $env:USERPROFILE 'redis\redis-cli.exe'

if (-not (Test-Path $RedisExe)) {
  Write-Error "redis-server.exe not found at $RedisExe. Download from https://github.com/tporadowski/redis/releases"
  exit 1
}

$listening = Get-NetTCPConnection -State Listen -LocalPort 6379 -ErrorAction SilentlyContinue
if ($listening) {
  $alive = & $RedisCli -p 6379 ping 2>$null
  if ($alive -match 'PONG') {
    Write-Host "Redis already running on port 6379 - nothing to do."
    exit 0
  }
  Write-Host "Port 6379 is occupied but not responding to PING; trying to start anyway."
}

$p = Start-Process -FilePath $RedisExe -ArgumentList "`"$Conf`"" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
$ping = & $RedisCli -p 6379 ping 2>$null
if ($ping -match 'PONG') {
  Write-Host "Redis started (PID $($p.Id)): $ping"
} else {
  Write-Warning "Redis process started (PID $($p.Id)) but PING failed. Check $env:USERPROFILE\redis\data\redis.log"
  exit 1
}
