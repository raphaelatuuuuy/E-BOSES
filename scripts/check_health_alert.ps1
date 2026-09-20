# E-Boses health watchdog: polls the deep health endpoint and emails an
# official when the system degrades (or recovers). Anti-spam: alerts on
# state change, then at most once per hour while still degraded.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\check_health_alert.ps1
#   powershell ... -HealthUrl "http://127.0.0.1:8000" -AlertEmail "captain@barangay.gov"
param(
    [string]$HealthUrl = "http://127.0.0.1:8000",
    [string]$AlertEmail = "",
    [string]$StateFile = ""
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if (-not $StateFile) { $StateFile = Join-Path $LogDir 'health-alert-state.json' }

$env_map = @{}
Get-Content (Join-Path $RepoRoot '.env') | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.*)$') {
        $value = $Matches[2].Trim().Trim('"', "'")
        $env_map[$Matches[1]] = $value
    }
}
$resendKey = $env_map['RESEND_API_KEY']
$fromEmail = if ($env_map['RESEND_FROM_EMAIL']) { $env_map['RESEND_FROM_EMAIL'] } else { 'onboarding@resend.dev' }
if (-not $AlertEmail) { $AlertEmail = $env_map['SUPPORT_EMAIL'] }

$state = @{ state = 'unknown'; last_alert_at = [DateTime]::MinValue.ToString('o') }
if (Test-Path $StateFile) {
    try { $state = Get-Content $StateFile -Raw | ConvertFrom-Json -AsHashtable } catch {}
}

$degraded = $false
$detail = ''
try {
    $response = Invoke-RestMethod -Uri "$HealthUrl/api/health/?deep=1" -TimeoutSec 25
    if ($response.status -ne 'ok') { $degraded = $true }
    $badDeps = @()
    foreach ($property in ($response.dependencies.PSObject.Properties)) {
        if ($property.Value -eq 'error') { $badDeps += $property.Name }
    }
    if ($badDeps.Count -gt 0) {
        $degraded = $true
        $detail = "failing dependencies: $($badDeps -join ', ')"
    } elseif ($degraded) {
        $detail = "overall status: $($response.status)"
    }
} catch {
    $degraded = $true
    $detail = "health endpoint unreachable: $($_.Exception.Message)"
}

$now = Get-Date
$lastAlert = [DateTime]::MinValue
if ($state['last_alert_at']) {
    try { $lastAlert = [DateTime]::Parse($state['last_alert_at']) } catch {}
}

function Send-Alert([string]$subject, [string]$body) {
    Write-Host "$subject - $body"
    if (-not $resendKey -or -not $AlertEmail) {
        Write-Host "email skipped (RESEND_API_KEY or SUPPORT_EMAIL/AlertEmail not configured)"
        return
    }
    $payload = @{
        from    = $fromEmail
        to      = @($AlertEmail)
        subject = $subject
        text    = $body
    } | ConvertTo-Json -Depth 4
    try {
        Invoke-RestMethod -Method Post -Uri 'https://api.resend.com/emails' `
            -Headers @{ Authorization = "Bearer $resendKey" } `
            -ContentType 'application/json' -Body $payload -TimeoutSec 15 | Out-Null
        Write-Host "alert email sent to $AlertEmail"
    } catch {
        Write-Warning "failed to send alert email: $($_.Exception.Message)"
    }
}

if ($degraded) {
    $hoursSinceAlert = ($now - $lastAlert).TotalHours
    if ($state['state'] -ne 'degraded' -or $hoursSinceAlert -ge 1) {
        Send-Alert "[E-Boses] System degraded" "E-Boses health check failed at $($now.ToString('u')). $detail"
        $state['state'] = 'degraded'
        $state['last_alert_at'] = $now.ToString('o')
    } else {
        Write-Host "still degraded - re-alert deferred (last alert $([math]::Round($hoursSinceAlert,1))h ago). $detail"
    }
} else {
    if ($state['state'] -eq 'degraded') {
        Send-Alert "[E-Boses] Recovered" "E-Boses health checks are passing again as of $($now.ToString('u'))."
    }
    $state['state'] = 'ok'
    $state['last_alert_at'] = $now.ToString('o')
}

$state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8
exit 0
