<#
.SYNOPSIS
  Checks a mod and zips it into releases\ ready to upload to GameBanana.
.EXAMPLE
  .\tools\package.ps1 golden-haze
.EXAMPLE
  .\tools\package.ps1 golden-haze -Force   # overwrite an existing zip for the same version
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Mod,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$modDir = Join-Path $root "mods\$Mod"
if (-not (Test-Path $modDir) -or $Mod -eq '_template') { throw "No mod folder at mods\$Mod" }

$problems = @()
$warnings = @()

# --- Read mod.md -------------------------------------------------------------
$modFile = Join-Path $modDir 'mod.md'
if (-not (Test-Path $modFile)) { throw "mods\$Mod\mod.md is missing." }
$modText = [IO.File]::ReadAllText($modFile)

function Get-Field([string]$field) {
    $m = [regex]::Match($modText, "(?m)^$field\s*:\s*(.+?)\s*$")
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

$title = Get-Field 'Title'
$version = Get-Field 'Version'
if (-not $title -or $title -eq 'My Mod Name') { $problems += "Set a real Title in mod.md." }
if (-not $version) { $problems += "Set a Version in mod.md (e.g. 1.0.0)." }
elseif ($version -notmatch '^[0-9A-Za-z._-]+$') { $problems += "Version '$version' should only use letters, numbers, dots and dashes." }
if ($modText -match 'What the mod does, in a few sentences') { $warnings += "The Description in mod.md is still the template text." }

# --- Check VPKs --------------------------------------------------------------
$buildDir = Join-Path $modDir 'build'
$vpks = @(Get-ChildItem -Path $buildDir -Filter '*.vpk' -File -ErrorAction SilentlyContinue)
if ($vpks.Count -eq 0) {
    $problems += "No .vpk files in mods\$Mod\build."
}
foreach ($v in $vpks) {
    if ($v.Name -notmatch '^pak\d{2}_dir\.vpk$') {
        $problems += "$($v.Name) must be named pak##_dir.vpk (## = 01 to 99), e.g. pak21_dir.vpk."
    }
    elseif ($v.Name -eq 'pak00_dir.vpk') {
        $problems += "pak00 is not allowed. Use a number from 01 to 99."
    }
    if ($v.Length -eq 0) { $problems += "$($v.Name) is empty." }
    if ($v.Length -ge 2GB) { $problems += "$($v.Name) is 2 GB or larger. Split it with CSDK's Multichunk Workshop Manager." }
}
$extraFiles = @(Get-ChildItem -Path $buildDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -ne '.vpk' -and $_.Name -ne 'README.txt' })
if ($extraFiles.Count -gt 0) { $warnings += "Ignoring non-VPK files in build: $($extraFiles.Name -join ', ')" }

# --- Check images ------------------------------------------------------------
$images = @(Get-ChildItem -Path (Join-Path $modDir 'images') -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '^\.(png|jpe?g|webp|gif)$' })
if ($images.Count -eq 0) { $warnings += "No screenshots in mods\$Mod\images. GameBanana needs at least one." }

# --- Report ------------------------------------------------------------------
foreach ($w in $warnings) { Write-Host "WARNING: $w" -ForegroundColor Yellow }
if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Host "PROBLEM: $p" -ForegroundColor Red }
    Write-Host "Fix the problems above and run this again." -ForegroundColor Red
    exit 1
}

# --- Build the zip -----------------------------------------------------------
$releases = Join-Path $root 'releases'
New-Item -ItemType Directory -Force -Path $releases | Out-Null
$zipPath = Join-Path $releases "$Mod-v$version.zip"
if ((Test-Path $zipPath) -and -not $Force) {
    Write-Host "releases\$Mod-v$version.zip already exists." -ForegroundColor Red
    Write-Host "Bump Version in mod.md for a new upload, or add -Force to overwrite it." -ForegroundColor Red
    exit 1
}

$staging = Join-Path ([IO.Path]::GetTempPath()) ("dlmod-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($v in $vpks) { Copy-Item $v.FullName -Destination $staging }

    $install = @"
$title (v$version)

EASIEST: install with Deadlock Mod Manager - https://deadlockmods.app
Search for "$title" in the Mods Store and click install.

MANUAL:
1. Open your Deadlock folder (Steam > Deadlock > Manage > Browse local files).
2. Go to game\citadel\addons (create the "addons" folder if it doesn't exist).
3. Copy the .vpk file(s) from this zip into that folder.
   If you already have a mod using the same pak number, rename this one to
   an unused number, e.g. pak37_dir.vpk.
4. Only if you've never installed mods by hand: open game\citadel\gameinfo.gi in Notepad
   (make a copy first). Under SearchPaths, put these three lines above "Game citadel":
       Mod     citadel
       Write   citadel
       Game    citadel/addons
   Without the Mod/Write lines the game stops at launch with "Unable to read default
   keybinding configuration". Mod Manager does all of this for you.

UNINSTALL: delete the .vpk from game\citadel\addons (or remove it in Mod Manager).
Steam's "Verify integrity of game files" restores gameinfo.gi.
"@
    [IO.File]::WriteAllText((Join-Path $staging 'INSTALL.txt'), $install, (New-Object Text.UTF8Encoding($false)))

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

$zip = Get-Item $zipPath
$sizeMb = [math]::Round($zip.Length / 1MB, 2)
Write-Host ""
Write-Host "Packaged: releases\$($zip.Name) ($sizeMb MB)" -ForegroundColor Green
Write-Host "  VPKs:   $($vpks.Name -join ', ')"
Write-Host "  Images: $($images.Count) in mods\$Mod\images"
Write-Host ""
Write-Host "Next: upload the zip to GameBanana (Deadlock > Mods > Submit) and copy the"
Write-Host "title, category, hero and description from mods\$Mod\mod.md."
