# Starts E-Boses Celery workers + Beat against PRODUCTION (Supabase + Upstash).
# Hybrid free-tier setup: Render runs the web API, this laptop runs background jobs.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-celery-prod.ps1
# Requires repo-root .env.production (DJANGO_SECRET_KEY/JWT/ALLOWED_HOSTS filled).
$ErrorActionPreference = 'Stop'
$ApiDir = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ApiDir)
$EnvFile = Join-Path $RepoRoot '.env.production'
$LogDir = Join-Path $ApiDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $EnvFile)) {
  Write-Error ".env.production not found at $EnvFile"
  exit 1
}

$loaded = 0
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and ($value.StartsWith('"') -or $value.StartsWith("'"))) {
      $value = $value.Trim('"', "'")
    }
    if ($value -match 'PASTE-ME|FILL-AFTER-DEPLOY') {
      Write-Error "$($Matches[1]) still has a placeholder value in $EnvFile - fill it first."
      exit 1
    }
    Set-Item -Path "Env:\$($Matches[1])" -Value $value
    $loaded++
  }
}
Write-Host "Loaded $loaded vars from .env.production (DJANGO_ENV=$env:DJANGO_ENV, broker=$($env:CELERY_BROKER_URL -replace ':[^:@/]+@', ':***@'))"

$FastPid = Join-Path $LogDir 'celery-prod-worker.pid'
$HeavyPid = Join-Path $LogDir 'celery-prod-worker-heavy.pid'
$BeatPid = Join-Path $LogDir 'celery-prod-beat.pid'

function Test-CeleryRunning {
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
  # Match prod hostnames/logfiles only: local dev workers use the same queues
  # on the local broker and must not count here.
  $matchPat = if ($NodeName) { $NodeName } elseif ($Queue) { "-Q $Queue" } else { "celery-prod-" }
  $already = Test-CeleryRunning -Role $Role -Match $matchPat
  if ($already) {
    $ids = ($already | ForEach-Object { $_.ProcessId }) -join ', '
    Write-Host "$Name already running (PID $ids) - nothing to do."
    return
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  $cmd = '-m celery -A config beat -l INFO --logfile "{0}" --pidfile "{1}"' -f $LogFile, $PidFile
  if ($Role -like 'worker*') {
    $cmd = '-m celery -A config worker -l INFO -Q {0} --pool=solo --hostname {1}@%h --logfile "{2}" --pidfile "{3}"' -f $Queue, $NodeName, $LogFile, $PidFile
  }
  $p = Start-Process -FilePath 'python' -ArgumentList $cmd -WorkingDirectory $ApiDir -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 8
  if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) {
    Write-Host "Started $Name (PID $($p.Id)). Log: $LogFile"
  } else {
    Write-Host "WARNING: $Name exited during startup. Check $LogFile"
  }
}

# Queue split mirrors production: fast OTP/SMS/emergency work must never sit
# behind vision/AI jobs. Exactly ONE beat anywhere (never also on Render).
Start-CeleryProc -Name 'Prod worker (fast)'  -Role 'worker'        -Queue 'eboses' -NodeName 'prod-eboses' -PidFile $FastPid  -LogFile (Join-Path $LogDir 'celery-prod-worker.log')
Start-CeleryProc -Name 'Prod worker (heavy)' -Role 'worker-heavy'  -Queue 'heavy'  -NodeName 'prod-heavy'  -PidFile $HeavyPid -LogFile (Join-Path $LogDir 'celery-prod-worker-heavy.log')
Start-CeleryProc -Name 'Prod beat'           -Role 'beat'          -PidFile $BeatPid -LogFile (Join-Path $LogDir 'celery-prod-beat.log')

Write-Host ''
Write-Host 'Current celery processes:'
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-m celery' } |
  ForEach-Object { Write-Host ("  PID {0}: {1}" -f $_.ProcessId, $_.CommandLine) }
Write-Host ''
Write-Host 'Tail logs with: Get-Content logs\celery-prod-worker.log -Wait'
