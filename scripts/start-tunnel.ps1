param([int]$Port = 8000)
$ErrorActionPreference = "Stop"
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$log = Join-Path ([System.IO.Path]::GetTempPath()) "opencode\cloudflared.log"
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
Start-Process -FilePath $cf -ArgumentList "tunnel --url http://127.0.0.1:$Port --logfile `"$log`"" -WindowStyle Hidden
$url = $null
for ($i = 0; $i -lt 12 -and -not $url; $i++) {
    Start-Sleep -Seconds 5
    if (Test-Path -LiteralPath $log) {
        $match = Select-String -LiteralPath $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($match) { $url = ([regex]::Match($match.Line, "https://[a-z0-9-]+\.trycloudflare\.com")).Value }
    }
}
if ($url) { Write-Output "TUNNEL_URL=$url" } else { Write-Output "TUNNEL_URL=not-found-check-log:$log" }
