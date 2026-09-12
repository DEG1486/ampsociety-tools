$ErrorActionPreference = 'Stop'

# Byter ut den yttre laddskarmen i repots index.html mot AmpSocietys egen.
#
# Kors EFTER build37.ps1: build37 packar om manifestet men ror inte det yttre
# skalet, sa startskarmen overlever kommande byggen.
#
# Skriptet ar INTE idempotent - det kastar om monstren redan ar ersatta, vilket
# ar avsiktligt.
#
# OBS: index.html i repot har startskarmen REDAN inbakad (den kom in i commit
# dfa70fd, v3.8.1). Ett vanligt "git checkout index.html" racker darfor inte -
# da hittar skriptet ingen bootstrap-skarm att ersatta och kastar. Den sista
# ORORDA bundler-exporten ligger i commit a14933a (v3.8). Hela kedjan fran rent
# lage ar alltsa:
#     git show a14933a:index.html > index.html
#     .\laddkalkylator\build37.ps1
#     .\laddkalkylator\build-startscreen.ps1
#
# I det normala flodet kors bara build37.ps1 - startskarmen ligger kvar i
# index.html och roras inte.
#
# Filen MASTE sparas som UTF-8 MED BOM. PowerShell 5.1 laser annars .ps1 som
# ANSI, och de svenska statustexterna nedan blir mojibake i den byggda filen.

# Sokvagar harleds relativt skriptets egen plats (.../ampsociety-tools/laddkalkylator)
$srcDir     = $PSScriptRoot
$repoDir    = Split-Path $srcDir -Parent
$sourcePath = Join-Path $repoDir 'index.html'
$outputPath = $sourcePath
$assetPath  = Join-Path $srcDir 'startskarm'

function DataUri($name, $mime) {
    'data:' + $mime + ';base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $assetPath $name)))
}
$css = [IO.File]::ReadAllText((Join-Path $assetPath 'startscreen.css'))
$css = $css.Replace('__APERCU__', (DataUri 'apercu-pro.otf' 'font/otf')).Replace('__GT_SUPER__', (DataUri 'gt-super-text.woff2' 'font/woff2'))
$screen = [IO.File]::ReadAllText((Join-Path $assetPath 'startscreen.html')).Replace('__LOGO__', (DataUri 'ampsociety-logo.svg' 'image/svg+xml'))
$html = [IO.File]::ReadAllText($sourcePath)
$stylePattern = [regex]::new('(?s)<style>.*?</style>')
$html = $stylePattern.Replace($html, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) "<style>`n$css`n</style>" }, 1)
$screenPattern = [regex]::new('(?s)  <div id="__bundler_thumbnail">.*?<div id="__bundler_loading">Unpacking\.\.\.</div>')
if ($screenPattern.Matches($html).Count -ne 1) {
    throw 'Hittade inte bootstrapens laddskarm. Ar index.html redan bearbetad? Kor "git checkout index.html" och sedan build37.ps1 forst.'
}
$html = $screenPattern.Replace($html, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $screen }, 1)
$html = $html.Replace('<html>', '<html lang="sv">').Replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">')

# Titeln kommer fran bundler-exporten och bar dar en HARDKODAD version
# ("Amp5 Laddkalkylator - Instrument v3.7") - en fjarde plats dar versionen kan
# bli gammal utan att nagon marker det. Den sattes tidigare for hand efter
# bygget; nu satts den har, versionslost, sa den aldrig kan sacka efter.
$html = [regex]::Replace($html, '(?s)<title>.*?</title>', '<title>Amp5 Laddkalkylator · AmpSociety</title>', 1)
$html = $html.Replace('This page requires JavaScript to display.', 'Aktivera JavaScript för att öppna laddkalkylatorn.')
$html = $html.Replace("setStatus('Unpacking ' + uuids.length + ' assets...');", "setStatus('Förbereder din kalkyl…');")
$html = $html.Replace("setStatus('Rendering...');", "setStatus('Öppnar laddkalkylatorn…');")
$html = $html.Replace("setStatus('Error: missing bundle data');", "setStatus('Kalkylatorn kunde inte laddas. Öppna filen igen.');")

# Blob-URL:erna for typsnitt och bilder revokeras en stund efter fonts.ready.
# Bootstrapens egen marginal pa 2 s ar FOR KORT: startskarmen haller sjalv kvar
# appen i 2,5 s, sa blobbarna hann revokeras innan nagot renderats - och alla
# inbaddade markestypsnitt foll tyst tillbaka pa systemfonter (GT Super blev
# Georgia). Hojs till 20 s; en oatervunnen blob kostar bara lite minne en gang.
$revokeGammal = 'setTimeout(revokeAll, 2000)'
if ($html.Contains($revokeGammal)) {
    $html = $html.Replace($revokeGammal, 'setTimeout(revokeAll, 20000)')
}

# ...men marginalen ensam racker inte. document.fonts.ready lovar bara att
# PAGAENDE laddningar ar klara; varianter som annu inte anvants ar olastade, och
# nar blob-URL:en revokeras kan de ALDRIG hamtas. GT Super 700 (compare-lagets
# scenariosiffror, PDF:ens stora tal) och GT Super kursiv (PDF:ens citat) anvands
# forst nar man byter lage eller exporterar - dvs nastan alltid efter
# revokeringen - och foll da tyst tillbaka pa Georgia. Alla deklarerade
# varianter tvingas darfor in i minnet innan blobbarna slapps.
$vantaGammal = 'try { await document.fonts?.ready; } catch (_) {}'
$vantaNy = @'
try { await document.fonts?.ready; } catch (_) {}
      // Tvinga in ALLA deklarerade typsnittsvarianter innan blobbarna slapps.
      // fonts.ready lovar bara att PAGAENDE laddningar ar klara - varianter som
      // annu inte anvants ar olastade, och nar blob-URL:en sedan revokeras kan
      // de ALDRIG hamtas. Foljden var att GT Super 700 (compare-lagets
      // scenariosiffror, PDF:ens stora tal) och GT Super kursiv (PDF:ens citat)
      // foll tyst tillbaka pa Georgia sa fort man bytte lage eller exporterade
      // mer an en stund efter sidladdningen.
      try { await Promise.all([...document.fonts].map((f) => f.load().catch(() => {}))); } catch (_) {}
'@
if ($html.Contains($vantaGammal) -and -not $html.Contains('[...document.fonts].map')) {
    $html = $html.Replace($vantaGammal, $vantaNy.TrimEnd("`r", "`n"))
}

# Start the minimum display time while the bundled assets unpack in parallel.
$startupHook = "document.addEventListener('DOMContentLoaded', async function() {"
$startupTimer = @'
document.addEventListener('DOMContentLoaded', async function() {
  const startupReady = new Promise(resolve => setTimeout(resolve, 2500));
'@
$swapHook = 'document.documentElement.replaceWith(doc.documentElement);'
if (-not $html.Contains($startupHook) -or -not $html.Contains($swapHook)) {
    throw 'Hittade inte bootstrapens tidshakar (DOMContentLoaded / documentElement-bytet).'
}
$html = $html.Replace($startupHook, $startupTimer)
$html = $html.Replace($swapHook, "await startupReady;`n    $swapHook")
# Skrivs MED BOM, som build37.ps1 gor. Annars beror filens forsta tre bytes pa
# vilket skript som rakade koras sist, och index.html andras i git utan att
# nagot i innehallet skiljer sig.
[IO.File]::WriteAllText($outputPath, $html, [Text.UTF8Encoding]::new($true))

# A separate, stationary preview lets the design be reviewed without delaying startup.
$preview = "<!DOCTYPE html><html lang=`"sv`"><head><meta charset=`"utf-8`"><meta name=`"viewport`" content=`"width=device-width,initial-scale=1`"><title>AmpSociety · Förhandsvisning av startskärm</title><style>$css</style></head><body>$screen</body></html>"
[IO.File]::WriteAllText((Join-Path $srcDir 'startskarm-preview.html'), $preview, [Text.UTF8Encoding]::new($false))
Write-Output "Byggde startskarm i $outputPath"
Write-Output "Forhandsvisning: $(Join-Path $srcDir 'startskarm-preview.html')"
