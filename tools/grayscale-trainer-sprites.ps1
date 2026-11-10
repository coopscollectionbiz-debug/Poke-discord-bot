# Generates the grayscale trainer sprites used for unowned trainers
# (public/sprites/trainers_2/grayscale/<file>.png) from the colour PNGs.
#
# Usage (from anywhere):
#   pwsh tools/grayscale-trainer-sprites.ps1            # only missing files
#   pwsh tools/grayscale-trainer-sprites.ps1 -Force     # regenerate all
#   pwsh tools/grayscale-trainer-sprites.ps1 -Magick "C:\Program Files\ImageMagick-7.1.1-Q16-HDRI\magick.exe"
#
# Reads ONLY the top level of trainers_2. The old version recursed into its own
# output folder, so every run nested another grayscale/ level (20 levels and
# 27,073 duplicate files had accumulated before this fix).

param(
    [switch]$Force,
    [string]$Magick = "magick"
)

$ErrorActionPreference = "Stop"
$src  = Join-Path $PSScriptRoot "..\public\sprites\trainers_2" | Resolve-Path
$dest = Join-Path $src "grayscale"

if (-not (Get-Command $Magick -ErrorAction SilentlyContinue)) {
    throw "ImageMagick not found ('$Magick'). Install it or pass -Magick <path to magick.exe>."
}
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

# Top level only: never descend into grayscale/ (or anything else).
$files = Get-ChildItem -Path $src -File -Filter "*.png"
$made = 0; $skipped = 0
foreach ($f in $files) {
    $out = Join-Path $dest $f.Name
    if ((Test-Path $out) -and -not $Force) { $skipped++; continue }
    & $Magick $f.FullName -colorspace Gray $out
    if ($LASTEXITCODE -ne 0) { throw "magick failed on $($f.Name)" }
    $made++
}

# Grayscale copies whose colour sprite no longer exists.
$orphans = Get-ChildItem -Path $dest -File -Filter "*.png" | Where-Object { -not (Test-Path (Join-Path $src $_.Name)) }

Write-Host "Grayscale trainer sprites: $made written, $skipped already present, $($files.Count) colour sprites."
if ($orphans) { Write-Warning "$($orphans.Count) grayscale file(s) have no colour sprite: $($orphans.Name -join ', ')" }
