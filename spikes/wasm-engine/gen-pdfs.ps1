# Generates the spike's stress PDFs with Edge's print-to-PDF (same pipeline as the repo's corpus/generate.ps1).
#   long-novel.pdf : ~300 full A5 pages of text in 30 chapters
#   photos.pdf     : 30 pages, each with a distinct large JPEG (memory / image-extraction stress)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = Join-Path $here 'pdfs'
$work = Join-Path $here 'gen-work'
New-Item -ItemType Directory -Force $out, $work | Out-Null
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$corpus = Join-Path $here '..\..\backend\Bib.Api.Tests\Fixtures\corpus'

function Print-Pdf($html, $name) {
    $htmlPath = Join-Path $work "$name.html"
    [System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding $false))
    $pdfPath = Join-Path $out "$name.pdf"
    & $edge --headless --disable-gpu --no-pdf-header-footer --no-first-run "--user-data-dir=$env:TEMP\bib-edge-spike" "--print-to-pdf=$pdfPath" ([System.Uri]$htmlPath).AbsoluteUri | Out-Null
    Start-Sleep -Milliseconds 500
    Write-Host ("{0}.pdf: {1:N1} MB" -f $name, ((Get-Item $pdfPath).Length / 1MB))
}

# --- long novel
$paragraphs = Get-Content (Join-Path $corpus 'novel.txt') -Encoding UTF8 | Where-Object { $_.Trim() -ne '' -and -not $_.StartsWith('# ') }
$body = New-Object System.Text.StringBuilder
for ($c = 1; $c -le 30; $c++) {
    [void]$body.Append("<h1>Chapter $c</h1>`n")
    for ($r = 0; $r -lt 6; $r++) {
        foreach ($p in $paragraphs) { [void]$body.Append("<p>$([System.Net.WebUtility]::HtmlEncode($p))</p>`n") }
    }
}
$style = 'body{font-family:Georgia,serif;font-size:11pt;line-height:1.45;margin:0} h1{page-break-before:always;font-size:18pt} h1:first-of-type{page-break-before:avoid} p{margin:0 0 .8em 0;text-align:justify}'
Print-Pdf "<!doctype html><html lang=""en""><head><meta charset=""utf-8""><style>@page{size:A5;margin:16mm} $style</style></head><body>$body</body></html>" 'long-novel'

# --- photos: distinct noisy JPEGs (worst case for size), 1600x1200
Add-Type -AssemblyName System.Drawing
$rng = New-Object System.Random 42
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L
$body = New-Object System.Text.StringBuilder
for ($i = 1; $i -le 30; $i++) {
    $w = 1600; $h = 1200
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $data = $bmp.LockBits((New-Object System.Drawing.Rectangle 0, 0, $w, $h), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
    $bytes = New-Object byte[] ($data.Stride * $h)
    $rng.NextBytes($bytes)
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    $bmp.UnlockBits($data)
    $file = "photo$i.jpg"
    $bmp.Save((Join-Path $work $file), $jpegCodec, $encParams)
    $bmp.Dispose()
    [void]$body.Append("<h1>Picture $i</h1><p>$([System.Net.WebUtility]::HtmlEncode($paragraphs[0]))</p><img src=""$file"">`n")
}
$style = 'body{font-family:"Segoe UI",Arial,sans-serif;font-size:11pt} h1{page-break-before:always;font-size:16pt} h1:first-of-type{page-break-before:avoid} img{display:block;width:100%;height:auto}'
Print-Pdf "<!doctype html><html lang=""en""><head><meta charset=""utf-8""><style>@page{size:A5;margin:12mm} $style</style></head><body>$body</body></html>" 'photos'

Copy-Item (Join-Path $corpus '*.pdf') $out
Get-ChildItem $out | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } }
