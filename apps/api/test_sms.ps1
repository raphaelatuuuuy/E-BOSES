# Simulate the SMS gateway without a handset.
#
#   .\test_sms.ps1                                  # send a sample Fire emergency
#   .\test_sms.ps1 -Msg "GUIDE"
#   .\test_sms.ps1 -Msg "HELP FIRE Champaca Street" -From "09171234567"
#   .\test_sms.ps1 -ShowReplies                     # print what would have been texted back
#
# Requires the API running:  python manage.py runserver 0.0.0.0:8000

param(
    [string]$Msg = "I need immediate help. This is a Fire emergency near Champaca Street, Marikina Heights. Please send assistance.`nLOC:14.6507,121.1133",
    [string]$From = "09171234567",
    [string]$Id = "",
    [string]$ApiUrl = "http://localhost:8000",
    [switch]$ShowReplies
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envFile = Join-Path $repoRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "No .env at $envFile" -ForegroundColor Red
    exit 1
}

# SMS_INBOUND_WEBHOOK_TOKEN is the new name; the endpoint still accepts the
# original SMS_EMERGENCY_WEBHOOK_TOKEN so an existing handset keeps working.
function Get-EnvValue([string]$key) {
    $line = Get-Content $envFile | Select-String "^$key="
    if (-not $line) { return "" }
    return (($line -split '=', 2)[1]).Trim()
}

$token = Get-EnvValue "SMS_INBOUND_WEBHOOK_TOKEN"
if (-not $token) { $token = Get-EnvValue "SMS_EMERGENCY_WEBHOOK_TOKEN" }

if (-not $token) {
    Write-Host "No SMS webhook token in .env. Set SMS_INBOUND_WEBHOOK_TOKEN." -ForegroundColor Red
    exit 1
}

# A unique id per run so each send is treated as a new message rather than a
# gateway retry of the previous one.
if (-not $Id) { $Id = "test-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

$body = @{ from = $From; id = $Id; msg = $Msg } | ConvertTo-Json

Write-Host "`n--> $From : $($Msg -replace "`n", ' | ')" -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "$ApiUrl/api/sms/inbound/" -Method Post `
        -Headers @{ "X-SMS-Webhook-Token" = $token } `
        -ContentType "application/json" -Body $body
    Write-Host "<-- $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
}
catch {
    Write-Host "<-- FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    exit 1
}

if ($ShowReplies) {
    Write-Host "`nQueued replies:" -ForegroundColor Yellow
    python manage.py shell -c @'
from apps.sms.models import OutboundSmsMessage
for m in OutboundSmsMessage.objects.order_by("-id")[:3]:
    print(f"\n-> xxxx{m.destination_last_four} [{m.purpose}] {m.status}")
    print(m.body or "(body not stored - OTP)")
'@
}
