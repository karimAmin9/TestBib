# Draws the app icons (the "B" logo from the app shell) into public/icons. Windows (System.Drawing).
# Usage: powershell -ExecutionPolicy Bypass -File frontend/scripts/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force $out | Out-Null

$accent = [System.Drawing.ColorTranslator]::FromHtml('#95ac7c')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#2f3a24')

# $inset: transparent margin around the rounded square ("any" icons); 0 = full bleed (maskable, Apple touch).
# $glyph: letter height as a share of the icon (maskable icons keep it inside the 80 % safe zone).
function New-Icon([string]$name, [int]$size, [double]$inset, [double]$radius, [double]$glyph) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)

    $box = $size * (1 - 2 * $inset)
    $x = $size * $inset
    $r = $box * $radius
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($r -gt 0) {
        $path.AddArc($x, $x, 2 * $r, 2 * $r, 180, 90)
        $path.AddArc($x + $box - 2 * $r, $x, 2 * $r, 2 * $r, 270, 90)
        $path.AddArc($x + $box - 2 * $r, $x + $box - 2 * $r, 2 * $r, 2 * $r, 0, 90)
        $path.AddArc($x, $x + $box - 2 * $r, 2 * $r, 2 * $r, 90, 90)
        $path.CloseFigure()
    } else {
        $path.AddRectangle((New-Object System.Drawing.RectangleF 0, 0, $size, $size))
    }
    $g.FillPath((New-Object System.Drawing.SolidBrush $accent), $path)

    $font = New-Object System.Drawing.Font 'Segoe UI', ([float]($size * $glyph)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = 'Center'
    $format.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF 0, ([float]($size * 0.02)), $size, $size
    $g.DrawString('B', $font, (New-Object System.Drawing.SolidBrush $ink), $rect, $format)

    $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "$name ($size px)"
}

New-Icon 'icon-192.png' 192 0.04 0.22 0.62
New-Icon 'icon-512.png' 512 0.04 0.22 0.62
New-Icon 'maskable-512.png' 512 0 0 0.46
New-Icon 'apple-touch-icon.png' 180 0 0 0.56
