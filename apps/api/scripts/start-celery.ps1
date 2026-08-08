# Starts the E-Boses Celery worker and Beat scheduler.
# Idempotent: safe to run on every boot / logon / after a crash.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-celery.ps1
$ErrorActionPreference = 'Stop'
$ApiDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ApiDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Celery and Channels share the local Redis. Make sure it is up first.
& (Join-Path $PSScriptRoot 'start-redis.ps1')

$WorkerPid = Join-Path $LogDir 'celery-worker.pid'
$BeatPid   = Join-Path $LogDir 'celery-beat.pid'
$WorkerLog = Join-Path $LogDir 'celery-worker.log'
$BeatLog   = Join-Path $LogDir 'celery-beat.log'

function Test-CeleryRunning {
  param([string]$Role)
  $procs = Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '-m celery' -and $_.CommandLine -match $Role }
  return $procs
}

function Start-CeleryProc {
  param([string]$Name, [string]$Role, [string]$PidFile, [string]$LogFile)
  $already = Test-CeleryRunning -Role $Role
  if ($already) {
    $ids = ($already | ForEach-Object { $_.ProcessId }) -join ', '
    Write-Host "$Name already running (PID $ids) - nothing to do."
    return
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  $cmd = '-m celery -A config {0} -l INFO --logfile "{1}" --pidfile "{2}"' -f $Role, $LogFile, $PidFile
  if ($Role -eq 'worker') { $cmd = '-m celery -A config worker -l INFO -Q eboses --pool=solo --logfile "{0}" --pidfile "{1}"' -f $LogFile, $PidFile }
  $p = Start-Process -FilePath 'python' -ArgumentList $cmd -WorkingDirectory $ApiDir -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 6
  if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) {
    Write-Host "Started $Name (PID $($p.Id)). Log: $LogFile"
  } else {
    Write-Host "WARNING: $Name exited during startup. Check $LogFile"
  }
}

Start-CeleryProc -Name 'Celery worker' -Role 'worker' -PidFile $WorkerPid -LogFile $WorkerLog
Start-CeleryProc -Name 'Celery beat'    -Role 'beat'    -PidFile $BeatPid    -LogFile $BeatLog

Write-Host ''
Write-Host 'Current celery processes:'
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-m celery' } |
  ForEach-Object { Write-Host ("  PID {0}: {1}" -f $_.ProcessId, $_.CommandLine) }
