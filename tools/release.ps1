<#
.SYNOPSIS
  Builds a mod on this PC and publishes it as a GitHub Release (then upload the same zip to GameBanana).
.DESCRIPTION
  1. Sets Version in mods\<mod>\mod.md (add a "### <version>" changelog entry there first).
  2. Runs the tests, then builds and compiles the mod with CSDK (npm run deploy).
  3. Packages releases\<mod>-v<version>.zip with tools\package.ps1.
  4. Commits mod.md, tags <mod>-v<version>, pushes, and creates the GitHub Release with the zip
     and that version's changelog as notes.
  The build has to run here: it needs CSDK and the game's own hud.xml, which GitHub doesn't have.
.EXAMPLE
  .\tools\release.ps1 hud-event-timers 1.0.1
#>
param(
    [Parameter(Mandatory = $true, Position = 0)] [string]$Mod,
    [Parameter(Mandatory = $true, Position = 1)] [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$modDir = Join-Path $root "mods\$Mod"
$source = Join-Path $modDir 'source'
$modFile = Join-Path $modDir 'mod.md'
if (-not (Test-Path $modFile)) { throw "No mods\$Mod\mod.md" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version should look like 1.0.1" }
foreach ($tool in 'git', 'gh', 'npm') { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool isn't installed or not on PATH." } }
gh auth status *> $null; if ($LASTEXITCODE -ne 0) { throw "Not signed in to GitHub. Run: gh auth login" }

Push-Location $root
try {
    if (git status --porcelain) { throw "You have uncommitted changes. Commit or stash them first, so the release matches the code." }

    # 1. Version and changelog
    $text = [IO.File]::ReadAllText($modFile)
    $notes = [regex]::Match($text, "(?ms)^### $([regex]::Escape($Version))\s*\r?\n(.*?)(?=^### |\z)").Groups[1].Value.Trim()
    if (-not $notes) { throw "Add a '### $Version' entry under ## Changelog in mods\$Mod\mod.md first." }
    $text = [regex]::Replace($text, '(?m)^Version:\s*.+$', "Version: $Version", 1)
    [IO.File]::WriteAllText($modFile, $text, (New-Object Text.UTF8Encoding($false)))
    $title = [regex]::Match($text, '(?m)^Title:\s*(.+?)\s*$').Groups[1].Value

    # 2. Test, build and compile (no install)
    if (Test-Path (Join-Path $source 'package.json')) {
        Push-Location $source
        try {
            npm test; if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
            npm run deploy; if ($LASTEXITCODE -ne 0) { throw "Build/compile failed." }
        } finally { Pop-Location }
    }

    # 3. Package
    & (Join-Path $PSScriptRoot 'package.ps1') $Mod -Force
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed." }
    $zip = Join-Path $root "releases\$Mod-v$Version.zip"

    # 4. Commit, tag, push, GitHub Release
    $tag = "$Mod-v$Version"
    git add $modFile
    git commit -m "Release $title v$Version"
    git tag $tag
    git push
    git push origin $tag
    gh release create $tag $zip --title "$title v$Version" --notes $notes
    Write-Host "`nReleased $tag. Upload the same zip to GameBanana: $zip" -ForegroundColor Green
}
finally { Pop-Location }
