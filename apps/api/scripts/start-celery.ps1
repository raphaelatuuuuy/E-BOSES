# Starts the E-Boses Celery worker and Beat scheduler.
# Idempotent: safe to run on every boot / logon / after a crash.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-celery.ps1
$ErrorActionPreference = 'Stop'
$ApiDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ApiDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Celery and Channels share the local Redis. Make sure it is up first.
& (Join-Path $PSScriptRoot 'start-redis.ps1')

$FastWorkerPid  = Join-Path $LogDir 'celery-worker.pid'
$HeavyWorkerPid = Join-Path $LogDir 'celery-worker-heavy.pid'
$EmergencyWorkerPid = Join-Path $LogDir 'celery-worker-emergency.pid'
$BeatPid   = Join-Path $LogDir 'celery-beat.pid'
$FastWorkerLog  = Join-Path $LogDir 'celery-worker.log'
$HeavyWorkerLog = Join-Path $LogDir 'celery-worker-heavy.log'
$EmergencyWorkerLog = Join-Path $LogDir 'celery-worker-emergency.log'
$BeatLog   = Join-Path $LogDir 'celery-beat.log'

function Test-CeleryRunning {
  # Match on the -Q flag so "worker" does not also hit "worker-heavy".
  param([string]$Role, [string]$Match)
  $procs = Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '-m celery' -and $_.CommandLine -match $Role }
  if ($Match) {
    $procs = $procs | Where-Object { $_.CommandLine -match $Match }
  }
  return $procs
}

function Start-CeleryProc {
  param([string]$Name, [string]$Role, [string]$PidFile, [string]$LogFile, [string]$Queue = "", [string]$NodeName = "")
  # Match on hostname/pidfile, not just -Q: prod workers share the same queue
  # names on a different broker ("prod-eboses@..." contains "-Q eboses" too)
  # and must not count as this stack running.
  $matchPat = if ($NodeName) { "--hostname $([regex]::Escape($NodeName))@" }
              elseif ($Queue) { "-Q $Queue" }
              else { [regex]::Escape([System.IO.Path]::GetFileName($PidFile)) }
  $already = Test-CeleryRunning -Role $Role -Match $matchPat
  if ($already) {
    $ids = ($already | ForEach-Object { $_.ProcessId }) -join ', '
    Write-Host "$Name already running (PID $ids) - nothing to do."
    return
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  $cmd = '-m celery -A config {0} -l INFO --logfile "{1}" --pidfile "{2}"' -f $Role, $LogFile, $PidFile
  if ($Role -like 'worker*') {
    $cmd = '-m celery -A config worker -l INFO -Q {0} --pool=solo --hostname {1}@%h --logfile "{2}" --pidfile "{3}"' -f $Queue, $NodeName, $LogFile, $PidFile
  }
  $p = Start-Process -FilePath 'python' -ArgumentList $cmd -WorkingDirectory $ApiDir -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 6
  if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) {
    Write-Host "Started $Name (PID $($p.Id)). Log: $LogFile"
  } else {
    Write-Host "WARNING: $Name exited during startup. Check $LogFile"
  }
}

# Two solo workers: the fast queue (OTP/SMS, emergency notifications,
# dispatch broadcasts) must never queue behind minutes-long vision/AI jobs.
# emergency has its own worker so dispatch never waits behind AI/media.
Start-CeleryProc -Name 'Celery worker (fast)'  -Role 'worker'        -Queue 'eboses' -NodeName 'eboses' -PidFile $FastWorkerPid  -LogFile $FastWorkerLog
Start-CeleryProc -Name 'Celery worker (heavy)' -Role 'worker-heavy'  -Queue 'heavy'  -NodeName 'heavy'  -PidFile $HeavyWorkerPid -LogFile $HeavyWorkerLog
Start-CeleryProc -Name 'Celery worker (emergency)' -Role 'worker-emergency' -Queue 'emergency' -NodeName 'emergency' -PidFile $EmergencyWorkerPid -LogFile $EmergencyWorkerLog
Start-CeleryProc -Name 'Celery beat'           -Role 'beat'          -PidFile $BeatPid        -LogFile $BeatLog

Write-Host ''
Write-Host 'Current celery processes:'
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-m celery' } |
  ForEach-Object { Write-Host ("  PID {0}: {1}" -f $_.ProcessId, $_.CommandLine) }
