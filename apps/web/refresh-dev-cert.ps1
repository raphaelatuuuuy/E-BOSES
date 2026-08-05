# Re-issue the mkcert dev certificate for whatever LAN IP this machine has now.
#
#   .\refresh-dev-cert.ps1
#   .\refresh-dev-cert.ps1 -Ip 192.168.1.50    # force a specific address
#
# Run this whenever the Wi-Fi changes. vite.config.ts loads
# certs/localhost+4.pem when it exists and silently falls back to an untrusted
# self-signed certificate when it does not - which is what makes the browser
# say "Not secure".

param([string]$Ip)

$ErrorActionPreference = "Stop"
$certDir = Join-Path $PSScriptRoot "certs"
$certFile = Join-Path $certDir "localhost+4.pem"
$keyFile = Join-Path $certDir "localhost+4-key.pem"

$mkcert = (Get-Command mkcert -ErrorAction SilentlyContinue).Source
if (-not $mkcert) {
    $fallback = Join-Path $env:USERPROFILE ".local\bin\mkcert.exe"
    if (Test-Path $fallback) { $mkcert = $fallback }
}
if (-not $mkcert) {
    Write-Host "mkcert not found. Install it, or run with plain HTTP:" -ForegroundColor Red
    Write-Host "  set VITE_DEV_HTTPS=false in .env" -ForegroundColor Red
    exit 1
}

if (-not $Ip) {
    # The address on the interface that actually reaches the network, which is
    # the one a phone on the same Wi-Fi can dial.
    $Ip = (Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1 -ExpandProperty IPv4Address).IPAddress
}
if (-not $Ip) {
    Write-Host "Could not detect a LAN IP. Pass one with -Ip." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $certDir | Out-Null
Write-Host "Issuing certificate for localhost, 127.0.0.1, ::1, $Ip" -ForegroundColor Cyan
& $mkcert -cert-file $certFile -key-file $keyFile localhost 127.0.0.1 ::1 $Ip

Write-Host "`nDone. Restart the Vite dev server." -ForegroundColor Green
Write-Host "Browse to https://$Ip`:5173 - no warning if mkcert's CA is installed."
Write-Host "If it still warns, run:  mkcert -install" -ForegroundColor Yellow
