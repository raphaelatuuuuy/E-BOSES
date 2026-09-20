# E-Boses nightly backup: Postgres dump + private media archive.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\backup_eboses.ps1
#   powershell ... -Destination "D:\eboses-backups" -KeepLast 14 -OffsiteTarget "\\NAS\e-boses"
#
# Reads DB_* and PRIVATE_MEDIA_ROOT from apps\api\.env. Keeps the last
# -KeepLast dumps and media archives, then copies both to -OffsiteTarget
# (or EBosesOffsiteTarget from the environment) when provided.
param(
    [string]$Destination = "",
    [int]$KeepLast = 14,
    [string]$OffsiteTarget = $env:EBosesOffsiteTarget,
    [string]$PgDumpPath = ""
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $RepoRoot 'apps\api'
# settings.py loads the repo-root .env (config/settings.py:24).
$EnvFile = Join-Path $RepoRoot '.env'

if (-not (Test-Path $EnvFile)) {
    Write-Error ".env not found at $EnvFile"
    exit 1
}

$env_map = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^([A-Z0-9_]+)=(.*)$') {
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and ($value.StartsWith('"') -or $value.StartsWith("'"))) {
            $value = $value.Trim('"', "'")
        }
        $env_map[$Matches[1]] = $value
    }
}

$dbHost = if ($env_map['DB_HOST']) { $env_map['DB_HOST'] } else { 'localhost' }
$dbPort = if ($env_map['DB_PORT']) { $env_map['DB_PORT'] } else { '5432' }
$dbName = if ($env_map['DB_NAME']) { $env_map['DB_NAME'] } else { 'e_boses' }
$dbUser = if ($env_map['DB_USER']) { $env_map['DB_USER'] } else { 'postgres' }
$dbPassword = $env_map['DB_PASSWORD']
if (-not $dbPassword) {
    Write-Error "DB_PASSWORD missing from $EnvFile - refusing to continue without credentials."
    exit 1
}

if (-not $PgDumpPath) {
    $candidates = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    foreach ($candidate in $candidates) {
        $maybe = Join-Path $candidate.FullName 'bin\pg_dump.exe'
        if (Test-Path $maybe) { $PgDumpPath = $maybe; break }
    }
}
if (-not $PgDumpPath -or -not (Test-Path $PgDumpPath)) {
    Write-Error "pg_dump.exe not found. Pass -PgDumpPath explicitly."
    exit 1
}

$mediaRoot = $env_map['PRIVATE_MEDIA_ROOT']
if (-not $mediaRoot) { $mediaRoot = Join-Path $ApiDir 'private_media' }
if (-not [System.IO.Path]::IsPathRooted($mediaRoot)) { $mediaRoot = Join-Path $ApiDir $mediaRoot }

if (-not $Destination) {
    $Destination = Join-Path $RepoRoot 'backups'
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$dumpFile = Join-Path $Destination "e_boses_db_$stamp.dump"
$mediaFile = Join-Path $Destination "e_boses_media_$stamp.zip"

# Database dump (custom format is already compressed).
$env:PGPASSWORD = $dbPassword
try {
    & $PgDumpPath -Fc -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $dumpFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "pg_dump failed with exit code $LASTEXITCODE."
        exit 1
    }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# Private media archive.
$mediaBackedUp = $false
if (Test-Path $mediaRoot) {
    Compress-Archive -Path (Join-Path $mediaRoot '*') -DestinationPath $mediaFile -Force
    $mediaBackedUp = $true
} else {
    Write-Warning "private_media not found at $mediaRoot - skipping media archive."
}

function Prune-Old([string]$pattern, [string]$dir) {
    $files = Get-ChildItem -Path $dir -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if ($files.Count -gt $KeepLast) {
        $files | Select-Object -Skip $KeepLast | ForEach-Object {
            Remove-Item $_.FullName -Force
            Write-Host "pruned $($_.Name)"
        }
    }
}

Prune-Old 'e_boses_db_*.dump' $Destination
Prune-Old 'e_boses_media_*.zip' $Destination

if ($OffsiteTarget) {
    try {
        New-Item -ItemType Directory -Force -Path $OffsiteTarget | Out-Null
        Copy-Item $dumpFile $OffsiteTarget -Force
        if ($mediaBackedUp) { Copy-Item $mediaFile $OffsiteTarget -Force }
        Write-Host "offsite copy done -> $OffsiteTarget"
    } catch {
        # A failed offsite copy must not fail the local backup itself.
        Write-Warning "offsite copy failed: $($_.Exception.Message)"
    }
}

$dumpSize = '{0:N1}' -f ((Get-Item $dumpFile).Length / 1MB)
Write-Host "backup complete: $(Split-Path -Leaf $dumpFile) (${dumpSize} MB)" +
    $(if ($mediaBackedUp) { " + $(Split-Path -Leaf $mediaFile)" })
