# Registers the E-Boses nightly backup as a Windows scheduled task.
# Runs daily at 02:00 as the current user. Idempotent: re-registering overwrites.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\register_backup_task.ps1
#   powershell ... -Time "02:30" -Destination "D:\eboses-backups" -OffsiteTarget "\\NAS\e-boses"
param(
    [string]$Time = "02:00",
    [string]$Destination = "",
    [string]$OffsiteTarget = ""
)

$ErrorActionPreference = 'Stop'
$TaskName = 'E-Boses nightly backup'
$ScriptPath = Join-Path $PSScriptRoot 'backup_eboses.ps1'
if (-not (Test-Path $ScriptPath)) {
    Write-Error "backup script not found at $ScriptPath"
    exit 1
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
if ($Destination) { $arguments += " -Destination `"$Destination`"" }
if ($OffsiteTarget) { $arguments += " -OffsiteTarget `"$OffsiteTarget`"" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "scheduled task '$TaskName' registered: daily at $Time"
Write-Host "run now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "inspect:  Get-ScheduledTaskInfo -TaskName '$TaskName'"
