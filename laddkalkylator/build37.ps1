$ErrorActionPreference = 'Stop'

# Sökvägar härleds relativt skriptets egen plats (.../ampsociety-tools/laddkalkylator)
$srcDir  = $PSScriptRoot
$repoDir = Split-Path $srcDir -Parent

$calcSrc    = Join-Path $srcDir '_33_calc.js'
$variantSrc = Join-Path $srcDir '_33_variant.jsx'
$pdfSrc     = Join-Path $srcDir '_33_pdf.jsx'
$baseHtml   = Join-Path $repoDir 'index.html'   # bas (innehåller manifestet)
$outHtml    = Join-Path $repoDir 'index.html'   # skrivs in i samma fil

$calcUUID    = 'f68b3a4d-11bb-427c-8557-8d540e0a90b6'
$variantUUID = 'bf93f494-9985-4fab-ba6a-1ca74980463d'
$pdfUUID     = '5c242ea4-b8fc-41c7-8c5e-e923c5fe0dc4'

function GzipB64($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $ms = New-Object System.IO.MemoryStream
    $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
    $gz.Write($bytes, 0, $bytes.Length)
    $gz.Close()
    return [Convert]::ToBase64String($ms.ToArray())
}

Write-Host "Komprimerar calc.js..."
$calcB64    = GzipB64 $calcSrc
Write-Host "Komprimerar variant.jsx..."
$variantB64 = GzipB64 $variantSrc
Write-Host "Komprimerar pdf.jsx..."
$pdfB64     = GzipB64 $pdfSrc

Write-Host "Laser bas-HTML (index.html)..."
$html = [System.IO.File]::ReadAllText($baseHtml, [System.Text.Encoding]::UTF8)

$manifestPattern = '(?s)<script type="__bundler/manifest">(.*?)</script>'
$manifestMatch   = [regex]::Match($html, $manifestPattern)
if (-not $manifestMatch.Success) { throw 'Manifest-blocket hittades inte i index.html' }
$manifest = $manifestMatch.Groups[1].Value.Trim() | ConvertFrom-Json

$manifest.$calcUUID.data    = $calcB64
$manifest.$variantUUID.data = $variantB64
$manifest.$pdfUUID.data     = $pdfB64

$newManifestJson = $manifest | ConvertTo-Json -Depth 10 -Compress
$newManifest     = '<script type="__bundler/manifest">' + $newManifestJson + '</script>'
$html = [regex]::Replace($html, $manifestPattern, $newManifest)

$html = $html -replace 'Amp5 Laddkalkylator v[\d.]+', 'Amp5 Laddkalkylator v3.7'

[System.IO.File]::WriteAllText($outHtml, $html, [System.Text.Encoding]::UTF8)

$size = (Get-Item $outHtml).Length
Write-Host "Byggde: $outHtml"
Write-Host "Storlek: $([math]::Round($size/1MB,2)) MB"
