param(
  [string]$Source = "$PSScriptRoot/../public/icons/icon-512.png"
)

Add-Type -AssemblyName System.Drawing

$res = [System.IO.Path]::GetFullPath("$PSScriptRoot/../android/app/src/main/res")
$sourceImage = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($Source))
$densities = @{
  mdpi = 48
  hdpi = 72
  xhdpi = 96
  xxhdpi = 144
  xxxhdpi = 192
}

function Save-Icon([string]$Path, [int]$Size, [double]$LogoScale, [bool]$Round) {
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#07145F"))

  if ($Round) {
    $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clip.AddEllipse(0, 0, $Size, $Size)
    $graphics.SetClip($clip)
  }

  $logoSize = [int]($Size * $LogoScale)
  $offset = [int](($Size - $logoSize) / 2)
  $graphics.DrawImage($sourceImage, $offset, $offset, $logoSize, $logoSize)
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

foreach ($entry in $densities.GetEnumerator()) {
  $directory = Join-Path $res "mipmap-$($entry.Key)"
  $legacySize = [int]$entry.Value
  Save-Icon (Join-Path $directory "ic_launcher.png") $legacySize 0.82 $false
  Save-Icon (Join-Path $directory "ic_launcher_round.png") $legacySize 0.78 $true
  Save-Icon (Join-Path $directory "ic_launcher_foreground.png") ($legacySize * 2.25) 0.66 $false
}

$sourceImage.Dispose()
Write-Output "Generated E-Boses Android launcher icons from $Source"
