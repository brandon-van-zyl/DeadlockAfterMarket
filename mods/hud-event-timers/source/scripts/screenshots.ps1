<#
.SYNOPSIS
  Takes GameBanana screenshots of the mod's parts from the browser preview, as JPEG.
.DESCRIPTION
  Needs the preview running (npm run preview, http://localhost:5178). Uses Microsoft Edge in
  headless mode to load the preview's capture mode at 1920x1080, plays the clock to the
  moment wanted (so banners fire for real), then crops each part and saves JPEGs to
  mods\hud-event-timers\images\. Also converts any other image there (webp/png) to JPEG.
.EXAMPLE
  .\scripts\screenshots.ps1
#>
param([string]$Preview = 'http://localhost:5178/')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore

$source = Split-Path -Parent $PSScriptRoot
$images = Join-Path (Split-Path -Parent $source) 'images'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found.' }
try { Invoke-WebRequest -UseBasicParsing -Uri $Preview -TimeoutSec 5 | Out-Null } catch { throw "Preview isn't running at $Preview. Start it with: npm run preview" }

$work = Join-Path ([IO.Path]::GetTempPath()) ('dlshots-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$profileDir = Join-Path $work 'edge-profile'

$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$quality = New-Object Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 92L

function Save-Jpeg([Drawing.Image]$img, [string]$path) { $img.Save($path, $jpeg, $quality) }

function Capture([string]$query, [string]$name) {
    $png = Join-Path $work "$name.png"
    # Real game scene behind the HUD when preview\backdrop.jpg exists, else a plain dark background.
    $bgParam = if (Test-Path (Join-Path $source 'preview\backdrop.jpg')) { '' } else { 'bg=0&' }
    $url = "$Preview`?capture=1&$bgParam$query"
    # Separate process: Edge logs noise to stderr, which strict PowerShell treats as an error.
    $args = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', "--user-data-dir=`"$profileDir`"",
        '--window-size=1920,1080', '--virtual-time-budget=9000', "--screenshot=`"$png`"", "`"$url`"")
    Start-Process -FilePath $edge -ArgumentList $args -Wait -WindowStyle Hidden `
        -RedirectStandardError (Join-Path $work "$name.log") -RedirectStandardOutput (Join-Path $work "$name.out")
    $tries = 0
    while (-not (Test-Path $png) -and $tries -lt 40) { Start-Sleep -Milliseconds 250; $tries++ }
    if (-not (Test-Path $png)) { throw "Edge didn't write $name" }
    return $png
}

function Crop([string]$png, [string]$out, [int]$x, [int]$y, [int]$w, [int]$h) {
    $src = [Drawing.Bitmap]::FromFile($png)
    try {
        $rect = New-Object Drawing.Rectangle $x, $y, $w, $h
        $part = $src.Clone($rect, $src.PixelFormat)
        try { Save-Jpeg $part (Join-Path $images $out) } finally { $part.Dispose() }
    } finally { $src.Dispose() }
    Write-Host "  $out"
}

Write-Host 'Capturing...'
# Full HUD with the 30s banner, next item (+1 READY), wave and events panel.
$full = Capture 't=4:28&until=4:31&souls=2400' 'full'
$src = [Drawing.Bitmap]::FromFile($full); try { Save-Jpeg $src (Join-Path $images 'hud-overview.jpg') } finally { $src.Dispose() }
Write-Host '  hud-overview.jpg'
Crop $full 'banner-30s.jpg' 380 130 1160 170

# Top-right stack on its own (no banner in the shot).
$panels = Capture 't=4:20&until=4:21&souls=2400' 'panels'
Crop $panels 'top-right-panels.jpg' 1560 100 360 210

$urgent = Capture 't=4:48&until=4:51&souls=2400' 'urgent'
Crop $urgent 'banner-10s.jpg' 380 130 1160 170

$options = Capture 't=4:20&until=4:21&souls=2400&options=1' 'options'
Crop $options 'options-panel.jpg' 1296 166 620 196

$map = Capture 't=3:05&until=3:06&souls=2400' 'map'
Crop $map 'minimap-heavy-crates.jpg' 1570 726 340 340

# --- Main image: a 1920x1080 collage of every part, with labels ----------------------------
function New-Collage {
    $W = 1920; $H = 1080
    $canvas = New-Object Drawing.Bitmap $W, $H
    $g = [Drawing.Graphics]::FromImage($canvas)
    try {
        $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'
        $bg = New-Object Drawing.Drawing2D.LinearGradientBrush (New-Object Drawing.Point 0, 0), (New-Object Drawing.Point 0, $H),
            ([Drawing.Color]::FromArgb(255, 24, 27, 33)), ([Drawing.Color]::FromArgb(255, 9, 11, 14))
        $g.FillRectangle($bg, 0, 0, $W, $H)
        # The game scene behind everything, darkened so the parts stand out.
        $backdrop = Join-Path $source 'preview\backdrop.jpg'
        if (Test-Path $backdrop) {
            $scene = [Drawing.Image]::FromFile($backdrop)
            try { $g.DrawImage($scene, 0, 0, $W, $H) } finally { $scene.Dispose() }
            $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(175, 8, 9, 12))), 0, 0, $W, $H)
        }

        $gold = [Drawing.Color]::FromArgb(255, 255, 237, 121)
        $offWhite = [Drawing.Color]::FromArgb(255, 255, 239, 215)
        $muted = [Drawing.Color]::FromArgb(170, 255, 239, 215)
        $family = if ((New-Object Drawing.Text.InstalledFontCollection).Families.Name -contains 'Bahnschrift') { 'Bahnschrift' } else { 'Segoe UI' }
        $titleFont = New-Object Drawing.Font $family, 54, ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
        $subFont = New-Object Drawing.Font $family, 22, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
        $labelFont = New-Object Drawing.Font $family, 20, ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)

        $g.DrawString('EVENT TIMERS HUD', $titleFont, (New-Object Drawing.SolidBrush $gold), 60, 36)
        $g.DrawString('Map event timers  |  warning banners  |  trooper wave countdown  |  Quickbuy souls  |  minimap crate markers', $subFont, (New-Object Drawing.SolidBrush $muted), 64, 104)
        $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(120, 255, 237, 121))), 60, 144, $W - 120, 2)

        $tile = {
            param([string]$file, [int]$x, [int]$y, [int]$w, [string]$label)
            $img = [Drawing.Image]::FromFile((Join-Path $images $file))
            try {
                $h = [int]($img.Height * $w / $img.Width)
                $g.FillRectangle((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 14, 16, 20))), $x - 6, $y - 6, $w + 12, $h + 12)
                $g.DrawImage($img, $x, $y, $w, $h)
                $g.DrawRectangle((New-Object Drawing.Pen ([Drawing.Color]::FromArgb(70, 255, 239, 215)), 1), $x - 6, $y - 6, $w + 12, $h + 12)
                $g.DrawString($label.ToUpper(), $labelFont, (New-Object Drawing.SolidBrush $offWhite), $x - 4, $y + $h + 12)
            } finally { $img.Dispose() }
        }
        & $tile 'banner-30s.jpg' 66 186 880 'Gold banner 30s before an event'
        & $tile 'banner-10s.jpg' 974 186 880 'Red banner at 10s'
        & $tile 'top-right-panels.jpg' 66 410 500 'Next item, wave, next events'
        & $tile 'options-panel.jpg' 610 410 760 'Options panel'
        & $tile 'minimap-heavy-crates.jpg' 1416 410 440 'Heavy crates after 3:00'
        & $tile 'hud-overview.jpg' 610 692 560 'All together in the HUD'

        $notes = @('Reads the HUD clock: stays in',
            'sync through pauses, reconnects',
            'and new matches',
            'Only runs in real matches',
            'Game-styled fonts and colours',
            'UI files only: no memory',
            'reading, no injection')
        $y = 770
        $bullet = $true
        foreach ($n in $notes) {
            # Lines that continue a sentence start lower-case: indent them instead of a new bullet.
            $cont = $n -cmatch '^[a-z]'
            $g.DrawString($(if ($cont) { "  $n" } else { "- $n" }), $subFont, (New-Object Drawing.SolidBrush $muted), 66, $y)
            $y += 34
        }
    } finally { $g.Dispose() }
    Save-Jpeg $canvas (Join-Path $images '00-main-collage.jpg')
    $canvas.Dispose()
    Write-Host '  00-main-collage.jpg'
}
New-Collage

# Convert any other images (webp/png) in images\ to JPEG, then remove the originals.
foreach ($f in Get-ChildItem $images -File | Where-Object { $_.Extension -match '^\.(webp|png)$' }) {
    $out = [IO.Path]::ChangeExtension($f.FullName, '.jpg')
    $stream = [IO.File]::OpenRead($f.FullName)
    try {
        $frame = [Windows.Media.Imaging.BitmapDecoder]::Create($stream, 'None', 'OnLoad').Frames[0]
        $enc = New-Object Windows.Media.Imaging.JpegBitmapEncoder
        $enc.QualityLevel = 92
        $enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($frame))
        $o = [IO.File]::Create($out); try { $enc.Save($o) } finally { $o.Close() }
    } finally { $stream.Close() }
    Remove-Item $f.FullName
    Write-Host "  converted $($f.Name) -> $([IO.Path]::GetFileName($out))"
}

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Done: $images"
