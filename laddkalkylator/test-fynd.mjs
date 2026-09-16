// test-fynd.mjs — regressionsspärrar för formelgranskningen 2026-09-13.
//
// Kör:  node laddkalkylator/test-fynd.mjs
//       node laddkalkylator/test-fynd.mjs --json
//
// VARFÖR DEN HÄR FILEN FINNS, utöver test-invarianter.mjs:
//
// Invariantsviten testar EGENSKAPER — att modellen inte motsäger sig själv
// eller fysiken. Den är grön genom hela granskningen 2026-09-13 och var grön
// genom alla fem blockerare. Den kunde inte se dem, av två skäl:
//
//   1. Den kör bara computeEnergy. computeEconomics, computeGridAssessment och
//      computeHubs hade inget skyddsnät alls — och det är där paybacken och
//      elnätsutlåtandet bor, alltså de tal som avgör en affär.
//   2. Merparten av fynden satt i PRESENTATIONEN: rätt beräkning, fel etikett,
//      fel fält uthämtat, eller en varning som fanns på skärmen men inte i
//      kundrapporten. Ingen egenskap hos räknemotorn bryts av det.
//
// Den här sviten testar därför FACIT, inte egenskaper: varje kontroll motsvarar
// ett konkret fynd och faller om just det fyndet återuppstår. Källkods-
// kontrollerna längst ned är medvetet grova strängmatchningar — de är billiga,
// de fångar den vanligaste återfallsformen (någon tar bort en rad), och de
// säger i klartext vilket fynd som brutits.
//
// Lägg till en spärr här varje gång en granskning hittar något som inte är en
// egenskap. Den kostar sekunder och betalar sig första gången.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harHar = path.dirname(fileURLToPath(import.meta.url));
const JSON_UT = process.argv.includes('--json');

function laddaCalc() {
  const src = fs.readFileSync(path.join(harHar, '_33_calc.js'), 'utf8').replace(/^﻿/, '');
  const ctx = { window: {}, console: { warn() {}, log() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: '_33_calc.js' });
  if (!ctx.window.Amp5Calc) throw new Error('calc.js satte aldrig window.Amp5Calc');
  return ctx.window.Amp5Calc;
}
const C = laddaCalc();
const las = (f) => fs.readFileSync(path.join(harHar, f), 'utf8').replace(/^﻿/, '');
const VARIANT = las('_33_variant.jsx');
const PDF = las('_33_pdf.jsx');
const CALC = las('_33_calc.js');

// --- testregister --------------------------------------------------------
const test = [];
const lagg = (fynd, namn, fn) => test.push({ fynd, namn, fn });

const energi = (o = {}) => C.computeEnergy(Object.assign({
  outlets: 20, hubs: 1, capPerHub: 44, systemCap: null, parkingHours: 9,
  profileHours: C.PROFILES.office.hours, peakOccupancyPct: 0.6,
  hwLimitKW: 11, efficiency: 0.95, sessionNeedKWh: null, strategy: 'priority',
}, o));

// =========================================================================
// RÄKNEMOTORN — funktioner som saknade skyddsnät helt
// =========================================================================

lagg('täckning', 'ekonomi: summor och identiteter', () => {
  const fel = [];
  for (const m of [0, 250000, 2000000]) for (const i of [0, 150000])
  for (const ep of [0, 2.5]) for (const cf of [0, 3.5]) for (const pt of [0, 60])
  for (const om of [0, 0.03]) for (const d of [21, 30]) for (const g of [0, 50000, 9e9]) {
    const r = C.computeEconomics({
      materialCost: m, installationCost: i, electricityPrice: ep, chargingFee: cf,
      totalEnergyDay: 800, gridEnergyDay: 800 / 0.95, powerTariff: pt,
      peakPowerKW: 44, omPctYear: om, daysPerMonth: d, investmentGrant: g,
    });
    const fall = `m=${m} i=${i} el=${ep} avg=${cf} tar=${pt} om=${om} d=${d} g=${g}`;
    const delar = r.netCapitalCost + r.lccEnergyCost + r.lccPowerCost + r.lccOmCost;
    if (Math.abs(delar - r.lccTotal) > 1e-6 * Math.max(1, r.lccTotal)) fel.push(`lccTotal ≠ delarna (${fall})`);
    if (Math.abs(r.monthlyEnergyCost * r.lccYears * 12 - r.lccEnergyCost) > 1e-6 * Math.max(1, r.lccEnergyCost)) fel.push(`lccEnergyCost ≠ månad × ${r.lccYears} år (${fall})`);
    if (r.investmentGrant > r.capitalCost + 1e-9) fel.push(`stödet överstiger kapitalet (${fall})`);
    if (r.paybackYears != null && r.paybackYears < 0) fel.push(`negativ payback (${fall})`);
    if (r.paybackYears != null && r.monthlyNet <= 0) fel.push(`payback utan positivt netto (${fall})`);
    if (r.paybackYears != null && Math.abs(r.netCapitalCost / r.monthlyNet / 12 - r.paybackYears) > 1e-9 * Math.max(1, r.paybackYears)) fel.push(`paybackformeln (${fall})`);
    if (r.lcoe != null && r.lcoe < 0) fel.push(`negativ LCoE (${fall})`);
    // Kostnaden räknas på INKÖPT volym, intäkten på LEVERERAD (η-fixen i v3.8).
    if (r.monthlyEnergyKWh > 0 && Math.abs(r.monthlyPurchasedKWh / r.monthlyEnergyKWh - 1 / 0.95) > 1e-9) fel.push(`inköpt/levererad ≠ 1/η (${fall})`);
    // LCoE kan aldrig understiga vad elen kostar per levererad kWh.
    if (r.lcoe != null && ep > 0 && r.lcoe < ep / 0.95 - 1e-9) fel.push(`LCoE under elpriset (${fall})`);
  }
  return fel;
});

lagg('täckning', 'elnät: formel, status och kostnadsregimer', () => {
  const fel = [];
  for (let A = 16; A <= 400; A += 4) for (let L = 0; L <= 90; L += 10)
  for (const peak of [0, 10, 44, 132, 500]) for (const inst of [undefined, 44, 132]) {
    const r = C.computeGridAssessment({ fuseSizeA: A, existingLoadPct: L / 100, systemPeakKW: peak, capPerHub: 44, installedHubs: 1, installedCapKW: inst });
    const fall = `${A}A last=${L}% topp=${peak} inst=${inst ?? '-'}`;
    const servis = Math.sqrt(3) * 400 * A / 1000;
    if (Math.abs(r.servisKW - servis) > 1e-9) fel.push(`serviseffekten ≠ √3·400·I (${fall})`);
    // A2: installerad effekt kapas av SmartHubens egen infeed (63 A/hub).
    // Anropet ovan har installedHubs = 1, så taket är exakt HUB_INFEED_KW.
    const dim = Math.max(peak, inst ? Math.min(inst, C.HUB_INFEED_KW) : 0);
    if (Math.abs(r.surplusKW - (servis * (1 - L / 100) - dim)) > 1e-9) fel.push(`överskottet ≠ tillgängligt − dimensionerande (${fall})`);
    if (r.surplusKW < -1e-9 && r.status !== 'upgrade') fel.push(`negativt överskott utan servisutökning (${fall})`);
    if (r.status === 'ok' && r.marginRatio < C.GRID_MARGIN - 1e-12) fel.push(`grön status under marginalkravet (${fall})`);
    if ((r.extraNeeded > 0) !== (r.upgradeCostLow > 0)) fel.push(`kostnad och behov går isär (${fall})`);
    if (r.upgradeCostHigh > 0 && r.upgradeCostHigh < r.upgradeCostLow) fel.push(`hög < låg kostnad (${fall})`);
  }
  return fel;
});

lagg('täckning', 'hubs: maximum tas alltid, målet stämmer', () => {
  const fel = [];
  for (const o of [1, 20, 54, 55, 108, 200]) for (const mal of [0, 10, 30, 120])
  for (const L of [1, 4, 9, 24]) for (const occ of [0, 0.3, 0.85, 1]) for (const cap of [null, 60, 200]) {
    const r = C.computeHubs({ outlets: o, desiredKWhPerOutlet: mal, parkingHours: L, occupancyPct: occ, capPerHub: 44, systemCap: cap, efficiency: 0.95, hwLimitKW: 11 });
    const fall = `${o}u mål=${mal} L=${L} occ=${occ} cap=${cap ?? '-'}`;
    if (r.hubs < Math.ceil(o / C.OUTLETS_PER_HUB)) fel.push(`färre hubbar än uttagen kräver (${fall})`);
    if (r.hubs < r.hubsBySessions) fel.push(`färre hubbar än sessionstaket kräver (${fall})`);
    if (r.deliveredEnergyPerOutlet > r.actualEnergyPerOutlet + 1e-9) fel.push(`levererat > kapacitetstaket (${fall})`);
    if (mal > 0 && occ > 0) {
      const nar = r.deliveredEnergyPerOutlet >= mal - 1e-6;
      if (r.achievesTarget !== nar) fel.push(`achievesTarget motsäger levererat (${fall})`);
      // I felfall får kapacitetstaket aldrig visas som mer än det levererade —
      // PDF:ens missat-mål-varning läser actualEnergyPerOutlet (granskningsfynd G1).
      if (!r.achievesTarget && r.actualEnergyPerOutlet > r.deliveredEnergyPerOutlet + 1e-9) fel.push(`kapacitetstak > levererat i felfall (${fall})`);
    }
    if (!r.achievesTarget && !r.limitReasons.length) fel.push(`missat mål utan orsak (${fall})`);
  }
  return fel;
});

// =========================================================================
// ENSKILDA FYND — räknemotorn
// =========================================================================

lagg('B1', 'elnätsstatus hålls mot anläggningens märkeffekt', () => {
  const fel = [];
  for (let A = 16; A <= 400; A += 4) for (let L = 0; L <= 80; L += 10)
  for (const inst of [44, 88, 132]) for (const peak of [5, 20, 44]) {
    const r = C.computeGridAssessment({ fuseSizeA: A, existingLoadPct: L / 100, systemPeakKW: Math.min(peak, inst), capPerHub: 44, installedHubs: Math.round(inst / 44), installedCapKW: inst });
    const fall = `${A}A last=${L}% installerat=${inst} topp=${Math.min(peak, inst)}`;
    // Kärnan i B1: grönt ljus får aldrig ges när märkeffekten inte ryms.
    if (r.status === 'ok' && inst > r.availableKW + 1e-9) fel.push(`grönt trots att märkeffekten inte ryms (${fall})`);
    // ...och returobjektet får inte motsäga sig självt åt något håll.
    if (r.status === 'ok' && r.hubsWithinAvailable < Math.round(inst / 44)) fel.push(`grönt men hubsWithinAvailable för lågt (${fall})`);
  }
  // Bakåtkompatibilitet: utan installedCapKW gäller det gamla beteendet exakt.
  for (const A of [63, 125, 250]) for (const peak of [10, 44, 100]) {
    const u = C.computeGridAssessment({ fuseSizeA: A, existingLoadPct: 0.2, systemPeakKW: peak, capPerHub: 44, installedHubs: 1 });
    if (Math.abs(u.surplusKW - (u.availableKW - peak)) > 1e-9) fel.push(`bakåtkompatibiliteten bruten (${A}A topp=${peak})`);
    if (u.installedCapKW !== null) fel.push(`installedCapKW ska vara null när den utelämnas (${A}A)`);
  }
  return fel;
});

lagg('B2', 'ingen ledig kapacitet medan bilar köar', () => {
  const fel = [];
  for (const prof of ['office', 'mall', 'residential', 'flat'])
  for (const o of [20, 54, 108]) for (const h of [1, 2, 3])
  for (const L of [2, 4, 6, 9, 12]) for (const occ of [0.3, 0.6, 0.85]) for (const need of [5, 10, 20]) {
    const r = energi({ outlets: o, hubs: h, parkingHours: L, profileHours: C.PROFILES[prof].hours, peakOccupancyPct: occ, sessionNeedKWh: need });
    // Köar bilar som VILL ha energi, och ryms alla som sessioner, då måste
    // anläggningen ligga på sitt tak — annars kastas tilldelad kapacitet.
    if ((r.queuedAtPeak || 0) > 0.5 && (r.sessionOverflowMax || 0) <= 0.5) {
      const t = r.busiestHour;
      // Rätt gräns är 6 A-GOLVET, inte 100 %. allocatePower räknar hur många
      // bilar som ryms med startströmmen (16 A = 11,085 kW) medan varje bil
      // bara drar sitt eget tak (11 kW), så en residual under en bils
      // minimiström blir över. Den kan fysiskt inte starta ännu en bil —
      // handbok 8.3.1: inget fordon laddar mellan 0 och 6 A. Kastad kapacitet
      // är därför ledig effekt som ÖVERSTIGER minChargeKW.
      const ledigt = r.effectiveCap - r.hourly[t];
      if (ledigt > r.minChargeKW + 1e-6) {
        fel.push(`${ledigt.toFixed(2)} kW ledigt (> 6 A-golvet ${r.minChargeKW.toFixed(2)}) med `
          + `${r.queuedAtPeak.toFixed(1)} bilar i kö (${prof} ${o}u/${h}hub L=${L} occ=${occ} behov=${need})`);
      }
    }
  }
  return fel.slice(0, 5);
});

lagg('B2', 'simuleringen når stationärt läge', () => {
  const fel = [];
  // Svepet MÅSTE täcka svansen. Den första versionen hade L upp till 24 men bara
  // occ ≤ 0,9 och behov ∈ {10, 30} — och missade därmed exakt det hörn där
  // konvergensen är segast: hög beläggning, långt parkeringsfönster och ett
  // behov som ligger nära vad anläggningen precis kan leverera. Där krävdes upp
  // till 119 dygn, taket var 80, och per laddtillfälle rapporterades det
  // angivna behovet som mött när det inte var det.
  for (const prof of ['office', 'mall', 'residential', 'flat'])
  for (const L of [1, 8, 15, 18, 20, 21, 22, 23, 24]) for (const occ of [0.1, 0.5, 0.85, 0.95, 1.0])
  for (const o of [20, 54, 160]) for (const need of [null, 10, 18, 25, 30, 50]) for (const hw of [11, 22]) {
    const r = energi({ outlets: o, hubs: 1, parkingHours: L, profileHours: C.PROFILES[prof].hours, peakOccupancyPct: occ, sessionNeedKWh: need, hwLimitKW: hw });
    if (!r.simKonvergerade) fel.push(`ej stationär efter ${r.simDygn} dygn (${prof} L=${L} occ=${occ} ${o}u behov=${need} hw=${hw})`);
    // Den identitet som bröts med 13,2 % när konvergenstestet bara såg flödet.
    if (r.totalEnergyDay > 1) {
      const via = r.perOutletKWh * r.totalSessionsPerDay;
      const d = Math.abs(via - r.totalEnergyDay) / r.totalEnergyDay;
      if (d > 1e-6) fel.push(`energibalansen ${(100 * d).toFixed(3)} % fel (${prof} L=${L} occ=${occ} ${o}u behov=${need} hw=${hw})`);
    }
  }
  return fel.slice(0, 5);
});

lagg('B3', 'räckvidden drar av laddförlusten exakt en gång', () => {
  const fel = [];
  // kwh100 är EV Databases VERKLIGA förbrukning och är BATTERISIDIG. Ledet
  // omvandlar uttagsmätt AC till energi i batteriet och ska vara kvar. Se noten
  // vid CARS i _33_calc.js innan någon "rättar" det här igen.
  if (!(C.ONBOARD_EFFICIENCY > 0.8 && C.ONBOARD_EFFICIENCY < 1)) fel.push(`ONBOARD_EFFICIENCY orimlig: ${C.ONBOARD_EFFICIENCY}`);
  const vantat = 30 * C.ONBOARD_EFFICIENCY / 14.5 * 100;
  if (Math.abs(C.rangeKm(30, 14.5) - vantat) > 1e-9) fel.push('rangeKm tillämpar inte ONBOARD_EFFICIENCY');
  for (const bil of C.CARS) {
    if (!(bil.kwh100 > 10 && bil.kwh100 < 30)) fel.push(`${bil.name}: kwh100 ${bil.kwh100} utanför rimligt intervall`);
    if (!(bil.battery > 20 && bil.battery < 130)) fel.push(`${bil.name}: batteri ${bil.battery} utanför rimligt intervall`);
    const km = bil.battery / bil.kwh100 * 100;
    if (!(km > 250 && km < 700)) fel.push(`${bil.name}: ${km.toFixed(0)} km på fullt batteri — kontrollera mot ev-database.org`);
  }
  return fel;
});

lagg('L1', 'ovaliderade indata ur URL-hashen clampas', () => {
  const fel = [];
  const nan = energi({ peakOccupancyPct: NaN });
  if (!nan.occupancy.every(Number.isFinite)) fel.push('peakOccupancyPct: NaN ger NaN i beläggningskurvan');
  const tva = energi({ peakOccupancyPct: 2 });
  if (tva.presentAtPeak > tva.maxOutlets + 1e-9) fel.push(`peakOccupancyPct: 2 ger ${tva.presentAtPeak.toFixed(1)} bilar på ${tva.maxOutlets} uttag`);
  const neg = energi({ hubs: -3 });
  if (!(neg.hubs >= 1 && neg.effectiveCap > 0 && neg.sessionCapacity > 0)) fel.push(`hubs: -3 ger hubs=${neg.hubs} cap=${neg.effectiveCap} sessionstak=${neg.sessionCapacity}`);
  return fel;
});

lagg('L2', 'energibehov under golvet tolkas som obegränsat', () => {
  const fel = [];
  const obegransat = energi({ sessionNeedKWh: null }).perOutletKWh;
  for (const n of [0, 0.0001, 0.05]) {
    const r = energi({ sessionNeedKWh: n });
    if (r.sessionNeedKWh !== null) fel.push(`behov ${n} tolkas inte som obegränsat`);
    if (Math.abs(r.perOutletKWh - obegransat) > 1e-9) fel.push(`behov ${n} ger inte samma som tomt fält`);
  }
  if (energi({ sessionNeedKWh: 0.5 }).sessionNeedKWh !== 0.5) fel.push('behov 0,5 kWh ska respekteras');
  return fel;
});

lagg('L7/L8', 'API:t: en källa för marginalen, ingen död export', () => {
  const fel = [];
  if (C.shapeToPeak !== undefined) fel.push('shapeToPeak är tillbaka på API:t — den nås av ingen kodväg');
  if (typeof C.GRID_MARGIN !== 'number') fel.push('GRID_MARGIN saknas på API:t');
  // Exakt EN deklaration av tröskeln, och computeGridAssessment ska läsa den.
  if ((CALC.match(/=\s*0\.10\s*;/g) || []).length !== 1) fel.push('marginaltröskeln finns på fler än ett ställe — GRID_MARGIN ska vara enda källan');
  if (!/const MARGIN = GRID_MARGIN;/.test(CALC)) fel.push('computeGridAssessment läser inte GRID_MARGIN');
  // Statusen ska vippa exakt vid GRID_MARGIN.
  const servis = Math.sqrt(3) * 400 * 63 / 1000, tillg = servis * 0.8;
  const strax = C.computeGridAssessment({ fuseSizeA: 63, existingLoadPct: 0.2, systemPeakKW: tillg * (1 - C.GRID_MARGIN) + 0.01 });
  if (strax.status === 'ok') fel.push('grön status strax under marginalkravet');
  return fel;
});

lagg('NY-1', 'elnät och ekonomi tål skräp ur URL-hashen', () => {
  const fel = [];
  // Fynd 2026-09-13 (fuzz genom hela kedjan): computeEnergy hade robusthets-
  // filtret, de andra två hade det inte. fuseSizeA = NaN gav NaN i serviseffekt,
  // tillgänglig effekt och överskott — men status 'marginal', alltså ett
  // självsäkert "knappt tillräcklig kapacitet" utan ett giltigt tal bakom sig.
  // Fälten kommer ur loadInitialCalcState, som avkodar godtycklig JSON.
  const skrap = [undefined, null, NaN, Infinity, -Infinity, '12', true, -1];
  const gBas = { fuseSizeA: 63, existingLoadPct: 0.2, systemPeakKW: 30, capPerHub: 44, installedHubs: 1, installedCapKW: 44 };
  for (const f of Object.keys(gBas)) for (const v of skrap) {
    const r = C.computeGridAssessment({ ...gBas, [f]: v });
    for (const k of ['servisKW', 'availableKW', 'surplusKW', 'extraNeeded', 'marginRatio', 'dimensionerandeKW', 'surplusVsPeakKW'])
      if (!Number.isFinite(r[k])) fel.push(`grid.${k} = ${r[k]} vid ${f}=${String(v)}`);
    if (!['ok', 'marginal', 'upgrade'].includes(r.status)) fel.push(`okänd status vid ${f}=${String(v)}`);
  }
  const eBas = { materialCost: 250000, installationCost: 150000, electricityPrice: 2.5, chargingFee: 3.5,
    totalEnergyDay: 800, gridEnergyDay: 842, powerTariff: 60, peakPowerKW: 44, omPctYear: 0.03,
    daysPerMonth: 21, investmentGrant: 0 };
  for (const f of Object.keys(eBas)) for (const v of skrap) {
    const r = C.computeEconomics({ ...eBas, [f]: v });
    for (const k of ['capitalCost', 'netCapitalCost', 'monthlyEnergyCost', 'monthlyPowerCost', 'monthlyOmCost', 'monthlyRevenue', 'monthlyNet', 'lccTotal', 'lccNet'])
      if (!Number.isFinite(r[k])) fel.push(`ekonomi.${k} = ${r[k]} vid ${f}=${String(v)}`);
    if (r.paybackYears != null && !Number.isFinite(r.paybackYears)) fel.push(`payback = ${r.paybackYears} vid ${f}=${String(v)}`);
    if (r.lcoe != null && !Number.isFinite(r.lcoe)) fel.push(`LCoE = ${r.lcoe} vid ${f}=${String(v)}`);
  }
  return fel.slice(0, 6);
});

// =========================================================================
// PRESENTATIONSFYND — den klass invariantsviten inte kan se
// =========================================================================

const kallkod = [
  ['B4', 'kövarningens spärrfält följer med till PDF:en', VARIANT,
    /sessionNeedKWh:\s*q\.sessionNeedKWh/,
    'queue-objektet i buildPdfData saknar sessionNeedKWh — PDF:ens kövarning spärrar på det fältet och blir då död kod'],
  ['B5', 'investeringskalkylen ser bilen', VARIANT,
    /function EconomicsPanel\(\{\s*economics,\s*car,\s*perSessionKWh\s*\}\)/,
    'EconomicsPanel tar inte emot car/perSessionKWh och kan därför inte varna för att intäkt och payback bygger på mer energi än bilen rymmer'],
  ['B5', 'PDF:ens batterivarning nämner kalkylen', PDF,
    /intäkten nedan förutsätter båda|energin i kalkylen nedan förutsätter båda/,
    'PDF-varningen nämner bara räckvidden, inte att intäkt och payback bygger på samma energi'],
  ['A1', 'jämförelseläget räknar med laddavgiften', VARIANT,
    // Hårdkodad nolla i ett computeEconomics-anrop, inte i en kommentar.
    /^(?![\s\S]*electricityPrice,\s*chargingFee:\s*0,)[\s\S]*$/,
    'chargingFee: 0 är hårdkodad någonstans — jämförelseläget rangordnar då efter kostnad i stället för lönsamhet'],
  ['A1', 'scenariokorten visar driftnettot', VARIANT, /Driftnetto\/mån/,
    'Driftnetto-raden saknas i ScenarioCard'],
  ['A1', 'jämförelserapporten visar driftnettot', PDF, /Driftnetto\/mån/,
    'Driftnetto-raden saknas i PDFCompare'],
  ['A2', 'paybackrutan har ett rimlighetstak', VARIANT, /längre än kalkylens/,
    'den gröna paybackrutan saknar gräns mot LCC-horisonten och kan visa 16 år grönt bredvid en livscykelförlust'],
  ['A4', 'kapacitetstaket kallas inte "faktisk"', VARIANT,
    // Bara etiketten i JSX-position, inte kommentaren som förklarar historiken.
    /^(?![\s\S]*\['Faktisk kWh \/ uttag')[\s\S]*$/,
    'etiketten "Faktisk kWh / uttag" är tillbaka — den sätts på actualEnergyPerOutlet, som är ett kapacitetstak'],
  ['A4', 'levererat visas bredvid kapacitetstaket', VARIANT, /Levererat \/ laddtillfälle/,
    'raden "Levererat / laddtillfälle" saknas, så kapacitetstaket står ensamt'],
  // Kravet är att rutan villkoras på ett FAKTISKT behov. Sedan v3.9.3 är
  // villkoret dessutom bara 'upgrade' — 'marginal' kunde aldrig ge ett behov.
  ['A5', 'kostnadsrutan kräver ett faktiskt behov', VARIANT,
    /status === 'upgrade' && upgradeCostLow > 0 && \(/,
    'skärmens kostnadsruta villkoras inte på upgradeCostLow > 0 och kan skriva "0 kkr–0 kkr"'],
  ['A5', 'samma spärr i kundrapporten', PDF,
    /status === 'upgrade' && upgradeCostLow > 0 && \(/,
    'PDF:ens kostnadsruta villkoras inte på upgradeCostLow > 0'],
  ['A6', 'marginalen avrundas nedåt', VARIANT, /Math\.floor\(\(assessment\.marginRatio/,
    'marginalraden avrundas inte nedåt och kan skriva "10 % (krav 10 %)" under en orange rubrik'],
  ['A7', 'sessionstaksvarningen finns i scenariokortet', VARIANT, /utan laddsession/,
    'ScenarioCard varnar inte när fler bilar är närvarande än hubben tar sessioner för'],
  ['A7', 'sessionstaksvarningen finns i jämförelserapporten', PDF, /utan laddsession/,
    'PDFCompare varnar inte för sessionstaket'],
  ['A7', 'batterivarningen finns på compare-skärmen', VARIANT, /car && car\.battery > 0 && energy\.perOutletKWh > car\.battery/,
    'ScenarioCard saknar batterivarningen som PDFCompare har'],
  ['M2', 'dagräkningen är samma i alla tre ekonomianrop', VARIANT, null,
    'de tre computeEconomics-anropen använder inte samma daysPerMonth-uttryck'],
  ['M3', 'reduktionsraden döljs när det inte finns någon', VARIANT, /peakReductionKW \|\| 0\) >= 0\.5 &&/,
    '"Reduktion −0 kW" kan åter visas bredvid en anläggning vars topp steg'],
  ['M5', 'skärmen visar både levererad och inköpt volym', VARIANT, /Energi \/ månad · inköpt/,
    'inköpt volym saknas på skärmen — energikostnaden går då inte att kontrollräkna'],
  ['M7', 'rapporten redovisar effekttariffens sats', PDF, /kr effektavgift `\s*\n?\s*\+ `\(\$\{Amp\.fmt\(powerTariff/,
    'effekttariffens sats saknas i rapporten — beloppet går inte att kontrollräkna'],
  ['M8', 'delad länk flaggas i investeringskalkylen', VARIANT, /öppnades från en delad länk/,
    'noten om att kostnadsfälten är mottagarens egna saknas'],
  // Appen skriver sin EGEN hash vid varje tillståndsändring, så "hashen finns"
  // betyder inte "länken kom utifrån". Utan jämförelsen mot det lokalt sparade
  // tillståndet visades noten vid varje F5 av säljarens egen kalkyl — ett
  // falskt påstående i kundvänd panel. Verifierat i webbläsaren: egen
  // omladdning tiger, någon annans länk flaggar.
  ['M8', 'länknoten skiljer egen hash från en delad', VARIANT,
    /encodeCalcState\(delbaraFalt\(lokalt\)\) === h\.slice\(3\)/,
    'STARTAD_FRAN_LANK sätts utan att jämföra hashen mot det lokalt sparade tillståndet — noten blir då sann vid varje omladdning'],
  ['NY-2', 'rapporten förklarar när märkeffekten binder', PDF, /begränsa anläggningen med ett fastighetseffekttak/,
    'PDF:en skriver ut kostnaden för servisutökning utan skärmens nyans att ett effekttak är ett alternativ'],
  ['B1', 'PDF-badgen visar märkeffekten', PDF, /label: 'Märkeffekt'/,
    'PDF:ens elnätsbadge visar inte anläggningens märkeffekt bredvid den tillgängliga effekten'],
  ['B1', 'PDF-badgens kolumnantal följer kolumnerna', PDF, /repeat\(\$\{cols\.length\}, 1fr\)/,
    'gridTemplateColumns är åter hårdkodad — en extra kolumn hamnar då på egen rad och sida 2 spricker'],
];

for (const [fynd, namn, kalla, re, meddelande] of kallkod) {
  lagg(fynd, namn, () => {
    if (fynd === 'M2' && re === null) {
      const n = (VARIANT.match(/daysPerMonth: activeDaysPerMonth \?\? profile\.daysPerMonth \?\? 30,/g) || []).length;
      return n === 3 ? [] : [`${meddelande} (hittade ${n} av 3)`];
    }
    return re.test(kalla) ? [] : [meddelande];
  });
}

// Varningsparitet: varje varning som kan visas på skärmen ska kunna visas i
// kundrapporten för samma indata, och tvärtom. Det var B4:s hela felklass.
lagg('paritet', 'varningar finns i både skärm och rapport', () => {
  const fel = [];
  const par = [
    ['kövarning', /Kö vid beläggningstopp/, /Kö vid beläggningstopp/],
    ['sessionstak', /utan laddsession/, /utan laddsession/],
    ['batteri', /batteri/i, /batteri/i],
  ];
  for (const [namn, reSkarm, rePdf] of par) {
    if (!reSkarm.test(VARIANT)) fel.push(`${namn}: saknas på skärmen`);
    if (!rePdf.test(PDF)) fel.push(`${namn}: saknas i kundrapporten`);
  }
  // Friskrivningen ska finnas i BÅDA PDF-mallarna. PDFEditorial har haft den
  // hela tiden; PDFCompare gick till kund med kWh, räckvidd, elnätsstatus och
  // månadskostnader utan en rad om att talen är modellberäkningar eller att
  // installationen kräver behörig elinstallatör (fynd 2026-09-13, hittat av
  // matt-pdf.mjs på första körningen).
  const editorial = PDF.slice(PDF.indexOf('function PDFEditorial'), PDF.indexOf('function PDFCompare'));
  const compare = PDF.slice(PDF.indexOf('function PDFCompare'));
  if (!/ELSÄK-FS/.test(editorial)) fel.push('friskrivningen saknas i PDFEditorial');
  if (!/ELSÄK-FS/.test(compare)) fel.push('friskrivningen saknas i PDFCompare');
  return fel;
});

// =========================================================================
// Granskningsrunda 2026-09-14 — fynd A1-A5
// =========================================================================

lagg('A1', 'servisutökningens två tal går att följa hela vägen', () => {
  const fel = [];
  const A2KW = (a) => Math.sqrt(3) * 400 * a / 1000;
  for (const A of [40, 63, 80, 125, 200, 400]) for (const L of [0, 0.2, 0.5, 0.8])
  for (const hubs of [1, 2, 4, 8]) {
    const r = C.computeGridAssessment({ fuseSizeA: A, existingLoadPct: L, systemPeakKW: 0,
      capPerHub: 44, installedHubs: hubs, installedCapKW: hubs * 44 });
    const fall = `${A}A last=${L * 100}% ${hubs}hub`;
    if (r.extraNeededForOk < r.extraNeeded - 1e-9) fel.push(`"för OK" under "för marginal" (${fall})`);
    // Båda talen förutsätter att den befintliga lasten är OFÖRÄNDRAD i kW —
    // det är hela poängen med fyndet. Mata därför tillbaka samma absoluta last.
    const E = r.existingKW;
    for (const [namn, extra, vantad] of [['extraNeeded', r.extraNeeded, ['marginal', 'ok']],
                                         ['extraNeededForOk', r.extraNeededForOk, ['ok']]]) {
      if (extra <= 0) continue;
      const nyServis = r.servisKW + extra;
      const r2 = C.computeGridAssessment({ fuseSizeA: nyServis / A2KW(1), existingLoadPct: E / nyServis,
        systemPeakKW: 0, capPerHub: 44, installedHubs: hubs, installedCapKW: hubs * 44 });
      if (!vantad.includes(r2.status)) {
        fel.push(`${namn} leder till '${r2.status}', inte ${vantad.join('/')} (${fall})`);
      }
    }
  }
  return fel;
});

lagg('A2', 'en SmartHub på egen 63 A-servis är inte en servisutökning', () => {
  const fel = [];
  // 44 kW är de 63 A avrundade uppåt. Jämförs det avrundade talet mot en exakt
  // beräknad servis blir läroboksfallet rött med prislapp.
  for (const hubs of [1, 2, 3, 4]) {
    const r = C.computeGridAssessment({ fuseSizeA: 63 * hubs, existingLoadPct: 0, systemPeakKW: 0,
      capPerHub: 44, installedHubs: hubs, installedCapKW: hubs * 44 });
    const fall = `${63 * hubs}A / ${hubs} hub, ingen annan last`;
    if (r.status === 'upgrade') fel.push(`status 'upgrade' (${fall})`);
    if (r.upgradeCostLow > 0) fel.push(`prislapp ${r.upgradeCostLow} kr utan behov (${fall})`);
    if (r.surplusKW < -1e-9) fel.push(`negativt överskott ${r.surplusKW} (${fall})`);
  }
  // Infeed-taket får aldrig höja den dimensionerande lasten, bara sänka den.
  for (const hubs of [1, 2, 5]) for (const cap of [10, 22, 44]) {
    const r = C.computeGridAssessment({ fuseSizeA: 630, existingLoadPct: 0, systemPeakKW: 0,
      capPerHub: cap, installedHubs: hubs, installedCapKW: hubs * cap });
    if (r.dimensionerandeKW > hubs * cap + 1e-9) fel.push(`dimensionerande över märkeffekten (${hubs}×${cap})`);
  }
  return fel;
});

lagg('A5', 'lasten i beläggningstoppen redovisas bredvid folk-siffrorna', () => {
  const fel = [];
  for (const pk of ['office', 'mall', 'residential', 'flat']) for (const L of [2, 8, 16])
  for (const occ of [0.3, 0.85]) for (const behov of [null, 15]) {
    const e = C.computeEnergy({ outlets: 54, hubs: 1, capPerHub: 44, systemCap: null,
      parkingHours: L, profileHours: C.PROFILES[pk].hours, peakOccupancyPct: occ,
      hwLimitKW: 11, efficiency: 0.95, sessionNeedKWh: behov, strategy: 'priority' });
    const fall = `${pk} L=${L} occ=${occ} behov=${behov ?? '-'}`;
    if (!Number.isFinite(e.powerAtBusiestKW)) fel.push(`powerAtBusiestKW saknas (${fall})`);
    if (Math.abs(e.powerAtBusiestKW - e.hourly[e.busiestHour]) > 1e-9) {
      fel.push(`powerAtBusiestKW ≠ hourly[busiestHour] (${fall})`);
    }
    if (e.powerAtBusiestKW > e.peakPowerKW + 1e-9) fel.push(`lasten i beläggningstoppen över dygnets topp (${fall})`);
  }
  return fel;
});

// =========================================================================
// Kör
// =========================================================================
// ENKELT LÄGE — computeSimple (v3.10.0)
// =========================================================================
// Funktionen svarar på enkla lägets fråga: kunden har N platser och en viss
// huvudsäkring — hur långt kan varje bil köra? Den har inget skyddsnät i
// invariantsviten (som bara kör computeEnergy), och den kan gå sönder TYST:
// ett fel i systemCap-formeln ändrar bara ett tal, och 70 km ser lika rimligt
// ut som 85.

const enkelt = (o = {}) => C.computeSimple(Object.assign({
  fuseSizeA: 63, existingLoadPct: 0.20, outlets: 20, parkingHours: 10,
  profileHours: C.PROFILES.residential.hours, peakOccupancyPct: 0.85,
  capPerHub: 44, hwLimitKW: 11, efficiency: 0.95,
  strategy: 'priority', profileLabel: 'Bostad',
}, o));

// 4 profiler × 6 säkringar × 3 laster × 4 tider × 4 platsantal = 1 152 fall.
// Ett computeEnergy per fall (~1,4 ms), alltså sekunder — inte minuter som den
// bakvända sökningen krävde.
const ENKELTSVEP = (() => {
  const ut = [];
  for (const pk of ['residential', 'office', 'mall', 'flat'])
  for (const a of [25, 50, 63, 100, 160, 250])
  for (const last of [0, 0.4, 0.8])
  for (const L of [1, 3, 10, 24])
  for (const n of [1, 10, 40, 120]) {
    const inp = {
      fuseSizeA: a, existingLoadPct: last, outlets: n, parkingHours: L,
      profileHours: C.PROFILES[pk].hours, peakOccupancyPct: 0.85,
      capPerHub: 44, hwLimitKW: 11, efficiency: 0.95,
      strategy: 'priority', profileLabel: C.PROFILES[pk].label,
    };
    ut.push({ pk, a, last, L, n, inp, r: C.computeSimple(inp) });
  }
  return ut;
})();

lagg('enkelt läge', 'svaret ger alltid GRÖN elnätsstatus', () => {
  // Modellens kärnlöfte. Sätts effekttaket ur servisen får Avancerat läge aldrig
  // svara "Servisutökning krävs" för samma anläggning — paritet mellan vyerna är
  // projektets vanligaste felklass (G1, G7). Faller om (1 − GRID_MARGIN)-faktorn
  // i systemCap tas bort, eller om hubbarna slutar följa effekten.
  const fel = [];
  for (const f of ENKELTSVEP) {
    const g = C.computeGridAssessment({
      fuseSizeA: f.a, existingLoadPct: f.last,
      systemPeakKW: f.r.energy.peakPowerKW, capPerHub: 44,
      installedHubs: f.r.energy.hubs, installedCapKW: f.r.energy.effectiveCap,
    });
    if (g.status !== 'ok') {
      fel.push(`${f.pk} ${f.a}A last=${f.last} L=${f.L} n=${f.n}: status '${g.status}' `
        + `(överskott ${g.surplusKW.toFixed(2)} kW av ${g.availableKW.toFixed(1)} tillgängliga)`);
      if (fel.length > 3) break;
    }
  }
  return fel;
});

lagg('enkelt läge', 'fler platser ⇒ aldrig mer energi per bil', () => {
  // Monotonicitet i det reglage kunden drar i. Bryts den visar UI:t att varje
  // bil får MER ju fler som delar på samma effekt — ett svar som ser ut som ett
  // fel för vem som helst, och som skulle dölja hela avvägningen läget finns för.
  const fel = [];
  for (const a of [25, 63, 160]) for (const L of [3, 10, 24]) {
    let förra = Infinity;
    for (const n of [1, 5, 10, 20, 40, 60, 80, 100, 120]) {
      const kWh = enkelt({ fuseSizeA: a, parkingHours: L, outlets: n }).perOutletKWh;
      if (kWh > förra + 1e-6) {
        fel.push(`${a}A L=${L}: ${n} platser gav ${kWh.toFixed(2)} kWh/bil, mer än föregående steg (${förra.toFixed(2)})`);
      }
      förra = kWh;
    }
  }
  return fel.slice(0, 4);
});

lagg('enkelt läge', 'hubbarna följer effekten, inte bara uttagsantalet', () => {
  // Med enbart autoräkningen (ceil(n / 54)) blev en ensam hub à 44 kW taket
  // långt innan servisen var slut: en 250 A-servis levererade inte mer än en
  // 100 A. Symtomet var ett svar som slutade förbättras när säkringen växte.
  const fel = [];
  for (const f of ENKELTSVEP) {
    if (f.r.hubs * 44 < f.r.systemCapKW - 1e-6) {
      fel.push(`${f.pk} ${f.a}A last=${f.last}: ${f.r.hubs} hubbar (${f.r.hubs * 44} kW) `
        + `bär inte effekttaket ${f.r.systemCapKW.toFixed(1)} kW`);
      if (fel.length > 3) break;
    }
  }
  // Och svaret får inte plana ut: större säkring ska ge mer per bil så länge
  // något annat än effekten inte binder (bilens AC-tak, parkeringstiden).
  const små = enkelt({ fuseSizeA: 63, outlets: 40, parkingHours: 10 }).perOutletKWh;
  const stora = enkelt({ fuseSizeA: 250, outlets: 40, parkingHours: 10 }).perOutletKWh;
  if (stora <= små + 1e-6) {
    fel.push(`250 A gav ${stora.toFixed(1)} kWh/bil, inte mer än 63 A (${små.toFixed(1)}) — hubbarna följer inte effekten`);
  }
  return fel;
});

lagg('enkelt läge', 'tål skräp ur URL-hashen', () => {
  // Samma klass som NY-1: fälten kommer ur loadInitialCalcState, som avkodar
  // godtycklig JSON ur hashen utan validering. NaN i säkringen gav tidigare NaN
  // rakt genom elnätsbedömningen men status 'marginal' — en självsäker rubrik
  // utan ett giltigt tal bakom sig.
  const fel = [];
  for (const v of [NaN, Infinity, -Infinity, undefined, null, -5, 0, 1e9]) {
    for (const falt of ['fuseSizeA', 'existingLoadPct', 'outlets', 'parkingHours', 'peakOccupancyPct']) {
      let r;
      try { r = enkelt({ [falt]: v }); }
      catch (e) { fel.push(`${falt}=${String(v)} kraschade: ${e.message}`); continue; }
      for (const [k, x] of Object.entries(r)) {
        if (typeof x !== 'number') continue;
        if (!Number.isFinite(x)) { fel.push(`${falt}=${String(v)} gav ${k}=${x}`); break; }
      }
      if (r.outlets < 1 || !Number.isInteger(r.outlets)) fel.push(`${falt}=${String(v)} gav outlets=${r.outlets}`);
      if (r.hubs < 1) fel.push(`${falt}=${String(v)} gav hubs=${r.hubs}`);
    }
  }
  return fel.slice(0, 4);
});

lagg('enkelt läge', 'reglaget kostar ett computeEnergy, inte arton', () => {
  // Prestandaspärr, och den motsvarar ett RAPPORTERAT fel: den första versionen
  // sökte baklänges (ange körsträcka → få antal platser) och gjorde ~18
  // computeEnergy-anrop per dragsteg, 11-26 ms. Vid 60 Hz har webbläsaren 16 ms
  // per bildruta, så reglaget gick inte att dra i vare sig Chrome eller Edge.
  // test-reglage.mjs var grön hela tiden — den mäter slutvärdet, inte
  // upplevelsen. Faller om någon återinför en sökning i beräkningen.
  const fel = [];
  const t = process.hrtime.bigint();
  const STEG = 60;                       // en dragning från ände till ände
  for (let i = 0; i < STEG; i++) enkelt({ outlets: 1 + i * 2 });
  const msPerSteg = Number(process.hrtime.bigint() - t) / 1e6 / STEG;
  if (msPerSteg > 8) {
    fel.push(`${msPerSteg.toFixed(1)} ms per dragsteg — budget 8 ms (halva bildrutan vid 60 Hz). `
      + 'Gör beräkningen en sökning igen? Reglaget blir omöjligt att dra.');
  }
  return fel;
});

lagg('enkelt läge', 'UI:t frågar efter platser och svarar i km', () => {
  // Presentationsspärr av samma slag som resten av filen. Enkla lägets värde står
  // och faller med att det svarar på kundens fråga — kopplas SimpleMode ur
  // render-grenen faller appen tillbaka på split-vyn utan att något annat märker det.
  const fel = [];
  if (!/function SimpleMode\(/.test(VARIANT)) fel.push('SimpleMode saknas i _33_variant.jsx');
  if (!/uiMode === 'simple'\)\s*\{\s*return \(\s*<SimpleMode/.test(VARIANT))
    fel.push('render-grenen för uiMode=simple saknas — enkelt läge når aldrig SimpleMode');
  if (!/C\.computeSimple\(/.test(VARIANT)) fel.push('SimpleMode anropar inte computeSimple');
  if (!/function SimplePlacesSlider/.test(VARIANT)) fel.push('platsreglaget saknas');
  if (!/km per laddning/.test(VARIANT)) fel.push('svaret anges inte i km — är riktningen omvänd igen?');
  // Utan energibehov kan en bil ladda hela parkeringstiden, och talet blir
  // fysiskt omöjligt (922 km, granskningen 2026-09-12). Varningen är enda
  // spärren mot det i den här vyn.
  if (!/schablonBatteri\(\)/.test(VARIANT)) fel.push('batterivarningen saknas i enkla läget');
  for (const k of ['brf', 'office', 'mall', 'garage']) {
    if (!new RegExp(k + ":\\s*\\{[^}]*profileKey:").test(VARIANT)) fel.push(`PROPERTY_PRESETS.${k} saknas`);
  }
  return fel;
});

// =========================================================================
const resultat = [];
let fel = 0;
for (const t of test) {
  let brott = [];
  try { brott = t.fn() || []; } catch (e) { brott = [`KRASCH: ${e.message}`]; }
  if (brott.length) fel++;
  resultat.push({ fynd: t.fynd, namn: t.namn, ok: brott.length === 0, brott });
}

if (JSON_UT) {
  console.log(JSON.stringify({ antal: test.length, fel, resultat }, null, 2));
} else {
  console.log('\nAmp5 - regressionsspärrar för granskningsfynden\n');
  let sistaFynd = '';
  for (const r of resultat) {
    if (r.fynd !== sistaFynd) { console.log(`  ── ${r.fynd} ${'─'.repeat(Math.max(0, 54 - r.fynd.length))}`); sistaFynd = r.fynd; }
    console.log(`  ${r.ok ? 'OK  ' : 'FEL '} ${r.namn}`);
    for (const b of r.brott) console.log(`         ${b}`);
  }
  console.log(`\n  ${test.length} spärrar, ${fel} brutna`);
  console.log(fel ? '\nRESULTAT: FEL — ett åtgärdat granskningsfynd har återuppstått\n'
                  : '\nRESULTAT: alla granskningsfynd förblir åtgärdade\n');
}
process.exit(fel ? 1 : 0);
