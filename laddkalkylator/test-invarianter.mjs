// test-invarianter.mjs — regressionssvit för Amp5 Laddkalkylatorns räknemotor.
//
// Kör:  node laddkalkylator/test-invarianter.mjs           (fullt svep, ~69k fall)
//       node laddkalkylator/test-invarianter.mjs --snabb   (litet svep, sekunder)
//       node laddkalkylator/test-invarianter.mjs --json    (maskinläsbar utskrift)
//
// Bakgrund: v3.8–v3.8.3 skrev om räknemotorn i tre vändor, och varje vända
// införde nya fel som bara nästa granskning hittade. De invarianter som gjorde
// omskrivningen trovärdig kördes ad hoc och gick förlorade. Det här är dem,
// bevarade. Kör sviten före och efter varje ändring i _33_calc.js.
//
// Sviten testar EGENSKAPER, inte facit: den känner inte till några "rätta"
// tal och går därför inte sönder av legitima modelländringar. Den går sönder
// när modellen börjar motsäga sig själv eller fysiken.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harHar = path.dirname(fileURLToPath(import.meta.url));
const SNABB = process.argv.includes('--snabb');
const JSON_UT = process.argv.includes('--json');

// --- Ladda calc.js i en sandlåda med window-shim -------------------------
function laddaCalc() {
  const src = fs.readFileSync(path.join(harHar, '_33_calc.js'), 'utf8').replace(/^﻿/, '');
  const ctx = { window: {}, console: { warn() {}, log() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: '_33_calc.js' });
  if (!ctx.window.Amp5Calc) throw new Error('calc.js satte aldrig window.Amp5Calc');
  return ctx.window.Amp5Calc;
}
const C = laddaCalc();

const EPS = 1e-6;
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

function beskriv(inp) {
  return `profil=${inp.profileLabel} L=${inp.parkingHours}h occ=${inp.peakOccupancyPct} `
    + `uttag=${inp.outlets} hubs=${inp.hubs ?? 'auto'} behov=${inp.sessionNeedKWh ?? '-'} `
    + `strategi=${inp.strategy} hw=${inp.hwLimitKW}`;
}

const TALFALT = [
  'perOutletKWh', 'totalEnergyDay', 'totalEnergyFromGrid', 'peakPowerKW',
  'peakDemandKW', 'peakReductionKW', 'avgPowerKW', 'avgPowerPerActive',
  'sessionsPerOutletPerDay', 'totalSessionsPerDay', 'kwhPerOutletPerDay',
  'presentAtPeak', 'queuedAtPeak', 'chargingAtPeak', 'maxPresent',
  'peakOccupancyPct', 'activeOutlets', 'effectiveCap', 'installedCap',
];

// --- Invariantregister ---------------------------------------------------
// check(r, inp) returnerar null (ok) eller avvikelsens storlek.
const INVARIANTER = [
  {
    namn: 'finita-tal',
    check(r) {
      for (const f of TALFALT) {
        const v = r[f];
        if (v != null && !Number.isFinite(v)) return 1;
      }
      if (r.hourly.some((v) => !Number.isFinite(v))) return 1;
      if (r.occupancy.some((v) => !Number.isFinite(v))) return 1;
      return null;
    },
  },
  {
    namn: 'effekttak',
    check(r) {
      const ov = r.peakPowerKW - r.effectiveCap;
      return ov > EPS * Math.max(1, r.effectiveCap) ? ov : null;
    },
  },
  {
    // Handbok 8.3.1: inget fordon laddar mellan 0 och 6 A.
    namn: '6A-golvet',
    check(r) {
      if (r.perCarAtPeakKW == null || r.perCarAtPeakKW === 0) return null;
      const brist = r.minChargeKW - r.perCarAtPeakKW;
      return brist > EPS ? brist : null;
    },
  },
  {
    namn: 'bilens-AC-tak',
    check(r) {
      if (r.perCarAtPeakKW == null) return null;
      const ov = r.perCarAtPeakKW - r.hwLimit;
      return ov > EPS ? ov : null;
    },
  },
  {
    // Granskningsfynd B4: "per laddtillfälle × antal" avvek 8,9 % från
    // "total per dygn" när simuleringen inte hunnit bli stationär.
    namn: 'energibalans',
    check(r) {
      const via = r.perOutletKWh * r.totalSessionsPerDay;
      const d = rel(via, r.totalEnergyDay);
      return d > 1e-6 ? d : null;
    },
  },
  {
    namn: 'behovstak',
    check(r, inp) {
      if (inp.sessionNeedKWh == null) return null;
      const ov = r.perOutletKWh - inp.sessionNeedKWh;
      return ov > EPS * Math.max(1, inp.sessionNeedKWh) ? ov : null;
    },
  },
  {
    // Granskningsfynd G5: färdigladdade bilar som står kvar är inte kö.
    namn: 'ko-ickenegativ',
    check(r) {
      if (r.queuedAtPeak < -EPS) return -r.queuedAtPeak;
      const ov = r.chargingAtPeak - r.presentAtPeak;
      return ov > EPS ? ov : null;
    },
  },
  {
    namn: 'sessionstak',
    check(r) {
      const ov = r.chargingAtPeak - r.sessionCapacity;
      return ov > EPS ? ov : null;
    },
  },
  {
    // Lastbalansering flyttar effekt mellan bilar, aldrig bort.
    namn: 'baslinje-energi',
    check(r) {
      const styrd = C.sum(r.hourly);
      const fri = C.sum(r.hourlyDemand);
      const brist = styrd - fri;
      return brist > 1e-6 * Math.max(1, fri) ? brist : null;
    },
  },
  {
    namn: 'belaggning-under-1',
    check(r) {
      const ov = r.peakOccupancyPct - 1;
      return ov > EPS ? ov : null;
    },
  },
  {
    namn: 'topp-over-medel',
    check(r) {
      const brist = r.avgPowerKW - r.peakPowerKW;
      return brist > EPS ? brist : null;
    },
  },
];

// --- Formmått över parkeringstiden ---------------------------------------
// Enskilda fall kan alla vara riktiga medan KURVAN är fel. Sågtanden i
// v3.8.1 och halvtimmesfyndet i v3.8.3 syns bara här.

function svepParkering(bas) {
  const rader = [];
  for (let L = 1; L <= 24; L++) {
    const r = C.computeEnergy({ ...bas, parkingHours: L });
    rader.push({
      L,
      energi: r.totalEnergyDay,
      platstimmar: C.sum(r.occupancy) * r.maxOutlets,
      toppBelaggning: r.peakOccupancyPct,
    });
  }
  return rader;
}

// Bilplatstimmar per dygn bestäms av beläggningen, inte av hur länge varje
// bil står. Spridningen mot parkeringstiden ska vara exakt 0.
function spridning(v) {
  const mx = Math.max(...v), mn = Math.min(...v);
  return mx > 1e-12 ? (mx - mn) / mx : 0;
}

// Längre parkeringstid ger mer tid att ladda; kurvan ska aldrig vända nedåt.
// v3.8.2 tog den här från 34 fallande steg till 0.
//
// OBS: gäller bara vid OBEGRÄNSAT sessionsbehov. Anges ett behov når varje
// session sitt tak, och total energi = sessioner × behov faller då som 1/L —
// korrekt fysik, inte ett fel. Monotonikravet ställs därför bara på det
// obegränsade fallet; behovsfallet mäts med sågtandsmåttet i stället.
function fallandeSteg(v) {
  let n = 0;
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1] - 1e-9) n++;
  return n;
}

// Sågtandsmått: teckenväxlingar i andra-differensen. En slät kurva har få.
// En kurva vars faltningskärna byter bredd med parkeringstidens paritet har
// nästan maximalt antal — precis det halvtimmesinterpolationen orsakar.
function taggighet(v) {
  const d2 = [];
  for (let i = 1; i < v.length - 1; i++) d2.push(v[i + 1] - 2 * v[i] + v[i - 1]);
  let vaxlingar = 0;
  for (let i = 1; i < d2.length; i++) {
    const a = d2[i - 1], b = d2[i];
    if (Math.abs(a) < 1e-9 || Math.abs(b) < 1e-9) continue;
    if ((a > 0) !== (b > 0)) vaxlingar++;
  }
  return { vaxlingar, mojliga: Math.max(0, d2.length - 1) };
}

// --- Parameterrum --------------------------------------------------------
function* fall() {
  const profiler    = Object.keys(C.PROFILES);
  const occar       = SNABB ? [0.5, 0.9]        : [0.1, 0.3, 0.5, 0.7, 0.9];
  const uttagen     = SNABB ? [54]              : [10, 54, 160];
  const hubbar      = SNABB ? [null]            : [null, 1, 4];
  const behoven     = SNABB ? [null, 20]        : [null, 10, 20, 40];
  const strategier  = SNABB ? ['priority']      : ['priority', 'fair'];
  const hwtak       = SNABB ? [11]              : [11, 22];
  const Lar         = SNABB ? [1, 4, 8, 13, 24] : Array.from({ length: 24 }, (_, i) => i + 1);

  for (const p of profiler)
    for (const L of Lar)
      for (const occ of occar)
        for (const outlets of uttagen)
          for (const hubs of hubbar)
            for (const need of behoven)
              for (const strategy of strategier)
                for (const hw of hwtak)
                  yield {
                    outlets, hubs, parkingHours: L, peakOccupancyPct: occ,
                    profileHours: C.PROFILES[p].hours, profileLabel: p,
                    sessionNeedKWh: need, strategy, hwLimitKW: hw,
                  };
}

// --- Kör ------------------------------------------------------------------
const start = Date.now();
const resultat = new Map(INVARIANTER.map((i) => [i.namn, { namn: i.namn, brott: 0, varsta: 0, varstaFall: null }]));
let antal = 0, kraschar = 0, forstaKrasch = null;

for (const inp of fall()) {
  antal++;
  let r;
  try {
    r = C.computeEnergy(inp);
  } catch (e) {
    kraschar++;
    if (!forstaKrasch) forstaKrasch = { fel: e.message, inp: beskriv(inp) };
    continue;
  }
  for (const inv of INVARIANTER) {
    const avvikelse = inv.check(r, inp);
    if (avvikelse != null) {
      const post = resultat.get(inv.namn);
      post.brott++;
      if (avvikelse > post.varsta) {
        post.varsta = avvikelse;
        post.varstaFall = beskriv(inp);
      }
    }
  }
}

const svep = [];
for (const p of Object.keys(C.PROFILES)) {
  for (const occ of (SNABB ? [0.8] : [0.3, 0.8])) {
    const bas = {
      outlets: 54, hubs: null, peakOccupancyPct: occ,
      profileHours: C.PROFILES[p].hours, profileLabel: p,
      strategy: 'priority', hwLimitKW: 11,
    };
    // Monotonin mäts obegränsat (se fallandeSteg); sågtanden i det
    // behovsbegränsade fallet, där halvtimmesfyndet syns tydligast.
    const fritt = svepParkering({ ...bas, sessionNeedKWh: null });
    const behov = svepParkering({ ...bas, sessionNeedKWh: 20 });
    svep.push({
      profil: p, occ,
      platstimmarSpridning: spridning(fritt.map((x) => x.platstimmar)),
      fallandeSteg: fallandeSteg(fritt.map((x) => x.energi)),
      taggighet: taggighet(fritt.map((x) => x.toppBelaggning)),
      energiTaggighet: taggighet(behov.map((x) => x.energi)),
    });
  }
}

const sekunder = (Date.now() - start) / 1000;

// --- Rapport --------------------------------------------------------------
const platsSpridningMax = Math.max(...svep.map((s) => s.platstimmarSpridning));
const fallandeTotalt    = svep.reduce((a, s) => a + s.fallandeSteg, 0);
const taggTotalt        = svep.reduce((a, s) => a + s.taggighet.vaxlingar, 0);
const taggMojliga       = svep.reduce((a, s) => a + s.taggighet.mojliga, 0);
const brottTotalt       = [...resultat.values()].reduce((a, r) => a + r.brott, 0);

if (JSON_UT) {
  console.log(JSON.stringify({
    antal, kraschar, sekunder,
    invarianter: [...resultat.values()],
    svep, platsSpridningMax, fallandeTotalt, taggTotalt, taggMojliga,
  }, null, 2));
} else {
  console.log('\nAmp5 raknemotor - invariantsvit');
  console.log(`${antal} fall pa ${sekunder.toFixed(1)} s${SNABB ? '  (snabbsvep)' : ''}\n`);
  console.log('       INVARIANT              BROTT   VARSTA AVVIKELSE');
  for (const r of resultat.values()) {
    console.log(`  ${r.brott === 0 ? 'OK  ' : 'FEL '} ${r.namn.padEnd(20)} ${String(r.brott).padStart(7)}   ${r.brott ? r.varsta.toPrecision(3) : '-'}`);
    if (r.brott) console.log(`       varst: ${r.varstaFall}`);
  }
  if (kraschar) {
    console.log(`\n  FEL  kraschar: ${kraschar}  forsta: ${forstaKrasch.fel}`);
    console.log(`       ${forstaKrasch.inp}`);
  }

  console.log('\n  FORMMATT (svep over parkeringstid 1-24 h)');
  console.log(`  ${'bilplatstimmar, max spridning'.padEnd(32)} ${(platsSpridningMax * 100).toFixed(3)} %   (mal: 0)`);
  console.log(`  ${'fallande steg i energikurvan'.padEnd(32)} ${fallandeTotalt}          (mal: 0)`);
  console.log(`  ${'sagtand i topplaggningen'.padEnd(32)} ${taggTotalt}/${taggMojliga}      (lagre = slatare)`);
  for (const s of svep) {
    console.log(`     ${s.profil.padEnd(12)} occ=${s.occ}  fallande=${s.fallandeSteg}  `
      + `sagtand=${s.taggighet.vaxlingar}/${s.taggighet.mojliga}  `
      + `energisagtand=${s.energiTaggighet.vaxlingar}/${s.energiTaggighet.mojliga}`);
  }
  console.log('');
}

// Hårda krav: invariantbrott, kraschar, bilplatstimmar och monotoni.
// Sågtanden rapporteras men fäller inte sviten — den är ett formmått, inte
// ett fel i sig.
const hardaFel = brottTotalt > 0 || kraschar > 0
  || platsSpridningMax > 1e-9 || fallandeTotalt > 0;
if (!JSON_UT) console.log(hardaFel ? 'RESULTAT: FEL\n' : 'RESULTAT: alla invarianter haller\n');
process.exit(hardaFel ? 1 : 0);
