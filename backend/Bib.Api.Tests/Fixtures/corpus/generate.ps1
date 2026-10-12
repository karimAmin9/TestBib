# Regenerates the real-world corpus PDFs from the ground-truth .txt files.
# Each PDF is printed by Microsoft Edge (Chromium/Skia PDF backend: subset TrueType fonts,
# ligatures, Flate/DCT images), which is what most "save as PDF" documents look like.
#
# Text format: "# Heading" starts a section (new page in novel.txt), "[img:file]" inserts an image,
# every other non-empty line is a paragraph.
#
# Usage (Windows):  powershell -ExecutionPolicy Bypass -File generate.ps1
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

Add-Type -AssemblyName System.Drawing
function New-PatternPng($path, $w, $h, $seed) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    for ($x = 0; $x -lt $w; $x++) {
        for ($y = 0; $y -lt $h; $y++) {
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(($x * 3 + $seed) % 256, ($y * 2 + $seed) % 256, (($x + $y) * $seed) % 256))
        }
    }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

New-PatternPng (Join-Path $here 'pattern.png') 120 80 7
New-PatternPng (Join-Path $here 'pattern2.png') 90 90 13
Copy-Item (Join-Path $here '..\sample.jpg') (Join-Path $here 'sample.jpg') -Force

$styles = @{
    'novel'       = 'body{font-family:Georgia,serif;font-size:13pt;line-height:1.5;margin:0} h1{page-break-before:always;font-size:20pt} h1:first-of-type{page-break-before:avoid} p{margin:0 0 1em 0;text-align:justify}'
    'illustrated' = 'body{font-family:"Segoe UI",Arial,sans-serif;font-size:12pt;line-height:1.4} img{display:block;margin:12pt 0;width:auto;height:auto} p{margin:0 0 1em 0}'
    'columns'     = 'body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.35} .cols{column-count:2;column-gap:28pt} p{margin:0 0 1em 0}'
}

foreach ($name in $styles.Keys) {
    $lines = Get-Content (Join-Path $here "$name.txt") -Encoding UTF8
    $body = New-Object System.Text.StringBuilder
    foreach ($line in $lines) {
        if ($line.Trim() -eq '') { continue }
        $enc = [System.Net.WebUtility]::HtmlEncode($line)
        if ($line.StartsWith('# ')) { [void]$body.Append("<h1>$([System.Net.WebUtility]::HtmlEncode($line.Substring(2)))</h1>`n") }
        elseif ($line -match '^\[img:(.+)\]$') { [void]$body.Append("<img src=""$($Matches[1])"">`n") }
        else { [void]$body.Append("<p>$enc</p>`n") }
    }
    $content = $body.ToString()
    if ($name -eq 'columns') { $content = "<div class=""cols"">$content</div>" }
    $html = "<!doctype html><html lang=""en""><head><meta charset=""utf-8""><style>@page{size:A5;margin:18mm} $($styles[$name])</style></head><body>$content</body></html>"
    $htmlPath = Join-Path $here "$name.html"
    [System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding $false))

    $pdfPath = Join-Path $here "$name.pdf"
    & $edge --headless --disable-gpu --no-pdf-header-footer --no-first-run "--user-data-dir=$env:TEMP\bib-edge" "--print-to-pdf=$pdfPath" ([System.Uri]$htmlPath).AbsoluteUri | Out-Null
    Start-Sleep -Milliseconds 500
    Write-Host "$name.pdf: $((Get-Item $pdfPath).Length) bytes"
}
