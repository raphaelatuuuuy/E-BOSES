param([string]$PublicHost = "https://raphaelatuuuuy.me", [string]$HealthPath = "/api/health/")
$svc = Get-Service Cloudflared -ErrorAction SilentlyContinue
if (-not $svc) { Write-Output "TUNNEL=down (Cloudflared service missing). Reinstall: cloudflared.exe service install <token>"; exit 1 }
Write-Output "TUNNEL=service $($svc.Status)"
$procs = @(Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue)
Write-Output ("WORKERS={0}" -f $procs.Count)
$direct = $false
try { $direct = (Invoke-WebRequest -Uri "http://127.0.0.1:8000$HealthPath" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200 } catch {}
try {
    $resp = Invoke-WebRequest -Uri ("$PublicHost$HealthPath") -UseBasicParsing -TimeoutSec 25
    Write-Output ("PUBLIC={0} App is accessible at {1}." -f $resp.StatusCode, $PublicHost)
} catch {
    if (-not $direct) { Write-Output "PUBLIC=unreachable and Django is not responding on localhost:8000. Start Django: python manage.py runserver 0.0.0.0:8000" }
    else { Write-Output "PUBLIC=unreachable but Django is up locally. Check the Cloudflared service and the tunnel route in the dashboard." }
}
