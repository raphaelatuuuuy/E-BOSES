# Registers a scheduled task that starts Celery worker + Beat at boot and at
# logon, with automatic restart on failure - so the daily schedules can't be
# forgotten again. Run as the same user that runs the API.
#   Register : powershell -ExecutionPolicy Bypass -File scripts\install-celery-startup-task.ps1
#   Uninstall: ... -Unregister
param([switch]$Unregister)
# Self-elevate: registering a Task Scheduler job (even boot user tasks) needs
# administrator rights. A UAC prompt will appear - accept it once.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
  if ($Unregister) { $args += ' -Unregister' }
  Start-Process powershell -Verb RunAs -ArgumentList $args
  exit
}
$TaskName = 'E-Boses Celery'
if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}
$ApiDir = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $ApiDir 'scripts\start-celery.ps1'
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""
$Triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings `
  -Description 'Start E-Boses Celery worker + Beat at boot/logon (idempotent).' -Force
Write-Host "Registered '$TaskName' (startup + logon triggers, restart-on-failure x3)."
Write-Host "Task: $TaskName"
