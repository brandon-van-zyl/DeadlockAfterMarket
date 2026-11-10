<#
.SYNOPSIS
  Creates a new mod folder from mods\_template.
.EXAMPLE
  .\tools\new-mod.ps1 "Golden Haze"
  Creates mods\golden-haze with mod.md titled "Golden Haze".
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$template = Join-Path $root 'mods\_template'

$slug = ($Name.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
if (-not $slug) { throw "Can't make a folder name from '$Name'. Use letters or numbers." }

$target = Join-Path $root "mods\$slug"
if (Test-Path $target) { throw "mods\$slug already exists." }

Copy-Item -Path $template -Destination $target -Recurse

$modFile = Join-Path $target 'mod.md'
$text = [IO.File]::ReadAllText($modFile)
$text = $text -replace '(?m)^Title:.*$', "Title: $Name"
[IO.File]::WriteAllText($modFile, $text, (New-Object Text.UTF8Encoding($false)))

Write-Host "Created mods\$slug" -ForegroundColor Green
Write-Host "  1. Edit mods\$slug\mod.md (hero, category, description)"
Write-Host "  2. Put your working files in mods\$slug\source"
Write-Host "  3. Put the built pak##_dir.vpk in mods\$slug\build"
Write-Host "  4. Add screenshots to mods\$slug\images"
Write-Host "  5. Run: .\tools\package.ps1 $slug"
