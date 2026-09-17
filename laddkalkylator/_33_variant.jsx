// variant-instrument.jsx — Variant A: Instrument
// AmpSociety brand-kompatibel. Fallback-typsnitt (Playfair Display + Karla)
// per grafisk manual v1.0. Balken som visuellt element. Primärfärg orange.

// Appens version — EN källa för både skärmens sidfot och rapportens meta.
// Den står i sidfoten för att frågan "kör du nya bygget?" ska gå att besvara med
// ögat: 2026-09-14 fungerade en fix överallt utom i Daniels egen Edge-flik, och
// svaret var att webbläsaren serverade den gamla filen ur cachen (Pages sätter
// `max-age=600`). Versionen syntes då bara i PDF:en, alltså efter en export.
// `verifiera-bygge.mjs` jämför den här raden mot literalen i _33_pdf.jsx.
const APP_VERSION = '3.10.0';

// ───────── PDF export helper ─────────
function buildPdfData({ mode, outlets, hubs, capPerHub, systemCap, parkingHours,
                       profileKey, peakOcc, desiredKWh, occPct, car,
                       carAcLimit, efficiency, sessionNeedKWh, strategy, projectName,
                       energy, sizing, chartEnergy, reportId,
                       gridAssessment, economics, perCarPeakKW }) {
  const C = window.Amp5Calc;
  const profile = C.PROFILES[profileKey];
  const meta = {
    projectName: projectName || '', // U2-fix: tom sträng = ej angivet; PDF visar ej default-strängen
    date: new Date().toLocaleDateString('sv-SE'),
    reportId,
    version: APP_VERSION,
  };
  const consts = {
    capPerHub, outletsPerHub: C.OUTLETS_PER_HUB,
    carAcLimit: carAcLimit ?? C.CAR_AC_LIMIT_KW,
    efficiency: efficiency ?? C.DEFAULT_EFFICIENCY,
    strategy: (C.LB_STRATEGY[strategy] || C.LB_STRATEGY[C.DEFAULT_STRATEGY]).label,
  };
  // Kö-/sessionsdata kommer alltid ur profilmodellen (= grafen och ekonomin),
  // även i hubs-läget där computeHubs står för dimensioneringen.
  const q = chartEnergy || energy;
  const queue = {
    presentAtPeak: q.presentAtPeak, chargingAtPeak: q.chargingAtPeak,
    queuedAtPeak: q.queuedAtPeak, maxPresent: q.maxPresent,
    sessionCapacity: q.sessionCapacity, sessionOverflowMax: q.sessionOverflowMax,
    needLimited: q.needLimited, perCarAtPeakKW: q.perCarAtPeakKW,
    // MÅSTE vara med. PDF:ens kövarning spärrar på `q.sessionNeedKWh != null`
    // (samma villkor som skärmen fick i v3.8.1), och utan fältet här var det
    // alltid undefined — varningen kunde därför ALDRIG renderas, i något fall.
    // 295 av 480 svepta konfigurationer varnade på skärmen och teg i
    // kundrapporten (granskningsfynd B4).
    sessionNeedKWh: q.sessionNeedKWh,
  };
  if (mode === 'energy') {
    return {
      mode: 'energy',
      inputs: {
        outlets, hubs, capPerHub, systemCap,
        parkingHours, profileHours: profile.hours,
        peakOccupancyPct: peakOcc,
        // > 0-normalisering: 0/negativt tolkas som obegränsat av calc och får
        // inte skrivas ut som ett tak i PDF:ens antagandetext
        sessionNeedKWh: (sessionNeedKWh != null && sessionNeedKWh > 0) ? sessionNeedKWh : null,
        autoHubs: energy.autoHubs,
        profileLabel: profile.label,
        carName: car.name, carKwh100: car.kwh100, carBattery: car.battery ?? null,
      },
      outputs: energy,
      const: consts,
      queue,
      meta,
      gridAssessment: gridAssessment || null,
      economics: economics || null,
      perCarPeakKW: perCarPeakKW ?? null,
    };
  }
  // Hub-läget: använd vald profil (inte flat) för att PDF:ens timgraf ska
  // spegla verklig beläggningsprofil. peakOcc sätts till occPct (hub-lägets
  // beläggning) som skalningsfaktor för profilen.
  const hubProfile = C.PROFILES[profileKey] || C.PROFILES.flat;
  const hubEnergy = chartEnergy || C.computeEnergy({
    outlets, hubs: sizing.hubs, capPerHub, systemCap,
    parkingHours, profileHours: hubProfile.hours,
    peakOccupancyPct: occPct,
    hwLimitKW: carAcLimit, efficiency, strategy,
    sessionNeedKWh: desiredKWh, // energimålet är bilens behov i hubs-läget
  });
  return {
    mode: 'hubs',
    inputs: {
      outlets, desiredKWhPerOutlet: desiredKWh,
      parkingHours, occupancyPct: occPct,
      capPerHub, systemCap,
      profileLabel: profile.label,
      carName: car.name, carKwh100: car.kwh100, carBattery: car.battery ?? null,
    },
    outputs: {
      ...sizing,
      hourly: hubEnergy.hourly,
      avgPowerPerOutlet: hubEnergy.avgPowerPerActive,
      // Energiraderna ur profilmodellen — samma som graf, nyckeltal och ekonomi.
      kwhPerOutletPerDay: hubEnergy.kwhPerOutletPerDay,
      totalSessionsPerDay: hubEnergy.totalSessionsPerDay,
      sessionsPerOutletPerDay: hubEnergy.sessionsPerOutletPerDay,
      totalEnergyDay: hubEnergy.totalEnergyDay,
    },
    const: consts,
    queue,
    meta,
    gridAssessment: gridAssessment || null,
    economics: economics || null,
    perCarPeakKW: perCarPeakKW ?? null,
  };
}

function buildComparePdfData({ scenarios, car, carAcLimit, efficiency, sessionNeedKWh, strategy,
                              fuseSizeA, existingLoadPct, electricityPrice, chargingFee, powerTariff,
                              activeDaysPerMonth, reportId, projectName }) {
  const C = window.Amp5Calc;
  const computed = scenarios.map((s) => {
    const profile = C.PROFILES[s.profileKey];
    const e = C.computeEnergy({
      outlets: s.outlets, hubs: s.hubs, capPerHub: s.capPerHub, systemCap: s.systemCap,
      parkingHours: s.parkingHours, profileHours: profile.hours,
      peakOccupancyPct: s.peakOcc,
      hwLimitKW: carAcLimit, efficiency, sessionNeedKWh, strategy,
      profileLabel: profile.label,
    });
    // Elnät och drift per scenario — samma beräkning som ComparePanel visar på
    // skärmen, så rapporten och skärmen inte kan gå isär. Investeringen ingår
    // inte: klumpbeloppen går inte att fördela per scenario.
    const grid = C.computeGridAssessment({
      fuseSizeA, existingLoadPct, systemPeakKW: e.peakPowerKW,
      capPerHub: s.capPerHub, installedHubs: e.hubs,
      installedCapKW: e.effectiveCap,
    });
    // Laddavgiften MÅSTE med. Med chargingFee hårdkodad till 0 visade korten
    // bara kostnad, och kostnaden växer med anläggningens storlek — det läge
    // som finns för att VÄLJA mellan alternativ rangordnade dem alltså omvänt
    // mot lönsamheten så fort en avgift var satt (granskningsfynd A1).
    const ek = C.computeEconomics({
      totalEnergyDay: e.totalEnergyDay, gridEnergyDay: e.totalEnergyFromGrid,
      materialCost: 0, installationCost: 0, investmentGrant: 0,
      electricityPrice, chargingFee, powerTariff,
      peakPowerKW: e.peakPowerKW, omPctYear: 0,
      // Samma dagräkning som huvudläget. Compare läste bara profilens default,
      // så en säljare som satt 30 dgr/mån i Avancerat kunde få två
      // månadskostnader för samma anläggning i samma möte (granskningsfynd M2).
      daysPerMonth: activeDaysPerMonth ?? profile.daysPerMonth ?? 30,
    });
    return {
      name: s.name,
      colorIndex: s.colorSlot,
      inputs: { ...s, profileLabel: profile.label },
      outputs: e,
      grid,
      ek,
      rangeKm: C.rangeKm(e.perOutletKWh, car.kwh100),
    };
  });
  return {
    mode: 'compare',
    scenarios: computed,
    car: { name: car.name, kwh100: car.kwh100, battery: car.battery ?? null },
    const: {
      // Scenariernas faktiska kW/hub, inte produktkonstanten: med ett scenario
      // satt till 30 kW stod det 30 i kortet och 44 i konstantrutan på samma
      // sida. Skiljer scenarierna sig åt listas de alla.
      capPerHub: (() => {
        const v = [...new Set(scenarios.map((x) => x.capPerHub ?? C.CAP_PER_HUB_KW))];
        return v.length === 1 ? v[0] : v.sort((a, b) => a - b).join(' / ');
      })(),
      outletsPerHub: C.OUTLETS_PER_HUB,
      carAcLimit: carAcLimit ?? C.CAR_AC_LIMIT_KW,
      efficiency: efficiency ?? C.DEFAULT_EFFICIENCY,
      sessionNeedKWh: (sessionNeedKWh != null && sessionNeedKWh > 0) ? sessionNeedKWh : null,
    },
    meta: {
      projectName: projectName || '', // U2-fix: tom sträng = ej angivet
      date: new Date().toLocaleDateString('sv-SE'),
      reportId,
      version: APP_VERSION,
    },
  };
}

let _pdfExporting = false;
async function exportAsPdf(data) {
  // Guard: prevent concurrent exports (rapid double-click creates orphaned React roots).
  if (_pdfExporting) return;
  _pdfExporting = true;

  // Render the PDF into a hidden overlay on the SAME page, then call window.print().
  // @media print rules hide the calculator UI and reveal only the overlay.
  // This approach works in standalone bundles (no cross-window script loading needed).
  let overlay = document.getElementById('__pdf_print_overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = '__pdf_print_overlay';
  overlay.style.cssText = 'position:fixed;left:-100000px;top:0;width:210mm;z-index:-1;';
  document.body.appendChild(overlay);

  // Inject print-only styles once
  if (!document.getElementById('__pdf_print_styles')) {
    const style = document.createElement('style');
    style.id = '__pdf_print_styles';
    style.textContent = `
      @media print {
        html body > *:not(#__pdf_print_overlay) { display: none !important; visibility: hidden !important; }
        html body #__pdf_print_overlay,
        html body #__pdf_print_overlay * { visibility: visible !important; }
        #__pdf_print_overlay {
          position: static !important; left: 0 !important; top: 0 !important;
          width: auto !important; z-index: auto !important;
          display: block !important;
        }
        #__pdf_print_overlay .pdf-page {
          box-shadow: none !important;
          page-break-after: always; break-after: page;
          margin: 0 !important;
          display: block !important;
        }
        #__pdf_print_overlay .pdf-page:last-child {
          page-break-after: auto; break-after: auto;
        }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        @page { size: A4 portrait; margin: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // Render the PDF template into the overlay
  const root = ReactDOM.createRoot(overlay);
  const Template = data.mode === 'compare' ? window.PDFCompare : window.PDFEditorial;
  // Utan den här kontrollen gav ett saknat eller trasigt mallobjekt tomma A4-sidor
  // i kundens utskrift i stället för ett felmeddelande.
  if (typeof Template !== 'function') {
    console.error('PDF-mallen saknas — avbryter export.');
    try { overlay.remove(); } catch (_) {}
    _pdfExporting = false;
    return;
  }
  root.render(<Template data={data} />);

  await waitForRender(overlay);

  // Städa när utskriften faktiskt är klar, inte efter en gissad tidsgräns.
  // Firefox och Safari blockerar inte på print(), så den gamla 1200 ms-rivningen
  // kunde ta bort overlayen medan förhandsvisningen byggdes — halv eller tom PDF
  // hos en kollega på Mac. try/catch ser dessutom till att flaggan aldrig fastnar
  // på true om print() kastar, vilket dödade knappen tyst resten av sessionen
  // (granskningsfynd G17).
  let stadad = false;
  const stada = () => {
    if (stadad) return;
    stadad = true;
    window.removeEventListener('afterprint', stada);
    try { root.unmount(); } catch (_) {}
    try { if (overlay.parentNode) overlay.remove(); } catch (_) {}
    _pdfExporting = false;
  };
  window.addEventListener('afterprint', stada);
  try {
    window.print();
  } catch (_) {
    stada();
    return;
  }
  // Skyddsnät om afterprint aldrig kommer (äldre webbläsare, blockerad dialog).
  setTimeout(stada, 60000);
}

// Vänta tills DOM är layoutad, fonts klara och alla bilder dekoderade.
async function waitForRender(node) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { await document.fonts?.ready; } catch (_) {}
  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((res) => {
      img.addEventListener('load', res, { once: true });
      img.addEventListener('error', res, { once: true });
    });
  }));
  await new Promise((r) => requestAnimationFrame(r));
}

const I = {
  // Från AmpSociety Grafisk Manual 2024 v1.0
  bg: '#F6F4EF',            // varm off-white (tonad)
  paper: '#FFFFFF',
  surface: '#FFFFFF',
  wash: '#FDE3D4',           // ljusaste orange-wash för accenter
  ink: '#272120',            // manualens "svart"
  ink2: '#3E3836',
  mute: '#838282',           // Cool Gray 7
  muteSoft: '#B8B4B2',
  line: '#DADADA',
  lineSoft: '#EEEEEE',
  accent: '#F46036',         // primär orange
  accentDeep: '#86341E',     // mörk orange
  accentSoft: '#F5A888',     // ljus orange
  accentWash: '#FDE3D4',
  forest: '#2E5449',
  forestSoft: '#58A08B',
  forestWash: '#E7F1ED',
  serif: '"GT Super Display", "Playfair Display", Georgia, serif',
  sans: '"Apercu", "Karla", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

// K1-fix: defensiv guard innan Amp5Calc-konstanter konsumeras vid modulladdning.
// Om calc.js inte hunnit köra (bundle-ordning eller laddfel) ger vi tydligt fel istället för cryptic TypeError.
if (!window.Amp5Calc || typeof window.Amp5Calc.computeEnergy !== 'function') {
  const msg = 'Amp5Calc är inte laddad. Kontrollera bundle-ordningen (calc.js måste köras före variant.jsx).';
  console.error(msg);
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#c62828">${msg}</div>`;
  }
  throw new Error(msg);
}

// H6-fix: sanera projektnamn — strippa Unicode bidi-overrides och zero-width-tecken som annars kan vilseleda PDF-rendering.
function sanitizeProjectName(s) {
  if (typeof s !== 'string') return '';
  // Strippa: LRM/RLM (200E,200F), embedding/override (202A-202E), isolates (2066-2069), ZWSP/ZWNJ/ZWJ (200B-200D)
  return s.replace(/[​-‏‪-‮⁦-⁩]/g, '');
}

// ───────── Spara/dela: kalkylen serialiseras till URL-hash + localStorage ─────────
// URL-hash (#k=base64-json) gör kalkylen delbar som länk; localStorage skyddar
// mot omladdning mitt i ett kundmöte. Hash vinner över localStorage vid start
// (en delad länk ska öppna exakt den kalkylen, inte mottagarens senaste).
const STORE_KEY = 'amp5_kalkyl_v1';
function encodeCalcState(s) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); } catch (_) { return ''; }
}
function decodeCalcState(str) {
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch (_) { return null; }
}
// Kostnadsfälten utelämnas medvetet ur delningslänken. De måste därför läsas
// tillbaka ur localStorage och läggas ovanpå hash-tillståndet — annars nollställs
// säljarens egen kostnadsbild tyst vid varje omladdning av en delad länk.
const KOSTNADSFALT = ['materialCost', 'installationCost', 'omPctYear', 'investmentGrant'];
// EN definition av vad som faktiskt delas, använd både när hashen skrivs och när
// den läses. Utan den gick de två isär, se STARTAD_FRAN_LANK nedan.
function delbaraFalt(s) {
  const { materialCost: _m, installationCost: _i, omPctYear: _o, investmentGrant: _g, ...delbart } = s;
  return delbart;
}
// Sätts när appen startade från en delad länk. Kostnadsfälten följer INTE med
// hashen (medvetet, G19) utan läses ur mottagarens egen localStorage — samma
// länk kan därför ge avsändaren payback 13,9 år och mottagaren 2,0 år. Bortvalet
// är rätt; det omarkerade utfallet var det inte.
let STARTAD_FRAN_LANK = false;
function loadInitialCalcState() {
  const h = window.location.hash;
  if (h && h.startsWith('#k=')) {
    const s = decodeCalcState(h.slice(3));
    if (s && typeof s === 'object') {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        const lokalt = raw ? JSON.parse(raw) : null;
        // Appen skriver sin EGEN hash vid varje tillståndsändring (autospar
        // nedan), så "hashen finns" betyder inte "länken kom från någon annan".
        // Utan den här jämförelsen visades noten "Sidan öppnades från en delad
        // länk" vid varje F5 av säljarens egen kalkyl — ett falskt påstående i
        // just den panel som visas för kund. Stämmer hashen med det lokalt
        // sparade tillståndet är det vår egen; skiljer den sig kom den utifrån.
        const egen = lokalt && typeof lokalt === 'object'
          && encodeCalcState(delbaraFalt(lokalt)) === h.slice(3);
        STARTAD_FRAN_LANK = !egen;
        if (lokalt && typeof lokalt === 'object') {
          for (const k of KOSTNADSFALT) {
            if (s[k] === undefined && lokalt[k] !== undefined) s[k] = lokalt[k];
          }
        }
      } catch (_) {}
      return s;
    }
  }
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') return s;
    }
  } catch (_) {}
  return null;
}

// P1-fix: LIMIT_SUB och LIMIT_WARNINGS som modulnivåkonstanter — skapas ej om vid varje render.
// window.Amp5Calc är definierat när variant.jsx evalueras (calc.js körs först i bundlen).
// Etiketterna delas med PDF:en via Amp5Calc.LIMIT_REASON_LABEL (en källa).
const LIMIT_SUB = window.Amp5Calc.LIMIT_REASON_LABEL;
const LIMIT_WARNINGS = {
  // Rättad 2026-09: tidigare stod "kortare parkering eller fler uttag krävs".
  // Effektbehovet per bil är mål / (parkeringstid × η) — oberoende av antalet
  // uttag, och det ÖKAR när tiden kortas. Båda råden var alltså felaktiga.
  [window.Amp5Calc.LIMIT_REASON.HW]:         'Målet kräver högre effekt per bil än fordonets AC-laddartak. Längre parkeringstid eller lägre energimål krävs — alternativt ett fordon som klarar 22 kW AC.',
  [window.Amp5Calc.LIMIT_REASON.SYSTEM_CAP]: 'Fastighetseffekttaket begränsar. Målet kräver servisutökning.',
  [window.Amp5Calc.LIMIT_REASON.HW_CONFIG]:  'Målet uppnås inte med vald tid och beläggning.',
};

const SCENARIO_NAMES = ['Scenario A', 'Scenario B', 'Scenario C', 'Scenario D', 'Scenario E', 'Scenario F'];
const MAX_SCENARIOS = 6;

// Stabilt id per scenario så React-key följer identitet, inte position.
// colorSlot = stabil palett-plats (0..N), allokeras till första lediga vid add
// så färgerna aldrig krockar eller ommålas vid borttagning mitt i listan.
let _scenarioSeq = 0;
function defaultScenario(name, colorSlot = 0) {
  return {
    cid: _scenarioSeq++,
    colorSlot,
    name,
    outlets: 20,
    hubs: null,
    capPerHub: window.Amp5Calc.CAP_PER_HUB_KW,
    systemCap: null,
    parkingHours: 8,
    profileKey: 'office',
    peakOcc: 0.95,
  };
}

// Inject responsive CSS once on first render
const RESPONSIVE_CSS = `
  @media (max-width: 860px) {
    .iv-split { grid-template-columns: 1fr !important; }
    .iv-left  { border-right: none !important; border-bottom: 1px solid #DADADA !important; max-width: 100% !important; }
    .iv-hero-number { font-size: clamp(64px, 18vw, 156px) !important; }
    .iv-results-grid { grid-template-columns: 1fr !important; }
    .iv-hero { grid-template-columns: 1fr !important; }
  }
`;
let _responsiveCssInjected = false;
function injectResponsiveCss() {
  if (_responsiveCssInjected) return;
  _responsiveCssInjected = true;
  const s = document.createElement('style');
  s.id = '__iv_responsive';
  s.textContent = RESPONSIVE_CSS;
  document.head.appendChild(s);
}

function InstrumentVariant() {
  const C = window.Amp5Calc;
  React.useLayoutEffect(injectResponsiveCss, []);
  // Återställ ev. sparad/delad kalkyl (URL-hash > localStorage > defaults).
  const init = React.useRef(loadInitialCalcState()).current || {};
  const [mode, setMode] = React.useState(init.mode ?? 'energy'); // energy | hubs | compare
  const [outlets, setOutlets] = React.useState(init.outlets ?? 20);
  const [hubs, setHubs] = React.useState(init.hubs ?? null); // auto
  const [capPerHub, setCapPerHub] = React.useState(init.capPerHub ?? 44);
  const [systemCap, setSystemCap] = React.useState(init.systemCap ?? null);
  // Defaults matchar 'office'-presetet så att fastighetschippen stämmer vid första laddning (fix #1)
  const [parkingHours, setParkingHours] = React.useState(init.parkingHours ?? 9);
  const [profileKey, setProfileKey] = React.useState(C.PROFILES[init.profileKey] ? init.profileKey : 'office');
  const [peakOcc, setPeakOcc] = React.useState(init.peakOcc ?? 0.85);
  // Behovstak per laddtillfälle (kWh, levererat). null = obegränsat — bilen
  // laddar då hela parkeringsfönstret (beteendet före v3.7.1).
  const [sessionNeedKWh, setSessionNeedKWh] = React.useState(init.sessionNeedKWh !== undefined ? init.sessionNeedKWh : 15);
  const [desiredKWh, setDesiredKWh] = React.useState(init.desiredKWh ?? 30);
  const [occPct, setOccPct] = React.useState(init.occPct ?? 0.75);
  const [carId, setCarId] = React.useState(init.carId ?? 'tesla3');
  const [carAcLimit, setCarAcLimit] = React.useState(init.carAcLimit ?? C.CAR_AC_LIMIT_KW);
  const [efficiency, setEfficiency] = React.useState(init.efficiency ?? C.DEFAULT_EFFICIENCY);
  // Lastbalanseringsstrategi (handbok 8.3.1). Styr hur många bilar som kommer
  // igång samtidigt: PriorityMaxPower ger 16 A start (~4 bilar per hub),
  // FairSharedPower 8 A (~8 bilar). Total levererad energi är densamma.
  const [strategy, setStrategy] = React.useState(C.LB_STRATEGY[init.strategy] ? init.strategy : C.DEFAULT_STRATEGY);
  const [projectName, setProjectName] = React.useState(init.projectName ?? '');
  // P4 (v3.7+): Enkel/Avancerad UI-toggle + fastighetstyp-preset
  const [uiMode, setUiMode] = React.useState(init.uiMode ?? 'simple');
  const applyPropertyType = React.useCallback((key) => {
    const preset = PROPERTY_PRESETS[key];
    if (!preset) return;
    setProfileKey(preset.profileKey);
    setParkingHours(preset.parkingHours);
    setPeakOcc(preset.peakOcc);
    setOccPct(preset.occPct);
    // Enkla lägets tredje fråga har ett svar redan när chippet klickas — Greta
    // ska se ett tal direkt, inte ett tomt reglage.
    if (preset.needKWh != null) setSessionNeedKWh(preset.needKWh);
  }, []);
  // F1: Elnät (servissäkring 3-fas 400 V + befintlig last)
  const [fuseSizeA, setFuseSizeA] = React.useState(init.fuseSizeA ?? 63);
  const [existingLoadPct, setExistingLoadPct] = React.useState(init.existingLoadPct ?? 0.20);
  // F2: Ekonomi
  const [materialCost, setMaterialCost] = React.useState(init.materialCost ?? 100000);
  const [installationCost, setInstallationCost] = React.useState(init.installationCost ?? 150000);
  const [electricityPrice, setElectricityPrice] = React.useState(init.electricityPrice ?? 2.50);
  const [chargingFee, setChargingFee] = React.useState(init.chargingFee ?? 0);
  // H1: effekttariff (kr/kW/månad) — påverkar månadskostnad via nätbolagets effektavgift
  const [powerTariff, setPowerTariff] = React.useState(init.powerTariff ?? 60);
  // LCC: drift & underhåll, %/år av kapital
  const [omPctYear, setOmPctYear] = React.useState(init.omPctYear ?? 3);
  // Aktiva laddningsdagar/månad för ekonomin. null = auto från profilen
  // (kontor ≈ 21 arbetsdagar, övriga 30).
  const [activeDaysPerMonth, setActiveDaysPerMonth] = React.useState(init.activeDaysPerMonth ?? null);
  // Investeringsstöd (kr) — t.ex. Naturvårdsverkets "Ladda bilen".
  const [investmentGrant, setInvestmentGrant] = React.useState(init.investmentGrant ?? 0);
  const [scenarios, setScenarios] = React.useState(() => {
    if (Array.isArray(init.scenarios) && init.scenarios.length) {
      return init.scenarios.map((s, i) => ({
        ...defaultScenario(s.name || SCENARIO_NAMES[i] || `Scenario ${i + 1}`, s.colorSlot ?? i),
        ...s,
        profileKey: C.PROFILES[s.profileKey] ? s.profileKey : 'office',
        cid: _scenarioSeq++,
      }));
    }
    return [
      defaultScenario(SCENARIO_NAMES[0], 0),
      { ...defaultScenario(SCENARIO_NAMES[1], 1), outlets: 50, profileKey: 'mall', peakOcc: 0.85 },
    ];
  });

  // fix #3 + granskningsfynd: enkelt läge räknar på produktstandard, men
  // avancerade värden SPARAS undan och återställs vid växling tillbaka —
  // tidigare nollställdes de tyst och säljarens anläggningsdata försvann
  // (elnätsstatus kunde hoppa från 'Servisutökning' till 'OK' mitt i mötet).
  // OBS: måste deklareras EFTER all state den läser — Babel gör const→var,
  // så tidigare placering gav undefined i deps-arrayen och stale closure.
  const advSnapshot = React.useRef(null);
  const [advancedWasCustom, setAdvancedWasCustom] = React.useState(false);
  const handleSetUiMode = React.useCallback((m) => {
    setUiMode(m);
    if (m === 'simple') {
      const hadCustom = hubs != null || capPerHub !== C.CAP_PER_HUB_KW || systemCap != null
        || carAcLimit !== C.CAR_AC_LIMIT_KW || existingLoadPct !== 0.20 || activeDaysPerMonth != null;
      advSnapshot.current = { hubs, capPerHub, systemCap, carAcLimit, existingLoadPct, activeDaysPerMonth };
      setAdvancedWasCustom(hadCustom);
      setHubs(null);
      setCapPerHub(C.CAP_PER_HUB_KW);
      setSystemCap(null);
      setCarAcLimit(C.CAR_AC_LIMIT_KW);
      setExistingLoadPct(0.20);
      setActiveDaysPerMonth(null);
    } else if (m === 'advanced' && advSnapshot.current) {
      const s = advSnapshot.current;
      setHubs(s.hubs);
      setCapPerHub(s.capPerHub);
      setSystemCap(s.systemCap);
      setCarAcLimit(s.carAcLimit);
      setExistingLoadPct(s.existingLoadPct);
      setActiveDaysPerMonth(s.activeDaysPerMonth);
      setAdvancedWasCustom(false);
    }
  }, [hubs, capPerHub, systemCap, carAcLimit, existingLoadPct, activeDaysPerMonth]);
  // Stabilt rapport-ID per session så omtryckning ger samma referens.
  const reportId = React.useRef('A5-' + Math.floor(Math.random() * 9000 + 1000)).current;

  // Autospar: hela kalkylen till localStorage + URL-hash (replaceState — inga
  // historikposter). Adressfältet är därmed alltid en delbar länk.
  React.useEffect(() => {
    const s = {
      mode, uiMode, outlets, hubs, capPerHub, systemCap, parkingHours, profileKey,
      peakOcc, sessionNeedKWh, desiredKWh, occPct, carId, carAcLimit, efficiency, strategy,
      projectName, fuseSizeA, existingLoadPct, materialCost, installationCost,
      electricityPrice, chargingFee, powerTariff, omPctYear, activeDaysPerMonth,
      investmentGrant,
      scenarios: scenarios.map(({ cid, ...rest }) => rest),
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
    // Delningslänken utelämnar AmpSocietys interna kalkylantaganden. Hashen
    // hamnar i kundens webbhistorik, i utskriftens sidhuvud och i varje
    // skärmdelning av adressfältet (granskningsfynd G19) — kostnadsbilden
    // sparas lokalt men följer inte med länken.
    try { window.history.replaceState(null, '', '#k=' + encodeCalcState(delbaraFalt(s))); } catch (_) {}
  }, [mode, uiMode, outlets, hubs, capPerHub, systemCap, parkingHours, profileKey,
      peakOcc, sessionNeedKWh, desiredKWh, occPct, carId, carAcLimit, efficiency, strategy,
      projectName, fuseSizeA, existingLoadPct, materialCost, installationCost,
      electricityPrice, chargingFee, powerTariff, omPctYear, activeDaysPerMonth,
      investmentGrant, scenarios]);

  const profile = C.PROFILES[profileKey];
  // Härled fastighetstyp ur faktiska värden (fix #1/#2) — chippen highlightas bara om värdena matchar
  const propertyType = matchPropertyType(profileKey, parkingHours, peakOcc, occPct);

  const energy = React.useMemo(() => C.computeEnergy({
    outlets, hubs, capPerHub, systemCap,
    parkingHours, profileHours: profile.hours, peakOccupancyPct: peakOcc,
    hwLimitKW: carAcLimit, efficiency, sessionNeedKWh, strategy,
    profileLabel: profile.label,
  }), [outlets, hubs, capPerHub, systemCap, parkingHours, profileKey, peakOcc, carAcLimit, efficiency, sessionNeedKWh, strategy]);

  const sizing = React.useMemo(() => C.computeHubs({
    outlets, desiredKWhPerOutlet: desiredKWh, parkingHours,
    occupancyPct: occPct, capPerHub, systemCap,
    hwLimitKW: carAcLimit, efficiency,
  }), [outlets, desiredKWh, parkingHours, occPct, capPerHub, systemCap, carAcLimit, efficiency]);

  // F1: Elnätsbedömning — systemets toppeffekt mot serviskapacitet
  // K4-fix: räkna ut effekt per laddande bil vid samtidig peak — avslöjar "trickle"-scenarier
  // där SmartHub-taket sprids på så många bilar att varje får under 2 kW.
  // I energiläget hämtas talet ur kohortsimuleringen (bilar som mött sitt
  // behov står kvar utan att ladda och ska inte ingå i nämnaren).
  // Effektprofil-graf: i hubs-läge räknas den på sizing.hubs + occPct.
  // Deklareras FÖRE ekonomin eftersom ekonomin nu läser samma modell —
  // Babel gör const→var, så fel ordning ger undefined i deps och stale closure.
  const chartEnergy = React.useMemo(() => {
    if (mode === 'energy') return energy;
    return C.computeEnergy({
      outlets, hubs: sizing.hubs, capPerHub, systemCap,
      parkingHours, profileHours: profile.hours,
      peakOccupancyPct: occPct,
      hwLimitKW: carAcLimit, efficiency, strategy,
      sessionNeedKWh: desiredKWh, // i hubs-läget är energimålet bilens behov
      profileLabel: profile.label,
    });
  }, [mode, energy, sizing.hubs, outlets, capPerHub, systemCap, parkingHours, profileKey, occPct, desiredKWh, carAcLimit, efficiency, strategy]);

  // EN toppeffekt för hela rapporten. Tidigare fick elnätsbedömningen ett eget
  // hubsPeak i hubs-läget medan ekonomin läste profilmodellen — samma anläggning
  // kunde då få "OK" i ett läge och "Servisutökning krävs" i det andra
  // (granskningsfynd G7). Deklareras EFTER chartEnergy: const→var gör att en
  // hook som läser en senare variabel får undefined i deps.
  const gridAssessment = React.useMemo(() => C.computeGridAssessment({
    fuseSizeA, existingLoadPct, systemPeakKW: chartEnergy.peakPowerKW,
    capPerHub, installedHubs: chartEnergy.hubs,
    // Servisen ska hållas mot vad anläggningen KAN dra, inte mot ett
    // beläggningsantagande (granskningsfynd B1).
    installedCapKW: chartEnergy.effectiveCap,
  }), [fuseSizeA, existingLoadPct, chartEnergy.peakPowerKW, capPerHub, chartEnergy.hubs, chartEnergy.effectiveCap]);

  // Effekt per LADDANDE bil vid samtidig topp kommer nu ur kohortsimuleringen i
  // båda lägena. Tidigare räknade hubs-läget effekttak / antal närvarande, vilket
  // gav värden under 6 A — en effekt Amp5 aldrig levererar (handbok 8.3.1).
  const perCarPeakKW = chartEnergy.perCarAtPeakKW ?? null;

  // F2: Kostnad & ROI — EN modell i båda lägena. computeHubs konstanta beläggning
  // dygnet runt är rätt för DIMENSIONERING (konservativ värsta-fallstopp) men
  // överskattade levererad energi upp till 2,3× och gick rakt in i paybacken.
  // Intäkt och återbetalningstid räknas därför på profilmodellen, samma som grafen.
  const economics = React.useMemo(() => C.computeEconomics({
    materialCost, installationCost,
    electricityPrice, chargingFee,
    totalEnergyDay: chartEnergy.totalEnergyDay,
    gridEnergyDay: chartEnergy.totalEnergyFromGrid,
    // Effekttariffen ska bara belasta det investeringen FAKTISKT orsakar, dvs.
    // ökningen av abonnemangstoppen — inte fastighetens befintliga grundlast.
    // Ett tidigare försök lade på existingKW, med följden att en större
    // servissäkring gjorde laddprojektets payback sämre: identisk anläggning
    // gick från 3,75 år till 6,00 år bara för att säkringen byttes 63 A -> 250 A.
    powerTariff, peakPowerKW: chartEnergy.peakPowerKW,
    omPctYear: omPctYear / 100,
    daysPerMonth: activeDaysPerMonth ?? profile.daysPerMonth ?? 30,
    investmentGrant,
  }), [chartEnergy.totalEnergyDay, chartEnergy.totalEnergyFromGrid, chartEnergy.peakPowerKW,
      materialCost, installationCost, electricityPrice, chargingFee,
      powerTariff, omPctYear, activeDaysPerMonth, profileKey, investmentGrant]);

  const car = C.CARS.find((c) => c.id === carId) || C.CARS[0];
  // actualEnergyPerOutlet är ett KAPACITETSTAK — vad anläggningen skulle kunna
  // leverera per uttag. Bilen tar inte emot mer än sitt mål, så det talet får
  // aldrig presenteras som levererad energi eller räckvidd: det överdrev
  // kundrapportens största siffra med upp till 86 % (granskningsfynd G1).
  const heroKWh = mode === 'energy' ? energy.perOutletKWh : sizing.deliveredEnergyPerOutlet;
  const heroRange = C.rangeKm(heroKWh, car.kwh100);

  if (uiMode === 'simple') {
    return (
      <SimpleMode
        propertyType={propertyType} applyPropertyType={applyPropertyType}
        profileKey={profileKey}
        fuseSizeA={fuseSizeA} setFuseSizeA={setFuseSizeA}
        existingLoadPct={existingLoadPct}
        parkingHours={parkingHours} peakOcc={peakOcc}
        outlets={outlets} setOutlets={setOutlets}
        carAcLimit={carAcLimit} efficiency={efficiency} strategy={strategy}
        setUiMode={handleSetUiMode}
      />
    );
  }

  if (mode === 'compare') {
    return (
      <div className="iv-root" style={{
        width: '100%', minHeight: '100vh', background: I.bg, color: I.ink,
        fontFamily: I.sans,
      }}>
        <ComparePanel
          mode={mode} setMode={setMode}
          scenarios={scenarios} setScenarios={setScenarios}
          car={car} carId={carId} setCarId={setCarId}
          carAcLimit={carAcLimit} setCarAcLimit={setCarAcLimit}
          efficiency={efficiency} setEfficiency={setEfficiency}
          sessionNeedKWh={sessionNeedKWh} setSessionNeedKWh={setSessionNeedKWh}
          strategy={strategy}
          fuseSizeA={fuseSizeA} existingLoadPct={existingLoadPct}
          electricityPrice={electricityPrice} chargingFee={chargingFee} powerTariff={powerTariff}
          activeDaysPerMonth={activeDaysPerMonth}
          projectName={projectName} setProjectName={setProjectName}
          onExportPdf={() => {
            const data = buildComparePdfData({ scenarios, car, carAcLimit, efficiency, sessionNeedKWh, strategy, fuseSizeA, existingLoadPct, electricityPrice, chargingFee, powerTariff, activeDaysPerMonth, reportId, projectName });
            exportAsPdf(data);
          }}
        />
      </div>
    );
  }

  return (
    <div className="iv-root iv-split" style={{
      width: '100%', minHeight: '100vh', background: I.bg, color: I.ink,
      fontFamily: I.sans, display: 'grid',
      gridTemplateColumns: 'minmax(min(420px,100%),420px) 1fr',
    }}>
      <LeftPanel
        uiMode={uiMode} setUiMode={handleSetUiMode}
        propertyType={propertyType} applyPropertyType={applyPropertyType}
        mode={mode} setMode={setMode}
        outlets={outlets} setOutlets={setOutlets}
        hubs={hubs} setHubs={setHubs} autoHubs={energy.autoHubs}
        capPerHub={capPerHub} setCapPerHub={setCapPerHub}
        systemCap={systemCap} setSystemCap={setSystemCap}
        parkingHours={parkingHours} setParkingHours={setParkingHours}
        profileKey={profileKey} setProfileKey={setProfileKey}
        peakOcc={peakOcc} setPeakOcc={setPeakOcc}
        sessionNeedKWh={sessionNeedKWh} setSessionNeedKWh={setSessionNeedKWh}
        desiredKWh={desiredKWh} setDesiredKWh={setDesiredKWh}
        occPct={occPct} setOccPct={setOccPct}
        carAcLimit={carAcLimit} setCarAcLimit={setCarAcLimit}
        efficiency={efficiency} setEfficiency={setEfficiency}
        strategy={strategy} setStrategy={setStrategy}
        projectName={projectName} setProjectName={setProjectName}
        fuseSizeA={fuseSizeA} setFuseSizeA={setFuseSizeA}
        existingLoadPct={existingLoadPct} setExistingLoadPct={setExistingLoadPct}
        materialCost={materialCost} setMaterialCost={setMaterialCost}
        installationCost={installationCost} setInstallationCost={setInstallationCost}
        powerTariff={powerTariff} setPowerTariff={setPowerTariff}
        omPctYear={omPctYear} setOmPctYear={setOmPctYear}
        activeDaysPerMonth={activeDaysPerMonth} setActiveDaysPerMonth={setActiveDaysPerMonth}
        profileDays={profile.daysPerMonth ?? 30}
        investmentGrant={investmentGrant} setInvestmentGrant={setInvestmentGrant}
        advancedWasCustom={advancedWasCustom}
        electricityPrice={electricityPrice} setElectricityPrice={setElectricityPrice}
        chargingFee={chargingFee} setChargingFee={setChargingFee}
      />
      <RightPanel
        mode={mode}
        energy={energy} sizing={sizing} chartEnergy={chartEnergy}
        heroKWh={heroKWh} heroRange={heroRange}
        profile={profile} peakOcc={peakOcc}
        car={car} carId={carId} setCarId={setCarId}
        parkingHours={parkingHours}
        outlets={outlets} capPerHub={capPerHub} systemCap={systemCap}
        occPct={occPct} desiredKWh={desiredKWh} profileKey={profileKey}
        carAcLimit={carAcLimit} efficiency={efficiency} sessionNeedKWh={sessionNeedKWh} strategy={strategy}
        gridAssessment={gridAssessment} economics={economics}
        perCarPeakKW={perCarPeakKW}
        uiMode={uiMode} powerTariff={powerTariff} omPctYear={omPctYear} existingLoadPct={existingLoadPct}
        onExportPdf={() => {
          const data = buildPdfData({
            mode, outlets, hubs, capPerHub, systemCap, parkingHours,
            profileKey, peakOcc, desiredKWh, occPct, car,
            carAcLimit, efficiency, sessionNeedKWh, strategy, projectName,
            energy, sizing, chartEnergy, reportId,
            gridAssessment, economics, perCarPeakKW,
          });
          exportAsPdf(data);
        }}
      />
    </div>
  );
}

// ───────── Enkelt läge — TRE frågor, ETT svar ─────────
// "Enkelhet som ledord. Standard skall vara så enkel att Greta 90 år fattar."
//
// Läget frågar efter det kunden VET (fastighet, huvudsäkring, antal
// parkeringsplatser) och svarar på det de undrar över: hur långt varje bil kan
// köra på en laddning.
//
// RIKTNINGEN ÄR VALD, INTE GIVEN. Första versionen gick åt andra hållet — ange
// körsträcka, få antal platser — och Daniel vände på den: en BRF vet att garaget
// har 40 platser, ingen vet hur långt de boende kör. Vändningen visade sig också
// vara skillnaden mellan ett reglage som går att dra och ett som inte gör det;
// se noten vid computeSimple i _33_calc.js.
//
// Vad som medvetet INTE finns här, och varför:
//   · Elnätsstatus  — computeSimple dimensionerar mot GRÖN status, så en rad om
//                     elnätet hade bara upprepat att svaret redan håller sig
//                     inom servisen.
//   · Ekonomi       — säljarens kalkyl, inte Gretas fråga. Ligger i Avancerat.
//   · Bilval, profil, beläggning, strategi, verkningsgrad — schabloner ur
//                     fastighetstypen. Alla finns kvar i Avancerat.

// Schablonbil: medelförbrukningen i CARS. EN källa — talet följer katalogen i
// stället för att bli en literal som glider isär med den (samma skäl som
// GRID_MARGIN slogs ihop till en källa i v3.8.9). Defaultbilen hade varit fel
// val: Tesla Model 3 LR går 14,5 kWh/100 km, näst snålast i katalogen, och hade
// gett Greta ~15 % för långa km-tal.
function schablonKwh100() {
  const cars = window.Amp5Calc.CARS;
  return cars.reduce((a, c) => a + c.kwh100, 0) / cars.length;
}
const kwhTillKm = (kwh) => window.Amp5Calc.rangeKm(kwh, schablonKwh100());

// Medelbatteriet i CARS. Enkla läget sätter INGET energibehov — det är ju frågan
// — så en bil laddar så länge den står, och utan tak kan svaret bli fysiskt
// omöjligt (148 kWh per session och 922 km räckvidd, granskningen 2026-09-12).
// Beräkningen rörs inte; talet flaggas.
function schablonBatteri() {
  const cars = window.Amp5Calc.CARS;
  return cars.reduce((a, c) => a + c.battery, 0) / cars.length;
}
function SimpleMode(p) {
  const C = window.Amp5Calc;
  const profile = C.PROFILES[p.profileKey] || C.PROFILES.office;

  // BASLASTEN ÄR NOLL HÄR, MED FLIT (Daniel 2026-09-16: "I det enkla läget så
  // skippar vi baslasten. Har vi 63A så räkna med 44kW osv!").
  //
  // Avancerats 20 %-schablon är ett antagande kunden aldrig gjort, och den åt en
  // femtedel av anslutningen innan något räknats: 63 A blev 44 → 35 → 31 kW, och
  // "31 kW" bredvid "63 A" går inte att stämma av mot något kunden känner igen.
  // Enkla läget dimensionerar därför mot HELA servisen. Har fastigheten
  // betydande grundlast är det ett avancerat samtal — och fältet finns kvar där.
  const res = React.useMemo(() => C.computeSimple({
    fuseSizeA: p.fuseSizeA,
    existingLoadPct: 0,
    outlets: p.outlets,
    parkingHours: p.parkingHours,
    profileHours: profile.hours,
    peakOccupancyPct: p.peakOcc,
    capPerHub: C.CAP_PER_HUB_KW,
    hwLimitKW: p.carAcLimit,
    efficiency: p.efficiency,
    strategy: p.strategy,
    profileLabel: profile.label,
  }), [p.fuseSizeA, p.outlets, p.parkingHours, p.profileKey,
       p.peakOcc, p.carAcLimit, p.efficiency, p.strategy]);

  const kWh = res.perOutletKWh;
  const km = Math.round(kwhTillKm(kWh));
  const hubTxt = res.hubs === 1 ? '1 SmartHub' : res.hubs + ' SmartHubs';
  const nattEllerDag = p.profileKey === 'residential' ? 'natt' : 'dag';

  // Två ärlighetsspärrar på svaret. Båda finns i de andra vyerna och måste
  // finnas här — enkla läget sätter INGET energibehov (det är ju frågan), så
  // en bil laddar så länge den står och talet kan bli fysiskt omöjligt.
  const batteri = schablonBatteri();
  const overBatteri = kWh > batteri;          // mer än bilen rymmer
  const forLite = km < 25;                    // knappt värt att installera

  return (
    <div className="iv-simple" style={{
      width: '100%', boxSizing: 'border-box', minHeight: '100vh', background: I.bg, color: I.ink,
      fontFamily: I.sans, display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '36px 24px 64px',
    }}>
      <div style={{ width: '100%', maxWidth: 680 }}>

        {/* Huvud */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, gap: 20 }}>
          <img src={window.Amp5Assets.logo} alt="AmpSociety" style={{ display: 'block', height: 30, width: 'auto' }} />
          <button onClick={() => p.setUiMode('advanced')}
            style={{
              background: 'transparent', border: '1px solid ' + I.line, color: I.ink2,
              padding: '7px 13px', borderRadius: 2, cursor: 'pointer',
              fontFamily: I.mono, fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase',
            }}>Avancerat läge</button>
        </div>

        <div style={{ fontFamily: I.serif, fontSize: 44, fontWeight: 500, letterSpacing: -0.8, lineHeight: 1.05, color: I.ink }}>
          Hur mycket får<br/>varje bil?
        </div>
        <div style={{ height: 4, width: 64, background: I.accent, marginTop: 14, marginBottom: 12 }} />
        <div style={{ fontSize: 13.5, color: I.ink2, lineHeight: 1.55, maxWidth: 520 }}>
          Svara på tre frågor. Vi räknar fram hur långt varje bil kan köra på en
          laddning — med er nuvarande elanslutning, utan att den behöver byggas ut.
        </div>

        {/* 1 — fastighet */}
        <SimpleStep n="1" title="Vad är det för fastighet?">
          <div className="iv-simple-chips" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            {Object.entries(PROPERTY_PRESETS).map(([k, pr]) => {
              const aktiv = p.propertyType === k;
              return (
                <button key={k} onClick={() => p.applyPropertyType(k)}
                  style={{
                    background: aktiv ? I.ink : I.surface,
                    color: aktiv ? I.bg : I.ink,
                    border: '1px solid ' + (aktiv ? I.ink : I.line),
                    padding: '14px 16px', borderRadius: 2, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    fontFamily: I.sans, fontSize: 14, fontWeight: 500, textAlign: 'left',
                    transition: 'background 120ms, border-color 120ms, color 120ms',
                  }}>
                  <span style={{ opacity: aktiv ? 1 : 0.65, display: 'flex' }}>{pr.glyph}</span>
                  {pr.label}
                </button>
              );
            })}
          </div>
        </SimpleStep>

        {/* 2 — säkring */}
        <SimpleStep n="2" title="Hur stor är huvudsäkringen?"
          hint="Står på elcentralen, eller på elräkningen. Vet ni inte — gissa, det går att ändra.">
          <SimpleFusePicker value={p.fuseSizeA} onChange={p.setFuseSizeA} />
        </SimpleStep>

        {/* 3 — antal platser */}
        <SimpleStep n="3" title="Hur många laddplatser vill ni ha?"
          hint="Det kunden oftast redan vet: antalet parkeringsplatser som ska få laddning.">
          <SimplePlacesSlider value={p.outlets} onChange={p.setOutlets} />
        </SimpleStep>

        {/* Svaret */}
        <div style={{
          marginTop: 40, padding: '32px 32px 28px', background: I.surface,
          border: '1px solid ' + I.line, borderRadius: 2,
        }}>
          <div style={{ fontSize: 13, color: I.mute, marginBottom: 2 }}>Varje bil får</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <div className="iv-simple-number" style={{
              fontFamily: I.serif, fontSize: 132, fontWeight: 500, lineHeight: 0.92,
              letterSpacing: -4, color: forLite ? I.accentDeep : I.ink, fontFeatureSettings: '"tnum"',
            }}>{C.fmt(km, { digits: 0 })}</div>
            <div style={{ fontFamily: I.serif, fontSize: 30, fontWeight: 500, color: I.ink, letterSpacing: -0.5 }}>
              km per laddning
            </div>
          </div>
          <div style={{ fontSize: 15, color: I.ink2, marginTop: 14, lineHeight: 1.5 }}>
            Alla <strong>{res.outlets} platser</strong> — samtidigt, varje {nattEllerDag}.
            <span style={{ color: I.mute }}> ({C.fmt(kWh, { digits: 1 })} kWh per bil)</span>
          </div>
          <div style={{ fontSize: 12.5, color: I.mute, marginTop: 8, fontFamily: I.mono }}>
            {hubTxt} · {C.fmt(res.systemCapKW, { digits: 0 })} kW mot elnätet · hela anslutningen används
          </div>

          {forLite && (
            <div style={{
              marginTop: 16, padding: '11px 14px', borderRadius: 2,
              background: I.accentWash, borderLeft: '3px solid ' + I.accent,
              fontSize: 12.5, lineHeight: 1.5, color: I.ink2,
            }}>
              <strong>Tunt.</strong> {km} km räcker knappt till en resa till jobbet.
              Färre platser, eller en större säkring, ger mer till varje bil.
            </div>
          )}
          {overBatteri && !forLite && (
            <div style={{
              marginTop: 16, padding: '11px 14px', borderRadius: 2,
              background: I.accentWash, borderLeft: '3px solid ' + I.accent,
              fontSize: 12.5, lineHeight: 1.5, color: I.ink2,
            }}>
              <strong>Mer än bilen rymmer.</strong> {C.fmt(kWh, { digits: 0 })} kWh är mer än ett
              typiskt elbilsbatteri ({C.fmt(batteri, { digits: 0 })} kWh) — anläggningen kan
              leverera det, men bilen kan inte ta emot det. I praktiken blir bilen full och
              slutar ladda. Anläggningen har alltså gott om kapacitet för de här platserna.
            </div>
          )}
        </div>

        {/* Effektprofilen — visar lastbalanseringen i handling */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: I.ink, letterSpacing: -0.2 }}>
              Så används effekten över dygnet
            </div>
            <div style={{ fontSize: 12, color: I.mute }}>kW per timme</div>
          </div>
          <HourlyChart energy={res.energy} utanEfterfragan />
          <div style={{ fontSize: 11.5, color: I.mute, marginTop: 10, lineHeight: 1.55 }}>
            Alla {res.outlets} bilar laddar inte samtidigt för full effekt. Amp5 fördelar
            effekten över dygnet och håller anläggningen under taket — det är därför
            {' '}{C.fmt(res.systemCapKW, { digits: 0 })} kW räcker till {res.outlets} platser.
          </div>
        </div>

        <SimpleDetails
          res={res} kWh={kWh} km={km} profil={profile.label}
          parkingHours={p.parkingHours} peakOcc={p.peakOcc}
          fuseSizeA={p.fuseSizeA} />

        <div style={{
          marginTop: 32, paddingTop: 20, borderTop: '1px solid ' + I.line,
          fontSize: 11, color: I.mute, lineHeight: 1.6,
        }}>
          Modellberäkning för dimensionering — ersätter inte projektering eller bindande
          offert. Installation kräver behörig elinstallatör enligt ELSÄK-FS.
          <span style={{ fontFamily: I.mono, marginLeft: 8 }}>Amp5 Laddkalkylator · v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}

function SimpleStep({ n, title, hint, children }) {
  return (
    <div style={{ marginTop: 34 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{
          fontFamily: I.mono, fontSize: 11, fontWeight: 700, color: I.accent,
          letterSpacing: 1, minWidth: 16,
        }}>{n}</span>
        <span style={{ fontSize: 16.5, fontWeight: 600, color: I.ink, letterSpacing: -0.2 }}>{title}</span>
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: I.mute, lineHeight: 1.5, margin: '0 0 12px 26px' }}>{hint}</div>
      )}
      <div style={{ marginLeft: 26, marginTop: hint ? 0 : 12 }}>{children}</div>
    </div>
  );
}

// Fler steg än FusePicker i Avancerat: Greta ska hitta SIN säkring i listan, inte
// behöva öppna ett "Annan"-fält. Serviseffekten skrivs ut i klartext så att valet
// går att kontrollera mot elräkningen.
function SimpleFusePicker({ value, onChange }) {
  const val = [25, 35, 50, 63, 80, 100, 125, 160, 200, 250];
  const finns = val.includes(value);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 6 }}>
        {val.map((a) => {
          const aktiv = finns && value === a;
          return (
            <button key={a} onClick={() => onChange(a)}
              style={{
                background: aktiv ? I.ink : I.surface,
                color: aktiv ? I.bg : I.ink,
                border: '1px solid ' + (aktiv ? I.ink : I.line),
                padding: '10px 2px', borderRadius: 2, cursor: 'pointer',
                fontFamily: I.sans, fontSize: 13, fontWeight: 600, textAlign: 'center',
                transition: 'background 120ms, border-color 120ms, color 120ms',
              }}>{a} A</button>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: I.mute, marginTop: 8, fontFamily: I.mono }}>
        {!finns && <span style={{ color: I.accentDeep }}>Egen storlek: {value} A · </span>}
        ≈ {Math.round(Math.sqrt(3) * 400 * value / 1000)} kW total elanslutning
      </div>
    </div>
  );
}

// Reglaget för antal laddplatser. Taket 120 räcker för de allra flesta
// BRF:er, kontor och p-hus; större anläggningar dimensioneras i Avancerat,
// där fältet går till 500. Värdet är appens egna `outlets`, så det följer med
// vid växling till Avancerat i stället för att nollställas.
function SimplePlacesSlider({ value, onChange }) {
  const MAX = 120;
  const v = Math.min(MAX, Math.max(1, value || 1));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: I.serif, fontSize: 40, fontWeight: 500, color: I.ink,
          letterSpacing: -1, fontFeatureSettings: '"tnum"',
        }}>{value}</span>
        <span style={{ fontSize: 16, color: I.ink2 }}>laddplatser</span>
        {value > MAX && (
          // Siffran visar det VERKLIGA värdet, inte det clampade: svaret nedan
          // räknas på p.outlets, och två olika tal på samma skärm är precis den
          // förväxling som kostade granskningen flera fynd (A4, G1).
          <span style={{ fontSize: 11.5, color: I.accentDeep, marginLeft: 'auto' }}>
            satt i Avancerat — reglaget går till {MAX}
          </span>
        )}
      </div>
      {/* Pucken är 26 px bred (20 + 3 px ram per sida) och förskjuts -13px, så
          vid MAX sticker den ut 13 px till höger om spåret. I Avancerat döljs
          det av vänsterpanelens padding; här ligger reglaget nära sidkanten och
          gav dokumentet horisontell scroll. Spåret får därför plats åt pucken. */}
      <div style={{ padding: '0 13px' }}>
        {/* label finns kvar trots utanRubrik: den blir <input aria-label> och är
            reglagets enda namn för skärmläsare när rubrikraden döljs. */}
        <SliderField utanRubrik label="Antal laddplatser"
          value={v} onChange={onChange} min={1} max={MAX} step={1} suffix="st" />
      </div>
    </div>
  );
}

// Hopfällt. Greta öppnar det aldrig; installatören och den skeptiske
// styrelseledamoten gör det, och då ska varje tal gå att följa.
function SimpleDetails({ res, kWh, km, profil, parkingHours, peakOcc, fuseSizeA }) {
  const C = window.Amp5Calc;
  const [open, setOpen] = React.useState(false);
  const rad = (etikett, varde) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      padding: '7px 0', borderBottom: '1px solid ' + I.lineSoft,
    }}>
      <span style={{ fontSize: 12.5, color: I.ink2 }}>{etikett}</span>
      <span style={{ fontSize: 12.5, color: I.ink, fontFamily: I.mono, textAlign: 'right' }}>{varde}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 28 }}>
      <button onClick={() => setOpen(!open)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: I.mono, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase',
          color: I.ink2, display: 'flex', alignItems: 'center', gap: 7,
        }}>
        <span style={{
          color: I.accent, transform: open ? 'rotate(90deg)' : 'none',
          transition: 'transform 140ms', display: 'inline-block',
        }}>▸</span>
        Så räknar vi
      </button>
      {open && (
        <div style={{
          marginTop: 14, padding: '18px 20px', background: I.surface,
          border: '1px solid ' + I.line, borderRadius: 2,
        }}>
          <div style={{ fontSize: 12.5, color: I.ink2, lineHeight: 1.65, marginBottom: 16 }}>
            Anläggningen får ett <strong>effekttak mot elnätet</strong> i stället för en
            utbyggd servis. SmartHub mäter fastighetens förbrukning och håller laddningen
            under taket, så att huvudsäkringen aldrig överbelastas (dynamisk
            lastbalansering, handbok 8.2). Därför kan {res.outlets} platser installeras på
            en anslutning som aldrig kunnat ge dem full effekt samtidigt — de delar på
            effekten över tiden i stället.
          </div>
          {rad('Elanslutning (' + fuseSizeA + ' A, 3-fas 400 V)', C.fmt(res.servisKW, { digits: 1 }) + ' kW')}
          {rad('Effekttak för laddningen', C.fmt(res.systemCapKW, { digits: 1 }) + ' kW  (hela anslutningen)')}
          {rad('SmartHubs', res.hubs + ' × ' + C.CAP_PER_HUB_KW + ' kW')}
          {rad('Laddplatser', res.outlets + ' st')}
          {rad('Energi per bil och laddning', C.fmt(kWh, { digits: 1 }) + ' kWh  ≈ ' + km + ' km')}
          <div style={{ fontSize: 11, color: I.mute, lineHeight: 1.6, marginTop: 14 }}>
            Hela anslutningen räknas som tillgänglig för laddning: enkla läget antar ingen
            befintlig grundlast och drar inte av någon säkerhetsmarginal. Lastbalanseringen
            mäter fastighetens förbrukning och håller laddningen under taket, så
            huvudsäkringen är gränsen. Har fastigheten betydande egen last (hiss, tvättstuga,
            värme) ska den dras av i Avancerat, och då minskar talet ovan.
            Övriga antaganden ur fastighetstypen: {profil}-profil, {parkingHours} h parkering,
            {' '}{Math.round(peakOcc * 100)} % beläggning i topptimmen. Räckvidden räknas på
            en genomsnittsbil i katalogen ({C.fmt(schablonKwh100(), { digits: 1 })} kWh/100 km)
            vid verklig förbrukning, inte WLTP — vintertid går det åt 20–40 % mer. Ändra
            vad som helst av detta i Avancerat läge.
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── Left panel ─────────
function LeftPanel(p) {
  const C = window.Amp5Calc;
  const isSimple = p.uiMode === 'simple';
  return (
    <div className="iv-left" style={{
      borderRight: `1px solid ${I.line}`,
      padding: '32px 32px 24px',
      background: I.bg,
      display: 'flex', flexDirection: 'column', gap: 28,
      overflowY: 'auto',
    }}>
      <Header />

      <UiModeToggle value={p.uiMode} onChange={p.setUiMode} />
      {isSimple && p.advancedWasCustom && (
        <div style={{ fontSize: 10.5, color: I.mute, lineHeight: 1.5, marginTop: -18, padding: '0 2px' }}>
          Enkelt läge räknar på standardvärden — dina avancerade inställningar
          återställs när du växlar tillbaka till Avancerad.
        </div>
      )}

      <ModeSwitch mode={p.mode} setMode={p.setMode} />

      {/* P3: Projektnamn för PDF-export */}
      <div>
        <label style={{ fontSize: 13, color: I.ink2, display: 'block', marginBottom: 6 }}>
          Projektnamn <span style={{ color: I.mute, fontSize: 11 }}>valfritt · visas i PDF</span>
        </label>
        <input
          type="text"
          value={p.projectName}
          onChange={(e) => p.setProjectName(sanitizeProjectName(e.target.value))}
          placeholder="t.ex. Brf Stormhatten · P-hus 2"
          maxLength={80}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: I.surface, border: `1px solid ${I.line}`,
            padding: '10px 12px', fontFamily: I.sans, fontSize: 13,
            color: I.ink, borderRadius: 2, outline: 'none',
          }}
        />
      </div>

      <Group label="Skala">
        <NumberField label="Antal uttag" value={p.outlets}
          onChange={p.setOutlets} min={1} max={500} suffix="st" />
        {!isSimple && p.mode === 'energy' && (
          <NumberField label="Antal SmartHubs" value={p.hubs ?? p.autoHubs}
            onChange={p.setHubs} min={1} max={20} suffix="hubs" optional
            hint={p.hubs == null
              ? `Auto (max ${C.OUTLETS_PER_HUB} uttag/hub)`
              : (p.hubs * C.OUTLETS_PER_HUB < p.outlets
                  ? `⚠ ${p.outlets} uttag kräver minst ${Math.ceil(p.outlets / C.OUTLETS_PER_HUB)} hubbar (${C.OUTLETS_PER_HUB} uttag/hub)`
                  : null)}
            onReset={p.hubs != null ? () => p.setHubs(null) : null} />
        )}
        {p.mode === 'hubs' && (
          <NumberField label="Önskad energi per uttag" value={p.desiredKWh}
            onChange={p.setDesiredKWh} min={1} max={200} suffix="kWh" />
        )}
        {!isSimple && (
          <>
            <NumberField label="Kapacitet per SmartHub" value={p.capPerHub}
              onChange={p.setCapPerHub} emptyValue={C.CAP_PER_HUB_KW}
              min={10} max={C.CAP_PER_HUB_KW} step={1} suffix="kW" />
            <NumberField label="Fastighetseffekttak" value={p.systemCap}
              placeholder="obegränsat" onChange={p.setSystemCap}
              min={1} max={10000} suffix="kW" optional />
          </>
        )}
      </Group>

      {isSimple ? (
        <Group label="Fastighet">
          <PropertyTypePicker value={p.propertyType} onChange={p.applyPropertyType} />
          <SliderField label="Parkeringstid" value={p.parkingHours}
            onChange={p.setParkingHours} min={1} max={24} step={1} suffix="h" />
          {p.mode === 'energy' && (
            <NumberField label="Energibehov per bil" value={p.sessionNeedKWh}
              onChange={p.setSessionNeedKWh} min={1} max={200} suffix="kWh" optional
              placeholder="obegränsat"
              hint="Typiskt behov per laddtillfälle. Tomt = bilen laddar så länge den står." />
          )}
        </Group>
      ) : (
        <Group label="Parkering">
          <SliderField label="Parkeringstid" value={p.parkingHours}
            onChange={p.setParkingHours} min={1} max={24} step={1} suffix="h" />
          {p.mode === 'energy' ? (
            <ProfilePicker value={p.profileKey} onChange={p.setProfileKey} />
          ) : (
            <SliderField label="Beläggningsgrad" value={Math.round(p.occPct*100)}
              onChange={(v) => p.setOccPct(v/100)} min={10} max={100} step={5} suffix="%" />
          )}
          {p.mode === 'energy' && (
            <SliderField label="Peak-beläggning" value={Math.round(p.peakOcc*100)}
              onChange={(v) => p.setPeakOcc(v/100)} min={5} max={100} step={1} suffix="%"
              hint="Profilens toppvärde. Med lång parkeringstid blir närvarokurvan jämnare än profilen — en bil som står nio timmar kan inte ge en skarpare topp än så. Antalet bilplatstimmar per dygn hålls fast." />
          )}
          {p.mode === 'energy' && (
            <NumberField label="Energibehov per bil" value={p.sessionNeedKWh}
              onChange={p.setSessionNeedKWh} min={1} max={200} suffix="kWh" optional
              placeholder="obegränsat"
              hint="Typiskt behov per laddtillfälle. Tomt = bilen laddar så länge den står." />
          )}
        </Group>
      )}

      {!isSimple && (
        <Group label="Avancerat">
          <CarAcLimitPicker value={p.carAcLimit} onChange={p.setCarAcLimit} />
          <StrategyPicker value={p.strategy} onChange={p.setStrategy} />
        </Group>
      )}

      <Group label="Elnät">
        <FusePicker value={p.fuseSizeA} onChange={p.setFuseSizeA} />
        {!isSimple && (
          <SliderField label="Befintlig last" value={Math.round(p.existingLoadPct * 100)}
            onChange={(v) => p.setExistingLoadPct(v / 100)} min={0} max={95} step={5} suffix="%"
            hint="Andel av serviseffekten som redan är belastad" />
        )}
      </Group>

      <Group label="Ekonomi">
        <NumberField label="Kostnad material" value={p.materialCost}
          onChange={p.setMaterialCost} min={0} max={10000000} step={5000} suffix="kr"
          hint="Totalkostnad för SmartHubs och övrigt material" />
        <NumberField label="Kostnad installation" value={p.installationCost}
          onChange={p.setInstallationCost} min={0} max={10000000} step={5000} suffix="kr"
          hint="Totalkostnad för kabeldragning, montage och driftsättning" />
        <NumberField label="Investeringsstöd" value={p.investmentGrant}
          onChange={p.setInvestmentGrant} min={0} max={10000000} step={5000} suffix="kr"
          hint="T.ex. Naturvårdsverkets Ladda bilen: 50 % av material + installation, max 15 000 kr per laddpunkt" />
        {/* Odefinierade prisfält flyttade paybacken mellan 1,3 år och "aldrig"
            i granskningen. Basen måste stå i klartext på båda fälten. */}
        <NumberField label="Elpris" value={p.electricityPrice}
          onChange={p.setElectricityPrice} min={0} max={10} step={0.1} suffix="kr/kWh"
          hint="Totalt inköpspris exkl. moms — inkl. elnätsöverföring, energiskatt och påslag, inte bara spotpris" />
        <NumberField label="Laddavgift" value={p.chargingFee}
          onChange={p.setChargingFee} min={0} max={10} step={0.1} suffix="kr/kWh"
          hint="Debiterat pris exkl. moms, samma bas som elpriset · 0 = fri laddning" />
        {!isSimple && (
          <>
            <NumberField label="Effekttariff" value={p.powerTariff}
              onChange={p.setPowerTariff} min={0} max={500} step={5} suffix="kr/kW/mån"
              hint="Nätbolagets effektavgift (typ. 40–120 kr/kW/mån för kommersiella abonnemang)" />
            <SliderField label="Drift & underhåll" value={p.omPctYear}
              onChange={p.setOmPctYear} min={0} max={10} step={1} suffix="%/år"
              hint="Service, kommunikation, betalflöde. Typiskt 2–4 % av kapital/år" />
            <NumberField label="Aktiva laddningsdagar" value={p.activeDaysPerMonth ?? p.profileDays}
              onChange={p.setActiveDaysPerMonth} min={1} max={31} suffix="dgr/mån" optional
              hint={p.activeDaysPerMonth == null ? `Auto från profilen (${p.profileDays} — kontor räknar arbetsdagar)` : null}
              onReset={p.activeDaysPerMonth != null ? () => p.setActiveDaysPerMonth(null) : null} />
          </>
        )}
      </Group>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 20 }}>
        <img src={window.Amp5Assets.logo} alt="AmpSociety" style={{ display: 'block', height: 32, width: 'auto' }} />
        <div style={{ fontFamily: I.mono, fontSize: 10, letterSpacing: 2, color: I.mute, textTransform: 'uppercase', fontWeight: 700 }}>
          Laddkalkylator
        </div>
      </div>
      {/* Rubrik först, balken direkt under (brand-manual) */}
      <div style={{ fontFamily: I.serif, fontSize: 36, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1.05, color: I.ink }}>
        Dimensionera rätt.<br/>Undvik plåsterlösningar.
      </div>
      {/* Balken — AmpSocietys visuella signatur, alltid under rubriken */}
      <div style={{ height: 4, width: 64, background: I.accent, marginTop: 14, marginBottom: 16 }} />
      <div style={{ fontSize: 13, color: I.ink2, lineHeight: 1.55, fontWeight: 400 }}>
        Ange din parkering, se hur mycket energi varje plats får, eller hur många SmartHubs som krävs.
      </div>
    </div>
  );
}

function ModeSwitch({ mode, setMode }) {
  const opts = [
    { k: 'energy',  t: 'Beräkna energi', s: 'Givet antal hubs' },
    { k: 'hubs',    t: 'Beräkna hubs',   s: 'Givet energibehov' },
    { k: 'compare', t: 'Jämför',         s: 'Sida vid sida' },
  ];
  return (
    <div style={{ display: 'flex', background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2, padding: 3 }}>
      {opts.map((o) => (
        <button key={o.k} onClick={() => { if (o.k !== mode) { setMode(o.k); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}
          style={{
            flex: 1, padding: '10px 12px', border: 'none', cursor: 'pointer',
            background: mode === o.k ? I.ink : 'transparent',
            color: mode === o.k ? I.bg : I.ink2,
            fontFamily: I.sans, fontSize: 13, fontWeight: 500,
            textAlign: 'left', borderRadius: 1, transition: 'all .15s',
          }}>
          <div>{o.t}</div>
          <div style={{ fontSize: 11, opacity: .7, fontWeight: 400, marginTop: 1 }}>{o.s}</div>
        </button>
      ))}
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div>
      <div style={{
        fontFamily: I.mono, fontSize: 10, letterSpacing: 1.6, color: I.mute,
        textTransform: 'uppercase', marginBottom: 14,
        paddingBottom: 8, borderBottom: `1px solid ${I.line}`,
      }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
    </div>
  );
}

function NumberField({
  label, value, onChange, min, max, step = 1,
  suffix, hint, onReset, placeholder, optional, emptyValue, compact,
}) {
  // Tom inmatning: optional → null, annars emptyValue (eller min, eller 1).
  const onEmpty = optional ? null : (emptyValue ?? min ?? 1);
  const display = value == null ? '' : value;

  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw === '') { onChange(onEmpty); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(max != null && n > max ? max : n);
  };
  const handleBlur = (e) => {
    const raw = e.target.value;
    if (raw === '') { onChange(onEmpty); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (min != null && n < min) onChange(min);
  };

  if (compact) {
    const rad = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: I.ink2, flex: 1 }}>
          {label}{optional && <span style={{ color: I.mute, fontSize: 10, marginLeft: 4 }}>·</span>}
        </span>
        <input type="number" value={display} placeholder={placeholder}
          onChange={handleChange} onBlur={handleBlur}
          min={min} max={max} step={step}
          style={{
            width: 88, background: I.bg, border: `1px solid ${I.line}`,
            padding: '4px 6px', fontFamily: I.mono, fontSize: 12,
            color: I.ink, borderRadius: 2, textAlign: 'right', outline: 'none',
          }} />
      </div>
    );
    // Compact-varianten tog emot hint men renderade den aldrig — en varning som
    // skickades hit försvann tyst. Raden läggs till bara när det finns något att
    // visa, så den vanliga layouten är oförändrad.
    if (!hint) return rad;
    return (
      <div>
        {rad}
        <div style={{ fontSize: 10, lineHeight: 1.4, color: I.accent, textAlign: 'right', marginTop: 2 }}>{hint}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 13, color: I.ink2 }}>
          {label}
          {optional && <span style={{ color: I.mute, fontSize: 11, marginLeft: 6 }}>valfritt</span>}
        </label>
        {onReset && (
          <button onClick={onReset} style={{
            border: 'none', background: 'transparent', color: I.accent,
            fontSize: 11, cursor: 'pointer', fontFamily: I.mono, letterSpacing: .5,
          }}>auto</button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2 }}>
        <input type="number" value={display} placeholder={placeholder}
          onChange={handleChange} onBlur={handleBlur}
          min={min} max={max} step={step}
          style={{
            flex: 1, border: 'none', background: 'transparent', padding: '10px 12px',
            fontFamily: I.mono, fontSize: 15, color: I.ink, outline: 'none',
            fontFeatureSettings: '"tnum"',
          }} />
        {suffix && (
          <div style={{
            padding: '10px 12px', fontFamily: I.mono, fontSize: 12, color: I.mute,
            borderLeft: `1px solid ${I.line}`, display: 'flex', alignItems: 'center',
          }}>{suffix}</div>
        )}
      </div>
      {hint && <div style={{ fontSize: 11, color: I.mute, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// Dragningen sköts av PEKARHÄNDELSER, inte av <input type="range">.
//
// Det inbyggda reglaget spårar musen själv, och den kedjan brister på flera
// håll: pekskärmar som kräver att fingret startar exakt på pucken, gest- och
// pekplattedrivrutiner som äter musens rörelser mellan tryck och släpp, och
// webbläsare som bara flyttar pucken vid klick. Symptomet är alltid detsamma
// — klick längs axeln fungerar, dragning gör det inte.
//
// Nu räknas värdet ur spårets egen bredd och pointer capture håller kvar
// dragningen tills fingret släpper, även utanför elementet. Samma väg för mus,
// touch och penna. Pucken hamnar dessutom exakt under pekaren: det inbyggda
// reglagets puck rör sig bara inom spåret minus puckbredden, så den låg upp
// till 8 px fel mot grafiken i ändarna.
//
// <input> är kvar, men bara för tangentbord och skärmläsare (piltangenter,
// Home/End, aria) — den tar inga pekarhändelser alls.
function SliderField({ label, value, onChange, min, max, step = 1, suffix, hint, utanRubrik }) {
  const pct = ((value - min) / (max - min)) * 100;
  const sparRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const vardeVidX = (clientX) => {
    const el = sparRef.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return value;
    const andel = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const steg = min + Math.round((andel * (max - min)) / step) * step;
    // Avrundningen håller flyttalsdamm borta när step inte är ett heltal.
    return Math.min(max, Math.max(min, Math.round(steg * 1e6) / 1e6));
  };
  const dra = (e) => {
    const v = vardeVidX(e.clientX);
    if (v !== value) onChange(v);
  };
  const slapp = (e) => {
    try { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  // DRAGNINGEN FÅR INTE HÄNGA PÅ setPointerCapture ENSAM.
  //
  // v3.9.4 löste "går inte att slida, man får klicka längs med axeln" genom att
  // ta pointer capture på spåret och driva dragningen ur `onPointerMove` med
  // `hasPointerCapture` som villkor. Det gjorde capture till EN ENDA felkälla
  // utan reserv: tas den inte — av vilket skäl som helst — fyrar `onPointerMove`
  // fortfarande, men villkoret är falskt och INGENTING händer. Nedtryckning
  // (klick) fungerar då, dragning inte. Exakt samma symptom som 2026-09-14, och
  // Daniel rapporterade det igen 2026-09-16 i både Chrome och Edge.
  //
  // Uppmätt med syntetiska pointer-events (som aldrig kan ta capture): 25
  // rörelser gav 1 värdeändring och reglaget stannade på 3 av ~110. Det synkrona
  // arbetet i handlern var 0,0 ms — det var alltså ALDRIG ett prestandaproblem,
  // vilket är vad jag först trodde och mätte i onödan.
  //
  // Här ligger dragningen i stället på window så länge draget pågår. Den
  // fungerar oavsett om capture togs, oavsett om React skulle byta ut noden
  // mitt i draget, och även när pekaren lämnar elementet. Capture behålls som
  // komplement — den hjälper när den funkar och skadar aldrig.
  const dragRef = React.useRef(null);
  dragRef.current = { value, min, max, step, onChange };
  const [drar, setDrar] = React.useState(false);
  React.useEffect(() => {
    if (!drar) return undefined;
    const flytta = (e) => {
      const el = sparRef.current;
      const d = dragRef.current;
      if (!el || !d) return;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0)) return;
      const andel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const steg = d.min + Math.round((andel * (d.max - d.min)) / d.step) * d.step;
      const v = Math.min(d.max, Math.max(d.min, Math.round(steg * 1e6) / 1e6));
      if (v !== d.value) d.onChange(v);
    };
    const upp = () => setDrar(false);
    window.addEventListener('pointermove', flytta);
    window.addEventListener('pointerup', upp);
    window.addEventListener('pointercancel', upp);
    return () => {
      window.removeEventListener('pointermove', flytta);
      window.removeEventListener('pointerup', upp);
      window.removeEventListener('pointercancel', upp);
    };
  }, [drar]);

  return (
    <div>
      {!utanRubrik && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={{ fontSize: 13, color: I.ink2 }}>{label}</label>
          <div style={{ fontFamily: I.mono, fontSize: 14, color: I.ink, fontFeatureSettings: '"tnum"' }}>
            {value}<span style={{ color: I.mute, fontSize: 11, marginLeft: 3 }}>{suffix}</span>
          </div>
        </div>
      )}
      {/* Större klickyta (36px) + tjockare track + större puck = lättare att träffa */}
      <div
        ref={sparRef}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;   // bara vänsterknapp
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();                                        // ingen textmarkering under draget
          if (inputRef.current) inputRef.current.focus({ preventScroll: true });
          setDrar(true);
          dra(e);
        }}
        onPointerMove={(e) => {
          let dragande = false;
          try { dragande = e.currentTarget.hasPointerCapture(e.pointerId); } catch (_) {}
          if (dragande) dra(e);
        }}
        onPointerUp={(e) => { setDrar(false); slapp(e); }}
        onPointerCancel={(e) => { setDrar(false); slapp(e); }}
        style={{ position: 'relative', height: 36, display: 'flex', alignItems: 'center', touchAction: 'none', cursor: 'pointer' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, background: I.line, borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, background: I.ink, borderRadius: 2 }} />
        <div style={{
          // -13px, inte -10: pucken är 20 px bred PLUS 3 px ram på varje sida
          // (content-box), så halva bredden är 13. Med -10 låg den 3 px till höger
          // om sitt eget värde — synligt mot spårets fyllnad i ändarna.
          position: 'absolute', left: `calc(${pct}% - 13px)`,
          width: 20, height: 20, borderRadius: 10,
          background: I.accent, border: `3px solid ${I.bg}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          pointerEvents: 'none',
        }} />
        <input ref={inputRef} type="range" value={value} min={min} max={max} step={step}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, margin: 0, padding: 0, pointerEvents: 'none' }} />
      </div>
      {hint && <div style={{ fontSize: 11, color: I.mute, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

const compareSelectStyle = {
  background: I.paper, border: `1px solid ${I.line}`, padding: '6px 10px',
  fontFamily: I.sans, fontSize: 13, color: I.ink, borderRadius: 2,
};

function CompareGlobalSetting({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontFamily: I.mono, fontSize: 10, letterSpacing: 1.6, color: I.mute, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </div>
  );
}

function CarAcLimitPicker({ value, onChange }) {
  const items = [
    { v: 3.7, label: '3,7 kW', sub: '1-fas 16 A' },
    { v: 7.4, label: '7,4 kW', sub: '1-fas 32 A' },
    { v: 11,  label: '11 kW',  sub: '3-fas 16 A' },
    { v: 22,  label: '22 kW',  sub: '3-fas 32 A' },
  ];
  return (
    <div>
      <div style={{ fontSize: 13, color: I.ink2, marginBottom: 8 }}>Bilens AC-laddartak</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {items.map((it) => {
          const active = Math.abs(value - it.v) < 0.01;
          return (
            <button key={it.v} onClick={() => onChange(it.v)}
              style={{
                background: active ? I.ink : I.surface,
                color: active ? I.bg : I.ink,
                border: `1px solid ${active ? I.ink : I.line}`,
                padding: '8px 10px', borderRadius: 2, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                fontFamily: I.sans, textAlign: 'left',
              }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{it.label}</span>
              <span style={{ fontSize: 10, opacity: 0.7, fontFamily: I.mono }}>{it.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Lastbalanseringsstrategi (handbok 8.3.1). Skillnaden ligger i startströmmen
// och därmed i hur många bilar som kommer igång samtidigt — inte i hur mycket
// energi anläggningen levererar totalt.
function StrategyPicker({ value, onChange }) {
  const C = window.Amp5Calc;
  const items = [
    { v: 'priority', label: 'PriorityMaxPower', sub: '16 A start · standard' },
    { v: 'fair',     label: 'FairSharedPower',  sub: '8 A start · fler igång' },
  ];
  return (
    <div>
      <div style={{ fontSize: 13, color: I.ink2, marginBottom: 8 }}>
        Lastbalansering
        <span style={{ color: I.mute, fontSize: 11, marginLeft: 6 }}>startström per session</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {items.map((it) => {
          const active = value === it.v;
          return (
            <button key={it.v} onClick={() => onChange(it.v)}
              style={{
                background: active ? I.ink : I.surface,
                color: active ? I.bg : I.ink,
                border: `1px solid ${active ? I.ink : I.line}`,
                padding: '8px 10px', borderRadius: 2, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                fontFamily: I.sans, textAlign: 'left',
              }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{it.label}</span>
              <span style={{ fontSize: 10, opacity: 0.7, fontFamily: I.mono }}>{it.sub}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: I.mute, marginTop: 6, lineHeight: 1.45 }}>
        Startströmmen delas ut i prioritetsordning tills kapaciteten är slut.
        Sessioner längre ned i ordningen köar — inget fordon laddar under {C.MIN_CHARGE_A} A.
      </div>
    </div>
  );
}

// ───────── Enkel/Avancerad — fastighetstyp-presets ─────────
// needKWh — schablonbehov per laddtillfälle. Talen är satta efter parkeringstiden
// och vad besöket rimligen ska räcka till: en natt hemma fyller på en
// dagsförbrukning med marginal, ett köpcentrumbesök på tre timmar gör det inte.
//
// LÄSAREN ÄR AVANCERAT, inte enkelt läge. Fältet skrevs för enkla lägets första
// version, där man angav körsträcka och fick antal platser; sedan riktningen
// vändes sätter det bara `sessionNeedKWh` när ett fastighetschip klickas, och
// det värdet används av energiläget. Enkelt läge sätter medvetet INGET behov —
// det är ju frågan det ställer.
//
// needKWh ingår MED FLIT inte i matchPropertyType: chippet ska följa profil, tid
// och beläggning, och skulle annars slockna så fort någon justerade behovet i
// Avancerat — vilket ser ut som att fastighetstypen glömts bort.
const PROPERTY_PRESETS = {
  brf:    { label: 'BRF / bostad',  profileKey: 'residential', parkingHours: 10, peakOcc: 0.85, occPct: 0.85, needKWh: 20, glyph: <GlyphHome /> },
  office: { label: 'Kontor',        profileKey: 'office',      parkingHours: 9,  peakOcc: 0.85, occPct: 0.75, needKWh: 15, glyph: <GlyphOffice /> },
  mall:   { label: 'Köpcentrum',    profileKey: 'mall',        parkingHours: 3,  peakOcc: 0.85, occPct: 0.60, needKWh: 10, glyph: <GlyphMall /> },
  garage: { label: 'Parkeringshus', profileKey: 'flat',        parkingHours: 6,  peakOcc: 0.60, occPct: 0.55, needKWh: 15, glyph: <GlyphFlat /> },
};

// Härled vald fastighetstyp ur faktiska värden — så chippen aldrig "ljuger" om
// vad som faktiskt beräknas (fix #1/#2). Returnerar null om inget preset matchar exakt.
function matchPropertyType(profileKey, parkingHours, peakOcc, occPct) {
  for (const [key, p] of Object.entries(PROPERTY_PRESETS)) {
    if (p.profileKey === profileKey
      && p.parkingHours === parkingHours
      && Math.abs(p.peakOcc - peakOcc) < 0.001
      && Math.abs(p.occPct - occPct) < 0.001) {
      return key;
    }
  }
  return null;
}

function PropertyTypePicker({ value, onChange }) {
  const items = Object.entries(PROPERTY_PRESETS);
  return (
    <div>
      <div style={{ fontSize: 13, color: I.ink2, marginBottom: 8 }}>
        Fastighetstyp
        <span style={{ color: I.mute, fontSize: 11, marginLeft: 6 }}>sätter rimliga grundvärden</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {items.map(([k, preset]) => {
          const active = value === k;
          return (
            <button key={k} onClick={() => onChange(k)}
              style={{
                background: active ? I.ink : I.surface,
                color: active ? I.bg : I.ink,
                border: `1px solid ${active ? I.ink : I.line}`,
                padding: '10px 12px', borderRadius: 2, cursor: 'pointer',
                fontFamily: I.sans, fontSize: 12, fontWeight: 500,
                textAlign: 'left',
              }}>
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UiModeToggle({ value, onChange }) {
  const opts = [
    // Undertexten beskrev tidigare enkla läget som "grundläggande inställningar",
    // vilket stämde när det var samma vy med färre fält. Sedan v3.10.0 ställer det
    // en ANNAN fråga, och då ska knappen säga vilken.
    { k: 'simple',   t: 'Enkel',     s: 'Hur många platser ryms?' },
    { k: 'advanced', t: 'Avancerad', s: 'Full kontroll' },
  ];
  return (
    <div style={{ display: 'flex', background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2, padding: 3 }}>
      {opts.map((o) => (
        <button key={o.k} onClick={() => onChange(o.k)}
          style={{
            flex: 1, padding: '8px 12px', border: 'none', cursor: 'pointer',
            background: value === o.k ? I.ink : 'transparent',
            color: value === o.k ? I.bg : I.ink2,
            fontFamily: I.sans, fontSize: 12, fontWeight: 500,
            textAlign: 'left', borderRadius: 1, transition: 'all .15s',
          }}>
          <div>{o.t}</div>
          <div style={{ fontSize: 10, opacity: .7, fontWeight: 400, marginTop: 1 }}>{o.s}</div>
        </button>
      ))}
    </div>
  );
}

function ProfilePicker({ value, onChange }) {
  const items = [
    { k: 'office', label: 'Kontor', glyph: <GlyphOffice /> },
    { k: 'mall', label: 'Köpcentrum', glyph: <GlyphMall /> },
    { k: 'residential', label: 'Bostad', glyph: <GlyphHome /> },
    { k: 'flat', label: 'Jämn', glyph: <GlyphFlat /> },
  ];
  return (
    <div>
      <div style={{ fontSize: 13, color: I.ink2, marginBottom: 8 }}>Beläggningsprofil</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {items.map((it) => (
          <button key={it.k} onClick={() => onChange(it.k)}
            style={{
              background: value === it.k ? I.ink : I.surface,
              color: value === it.k ? I.bg : I.ink,
              border: `1px solid ${value === it.k ? I.ink : I.line}`,
              padding: '10px 12px', borderRadius: 2, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: I.sans, fontSize: 12, fontWeight: 500,
              textAlign: 'left',
            }}>
            <span style={{ opacity: value === it.k ? 1 : 0.7 }}>{it.glyph}</span>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GlyphOffice() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="3" width="10" height="9"/><path d="M5 6h1M8 6h1M5 9h1M8 9h1"/></svg>;
}
function GlyphMall() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 5h10v7H2z"/><path d="M4 5V3a3 3 0 016 0v2"/></svg>;
}
function GlyphHome() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 7l5-4 5 4v5H2z"/><path d="M6 12V9h2v3"/></svg>;
}
function GlyphFlat() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 7h10"/></svg>;
}

// ───────── F1: FusePicker (3-fas 400 V) ─────────
function FusePicker({ value, onChange }) {
  const presets = [63, 125, 200];
  // G4-fix: håll custom-läget i eget state så fältet inte avmonteras mitt i inmatning
  // när mellansteget råkar matcha en preset (t.ex. 63 på väg mot 630).
  const [customMode, setCustomMode] = React.useState(!presets.includes(value));
  const isCustom = customMode || !presets.includes(value);
  return (
    <div>
      <div style={{ fontSize: 13, color: I.ink2, marginBottom: 8 }}>
        Servissäkring
        <span style={{ color: I.mute, fontSize: 11, marginLeft: 6 }}>3-fas 400 V</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6 }}>
        {presets.map((a) => {
          const kw = Math.round(Math.sqrt(3) * 400 * a / 1000);
          const active = !isCustom && value === a;
          return (
            <button key={a} onClick={() => { setCustomMode(false); onChange(a); }}
              style={{
                background: active ? I.ink : I.surface,
                color: active ? I.bg : I.ink,
                border: `1px solid ${active ? I.ink : I.line}`,
                padding: '8px 4px', borderRadius: 2, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                fontFamily: I.sans, textAlign: 'center',
              }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{a} A</span>
              <span style={{ fontSize: 10, opacity: 0.7, fontFamily: I.mono }}>{kw} kW</span>
            </button>
          );
        })}
        <button onClick={() => { setCustomMode(true); if (presets.includes(value)) onChange(250); }}
          style={{
            background: isCustom ? I.ink : I.surface,
            color: isCustom ? I.bg : I.ink2,
            border: `1px solid ${isCustom ? I.ink : I.line}`,
            padding: '8px 4px', borderRadius: 2, cursor: 'pointer',
            fontFamily: I.sans, fontSize: 12, fontWeight: 600,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
          <span>Annan</span>
          <span style={{ fontSize: 10, opacity: 0.7, fontFamily: I.mono }}>A</span>
        </button>
      </div>
      {isCustom && (
        <div style={{ marginTop: 8 }}>
          <NumberField label="Säkringsstorlek" value={value} onChange={onChange}
            min={1} max={800} suffix="A"
            hint={`Serviseffekt: ≈ ${Math.round(Math.sqrt(3) * 400 * value / 1000)} kW (3-fas 400 V)`} />
        </div>
      )}
    </div>
  );
}

// ───────── F1: GridAssessment display ─────────
function GridAssessment({ assessment, hubHint, perCarPeakKW, carAcLimit, carKwh100, queue, needMet }) {
  const C = window.Amp5Calc;
  const { status, servisKW, existingKW, availableKW, surplusKW, upgradeCostLow, upgradeCostHigh,
    installedCapKW, surplusVsPeakKW, limitedByInstalled, extraNeeded, extraNeededForOk } = assessment;
  const STATUS_CFG = {
    ok:       { color: '#2E7D32', bg: '#E8F5E9', label: 'OK: elnätet täcker laddningsbehovet' },
    marginal: { color: '#E65100', bg: '#FFF3E0', label: 'Marginellt: knappt tillräcklig kapacitet' },
    upgrade:  { color: '#C62828', bg: '#FFEBEE', label: 'Servisutökning krävs' },
  };
  const cfg = STATUS_CFG[status] || STATUS_CFG.ok;
  // Amp5 späder inte ut effekten över alla bilar — den tilldelar startström i
  // prioritetsordning och köar resten (handbok 8.3.1). Varningen handlar därför
  // om KÖ, inte om trickle-laddning: den gamla gränsen på 2 kW kunde aldrig nås,
  // eftersom ingen session körs under 6 A.
  const perCarLimitKW = Math.min(perCarPeakKW || 0, carAcLimit || 11);
  const present = queue ? queue.presentAtPeak || 0 : 0;
  const charging = queue ? queue.chargingAtPeak || 0 : 0;
  const queued = queue ? queue.queuedAtPeak || 0 : 0;
  const overflow = queue ? queue.sessionOverflowMax || 0 : 0;
  const queueShare = present > 0.5 ? queued / present : 0;
  // Kö är normalt och helt i sin ordning så länge bilarna hinner få sin energi.
  // Överskottsvarningen säger allt kövarningen skulle sagt, och mer — visa inte båda.
  // Utan angivet energibehov finns inget behov att missa — då är kö bara
  // lastbalansering, inte underdimensionering. Tidigare påstod varningen att
  // bilarna inte nådde ett behov användaren aldrig angett (granskningsfynd G4).
  const harBehov = queue ? queue.sessionNeedKWh != null : false;
  const showQueueWarn = harBehov && !needMet && queueShare > 0.4 && charging > 0 && overflow <= 0.5;
  const rows = [
    ['Serviseffekt (√3 × 400 V × A)', `${C.fmt(servisKW, { digits: 0 })} kW`],
    ['Befintlig last',                 `${C.fmt(existingKW, { digits: 0 })} kW`],
    ['Tillgänglig för laddning',       `${C.fmt(availableKW, { digits: 0 })} kW`],
    // Båda leden skrivs ut. Statusen följer det bindande — anläggningens
    // märkeffekt när den är högre än den modellerade toppen (granskningsfynd B1).
    ...(installedCapKW != null
      ? [['Anläggningens märkeffekt', `${C.fmt(installedCapKW, { digits: 0 })} kW`]] : []),
    ...(limitedByInstalled
      ? [['Modellerad topplast', `${C.fmt(availableKW - surplusVsPeakKW, { digits: 0 })} kW`]] : []),
    ['Överskott / underskott',         `${surplusKW >= 0 ? '+' : ''}${C.fmt(surplusKW, { digits: 0 })} kW`],
    // Avrundas NEDÅT till en decimal. Statusen jämför exakt, så en marginal på
    // 9,79 % skrevs tidigare ut som "10 % (krav 10 %)" under en orange rubrik
    // som sa att kravet inte var uppfyllt — 304 fall i svepet över vanliga
    // säkringsstorlekar (granskningsfynd A6). Nedåtavrundning är dessutom rätt
    // riktning för en marginal: den får aldrig se större ut än den är.
    ['Marginal mot tillgänglig effekt',
      `${C.fmt(Math.floor((assessment.marginRatio || 0) * 1000) / 10, { digits: 1 })} % (krav ${Math.round(C.GRID_MARGIN * 100)} %)`],
    // Folk-siffrorna samplas i BELÄGGNINGSTOPPEN, inte i effekttoppen — olika
    // timme i 67 % av fallen. Och perCarPeakKW är vad lastbalanseringen
    // TILLDELAR, medan lasten är vad bilarna faktiskt drar (lägre så snart en
    // kohort mött sitt behov). Etiketterna säger nu vilken timme som avses, och
    // lasten i samma timme står bredvid — annars jämförde läsaren produkten mot
    // dygnets Topplast och fick upp till 97 % fel (granskningsfynd A5).
    ...(present > 0.5 && queue && Number.isFinite(queue.powerAtBusiestKW)
      ? [['Last vid beläggningstopp', `${C.fmt(queue.powerAtBusiestKW, { digits: 1 })} kW`]] : []),
    ...(perCarPeakKW != null ? [['Tilldelad effekt per laddande bil', `${C.fmt(perCarLimitKW, { digits: 1 })} kW`]] : []),
    ...(present > 0.5 ? [['Vid beläggningstopp: laddar / köar', `${C.fmt(charging, { digits: 0 })} / ${C.fmt(queued, { digits: 0 })} bilar`]] : []),
  ];
  return (
    <div style={{ border: `1px solid ${I.line}`, borderRadius: 2, background: I.surface, overflow: 'hidden' }}>
      <div style={{
        padding: '10px 16px', background: cfg.bg,
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${I.line}`,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: cfg.color, flexShrink: 0 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</div>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, padding: '6px 0',
            borderBottom: `1px solid ${I.lineSoft}`,
          }}>
            <span style={{ color: I.mute }}>{k}</span>
            <span style={{ fontFamily: I.mono, color: I.ink, fontFeatureSettings: '"tnum"' }}>{v}</span>
          </div>
        ))}
        {/* upgradeCostLow > 0 är spärren PDF:en redan har. Utan den ritades
            rutan även vid 'marginal', som per definition har positivt
            överskott och därmed noll extra kW — resultatet blev "Indikativ
            kostnad för servisutökning: 0 kkr–0 kkr" i samtliga marginalfall
            (granskningsfynd A5). Räknemotorn villkorar redan på faktiskt
            behov; det var bara skärmen som saknade motsvarigheten. */}
        {/* Bara 'upgrade'. 'marginal' kräver surplusKW >= 0 ⟹ extraNeeded = 0
            ⟹ upgradeCostLow = 0, så grenen kunde aldrig bli sann — den lades in
            som ett skyddsnät men var död kod från början. */}
        {status === 'upgrade' && upgradeCostLow > 0 && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: I.accentWash, borderLeft: `3px solid ${I.accent}`,
            fontSize: 11, color: I.ink, lineHeight: 1.5,
          }}>
            Indikativ kostnad för servisutökning:{' '}
            <strong>{upgradeCostLow >= 1_000_000 ? `${C.fmt(upgradeCostLow / 1_000_000, { digits: 1 })} Mkr` : `${C.fmt(upgradeCostLow / 1000, { digits: 0 })} kkr`}–{upgradeCostHigh >= 1_000_000 ? `${C.fmt(upgradeCostHigh / 1_000_000, { digits: 1 })} Mkr` : `${C.fmt(upgradeCostHigh / 1000, { digits: 0 })} kkr`}</strong>
            {/* extraNeeded tar anläggningen till överskott 0, alltså orange
                "Marginellt" — inte grönt. Det andra talet saknades helt, så
                rådet gick aldrig att följa hela vägen till OK. Antagandet om
                oförändrad grundlast måste stå med: lasten matas in som en ANDEL
                av nuvarande servis, och skalas därför upp om man matar tillbaka
                en större säkring i appen (granskningsfynd A1). */}
            <div style={{ marginTop: 6, fontSize: 10.5, color: I.ink2 }}>
              Krävs: <strong>+{C.fmt(extraNeeded, { digits: 1 })} kW</strong> för att
              servisen precis ska räcka, <strong>+{C.fmt(extraNeededForOk, { digits: 1 })} kW</strong> för
              att nå {Math.round(C.GRID_MARGIN * 100)} % marginal (grön status).
              Båda förutsätter att fastighetens befintliga last är oförändrad.
            </div>
          </div>
        )}
        {limitedByInstalled && status !== 'ok' && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: I.bg, borderLeft: `3px solid ${I.mute}`,
            fontSize: 11, color: I.ink, lineHeight: 1.5,
          }}>
            Det är <strong>anläggningens märkeffekt</strong> som binder, inte den
            modellerade lasten. Servisutökning är alltså inte enda vägen: ett
            konfigurerat fastighetseffekttak, eller dynamisk lastbalansering med
            extern energimätare, begränsar anläggningen mot servisen i stället.
          </div>
        )}
        {hubHint && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: I.surface, borderLeft: `3px solid ${I.mute}`,
            fontSize: 11, color: I.mute, lineHeight: 1.5,
          }}>
            💡 Ange <strong>Fastighetseffekttak</strong> (kW) så delar SmartHubbarna automatiskt på den tillgängliga effekten, och elnätsbedömningen blir mer exakt.
          </div>
        )}
        {overflow > 0.5 && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: '#FFEBEE', borderLeft: `3px solid #C62828`,
            fontSize: 11, color: '#5C1A16', lineHeight: 1.5,
          }}>
            ⚠️ <strong>Fler bilar än SmartHuben kan ta sessioner för:</strong> vid topp står{' '}
            <strong>{C.fmt(overflow, { digits: 0 })} bilar</strong> utan laddsession
            ({C.fmt(queue.maxPresent, { digits: 0 })} närvarande mot taket {queue.sessionCapacity}).
            En SmartHub kör max {C.MAX_SESSIONS_PER_HUB} simultana sessioner — lägg till{' '}
            {queue.hubsNeededForSessions > 1
              ? `${queue.hubsNeededForSessions} SmartHubs till`
              : 'en SmartHub till'}.
          </div>
        )}
        {showQueueWarn && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: '#FFF3E0', borderLeft: `3px solid #E65100`,
            fontSize: 11, color: '#5C2E00', lineHeight: 1.5,
          }}>
            ⚠️ <strong>Kö vid beläggningstopp:</strong> {C.fmt(charging, { digits: 0 })} av{' '}
            {C.fmt(present, { digits: 0 })} bilar laddar samtidigt à{' '}
            <strong>{C.fmt(perCarLimitKW, { digits: 1 })} kW</strong>
            {' '}(≈{C.fmt(C.rangeKm(perCarLimitKW, carKwh100 || 16), { digits: 0 })} km/h),
            resten väntar på tur. Bilarna når inte sitt energibehov under parkeringen —
            överväg fler SmartHubs eller färre samtidiga uttag.
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── F2: EconomicsPanel ─────────
// car/perSessionKWh: investeringskalkylen kunde tidigare INTE varna — den tog
// bara emot `economics`. Hjälterutan och PDF-remsan flaggade att energin per
// laddtillfälle överstiger bilens batteri, medan intäkten, paybacken och LCoE:n
// byggde rakt av på samma kWh utan ett ord (granskningsfynd B5). perSessionKWh
// är chartEnergy.perOutletKWh i BÅDA lägena — det är den storhet intäkten
// faktiskt räknas på (totalEnergyDay = perOutletKWh × sessioner).
function EconomicsPanel({ economics, car, perSessionKWh }) {
  const C = window.Amp5Calc;
  const {
    capitalCost, hubCapital, outletCapital, investmentGrant, netCapitalCost,
    monthlyEnergyKWh, monthlyPurchasedKWh, monthlyEnergyCost, monthlyPowerCost, monthlyOmCost,
    monthlyRevenue, monthlyNet,
    paybackMonths, paybackYears,
    lccYears, lccEnergyCost, lccPowerCost, lccOmCost, lccTotal, lccRevenue, lccNet, lcoe,
  } = economics;
  const fmtKr = (kr) => kr >= 1_000_000
    ? `${C.fmt(kr / 1_000_000, { digits: 1 })} Mkr`
    : `${C.fmt(kr / 1000, { digits: 0 })} kkr`;
  // LCC-blockets poster måste dela enhet med sin egen total, annars ser de ut
  // att inte summera: 100 kkr + 3 Mkr + 634 kkr + 30 kkr mot "Total 3,7 Mkr"
  // är rätt räknat men läses som ett räknefel (213 av 2 160 svepta fall).
  // Enheten väljs EN gång, av totalen, och gäller hela kolumnen.
  const lccMkr = lccTotal >= 1_000_000;
  const fmtLcc = (kr) => lccMkr
    ? `${C.fmt(kr / 1_000_000, { digits: 2 })} Mkr`
    : `${C.fmt(kr / 1000, { digits: 0 })} kkr`;
  const hasRevenue = monthlyRevenue > 0;
  // Bygger kalkylen på mer energi per laddtillfälle än bilen rymmer? Då är
  // intäkten — och därmed paybacken och LCoE:n — för hög, inte bara räckvidden.
  const överBatteri = car && car.battery > 0 && perSessionKWh > car.battery;
  // Levererad OCH inköpt volym. Med bara den levererade gick raderna inte att
  // kontrollräkna: 6 313 kWh och 16 614 kr ger 2,63 kr/kWh mot de 2,50
  // användaren angett, och differensen (systemförlusterna) syntes ingenstans.
  // PDF:en skriver ut båda sedan v3.8; skärmen gjorde det inte.
  const visaInkopt = monthlyPurchasedKWh > monthlyEnergyKWh + 0.5;
  const rows = [
    ['Energi / månad · levererat', `${C.fmt(monthlyEnergyKWh, { digits: 0 })} kWh`],
    ...(visaInkopt ? [['Energi / månad · inköpt', `${C.fmt(monthlyPurchasedKWh, { digits: 0 })} kWh`]] : []),
    ['Energikostnad / månad', `${C.fmt(monthlyEnergyCost, { digits: 0 })} kr`],
    ...(monthlyPowerCost > 0 ? [['Effektavgift / månad', `${C.fmt(monthlyPowerCost, { digits: 0 })} kr`]] : []),
    ...(monthlyOmCost > 0 ? [['Drift & underhåll / mån', `${C.fmt(monthlyOmCost, { digits: 0 })} kr`]] : []),
    ...(hasRevenue ? [
      ['Intäkt / månad',  `${C.fmt(monthlyRevenue, { digits: 0 })} kr`],
      ['Netto / månad',   `${monthlyNet >= 0 ? '+' : ''}${C.fmt(monthlyNet, { digits: 0 })} kr`],
    ] : []),
  ];
  return (
    <div style={{ border: `1px solid ${I.line}`, borderRadius: 2, background: I.surface, overflow: 'hidden' }}>
      {/* Capital cost header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${I.line}` }}>
        <div style={{ fontSize: 11, color: I.mute, marginBottom: 4 }}>Investeringskostnad</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{
            fontFamily: I.serif, fontSize: 42, fontWeight: 500,
            letterSpacing: -1, color: I.ink, lineHeight: 1,
          }}>
            {capitalCost >= 1_000_000 ? C.fmt(capitalCost / 1_000_000, { digits: 1 }) : C.fmt(capitalCost / 1000, { digits: 0 })}
          </div>
          <div style={{ fontSize: 16, color: I.mute, fontFamily: I.mono }}>{capitalCost >= 1_000_000 ? 'Mkr' : 'kkr'}</div>
        </div>
        <div style={{ fontSize: 11, color: I.mute, marginTop: 4 }}>
          {hubCapital >= 1_000_000 ? `${C.fmt(hubCapital / 1_000_000, { digits: 1 })} Mkr` : `${C.fmt(hubCapital / 1000, { digits: 0 })} kkr`} material
          {outletCapital > 0 && ` + ${outletCapital >= 1_000_000 ? `${C.fmt(outletCapital / 1_000_000, { digits: 1 })} Mkr` : `${C.fmt(outletCapital / 1000, { digits: 0 })} kkr`} installation`}
        </div>
        {investmentGrant > 0 && (
          <div style={{ fontSize: 11, color: I.forest, marginTop: 3, fontWeight: 600 }}>
            − {fmtKr(investmentGrant)} investeringsstöd → netto {fmtKr(netCapitalCost)}
          </div>
        )}
      </div>
      {/* Står FÖRE talen, inte efter: varningen kvalificerar allt under sig.
          Hjälterutan varnar för räckvidden; här är poängen att intäkten och
          därmed återbetalningstiden bygger på samma omöjliga mängd. */}
      {överBatteri && (
        <div style={{
          padding: '9px 16px', background: I.accentWash,
          borderBottom: `1px solid ${I.line}`, borderLeft: `3px solid ${I.accent}`,
          fontSize: 10.5, lineHeight: 1.45, color: I.ink2,
        }}>
          ⚠ <strong>Kalkylen bygger på {C.fmt(perSessionKWh, { digits: 0 })} kWh per laddtillfälle</strong>
          {' '}— mer än {car.name}s batteri på {C.fmt(car.battery, { digits: 0 })} kWh.
          {hasRevenue
            ? ' Intäkten och återbetalningstiden nedan är därför för optimistiska.'
            : ' Energimängden nedan är därför för hög.'}
          {' '}Ange <strong>energibehov per bil</strong> för ett realistiskt tal.
        </div>
      )}
      {STARTAD_FRAN_LANK && (
        <div style={{
          padding: '8px 16px', background: I.bg,
          borderBottom: `1px solid ${I.line}`,
          fontSize: 10, lineHeight: 1.45, color: I.mute,
        }}>
          Sidan öppnades från en delad länk. Anläggningsdata följde med, men
          <strong> investering, drift och stöd är dina egna</strong> — de delas inte
          i länken. Kontrollera dem innan du läser återbetalningstiden.
        </div>
      )}
      {/* Monthly cashflow */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, padding: '6px 0',
            borderBottom: `1px solid ${I.lineSoft}`,
          }}>
            <span style={{ color: I.mute }}>{k}</span>
            <span style={{ fontFamily: I.mono, color: I.ink, fontFeatureSettings: '"tnum"' }}>{v}</span>
          </div>
        ))}
        {/* Grönt betyder "betalar sig inom den horisont vi räknar på". En
            payback som överstiger LCC-horisonten är inte ett positivt besked:
            rutan direkt nedanför visar då en NETTOFÖRLUST över samma tio år,
            och en anläggning som betalar sig på 16 år har hunnit nå sin
            tekniska livslängd innan dess. Utan den här gränsen renderades
            5 742 år i exakt samma gröna ruta som 1,8 år (granskningsfynd A2). */}
        {paybackYears != null && (() => {
          const överHorisont = paybackYears > lccYears;
          const färg = överHorisont ? I.accentDeep : I.forest;
          return (
            <div style={{
              marginTop: 10, padding: '10px 14px',
              background: överHorisont ? I.accentWash : I.forestWash,
              borderLeft: `3px solid ${överHorisont ? I.accent : I.forestSoft}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 11, color: färg }}>Enkel återbetalningstid<br/>
                <span style={{ fontSize: 9.5, opacity: 0.8 }}>
                  {överHorisont
                    ? `längre än kalkylens ${lccYears} år — se livscykelkostnaden nedan`
                    : 'odiskonterad · priser exkl. moms'}
                </span></span>
              <span style={{ fontFamily: I.serif, fontSize: 24, fontWeight: 500, color: färg, letterSpacing: -0.5, whiteSpace: 'nowrap' }}>
                {paybackMonths <= 0.5
                  ? 'direkt'
                  : (paybackYears < 1
                    ? `${Math.round(paybackMonths)} mån`
                    : `${C.fmt(paybackYears, { digits: paybackYears >= 100 ? 0 : 1 })} år`)}
              </span>
            </div>
          );
        })()}
        {paybackYears == null && (
          <div style={{ fontSize: 11, color: I.mute, fontStyle: 'italic', marginTop: 8, padding: '6px 0' }}>
            {hasRevenue
              ? 'Investering återbetalar sig ej med nuvarande inställningar.'
              : 'Ange en laddavgift (kr/kWh) för att beräkna återbetalningstid.'}
          </div>
        )}

        {/* Livscykelkostnad. Odiskonterad, som paybacken ovan — att blanda ett
            nuvärdesberäknat tal med en odiskonterad payback i samma ruta vore
            att visa två siffror som ser jämförbara ut men inte är det.
            LCoE är talet att hålla mot ett laddoperatörsavtal: vad varje
            levererad kWh kostar när investeringen slås ut över perioden. */}
        {lccTotal > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${I.line}` }}>
            <div style={{
              fontFamily: I.mono, fontSize: 9.5, letterSpacing: 1,
              textTransform: 'uppercase', color: I.mute, marginBottom: 8,
            }}>
              Livscykelkostnad {lccYears} år
            </div>
            {[
              ['Investering', fmtLcc(netCapitalCost)],
              ['Energi', fmtLcc(lccEnergyCost)],
              ...(lccPowerCost > 0 ? [['Effektavgift', fmtLcc(lccPowerCost)]] : []),
              ...(lccOmCost > 0 ? [['Drift & underhåll', fmtLcc(lccOmCost)]] : []),
            ].map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, padding: '5px 0', borderBottom: `1px solid ${I.lineSoft}`,
              }}>
                <span style={{ color: I.mute }}>{k}</span>
                <span style={{ fontFamily: I.mono, color: I.ink, fontFeatureSettings: '"tnum"' }}>{v}</span>
              </div>
            ))}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '8px 0 4px', fontSize: 12, fontWeight: 600,
            }}>
              <span style={{ color: I.ink }}>Total kostnad {lccYears} år</span>
              <span style={{ fontFamily: I.mono, color: I.ink, fontFeatureSettings: '"tnum"' }}>{fmtLcc(lccTotal)}</span>
            </div>
            {hasRevenue && (
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, padding: '5px 0', borderTop: `1px solid ${I.lineSoft}`,
              }}>
                <span style={{ color: I.mute }}>− laddintäkter · netto</span>
                <span style={{ fontFamily: I.mono, color: lccNet <= 0 ? I.forest : I.ink, fontFeatureSettings: '"tnum"' }}>
                  {lccNet <= 0 ? '+' : ''}{fmtLcc(Math.abs(lccNet))}
                </span>
              </div>
            )}
            {lcoe != null && (
              <div style={{
                marginTop: 10, padding: '10px 14px',
                background: I.accentWash, borderLeft: `3px solid ${I.accent}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, color: I.ink2 }}>Kostnad per levererad kWh<br/>
                  <span style={{ fontSize: 9.5, color: I.mute }}>investering utslagen över {lccYears} år · exkl. moms</span></span>
                <span style={{ fontFamily: I.serif, fontSize: 24, fontWeight: 500, color: I.accent, letterSpacing: -0.5 }}>
                  {C.fmt(lcoe, { digits: 2 })} <span style={{ fontSize: 13, fontFamily: I.mono }}>kr/kWh</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${I.line}`, fontSize: 10.5, color: I.mute, lineHeight: 1.65 }}>
      <div style={{ fontFamily: I.mono, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase', fontSize: 10 }}>Modell</div>
      Räckvidd räknas mot verklig förbrukning (EV Database), inte WLTP — ett
      mer återhållsamt tal. Av bilarna som står på en plats en viss timme
      antas en andel 1/parkeringstiden ha anlänt just då; ankomsterna faltas
      med parkeringstidsfönstret, skalat mot vald topp-beläggning.
      Effekten fördelas som i Amp5:s lastbalansering: startström i
      prioritetsordning tills kapaciteten är slut, resten köar — inget fordon
      laddar under 6 A, och en SmartHub kör max 30 simultana sessioner.
      Ankomsterna räknas som en jämn ström. Verkliga ankomster är ojämnare, och
      vid låg beläggning — när antalet närvarande bilar tidvis understiger det
      antal som ryms på effekten — ger det något mindre energi än modellen visar.
      Vintertid räkna 20–40 % högre energiåtgång.
      <div style={{ fontFamily: I.mono, fontSize: 9.5, letterSpacing: 0.5, marginTop: 10, color: I.mute }}>
        Amp5 Laddkalkylator · v{APP_VERSION}
      </div>
    </div>
  );
}

// ───────── Compare panel ─────────
function ComparePanel({ mode, setMode, scenarios, setScenarios, car, carId, setCarId,
                        carAcLimit, setCarAcLimit, efficiency, setEfficiency,
                        sessionNeedKWh, setSessionNeedKWh, strategy,
                        fuseSizeA, existingLoadPct, electricityPrice, chargingFee, powerTariff,
                        activeDaysPerMonth, projectName, setProjectName, onExportPdf }) {
  const C = window.Amp5Calc;
  const [exporting, setExporting] = React.useState(false);

  const { computed, maxKWh } = React.useMemo(() => {
    const rows = scenarios.map((s) => {
      const profile = C.PROFILES[s.profileKey];
      const e = C.computeEnergy({
        outlets: s.outlets, hubs: s.hubs, capPerHub: s.capPerHub, systemCap: s.systemCap,
        parkingHours: s.parkingHours, profileHours: profile.hours,
        peakOccupancyPct: s.peakOcc,
        hwLimitKW: carAcLimit, efficiency, sessionNeedKWh, strategy,
        profileLabel: profile.label,
      });
      // Elnätet och driftkostnaden saknades HELT i jämförelseläget — det läge
      // som finns för att välja mellan alternativ visade bara kWh och räckvidd.
      // Servis och elpris är fastighetens, alltså gemensamma för scenarierna;
      // det som skiljer är lasten de orsakar.
      const grid = C.computeGridAssessment({
        fuseSizeA, existingLoadPct, systemPeakKW: e.peakPowerKW,
        capPerHub: s.capPerHub, installedHubs: e.hubs,
        installedCapKW: e.effectiveCap,
      });
      // INVESTERINGEN utelämnas medvetet: material och installation är
      // klumpbelopp för hela projektet och går inte att fördela per scenario
      // utan att gissa ett pris per hub. Driften går däremot att räkna exakt.
      // Samma funktion som huvudläget, med investeringen nollad.
      //
      // Laddavgiften är däremot INTE ett medvetet bortval — den hårdkodades
      // till 0, vilket lämnade korten med bara kostnad. Eftersom kostnaden
      // växer med anläggningens storlek rangordnade jämförelseläget
      // alternativen omvänt mot lönsamheten (granskningsfynd A1).
      const ek = C.computeEconomics({
        totalEnergyDay: e.totalEnergyDay, gridEnergyDay: e.totalEnergyFromGrid,
        materialCost: 0, installationCost: 0, investmentGrant: 0,
        electricityPrice, chargingFee, powerTariff,
        peakPowerKW: e.peakPowerKW, omPctYear: 0,
        // Samma dagräkning som huvudläget (granskningsfynd M2) — annars kunde
        // skärmens två lägen visa månadskostnader 42,9 % isär för samma anläggning.
        daysPerMonth: activeDaysPerMonth ?? profile.daysPerMonth ?? 30,
      });
      return {
        scenario: s, energy: e, profile, grid, ek,
        rangeKm: C.rangeKm(e.perOutletKWh, car.kwh100),
      };
    });
    return { computed: rows, maxKWh: Math.max(...rows.map((r) => r.energy.perOutletKWh), 1) };
  }, [scenarios, carId, carAcLimit, efficiency, sessionNeedKWh, strategy,
      fuseSizeA, existingLoadPct, electricityPrice, chargingFee, powerTariff, activeDaysPerMonth]);

  const updateScenario = (i, patch) => {
    setScenarios((arr) => arr.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  };
  const addScenario = () => {
    if (scenarios.length >= MAX_SCENARIOS) return;
    setScenarios((arr) => {
      // Välj första lediga namnet (inte arr.length) så add/remove inte ger dubbletter.
      const used = new Set(arr.map((s) => s.name));
      const name = SCENARIO_NAMES.find((n) => !used.has(n)) || SCENARIO_NAMES[arr.length];
      // Välj första lediga färg-slot så färgerna aldrig krockar efter add/remove.
      const usedSlots = new Set(arr.map((s) => s.colorSlot));
      let slot = 0;
      while (usedSlots.has(slot)) slot++;
      return [...arr, defaultScenario(name, slot)];
    });
  };
  const removeScenario = (i) => {
    if (scenarios.length <= 1) return;
    setScenarios((arr) => arr.filter((_, j) => j !== i));
  };

  const handleExport = async () => {
    setExporting(true);
    try { await onExportPdf(); }
    finally { setExporting(false); }
  };

  return (
    <div style={{ padding: '32px 48px 48px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={window.Amp5Assets.logo} alt="AmpSociety" style={{ display: 'block', height: 32, width: 'auto' }} />
          <div style={{ height: 4, width: 48, background: I.accent }} />
          <div style={{ fontFamily: I.serif, fontSize: 26, fontWeight: 500, letterSpacing: -0.4, color: I.ink }}>
            Scenariojämförelse
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionBtn onClick={addScenario}>+ Lägg till</ActionBtn>
          <ActionBtn onClick={handleExport} primary>
            {exporting ? 'Genererar…' : 'Spara som PDF'}
          </ActionBtn>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 320, flex: '0 1 360px' }}>
          <ModeSwitch mode={mode} setMode={setMode} />
        </div>
        <CompareGlobalSetting label="Projektnamn">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(sanitizeProjectName(e.target.value))}
            placeholder="valfritt · visas i PDF"
            maxLength={80}
            style={{
              background: 'transparent', border: 'none', borderBottom: `1px solid ${I.line}`,
              padding: '4px 0', fontFamily: I.sans, fontSize: 13, color: I.ink,
              outline: 'none', minWidth: 180,
            }}
          />
        </CompareGlobalSetting>
        <CompareGlobalSetting label="Räckvidd för">
          <select value={carId} onChange={(e) => setCarId(e.target.value)} style={compareSelectStyle}>
            {C.CARS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </CompareGlobalSetting>
        <CompareGlobalSetting label="Bilens AC-tak">
          <select value={carAcLimit} onChange={(e) => setCarAcLimit(Number(e.target.value))} style={compareSelectStyle}>
            <option value={3.7}>3,7 kW (1-fas 16 A)</option>
            <option value={7.4}>7,4 kW (1-fas 32 A)</option>
            <option value={11}>11 kW (3-fas 16 A)</option>
            <option value={22}>22 kW (3-fas 32 A)</option>
          </select>
        </CompareGlobalSetting>
        <CompareGlobalSetting label="Energibehov / bil">
          <input type="number" min={1} max={200}
            value={sessionNeedKWh == null ? '' : sessionNeedKWh}
            placeholder="obegränsat"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') { setSessionNeedKWh(null); return; }
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              // ≤ 0 = obegränsat (calc:s tolkning) — visa placeholdern i stället för '0'
              setSessionNeedKWh(n <= 0 ? null : Math.min(200, n));
            }}
            style={{ ...compareSelectStyle, width: 90, fontFamily: I.mono, textAlign: 'right' }} />
          <span style={{ fontSize: 11, color: I.mute }}>kWh / laddtillfälle</span>
        </CompareGlobalSetting>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16,
      }}>
        {computed.map((c, i) => (
          <ScenarioCard
            key={c.scenario.cid}
            color={C.SCENARIO_PALETTE[c.scenario.colorSlot % C.SCENARIO_PALETTE.length]}
            scenario={c.scenario}
            energy={c.energy}
            rangeKm={c.rangeKm}
            grid={c.grid}
            ek={c.ek}
            car={car}
            canRemove={scenarios.length > 1}
            onChange={(patch) => updateScenario(i, patch)}
            onRemove={() => removeScenario(i)}
          />
        ))}
      </div>

      {scenarios.length > 1 && (
        <ComparisonStrip computed={computed} maxKWh={maxKWh} />
      )}
    </div>
  );
}

function ComparisonStrip({ computed, maxKWh }) {
  const C = window.Amp5Calc;
  return (
    <div style={{
      marginTop: 28, padding: '20px 24px',
      background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2,
    }}>
      <div style={{
        fontFamily: I.mono, fontSize: 10, letterSpacing: 1.6,
        color: I.mute, textTransform: 'uppercase', marginBottom: 14,
      }}>Relativ jämförelse · kWh per uttag</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {computed.map((c, i) => {
          const color = C.SCENARIO_PALETTE[c.scenario.colorSlot % C.SCENARIO_PALETTE.length];
          const pct = (c.energy.perOutletKWh / maxKWh) * 100;
          return (
            <div key={c.scenario.cid} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 88px', alignItems: 'center', gap: 12 }}>
              <span style={{ fontFamily: I.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.scenario.name}
              </span>
              <div style={{ height: 8, background: I.line, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .2s' }} />
              </div>
              <span style={{ fontFamily: I.mono, fontSize: 12, color: I.ink, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                {C.fmt(c.energy.perOutletKWh, { digits: 1 })} kWh
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioCard({ color, scenario, energy, rangeKm, grid, ek, car, canRemove, onChange, onRemove }) {
  const C = window.Amp5Calc;
  const s = scenario;
  const isLimited = energy.effectiveCap < energy.installedCap;
  const GRID_TEXT = { ok: 'Räcker', marginal: 'Knapp marginal', upgrade: 'Servisutökning' };

  return (
    <div style={{
      background: I.surface, border: `1px solid ${I.line}`,
      borderTop: `3px solid ${color}`, borderRadius: 2,
      padding: '14px 14px 16px', position: 'relative',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <input value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={24}
          style={{
            border: 'none', background: 'transparent', color,
            fontFamily: I.mono, fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1.2, padding: 0,
            outline: 'none', flex: 1, minWidth: 0,
          }} />
        {canRemove && (
          <button onClick={onRemove} aria-label="Ta bort scenario"
            style={{
              border: `1px solid ${I.line}`, background: 'transparent', color: I.mute,
              width: 22, height: 22, borderRadius: 11, cursor: 'pointer',
              fontSize: 14, lineHeight: 1, padding: 0,
            }}>×</button>
        )}
      </div>

      <NumberField compact label="Uttag" value={s.outlets}
        onChange={(v) => onChange({ outlets: v })} min={1} max={500} />
      {/* Samma 54-uttag/hub-kontroll som huvudpanelen har. Den saknades här, så
          ett scenario kunde sättas till färre hubbar än uttagen fysiskt kräver
          och jämföras rakt av mot ett giltigt scenario. */}
      <NumberField compact label="SmartHubs" value={s.hubs} placeholder={`auto (${energy.autoHubs})`}
        onChange={(v) => onChange({ hubs: v })} min={1} max={20} optional
        hint={s.hubs != null && s.hubs * C.OUTLETS_PER_HUB < s.outlets
          ? `⚠ kräver minst ${Math.ceil(s.outlets / C.OUTLETS_PER_HUB)} hubbar`
          : null} />
      <NumberField compact label="Parkering (h)" value={s.parkingHours}
        onChange={(v) => onChange({ parkingHours: v })} min={1} max={24} />
      <NumberField compact label="kW/hub" value={s.capPerHub}
        onChange={(v) => onChange({ capPerHub: v })} emptyValue={C.CAP_PER_HUB_KW}
        min={10} max={C.CAP_PER_HUB_KW} />
      <NumberField compact label="Systemtak (kW)" value={s.systemCap} placeholder="obegränsat"
        onChange={(v) => onChange({ systemCap: v })} min={1} max={10000} optional />

      <div>
        <div style={{ fontSize: 10, color: I.mute, marginBottom: 4 }}>Profil</div>
        <select value={s.profileKey}
          onChange={(e) => onChange({ profileKey: e.target.value })}
          style={{
            width: '100%', background: I.bg, border: `1px solid ${I.line}`,
            padding: '6px 8px', fontFamily: I.sans, fontSize: 12,
            color: I.ink, borderRadius: 2,
          }}>
          {Object.entries(C.PROFILES).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: I.mute, marginBottom: 4 }}>
          <span>Topp-beläggning</span><span>{Math.round(s.peakOcc * 100)}%</span>
        </div>
        <input type="range" min={5} max={100} step={5}
          aria-label="Topp-beläggning"
          value={Math.round(s.peakOcc * 100)}
          onChange={(e) => onChange({ peakOcc: Number(e.target.value) / 100 })}
          style={{ width: '100%', accentColor: color }} />
      </div>

      <div style={{ marginTop: 6, paddingTop: 12, borderTop: `1px solid ${I.line}` }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: I.serif, fontSize: 36, fontWeight: 700, color, lineHeight: 1, letterSpacing: -1 }}>
            {C.fmt(energy.perOutletKWh, { digits: 1 })}
          </div>
          <div style={{ fontSize: 10, color: I.mute, marginTop: 2 }}>kWh / uttag</div>
        </div>
        <CardStat label={`Räckvidd`} value={`${C.fmt(rangeKm, { digits: 0 })} km`} />
        <CardStat label="SmartHubs" value={energy.hubs} />
        <CardStat label="Laddningar/uttag·dygn" value={
          energy.sessionsPerOutletPerDay >= 10
            ? C.fmt(energy.sessionsPerOutletPerDay, { digits: 0 })
            : C.fmt(energy.sessionsPerOutletPerDay, { digits: 1 })
        } />
        <CardStat label="kWh/uttag·dygn" value={`${C.fmt(energy.kwhPerOutletPerDay, { digits: 0 })} kWh`} />
        <CardStat label="Installerad" value={`${energy.installedCap} kW`} />
        {isLimited && <CardStat label="Effektiv" value={`${energy.effectiveCap} kW`} warn />}
        <CardStat label="Topp-effekt" value={`${C.fmt(energy.peakPowerKW, { digits: 0 })} kW`} />
        <CardStat label="Total energi/dygn" value={`${C.fmt(energy.totalEnergyDay, { digits: 0 })} kWh`} />

        {/* Elnät och drift. Saknades helt i jämförelseläget, alltså i just det
            läge som finns för att VÄLJA mellan alternativ. Investeringen är
            utelämnad med flit — material och installation är klumpbelopp för
            hela projektet och går inte att fördela per scenario. */}
        {grid && (
          <CardStat
            label="Elnät"
            value={`${GRID_TEXT[grid.status] || grid.status} · ${grid.surplusKW >= 0 ? '+' : ''}${C.fmt(grid.surplusKW, { digits: 0 })} kW`}
            warn={grid.status !== 'ok'} />
        )}
        {/* Dagräkningen MÅSTE stå på kortet. Den följer scenariots egen profil
            (kontor 21 arbetsdagar, övriga 30), så två kort kan visa
            månadskostnader 62 % isär för identisk hårdvara — och hela den
            skillnaden är kalendern. Appens egna defaultscenarier (A kontor,
            B köpcentrum) utlöser det (granskningsfynd A3). */}
        {ek && ek.monthlyEnergyCost > 0 && (
          <CardStat label="Aktiva dagar/mån" value={`${C.fmt(ek.daysPerMonth, { digits: 0 })} dgr`} />
        )}
        {ek && ek.monthlyEnergyCost > 0 && (
          <CardStat label="Energikostnad/mån" value={`${C.fmt(ek.monthlyEnergyCost, { digits: 0 })} kr`} />
        )}
        {ek && ek.monthlyPowerCost > 0 && (
          <CardStat label="Effektavgift/mån" value={`${C.fmt(ek.monthlyPowerCost, { digits: 0 })} kr`} />
        )}
        {/* Driftnetto = laddintäkt − el − effektavgift. Investeringen ingår
            inte (se ovan), så detta är inte ett resultat utan det överskott
            driften ger. Utan den här raden rangordnade korten alternativen
            efter kostnad, alltså omvänt mot lönsamheten. */}
        {ek && ek.monthlyRevenue > 0 && (
          <CardStat label="Laddintäkt/mån" value={`${C.fmt(ek.monthlyRevenue, { digits: 0 })} kr`} />
        )}
        {ek && ek.monthlyRevenue > 0 && (
          <CardStat
            label="Driftnetto/mån"
            value={`${ek.monthlyNet >= 0 ? '+' : '−'}${C.fmt(Math.abs(ek.monthlyNet), { digits: 0 })} kr`}
            warn={ek.monthlyNet < 0} />
        )}

        {/* Sessionstaket saknades i jämförelseläget medan huvudläget varnade
            för exakt samma konfiguration — kodens eget standardscenario B
            (50 uttag, köpcentrum, 85 %) utlöser det redan. */}
        {(energy.sessionOverflowMax || 0) > 0.5 && (
          <div style={{
            marginTop: 8, padding: '6px 8px',
            background: '#FFEBEE', borderLeft: `3px solid #C62828`,
            fontSize: 10, color: '#5C1A16', lineHeight: 1.4,
          }}>
            ⚠️ {C.fmt(energy.sessionOverflowMax, { digits: 0 })} bilar utan laddsession
            ({C.fmt(energy.maxPresent, { digits: 0 })} närvarande mot taket {energy.sessionCapacity}).
            Kräver {energy.hubsNeededForSessions > 1
              ? `${energy.hubsNeededForSessions} SmartHubs till`
              : 'en SmartHub till'}.
          </div>
        )}
        {/* Batterivarningen fanns i PDFCompare men inte här — säljaren såg
            1 245 km på skärmen och upptäckte problemet först vid export. */}
        {car && car.battery > 0 && energy.perOutletKWh > car.battery && (
          <div style={{
            marginTop: 8, padding: '6px 8px',
            background: I.accentWash, borderLeft: `3px solid ${I.accent}`,
            fontSize: 10, color: I.ink2, lineHeight: 1.4,
          }}>
            ⚠️ Över {car.name}s batteri ({C.fmt(car.battery, { digits: 0 })} kWh).
            Bilen kan inte ta emot hela mängden — ange energibehov per bil.
          </div>
        )}
      </div>
    </div>
  );
}

function CardStat({ label, value, warn }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      fontSize: 11, padding: '3px 0',
      borderBottom: `1px solid ${I.line}`,
    }}>
      <span style={{ color: I.mute }}>{label}</span>
      <span style={{ color: warn ? I.accent : I.ink, fontFamily: I.mono, fontFeatureSettings: '"tnum"' }}>{value}</span>
    </div>
  );
}

// ───────── Right panel ─────────
function RightPanel({ mode, energy, sizing, chartEnergy, heroKWh, heroRange, profile, peakOcc, car, carId, setCarId, parkingHours, outlets, capPerHub, systemCap, occPct, desiredKWh, profileKey, carAcLimit, efficiency, sessionNeedKWh, strategy, gridAssessment, economics, perCarPeakKW, uiMode, powerTariff, omPctYear, existingLoadPct, onExportPdf }) {
  const C = window.Amp5Calc;
  const [exporting, setExporting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [linkCopied, setLinkCopied] = React.useState(false);

  const handleExport = async () => {
    setExporting(true);
    try { await onExportPdf(); }
    finally { setExporting(false); }
  };

  // URL-hashen hålls alltid aktuell av autospar-effekten — adressen ÄR kalkylen.
  const handleShareLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    }).catch(() => {});
  };

  const handleCopy = () => {
    const kWh = mode === 'energy'
      ? `${C.fmt(energy.perOutletKWh, { digits: 1 })} kWh/uttag · ${C.fmt(heroRange, { digits: 0 })} km räckvidd`
      : `${sizing.hubs} SmartHubs · ${C.fmt(sizing.deliveredEnergyPerOutlet, { digits: 1 })} kWh/uttag`;
    navigator.clipboard?.writeText(kWh).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div className="iv-right" style={{ padding: '32px 48px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ fontFamily: I.mono, fontSize: 10, letterSpacing: 1.6, color: I.mute, textTransform: 'uppercase' }}>
          Resultat · {mode === 'energy' ? 'Energi per uttag' : 'SmartHub-dimensionering'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionBtn onClick={handleShareLink}>{linkCopied ? '✓ Länk kopierad' : 'Dela länk'}</ActionBtn>
          <ActionBtn onClick={handleCopy}>{copied ? '✓ Kopierat' : 'Kopiera'}</ActionBtn>
          <ActionBtn onClick={handleExport} primary>
            {exporting ? 'Genererar…' : 'Spara som PDF'}
          </ActionBtn>
        </div>
      </div>

      <Hero mode={mode} kWh={heroKWh} rangeKm={heroRange} car={car} carId={carId} setCarId={setCarId}
            energy={energy} sizing={sizing} peakOcc={peakOcc} />

      <Divider />

      <div className="iv-results-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 32, marginTop: 32 }}>
        <div>
          <SectionTitle title="Effektprofil" hint="Timvis last över dygnet (kW)" />
          <HourlyChart energy={chartEnergy} />
        </div>
        <div>
          <SectionTitle title="Nyckeltal" />
          <StatList mode={mode} energy={energy} sizing={sizing} chartEnergy={chartEnergy} />
        </div>
      </div>

      <Divider />

      <div style={{ marginTop: 32 }}>
        <SectionTitle title="Känslighet" hint={mode === 'energy'
          ? 'kWh per uttag vid olika parkeringstider'
          : 'Antal SmartHubs vid olika energimål'} />
        <SensitivityChart
          mode={mode} energy={energy} sizing={sizing}
          parkingHours={parkingHours}
          outlets={outlets} capPerHub={capPerHub} systemCap={systemCap}
          occPct={occPct} peakOcc={peakOcc} desiredKWh={desiredKWh}
          profile={profile}
          carAcLimit={carAcLimit} efficiency={efficiency}
          sessionNeedKWh={sessionNeedKWh} strategy={strategy}
          gridAssessment={gridAssessment}
        />
      </div>

      <Divider />

      <div style={{ marginTop: 32 }}>
        <SectionTitle title="Elnätsbedömning" hint="3-fas 400 V · serviskapacitet vs laddningsbehov" />
        <GridAssessment assessment={gridAssessment}
          hubHint={mode === 'hubs' && sizing.effectiveCap > 100}
          perCarPeakKW={perCarPeakKW} carAcLimit={carAcLimit} carKwh100={car.kwh100}
          queue={chartEnergy}
          needMet={!!chartEnergy.needLimited} />
      </div>

      <Divider />

      <div style={{ marginTop: 32, paddingBottom: 16 }}>
        <SectionTitle title="Investeringskalkyl" hint="Kostnad och återbetalningstid" />
        <EconomicsPanel economics={economics} car={car} perSessionKWh={chartEnergy.perOutletKWh} />
        {uiMode === 'simple' && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            fontSize: 10.5, color: I.mute, lineHeight: 1.5,
            background: I.surface, border: `1px solid ${I.lineSoft}`, borderRadius: 2,
          }}>
            Antaganden (ändras i Avancerat): effekttariff {C.fmt(powerTariff, { digits: 0 })} kr/kW/mån ·
            drift &amp; underhåll {C.fmt(omPctYear, { digits: 0 })} %/år ·
            befintlig last {C.fmt(Math.round(existingLoadPct * 100), { digits: 0 })} % ·
            aktiva dagar {C.fmt(economics.daysPerMonth, { digits: 0 })}/mån.
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ children, onClick, primary }) {
  const [hover, setHover] = React.useState(false);
  const base = primary ? {
    background: I.ink, border: `1px solid ${I.ink}`, color: '#fff',
  } : {
    background: 'transparent', border: `1px solid ${I.line}`, color: I.ink2,
  };
  const hoverStyle = hover ? {
    background: I.accent, border: `1px solid ${I.accent}`, color: '#fff',
  } : {};
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        ...base, ...hoverStyle,
        padding: '8px 14px', borderRadius: 2, fontFamily: I.mono, fontSize: 11,
        letterSpacing: 1.2, textTransform: 'uppercase', cursor: 'pointer',
        transition: 'background 120ms, border-color 120ms, color 120ms',
      }}>{children}</button>
  );
}

function Hero({ mode, kWh, rangeKm, car, carId, setCarId, energy, sizing, peakOcc }) {
  const C = window.Amp5Calc;
  const primaryLabel = mode === 'energy' ? 'kWh per uttag' : 'SmartHubs krävs';
  const primaryValue = mode === 'energy'
    ? <><span>{C.fmt(kWh, { digits: 1 })}</span></>
    : <><span>{sizing.hubs}</span></>;
  // P1-fix: LIMIT_SUB och LIMIT_WARNINGS är nu modulnivåkonstanter (se ovan)
  const perHubKW = energy.hubs ? Math.round(energy.installedCap / energy.hubs) : C.CAP_PER_HUB_KW;
  const primarySub = mode === 'energy'
    ? `${energy.hubs} × ${perHubKW} kW · ${energy.profileLabel || 'Profil'} · faktisk topp ${Math.round((energy.peakOccupancyPct ?? peakOcc) * 100)} % beläggning${energy.needLimited ? ' · behovet uppfylls' : ''}`
    : sizing.achievesTarget
        ? (sizing.headroomKWh > 0.1 ? 'når energimålet · marginal finns' : 'når energimålet · ingen marginal')
        : ((sizing.limitReasons && sizing.limitReasons.length
            ? sizing.limitReasons.map((r) => LIMIT_SUB[r]).filter(Boolean).join(' · ')
            : LIMIT_SUB[sizing.limitReason]) || 'ej uppnåeligt med vald konfiguration');

  // Alla bindande orsaker, inte bara den primära. computeHubs vet om både
  // fastighetstaket och bilens AC-tak binder samtidigt; visas bara den ena får
  // säljaren ett råd som inte räcker hela vägen (granskningsfynd G11).
  const warning = mode === 'hubs' && !sizing.achievesTarget
    ? ((sizing.limitReasons && sizing.limitReasons.length
        ? sizing.limitReasons.map((r) => LIMIT_WARNINGS[r]).filter(Boolean)
        : [LIMIT_WARNINGS[sizing.limitReason] || LIMIT_WARNINGS[C.LIMIT_REASON.HW_CONFIG]]
      ).join(' '))
    : null;

  // Överstiger energin per laddtillfälle den valda bilens batteri? Gäller båda
  // lägena — hubs-läget visar deliveredEnergyPerOutlet i samma ruta.
  const batteriTak = (car && car.battery > 0 && kWh > car.battery) ? car.battery : null;

  return (
    <div className="iv-hero" style={{
      display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 40,
      alignItems: 'end', paddingBottom: 8,
    }}>
      <div>
        <div style={{ fontSize: 13, color: I.mute, marginBottom: 6 }}>{primaryLabel}</div>
        <div className="iv-hero-number" style={{
          fontFamily: I.serif, fontSize: 156, fontWeight: 500, lineHeight: 0.9,
          letterSpacing: -4, color: I.ink, fontFeatureSettings: '"tnum"',
          display: 'flex', alignItems: 'baseline', gap: 12,
        }}>
          {primaryValue}
          <span style={{ fontSize: 28, fontWeight: 400, color: I.mute, letterSpacing: -0.5 }}>
            {mode === 'energy' ? 'kWh' : `×${sizing.hubs ? Math.round(sizing.installedCap / sizing.hubs) : C.CAP_PER_HUB_KW} kW`}
          </span>
        </div>
        <div style={{ fontSize: 13, color: warning ? I.accentDeep : I.mute, marginTop: 6, fontFamily: I.mono }}>
          {primarySub}
        </div>
        {warning && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: I.accentWash, borderLeft: `3px solid ${I.accent}`,
            fontSize: 12, color: I.ink, lineHeight: 1.5,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{
              fontFamily: I.mono, fontWeight: 700, color: I.accentDeep, fontSize: 10,
              letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 2,
            }}>OBS</span>
            <span>{warning}</span>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: I.mute, marginTop: 14, lineHeight: 1.55, maxWidth: 460 }}>
          Beräkningen antar verklig förbrukning vid normal körning, inte WLTP. Vintertid räkna 20–40 % högre energiåtgång per km.
        </div>
      </div>

      <div style={{
        border: `1px solid ${I.line}`, padding: '20px 24px', borderRadius: 2,
        background: I.surface,
      }}>
        <div style={{ fontFamily: I.mono, fontSize: 10, letterSpacing: 1.5, color: I.mute, textTransform: 'uppercase', marginBottom: 10 }}>
          Vad räcker det till?
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <div style={{ fontFamily: I.serif, fontSize: 56, fontWeight: 500, letterSpacing: -1.5, fontFeatureSettings: '"tnum"', color: I.accent }}>
            {C.fmt(rangeKm, { digits: 0 })}
          </div>
          <div style={{ fontSize: 16, color: I.mute }}>km</div>
        </div>
        <select value={carId} onChange={(e) => setCarId(e.target.value)}
          style={{
            width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${I.line}`,
            padding: '6px 0', fontFamily: I.sans, fontSize: 12, color: I.ink2, cursor: 'pointer',
            fontWeight: 500, outline: 'none',
          }}>
          {C.CARS.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.kwh100} kWh/100km</option>)}
        </select>
        {/* Rimlighetstak. Utan angivet energibehov laddar modellen så länge
            bilen står — korrekt om ANLÄGGNINGEN (hubbarna går verkligen på sitt
            tak), men påståendet om BILEN blir omöjligt: 148 kWh per session och
            922 km räckvidd för en bil som går 600 km på fullt batteri.
            Beräkningen rörs inte; talet flaggas bara som ogenomförbart, och
            åtgärden (ange ett energibehov) står i rutan. */}
        {batteriTak != null && (
          <div style={{
            marginTop: 12, padding: '9px 11px', borderRadius: 2,
            background: I.accentWash, borderLeft: `3px solid ${I.accent}`,
            fontSize: 10.5, lineHeight: 1.45, color: I.ink2,
          }}>
            ⚠ <strong>Mer än bilen rymmer.</strong> {C.fmt(kWh, { digits: 0 })} kWh per laddtillfälle
            överstiger {car.name}s batteri på {car.battery} kWh — anläggningen kan leverera det,
            men bilen kan inte ta emot det. Ange <strong>energibehov per bil</strong> för ett
            realistiskt tal.
          </div>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: I.line, margin: '32px 0 0' }} />;
}

function SectionTitle({ title, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: I.ink, letterSpacing: -0.2 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: I.mute }}>{hint}</div>}
    </div>
  );
}

// utanEfterfragan — enkla läget. Den okontrollerade efterfrågan är ett
// dimensioneringsbegrepp, inte ett kundbudskap, och den SPRÄNGER skalan: 40
// platser på ett 31 kW-tak ger efterfrågan 367 kW, så y-axeln skalas efter den
// och det anläggningen faktiskt levererar krymper till en strimma längst ned.
// Diagrammet såg då ut att motsäga texten bredvid ("31 kW räcker till 40
// platser"). Avancerat visar fortfarande båda serierna — där är jämförelsen
// hela poängen.
function HourlyChart({ energy, utanEfterfragan }) {
  const C = window.Amp5Calc;
  const cap = energy.effectiveCap;
  // Binder ett angivet effekttak i stället för hubbarnas märkeffekt? Då är
  // "Hub-tak" fel namn på strecket — det är fastighetens/elnätets tak.
  const takEtikett = (energy.installedCap > cap + 0.01) ? 'Effekttak' : 'Hub-tak';
  const demand = utanEfterfragan ? energy.hourly : (energy.hourlyDemand || energy.hourly);
  const yMax = Math.max(utanEfterfragan ? energy.peakPowerKW : energy.peakDemandKW, cap, 1) * 1.05;
  const capPct = (cap / yMax) * 100;
  // Efterfrågestapeln ritas RÖD bara när den kapas, annars grå — men legenden
  // visade alltid rött. I en anläggning med marginal (alltså den vanliga) stod
  // det en röd ruta i förklaringen till staplar som är grå.
  const harKapat = energy.hourly.some((d, i) => (demand[i] ?? 0) > d + 0.01);
  const demandFarg = harKapat ? 'rgba(239,83,80,0.55)' : 'rgba(39,33,32,0.30)';

  return (
    <div style={{ background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2, padding: '16px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14, gap: 16, flexWrap: 'wrap' }}>
        {!utanEfterfragan && <Stat small label="Efterfrågan" value={`${C.fmt(energy.peakDemandKW, {digits: 0})} kW`} />}
        <Stat small label="Levererat" value={`${C.fmt(energy.peakPowerKW, {digits: 0})} kW`} />
        {/* peakReductionKW är golvad på noll i calc. I ~0,6 % av fallen
            överstiger den styrda toppen faktiskt den okontrollerade (kön
            mättar effekttaket, som mest +7,1 %) — då skrev raden "Reduktion
            −0 kW" bredvid en anläggning vars topp STEG. Visa raden bara när
            det finns en reduktion att visa. */}
        {!utanEfterfragan && (energy.peakReductionKW || 0) >= 0.5 && (
          <Stat small label="Reduktion" value={`−${C.fmt(energy.peakReductionKW, {digits: 0})} kW`} />
        )}
        <Stat small label={takEtikett} value={`${C.fmt(cap, {digits: 0})} kW`} />
      </div>
      <div style={{ position: 'relative', height: 160, display: 'flex', alignItems: 'flex-end', gap: 3 }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: `${capPct}%`,
          borderTop: `1px dashed ${I.accent}`, pointerEvents: 'none', zIndex: 2,
        }} />
        {energy.hourly.map((delivered, i) => {
          const dem = demand[i];
          const demH = (dem / yMax) * 100;
          const delH = (delivered / yMax) * 100;
          const clipped = dem > delivered + 0.01;
          return (
            <div key={i} title={`${i}:00 · efterfrågan ${C.fmt(dem, {digits: 0})} kW · levererat ${C.fmt(delivered, {digits: 0})} kW${delivered > dem + 0.5 ? ' · laddning förskjuten hit av effektdelningen' : ''}`}
              style={{ flex: 1, height: '100%', position: 'relative' }}>
              {dem > 0 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0,
                  height: `${demH}%`,
                  background: clipped ? 'rgba(239,83,80,0.22)' : 'rgba(39,33,32,0.10)',
                  borderTop: clipped ? '1px solid rgba(239,83,80,0.55)' : 'none',
                }} />
              )}
              {delivered > 0 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0,
                  height: `${delH}%`, background: I.ink, opacity: 0.9,
                }} />
              )}
            </div>
          );
        })}
      </div>
      {/* Etiketterna låg i en space-between-rad: "00" vid vänsterkanten och
          "24" vid högerkanten, medan stapel i har sitt centrum vid (i+0,5)/24.
          Timmarna hamnade därför en halv stapelbredd fel, och "24" pekade på en
          timme som inte finns (serien är 0–23). Nu delar etiketterna samma
          flex-grid som staplarna, så varje etikett står under sin egen stapel —
          samma timmar som PDF:ens PowerChart använder. */}
      <div style={{ display: 'flex', gap: 3, marginTop: 8, fontFamily: I.mono, fontSize: 10, color: I.mute, letterSpacing: .5 }}>
        {energy.hourly.map((_, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            {[0, 6, 12, 18, 23].includes(i) ? String(i).padStart(2, '0') : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 10, color: I.mute, flexWrap: 'wrap' }}>
        <LegendSwatch color={I.ink} label="SmartHub levererat" />
        {!utanEfterfragan && <LegendSwatch color={demandFarg} label={harKapat ? 'Okontrollerad efterfrågan (kapas)' : 'Okontrollerad efterfrågan'} />}
        <LegendSwatch color={I.accent} dashed label={takEtikett} />
      </div>
    </div>
  );
}

function LegendSwatch({ color, label, dashed }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', width: 14, height: dashed ? 0 : 8,
        background: dashed ? 'transparent' : color,
        borderTop: dashed ? `1px dashed ${color}` : 'none',
      }} />
      {label}
    </span>
  );
}

function Stat({ label, value, small }) {
  return (
    <div>
      <div style={{ fontFamily: I.mono, fontSize: 9, letterSpacing: 1.4, color: I.mute, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: I.sans, fontSize: small ? 18 : 24, fontWeight: 500, color: I.ink, fontFeatureSettings: '"tnum"', letterSpacing: -0.3 }}>{value}</div>
    </div>
  );
}

function StatList({ mode, energy, sizing, chartEnergy }) {
  const C = window.Amp5Calc;
  const fmtSessions = (n) => n >= 10 ? C.fmt(n, { digits: 0 }) : C.fmt(n, { digits: 1 });
  const eng = chartEnergy || energy; // profilbaserad modell (i hubs-läget = grafens)
  const rows = mode === 'energy' ? [
    ['Installerad kapacitet',  `${C.fmt(energy.installedCap, { digits: 0 })} kW`],
    ['Effektiv kapacitet',      `${C.fmt(energy.effectiveCap, { digits: 0 })} kW`],
    ['Topplast / medellast',    `${C.fmt(energy.peakPowerKW, { digits: 0 })} / ${C.fmt(energy.avgPowerKW, { digits: 0 })} kW`],
    ['Aktiva uttag (snitt)',    `${C.fmt(energy.activeOutlets, { digits: 1 })} av ${energy.maxOutlets}`],
    ['Laddar / köar vid beläggningstopp', `${C.fmt(energy.chargingAtPeak, { digits: 0 })} / ${C.fmt(energy.queuedAtPeak, { digits: 0 })} bilar`],
    ['Laddningar / uttag·dygn', fmtSessions(energy.sessionsPerOutletPerDay)],
    ['Totalt laddningar / dygn', fmtSessions(energy.totalSessionsPerDay)],
    ['kWh / uttag·dygn',        `${C.fmt(energy.kwhPerOutletPerDay, { digits: 1 })} kWh`],
    ['Medeleffekt / belagd plats', `${C.fmt(energy.avgPowerPerActive, { digits: 1 })} kW`],
    ['SmartHubs',               `${energy.hubs} × ${energy.hubs ? Math.round(energy.installedCap / energy.hubs) : C.CAP_PER_HUB_KW} kW`],
  ] : [
    ['Installerad kapacitet',  `${C.fmt(sizing.installedCap, { digits: 0 })} kW`],
    ['Effektiv kapacitet',      `${C.fmt(sizing.effectiveCap, { digits: 0 })} kW`],
    ['Effekt som krävs',        `${C.fmt(sizing.powerNeeded, { digits: 0 })} kW`],
    ['Hubs pga uttag',          `${sizing.hubsByOutlets}`],
    ['Hubs pga sessioner',      `${sizing.hubsBySessions}`],
    ['Hubs pga effekt',         `${sizing.hubsByPower}${sizing.hubsByPowerIdeal > sizing.hubsByPower ? ` (idealt ${sizing.hubsByPowerIdeal})` : ''}`],
    // TVÅ MODELLER, TVÅ BLOCK (granskningsfynd A4). Raderna ovan och de två
    // närmast nedan kommer ur computeHubs, som antar KONSTANT beläggning hela
    // dygnet — rätt för dimensionering, medvetet konservativt. Raderna längst
    // ned kommer ur profilmodellen, samma som grafen och investeringskalkylen.
    // Tidigare stod dimensioneringens "Levererat / laddtillfälle" mitt bland
    // profilmodellens rader, och de multiplicerade inte ihop: 12,4 × 0,66 = 8,2
    // medan raden under sa 14,7. De skiljer sig i 37 % av hubs-fallen, värsta
    // 128 %. Nu är varje block internt konsekvent och etiketten säger vilken
    // modell talet kommer ur.
    ['Dimensionerande: levererat / laddtillfälle',
      `${C.fmt(sizing.deliveredEnergyPerOutlet, { digits: 1 })} kWh`],
    // actualEnergyPerOutlet är ett KAPACITETSTAK — vad anläggningen skulle
    // kunna leverera per laddtillfälle, inte vad bilen får. Etiketten
    // "Faktisk kWh / uttag" påstod precis det fältet inte får påstå
    // (granskningsfynd G1, återfallet A4): vid uppnått mål stod det 50,2 kWh
    // medan hjälterutan och PDF:en sa 30,0 kWh levererat. De två talen står nu
    // bredvid varandra med var sin ärlig etikett, så de inte kan förväxlas.
    ['Dimensionerande: kapacitetstak / laddtillfälle',
      sizing.achievesTarget
        ? `${C.fmt(sizing.actualEnergyPerOutlet, { digits: 1 })} kWh · +${C.fmt(sizing.headroomKWh, { digits: 1 })} marginal`
        : `${C.fmt(sizing.actualEnergyPerOutlet, { digits: 1 })} kWh · −${C.fmt(sizing.shortfallKWh, { digits: 1 })} under mål`,
    ],
    // Profilmodellen. De tre raderna går ihop: levererat × laddningar = kWh/dygn.
    ['Laddningar / uttag·dygn', fmtSessions(eng.sessionsPerOutletPerDay)],
    ['Totalt laddningar / dygn', fmtSessions(eng.totalSessionsPerDay)],
    ['Levererat / laddtillfälle', `${C.fmt(eng.perOutletKWh, { digits: 1 })} kWh`],
    ['kWh / uttag·dygn',        `${C.fmt(eng.kwhPerOutletPerDay, { digits: 1 })} kWh`],
  ];
  return (
    <div style={{ border: `1px solid ${I.line}`, borderRadius: 2, background: I.surface }}>
      {mode === 'hubs' && (
        <div style={{ padding: '10px 16px', fontSize: 10.5, color: I.mute, lineHeight: 1.5, borderBottom: `1px solid ${I.line}`, background: I.bg }}>
          Två modeller på samma skärm. <strong>Dimensionerande</strong>-raderna och
          hjälterutans kWh antar värsta fall: full beläggning hela parkerings-
          fönstret, dygnet runt. Det ger ett konservativt hubbantal.
          <strong>Profilmodellens</strong> rader längst ned räknar på den valda
          beläggningsprofilen — samma modell som grafen och investeringskalkylen,
          och därför högre tal när profilen har lugna timmar.
        </div>
      )}
      {rows.map(([k, v], i) => (
        <div key={k} style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          padding: '12px 16px', gap: 12,
          borderTop: i === 0 ? 'none' : `1px solid ${I.line}`,
        }}>
          <div style={{ fontSize: 12, color: I.ink2 }}>{k}</div>
          <div style={{ fontFamily: I.mono, fontSize: 12, color: I.ink, fontFeatureSettings: '"tnum"', textAlign: 'right' }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function SensitivityChart({ mode, energy, sizing, parkingHours, outlets, capPerHub, systemCap, occPct, peakOcc, desiredKWh, profile, carAcLimit, efficiency, sessionNeedKWh, strategy, gridAssessment }) {
  const C = window.Amp5Calc;
  const width = 640, height = 200, pad = { l: 48, r: 16, t: 16, b: 40 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  // Hur många hubbar servisen rymmer utöver de installerade (null = okänt).
  const hubPlats = gridAssessment && Number.isFinite(gridAssessment.hubsHeadroom)
    ? gridAssessment.hubsHeadroom : null;
  const elnatRad = hubPlats == null ? null
    : hubPlats > 0
      ? <> Elnätet rymmer <strong>{hubPlats} hub{hubPlats > 1 ? 'bar' : ''} till</strong> inom nuvarande servis.</>
      : <> Men <strong>nuvarande servis rymmer inga fler hubbar</strong> — en till kräver servisutökning.</>;

  const { points, xLabel, yLabel, highlightX, xTicks, kneeX, kneeNeedBound, powerLimited, needLimited } = React.useMemo(() => {
    if (mode === 'energy') {
      const vals = [];
      for (let h = 1; h <= 24; h++) {
        const e = C.computeEnergy({
          outlets, hubs: energy.hubs, capPerHub, systemCap,
          parkingHours: h, profileHours: profile.hours, peakOccupancyPct: peakOcc,
          hwLimitKW: carAcLimit, efficiency, sessionNeedKWh, strategy,
        });
        vals.push({ x: h, y: e.perOutletKWh });
      }
      // Knäpunkt: första parkeringstid där kurvan nått ~98% av sitt max → planar ut.
      // Om knät ligger före 23h är systemet effektbegränsat (mer tid ger ~ingen energi).
      const yPeak = Math.max(...vals.map((p) => p.y), 0);
      let knee = null;
      if (yPeak > 0) {
        for (const p of vals) { if (p.y >= 0.98 * yPeak) { knee = p.x; break; } }
      }
      // Platå (knät före 23h) → visa markör.
      const hasPlateau = knee != null && knee <= 22;
      // Flat/jämn profil ger en LINJÄR kurva (ingen platå) även när systemet är
      // gravt underdimensionerat. Fånga det via clipping: peakReductionKW > 0
      // betyder att efterfrågan kapas → effektbegränsat (men ingen knämarkör).
      const clips = (energy.peakReductionKW || 0) > 0.5;
      // Klassa platån efter ORSAK, inte efter aktuell punkt: om kurvans max
      // ≈ behovet är knät punkten där behovet möts — inte ett effekttak.
      // (energy.needLimited gäller bara aktuell parkeringstid och kan vara
      // false fast hela platån är behovsstyrd.)
      const kneeNeedBound = sessionNeedKWh != null && sessionNeedKWh > 0
        && yPeak >= sessionNeedKWh * 0.995;
      return {
        points: vals,
        xLabel: 'Parkeringstid (h)', yLabel: 'kWh / uttag',
        highlightX: parkingHours,
        xTicks: [1, 4, 8, 12, 16, 20, 24],
        kneeX: hasPlateau ? knee : null,
        kneeNeedBound,
        powerLimited: clips || (hasPlateau && !kneeNeedBound),
        needLimited: !!energy.needLimited,
      };
    }
    // Hubs mode: steg 1 (inte 5) → highlight träffar alltid exakt; range 1–200 täcker sliderns max (U1-fix)
    const vals = [];
    for (let k = 1; k <= 200; k++) {
      const s = C.computeHubs({
        outlets, desiredKWhPerOutlet: k, parkingHours,
        occupancyPct: occPct, capPerHub, systemCap,
        hwLimitKW: carAcLimit, efficiency,
      });
      vals.push({ x: k, y: s.hubs });
    }
    return {
      points: vals,
      xLabel: 'Önskad kWh / uttag', yLabel: 'SmartHubs',
      highlightX: Math.round(desiredKWh),
      xTicks: [10, 20, 30, 40, 50, 60, 80, 100, 150, 200], // U1-fix: täcker hela sliderns 1–200 range
      kneeX: null, kneeNeedBound: false, powerLimited: false, needLimited: false,
    };
  }, [mode, outlets, capPerHub, systemCap, profile, peakOcc, occPct,
      parkingHours, desiredKWh, energy.hubs, energy.perOutletKWh, energy.needLimited,
      energy.peakReductionKW, sizing.hubs, carAcLimit, efficiency, sessionNeedKWh, strategy]);

  const xMin = Math.min(...points.map((p) => p.x));
  const xMax = Math.max(...points.map((p) => p.x));
  const yMin = 0;
  const yMax = Math.max(...points.map((p) => p.y)) * 1.15 || 1;
  // M1-fix: defensiv guard mot division med 0 om alla x-värden råkar sammanfalla
  const xRange = (xMax - xMin) || 1;
  const yRange = (yMax - yMin) || 1;
  const sx = (x) => pad.l + ((x - xMin) / xRange) * innerW;
  const sy = (y) => pad.t + innerH - ((y - yMin) / yRange) * innerH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');

  return (
    <div style={{ background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2, padding: '16px 20px' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        {/* Y-gridlines + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = pad.t + innerH * (1 - t);
          return <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke={I.line} />
            <text x={pad.l - 8} y={y + 4} textAnchor="end" fontFamily={I.mono} fontSize={10} fill={I.mute}>
              {(yMin + (yMax - yMin) * t).toFixed(yMax > 10 ? 0 : 1)}
            </text>
          </g>;
        })}
        {/* X-axis tick labels */}
        {xTicks.map((tick) => (
          <g key={tick}>
            <line x1={sx(tick)} x2={sx(tick)} y1={pad.t + innerH} y2={pad.t + innerH + 4} stroke={I.line} />
            <text x={sx(tick)} y={pad.t + innerH + 16} textAnchor="middle" fontFamily={I.mono} fontSize={10} fill={I.mute}>
              {tick}
            </text>
          </g>
        ))}
        {/* Area fill */}
        <path d={`${path} L ${sx(xMax)} ${sy(0)} L ${sx(xMin)} ${sy(0)} Z`} fill={I.accent} opacity="0.08" />
        {/* Line */}
        <path d={path} fill="none" stroke={I.ink} strokeWidth="1.75" />
        {/* Knä-markör: var systemet blir effektbegränsat */}
        {kneeX != null && (() => {
          const atEnd = sx(kneeX) > width - 90;
          return (
            <g>
              <line x1={sx(kneeX)} x2={sx(kneeX)} y1={pad.t} y2={pad.t + innerH} stroke={I.mute} strokeWidth="1" strokeDasharray="2 3" />
              <text x={sx(kneeX) + (atEnd ? -5 : 5)} y={pad.t + 11} textAnchor={atEnd ? 'end' : 'start'}
                    fontFamily={I.mono} fontSize={9} fill={I.mute}>
                {kneeNeedBound ? 'Behov mött' : 'Effekttak'}
              </text>
            </g>
          );
        })()}
        {/* Highlight */}
        {highlightX != null && (
          <g>
            <line x1={sx(highlightX)} x2={sx(highlightX)} y1={pad.t} y2={pad.t + innerH} stroke={I.accent} strokeDasharray="3 3" />
            {(() => {
              const hit = points.find((p) => p.x === highlightX);
              if (!hit) return null;
              const isHubs = mode === 'hubs';
              const label = isHubs
                ? `${C.fmt(hit.y, { digits: 0 })} hub${hit.y === 1 ? '' : 's'}`
                : `${C.fmt(hit.y, { digits: 1 })} kWh`;
              const labelX = sx(hit.x) + 10;
              const labelAnchor = labelX > width - 80 ? 'end' : 'start';
              const labelOffset = labelAnchor === 'end' ? -14 : 10;
              return <g>
                <circle cx={sx(hit.x)} cy={sy(hit.y)} r="5" fill={I.accent} stroke={I.bg} strokeWidth="2"/>
                <text x={sx(hit.x) + labelOffset} y={sy(hit.y) - 6} textAnchor={labelAnchor}
                      fontFamily={I.mono} fontSize={11} fill={I.ink}>
                  {label}
                </text>
              </g>;
            })()}
          </g>
        )}
        {/* Axis labels */}
        <text x={pad.l} y={height - 4} fontFamily={I.mono} fontSize={10} fill={I.mute}>{xLabel}</text>
        <text x={width - pad.r} y={pad.t - 4} textAnchor="end" fontFamily={I.mono} fontSize={10} fill={I.mute}>{yLabel}</text>
      </svg>
      {/* Rådet "fler SmartHubs" är värdelöst om servisen inte rymmer en till.
          Elnätspanelen visste det redan, men de två rutorna pratade inte med
          varandra: 125 A med 20 % grundlast ger 69 kW tillgängligt, vilket
          rymmer EN hub på 44 kW — och ändå stod rådet där. Nu säger rutan
          antingen hur många som får plats eller att servisen måste utökas. */}
      {mode === 'energy' && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 2,
          background: powerLimited ? I.accentWash : I.forestWash,
          borderLeft: `3px solid ${powerLimited ? I.accent : I.forestSoft}`,
          fontSize: 11.5, lineHeight: 1.5, color: I.ink,
        }}>
          {needLimited
            ? <>✓ <strong>Behovet uppfylls.</strong> Bilarna når sitt energibehov ({C.fmt(sessionNeedKWh, { digits: 0 })} kWh) under parkeringen — mer effekt eller längre tid ger inte mer energi, bara snabbare laddning.</>
            : powerLimited
            ? (kneeX != null && !kneeNeedBound
                ? <>⚡ <strong>Effektbegränsat.</strong> Hubbarna går maxade nästan hela dygnet. Bortom ~{kneeX} h parkering ger längre tid knappt mer energi per bil. Vill ni leverera mer: <strong>fler SmartHubs eller högre effekt</strong>, inte längre parkeringstid.{elnatRad}</>
                // Den här grenen gäller den LINJÄRA kurvan (jämn profil, inget knä).
                // Texten sa tidigare "hubbarna räcker inte för antalet platser",
                // vilket pekade ut fel flaskhals: en hub tar 54 uttag och 30
                // sessioner, så platsantalet binder nästan aldrig — det är effekten
                // mot antalet samtidigt närvarande bilar som gör det. Värre var att
                // texten inte förklarade varför kurvan ändå stiger brant: total
                // dygnsenergi är KONSTANT när hubbarna går maxade, och kurvan stiger
                // bara för att färre sessioner delar på samma energi. Utan den
                // meningen läser man kurvan som att längre parkeringstid löser
                // underdimensioneringen.
                : <>⚡ <strong>Effektbegränsat.</strong> Hubbarnas effekt räcker inte för alla bilar samtidigt — de som ryms får full startström, resten köar tills kapacitet frigörs. Anläggningen går redan på sitt tak dygnet runt, så kurvan stiger bara för att färre bilar delar på samma energi: <strong>mer per bil, men färre laddade bilar</strong>. Vill ni höja totalen: <strong>fler SmartHubs eller högre effekt</strong>.{elnatRad}</>)
            : <>🕓 <strong>Tidsbegränsat.</strong> Systemet har effektmarginal, så <strong>längre parkeringstid ger i huvudsak mer energi</strong> per bil{kneeNeedBound && kneeX != null ? <> — upp till behovet ({C.fmt(sessionNeedKWh, { digits: 0 })} kWh) som nås vid ~{kneeX} h</> : null}.</>}
        </div>
      )}
    </div>
  );
}

// Felgräns. Utan den blev ett renderingsfel permanent: starttillståndet läses
// tillbaka ur URL-hash och localStorage, så en omladdning återskapade exakt det
// tillstånd som kraschade, och länken spred felet vidare (granskningsfynd G18).
class Felgrans extends React.Component {
  constructor(props) { super(props); this.state = { fel: null }; }
  static getDerivedStateFromError(fel) { return { fel }; }
  componentDidCatch(fel, info) { console.error('Laddkalkylatorn kraschade:', fel, info); }
  aterstall() {
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    try { window.history.replaceState(null, '', window.location.pathname); } catch (_) {}
    window.location.reload();
  }
  render() {
    if (!this.state.fel) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', background: I.bg, color: I.ink, fontFamily: I.sans,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
      }}>
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontFamily: I.mono, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: I.accentDeep, marginBottom: 12 }}>
            Något gick fel
          </div>
          <div style={{ fontFamily: I.serif, fontSize: 32, fontWeight: 500, letterSpacing: -0.5, marginBottom: 14 }}>
            Kalkylatorn kunde inte visas
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: I.ink2, marginBottom: 20 }}>
            Den sparade kalkylen kan vara skadad. Börja om med tomma värden —
            dina inmatningar rensas, men inget annat påverkas.
          </p>
          <button onClick={() => this.aterstall()} style={{
            background: I.ink, color: I.bg, border: `1px solid ${I.ink}`,
            padding: '10px 18px', borderRadius: 2, cursor: 'pointer',
            fontFamily: I.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase',
          }}>Börja om</button>
          <pre style={{
            marginTop: 22, fontSize: 10.5, fontFamily: I.mono, color: I.mute,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{String(this.state.fel && this.state.fel.message || this.state.fel)}</pre>
        </div>
      </div>
    );
  }
}

// Bundlens filer kors i global scope, dar en top-level function-deklaration
// OCKSA blir en window-egenskap. Namnet maste darfor fangas i en const (som
// inte skapar nagon window-egenskap) innan window.InstrumentVariant skrivs
// over — annars pekar identifieraren i wrappern pa wrappern sjalv och
// renderingen blir oandlig rekursion.
const InstrumentVariantKarna = InstrumentVariant;

function InstrumentVariantMedFelgrans() {
  return <Felgrans><InstrumentVariantKarna /></Felgrans>;
}

Object.assign(window, { InstrumentVariant: InstrumentVariantMedFelgrans });


