// matt-pdf.mjs — mäter sidöverflöde i kundrapporten, automatiskt.
//
// Kör:  node laddkalkylator/matt-pdf.mjs
//       node laddkalkylator/matt-pdf.mjs --behall   (spara sonderna för felsökning)
//
// VARFÖR: PDF-sidorna är A4 med FAST höjd (1123 px) och `overflow: hidden`.
// Växer texten klipps den TYST — ingen varning, inget felmeddelande, bara en
// kundrapport med en avhuggen friskrivning. Det inträffade tre gånger under
// granskningen 2026-09-13, varje gång för att någon lade till en rad text:
// kövarningen väcktes till liv, effekttariffens sats skrevs ut, och elnätsbadgen
// fick en femte kolumn.
//
// Mätmetoden stod i CLAUDE.md som ett tiostegs handgrepp med lätt att glömma
// detaljer (stubba window.print, aldrig rensa overlayen för hand, ladda om
// mellan fallen). Det här är samma metod, körbar.
//
// TVÅ KRITERIER, och det andra är det som brukar glömmas:
//   1. inga klippta LÖV-element (containers ger falska träffar)
//   2. scrollHeight === clientHeight
// Under granskningen visade sida 2 noll klippta lövelement hela vägen från
// 1124 till 1153 px — överskottet låg i containrarnas marginaler. Hade bara
// kriterium 1 kontrollerats hade en trasig sida 2 gått rakt igenom.
//
// Kräver Chrome lokalt. Saknas den hoppar skriptet över med exit 0 — det är
// avsett som en kontroll före commit, inte som en CI-grind.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const harHar = path.dirname(fileURLToPath(import.meta.url));
const roten = path.resolve(harHar, '..');
const BEHALL = process.argv.includes('--behall');
const SIDHOJD = 1123;

const KROM = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } })
  || process.env.CHROME_PATH;

if (!KROM) {
  console.log('\nmatt-pdf: hittade ingen Chrome — hoppar över.');
  console.log('  Sätt CHROME_PATH om den ligger på en egen plats.\n');
  process.exit(0);
}

// --- fallen -------------------------------------------------------------
// Varje fall sätts via URL-hashen (#k= + base64 av JSON, se decodeCalcState).
// Snabbare och pålitligare än att driva reglagen via DOM.
const gemensamt = {
  mode: 'energy', uiMode: 'advanced', capPerHub: 44, systemCap: null,
  carId: 'tesla3', carAcLimit: 11, efficiency: 0.95, strategy: 'priority',
  desiredKWh: 30, electricityPrice: 2.5, chargingFee: 3.5, powerTariff: 60,
  materialCost: 400000, installationCost: 300000, omPctYear: 3, investmentGrant: 0,
};
const FALL = [
  ['appens default · servisutökning', { ...gemensamt, outlets: 20, hubs: null, parkingHours: 9, profileKey: 'office', peakOcc: 0.85, occPct: 0.75, sessionNeedKWh: 15, fuseSizeA: 63, existingLoadPct: 0.20, materialCost: 100000, installationCost: 150000 }],
  ['inga varningar · gott om servis', { ...gemensamt, outlets: 20, hubs: 1, parkingHours: 9, profileKey: 'office', peakOcc: 0.6, occPct: 0.6, sessionNeedKWh: 15, fuseSizeA: 125, existingLoadPct: 0.20 }],
  ['batterivarning', { ...gemensamt, outlets: 25, hubs: 1, parkingHours: 16, profileKey: 'flat', peakOcc: 0.18, occPct: 0.18, sessionNeedKWh: null, fuseSizeA: 125, existingLoadPct: 0.20 }],
  ['TVÅ varningar · kö + batteri', { ...gemensamt, outlets: 54, hubs: 3, parkingHours: 24, profileKey: 'mall', peakOcc: 0.85, occPct: 0.85, sessionNeedKWh: 200, fuseSizeA: 63, existingLoadPct: 0.20 }],
  ['hubs-läget', { ...gemensamt, mode: 'hubs', outlets: 40, hubs: null, parkingHours: 6, profileKey: 'mall', peakOcc: 0.85, occPct: 0.85, desiredKWh: 120, sessionNeedKWh: null, fuseSizeA: 125, existingLoadPct: 0.20 }],
  ['jämförelseläget · 2 scenarier', { ...gemensamt, mode: 'compare', fuseSizeA: 63, existingLoadPct: 0.20 }],
  ['jämförelseläget · 4 scenarier', { ...gemensamt, mode: 'compare', fuseSizeA: 63, existingLoadPct: 0.20,
    scenarios: [
      { name: 'Scenario A', colorSlot: 0, outlets: 20, hubs: 1, capPerHub: 44, systemCap: null, parkingHours: 9, profileKey: 'office', peakOcc: 0.85 },
      { name: 'Scenario B', colorSlot: 1, outlets: 50, hubs: 1, capPerHub: 44, systemCap: null, parkingHours: 8, profileKey: 'mall', peakOcc: 0.85 },
      { name: 'Scenario C', colorSlot: 2, outlets: 80, hubs: 2, capPerHub: 44, systemCap: null, parkingHours: 12, profileKey: 'residential', peakOcc: 0.9 },
      { name: 'Scenario D', colorSlot: 3, outlets: 108, hubs: 3, capPerHub: 44, systemCap: null, parkingHours: 3, profileKey: 'flat', peakOcc: 0.6 },
    ] }],
];

// String.raw, inte en vanlig template literal: sonden innehåller reguljära
// uttryck, och i en vanlig template literal äts varje backslash innan koden ens
// når webbläsaren — \d blir d och \s blir s, så uttrycket matchar tyst
// ingenting. Statusregexerna nedan har inga escapes och fungerade därför direkt,
// vilket gjorde felet lätt att missa. ${...} fungerar likadant i String.raw.
const SOND = String.raw`
<script>
(async function () {
  const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => (el.textContent || '').trim();
  const ut = [];
  try {
    await vanta(8000);                       // startskärmen håller appen i 2,5 s

    // PARITET: samma tillstånd ska ge samma besked på skärmen och i rapporten.
    // Projektets vanligaste felklass — rätt beräkning, men skärmen och
    // kundrapporten visade olika tal (G1: 346 km mot 186 km) eller olika status
    // (G7). Ordalydelsen skiljer medvetet; STATUSKLASSEN får inte göra det.
    const skarmText = document.body.innerText;
    const klass = (t) => (/OK: elnätet|Elnät: OK/.test(t) ? 'ok'
      : /Marginellt|Elnät: Marginellt/.test(t) ? 'marginal'
      : /Servisutökning krävs|Utökning krävs/.test(t) ? 'upgrade' : null);
    // Negativ lookbehind pa '/': talet i enheten "kWh/100 km" ar inte en
    // rackvidd, och slapptes annars igenom och gav falska paritetsfel.
    const kmVarden = (t) => [...new Set((t.match(/(?<![\/\d])(\d[\d\s ]{0,8})km/g) || [])
      .map((x) => parseInt(x.replace(/[^\d]/g, ''), 10))
      .filter((n) => n > 20 && n < 5000))].sort((a, b) => b - a);

    window.print = function () {};           // aldrig skriva ut på riktigt
    const knapp = [...document.querySelectorAll('button')].find((b) => /Spara som PDF/.test(txt(b)));
    if (!knapp) throw new Error('hittade ingen exportknapp');
    knapp.click();
    await vanta(5000);
    const ov = document.getElementById('__pdf_print_overlay');
    if (!ov) throw new Error('ingen overlay — exporten returnerade tyst');
    const text = ov.innerText || '';
    for (const sida of ov.querySelectorAll('[id^="ed-"],[id^="cmp-"]')) {
      const r = sida.getBoundingClientRect();
      let klippta = 0, lagst = 0, lagstText = '';
      for (const el of sida.querySelectorAll('*')) {
        if (el.children.length) continue;                    // bara LÖV
        if (!(el.textContent || '').trim()) continue;
        const rel = el.getBoundingClientRect().bottom - r.top;
        if (rel > lagst) { lagst = rel; lagstText = txt(el).slice(0, 40); }
        if (rel > ${SIDHOJD} + 0.5) klippta++;
      }
      ut.push({ sida: sida.id, scrollHeight: sida.scrollHeight, clientHeight: sida.clientHeight,
                lagst: Math.round(lagst * 10) / 10, klippta, lagstText });
    }
    ut.push({
      friskrivning: text.indexOf('ELSÄK-FS') >= 0,
      varningar: (text.match(/⚠/g) || []).length,
      skarmStatus: klass(skarmText), pdfStatus: klass(text),
      skarmKm: kmVarden(skarmText), pdfKm: kmVarden(text),
    });
  } catch (e) {
    ut.push({ fel: e && e.message });
  }
  const d = document.createElement('div');
  d.id = 'MATT';
  d.textContent = '###MATT###' + JSON.stringify(ut);
  document.documentElement.appendChild(d);
})();
</script>`;

// --- kör ----------------------------------------------------------------
const html = fs.readFileSync(path.join(roten, 'index.html'), 'utf8');
if (!html.includes('</body>')) { console.error('index.html saknar </body>'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amp5-pdf-'));
const sondFil = path.join(tmp, 'sond.html');
fs.writeFileSync(sondFil, html.replace('</body>', SOND + '</body>'), 'utf8');

console.log('\nmatt-pdf — sidöverflöde i kundrapporten\n');
console.log(`  sidhöjd ${SIDHOJD} px · kriterium: 0 klippta lövelement OCH scrollHeight = clientHeight\n`);

let fel = 0;
for (const [namn, tillstand] of FALL) {
  const hash = Buffer.from(JSON.stringify(tillstand), 'utf8').toString('base64');
  let rad;
  try {
    const dom = execFileSync(KROM, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom',
      '--virtual-time-budget=45000', `file:///${sondFil.replace(/\\/g, '/')}#k=${hash}`,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = dom.match(/###MATT###(\[[\s\S]*?\])<\/div>/);
    if (!m) throw new Error('sonden svarade inte — renderades appen?');
    rad = JSON.parse(m[1]);
  } catch (e) {
    console.log(`  FEL  ${namn}\n         ${e.message.split('\n')[0]}`);
    fel++; continue;
  }
  const krasch = rad.find((x) => x.fel);
  if (krasch) { console.log(`  FEL  ${namn}\n         ${krasch.fel}`); fel++; continue; }
  const meta = rad.find((x) => x.friskrivning !== undefined) || {};
  const sidor = rad.filter((x) => x.sida);
  const brott = sidor.filter((s) => s.klippta > 0 || s.scrollHeight !== s.clientHeight);
  const paritetsfel = [];
  if (meta.skarmStatus && meta.pdfStatus && meta.skarmStatus !== meta.pdfStatus)
    paritetsfel.push(`elnätsstatus: skärmen säger "${meta.skarmStatus}", rapporten "${meta.pdfStatus}"`);
  const sKm = meta.skarmKm || [], pKm = meta.pdfKm || [];
  if (sKm.length && pKm.length && sKm[0] !== pKm[0])
    paritetsfel.push(`räckvidd: skärmen visar ${sKm[0]} km, rapporten ${pKm[0]} km`);
  if (!sidor.length) { console.log(`  FEL  ${namn}\n         inga sidor hittades`); fel++; continue; }
  if (!meta.friskrivning) brott.push({ sida: '(friskrivningen)', scrollHeight: 0, clientHeight: 0, klippta: 1, lagstText: 'texten når inte "ELSÄK-FS"' });
  const trasigt = brott.length + paritetsfel.length;
  console.log(`  ${trasigt ? 'FEL ' : 'OK  '} ${namn}${meta.varningar ? `  (${meta.varningar} varningar)` : ''}`
    + (meta.skarmStatus ? `  [elnät ${meta.skarmStatus}${sKm[0] ? `, ${sKm[0]} km` : ''}]` : ''));
  for (const f of paritetsfel) console.log(`         ! PARITET  ${f}`);
  for (const s of sidor) {
    const trasig = s.klippta > 0 || s.scrollHeight !== s.clientHeight;
    console.log(`         ${trasig ? '!' : ' '} ${s.sida.padEnd(6)} scroll ${s.scrollHeight}/${s.clientHeight}`
      + `  sista lövet ${String(s.lagst).padStart(6)}  klippta ${s.klippta}`
      + (trasig ? `   <- "${s.lagstText}"` : ''));
  }
  if (trasigt) fel++;
}

if (BEHALL) console.log(`\n  sonden sparad: ${sondFil}`);
else fs.rmSync(tmp, { recursive: true, force: true });

console.log(fel ? `\nRESULTAT: FEL — ${fel} av ${FALL.length} fall spiller över\n`
                : `\nRESULTAT: alla ${FALL.length} fall håller sig inom sidan\n`);
process.exit(fel ? 1 : 0);
