// verifiera-bygge.mjs — kontrollerar att index.html faktiskt är byggd från
// källfilerna i laddkalkylator/.
//
// Kör:  node laddkalkylator/verifiera-bygge.mjs
//
// Appen är en enda självständig HTML-fil där källkoden ligger gzip+base64-
// komprimerad i <script type="__bundler/manifest">. Det gör det lätt att ändra
// en källfil, committa, och glömma att köra build37.ps1 — index.html ser ut att
// vara med i commiten men innehåller fortfarande den gamla koden. Ingenting
// säger ifrån, och felet upptäcks först när någon undrar varför en fix inte
// syns live.
//
// Skriptet packar upp manifestet och jämför innehållet mot källfilerna.
//
// OBS radsluten: repot har core.autocrlf=true, så källfilerna är CRLF i
// arbetskatalogen på Windows men LF i git. Manifestet byggs på Windows och
// innehåller därför CRLF, medan en utcheckning i CI (Linux) ger LF. En rå
// byte-jämförelse skulle alltså larma på varje körning i CI utan att något är
// fel. Båda sidor normaliseras till LF före jämförelsen — JS bryr sig inte om
// radslut, och det är innehållet vi vill skydda.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const harHar = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.dirname(harHar);
const indexPath = path.join(repoDir, 'index.html');

// UUID:na måste hållas i synk med build37.ps1.
const ASSETS = [
  { uuid: 'f68b3a4d-11bb-427c-8557-8d540e0a90b6', fil: '_33_calc.js' },
  { uuid: 'bf93f494-9985-4fab-ba6a-1ca74980463d', fil: '_33_variant.jsx' },
  { uuid: '5c242ea4-b8fc-41c7-8c5e-e923c5fe0dc4', fil: '_33_pdf.jsx' },
];

const fel = [];
const ok = [];
const normalisera = (s) => s.replace(/\r\n/g, '\n');

const html = fs.readFileSync(indexPath, 'utf8');
const träff = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
if (!träff) {
  console.error('FEL: hittade inget manifest-block i index.html');
  process.exit(1);
}
const manifest = JSON.parse(träff[1].trim());

for (const { uuid, fil } of ASSETS) {
  const post = manifest[uuid];
  if (!post) { fel.push(`${fil}: UUID ${uuid} saknas i manifestet`); continue; }
  let ipackad;
  try {
    const rå = Buffer.from(post.data, 'base64');
    ipackad = post.compressed ? zlib.gunzipSync(rå).toString('utf8') : rå.toString('utf8');
  } catch (e) {
    fel.push(`${fil}: kunde inte packa upp manifestposten (${e.message})`);
    continue;
  }
  const påDisk = fs.readFileSync(path.join(harHar, fil), 'utf8');
  const a = normalisera(ipackad), b = normalisera(påDisk);
  if (a === b) {
    ok.push(`${fil} (${b.length} tecken)`);
  } else {
    fel.push(`${fil}: index.html matchar INTE källfilen `
      + `(bundlad ${a.length} tecken, på disk ${b.length}) — kör build37.ps1`);
  }
}

// Versionssträngen står i `APP_VERSION` i _33_variant.jsx (sidfoten och rapportens
// meta läser den) och som literal i _33_pdf.jsx:s exempeldata. Går de isär visar
// appen en version och PDF:en en annan — därför matchas båda formerna här.
const versioner = new Map();
for (const fil of ['_33_calc.js', '_33_variant.jsx', '_33_pdf.jsx']) {
  const txt = fs.readFileSync(path.join(harHar, fil), 'utf8');
  for (const m of txt.matchAll(/(?:version:\s*|APP_VERSION\s*=\s*)'(\d+\.\d+\.\d+)'/g)) {
    if (!versioner.has(m[1])) versioner.set(m[1], []);
    versioner.get(m[1]).push(fil);
  }
}
if (versioner.size === 0) {
  fel.push('hittade ingen versionssträng i källfilerna');
} else if (versioner.size > 1) {
  const lista = [...versioner.entries()].map(([v, f]) => `${v} i ${[...new Set(f)].join(', ')}`);
  fel.push(`versionssträngarna går isär: ${lista.join('; ')}`);
} else {
  ok.push(`version ${[...versioner.keys()][0]} konsekvent på ${[...versioner.values()][0].length} ställen`);
}

// Yttre skalet ska inte bära en egen version — den blir gammal utan att någon märker det.
if (/Amp5 Laddkalkylator v[\d.]+/.test(html)) {
  fel.push('yttre skalet innehåller en hårdkodad version ("Amp5 Laddkalkylator v…")');
} else {
  ok.push('yttre skalet är versionslöst');
}

for (const rad of ok) console.log(`  OK   ${rad}`);
for (const rad of fel) console.log(`  FEL  ${rad}`);
console.log(fel.length ? '\nRESULTAT: index.html är INTE i synk med källkoden\n' : '\nRESULTAT: bygget är i synk\n');
process.exit(fel.length ? 1 : 0);
