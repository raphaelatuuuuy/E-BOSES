# Registers the E-Boses health watchdog to run every 15 minutes.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\register_health_alert_task.ps1
#   powershell ... -AlertEmail "captain@barangay.gov" -HealthUrl "http://127.0.0.1:8000"
param(
    [string]$IntervalMinutes = 15,
    [string]$AlertEmail = "",
    [string]$HealthUrl = "http://127.0.0.1:8000"
)

$ErrorActionPreference = 'Stop'
$TaskName = 'E-Boses health watchdog'
$ScriptPath = Join-Path $PSScriptRoot 'check_health_alert.ps1'
if (-not (Test-Path $ScriptPath)) {
    Write-Error "watchdog script not found at $ScriptPath"
    exit 1
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -HealthUrl `"$HealthUrl`""
if ($AlertEmail) { $arguments += " -AlertEmail `"$AlertEmail`"" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "scheduled task '$TaskName' registered: every $IntervalMinutes minute(s)"
Write-Host "run now:  Start-ScheduledTask -TaskName '$TaskName'"
