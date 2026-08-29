# Stops the E-Boses Celery worker and Beat scheduler.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\stop-celery.ps1
$ErrorActionPreference = 'SilentlyContinue'
$ApiDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ApiDir 'logs'

foreach ($f in @('celery-worker.pid', 'celery-worker-heavy.pid', 'celery-beat.pid')) {
  $pf = Join-Path $LogDir $f
  if (Test-Path $pf) {
    $pidNum = (Get-Content $pf | Select-Object -First 1).Trim()
    if ($pidNum) {
      Stop-Process -Id $pidNum -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped $f (PID $pidNum)"
    }
    Remove-Item $pf -Force
  }
}

Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '-m celery' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped stray celery process (PID $($_.ProcessId))"
  }
Write-Host 'Done.'
