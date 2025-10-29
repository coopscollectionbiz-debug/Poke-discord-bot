# === CONFIGURATION ===
$src  = "E:\Discord Bot\public\sprites\trainers_2"
$dest = "$src\grayscale"

# === SETUP ===
if (!(Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

Write-Host "🎨 Starting grayscale conversion for trainer sprites..." -ForegroundColor Cyan

# === PROCESSING LOOP ===
Get-ChildItem -Path $src -Recurse -Filter "*.png" | ForEach-Object {
    $relative = $_.FullName.Substring($src.Length)
    $outFile  = Join-Path $dest $relative
    $outDir   = Split-Path $outFile

    if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

    # Convert to grayscale using ImageMagick
    & "C:\Program Files\ImageMagick-7.1.1-Q16-HDRI\magick.exe" $_.FullName -colorspace Gray $outFile

    Write-Host "✅ Grayscaled:" $_.Name
}

Write-Host "`nAll trainer sprites processed successfully!" -ForegroundColor Green
