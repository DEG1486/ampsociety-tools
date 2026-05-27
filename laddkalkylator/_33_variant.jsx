// variant-instrument.jsx — Variant A: Instrument
// AmpSociety brand-kompatibel. Fallback-typsnitt (Playfair Display + Karla)
// per grafisk manual v1.0. Balken som visuellt element. Primärfärg orange.

// ───────── PDF export helper ─────────
function buildPdfData({ mode, outlets, hubs, capPerHub, systemCap, parkingHours,
                       profileKey, peakOcc, desiredKWh, occPct, car,
                       carAcLimit, efficiency, projectName,
                       energy, sizing, reportId,
                       gridAssessment, economics }) {
  const C = window.Amp5Calc;
  const profile = C.PROFILES[profileKey];
  const meta = {
    projectName: projectName || '', // U2-fix: tom sträng = ej angivet; PDF visar ej default-strängen
    date: new Date().toLocaleDateString('sv-SE'),
    reportId,
    version: '3.7',
  };
  const consts = {
    capPerHub, outletsPerHub: C.OUTLETS_PER_HUB,
    carAcLimit: carAcLimit ?? C.CAR_AC_LIMIT_KW,
    efficiency: efficiency ?? C.DEFAULT_EFFICIENCY,
  };
  if (mode === 'energy') {
    return {
      mode: 'energy',
      inputs: {
        outlets, hubs, capPerHub, systemCap,
        parkingHours, profileHours: profile.hours,
        peakOccupancyPct: peakOcc,
        autoHubs: energy.autoHubs,
        profileLabel: profile.label,
        carName: car.name, carKwh100: car.kwh100,
      },
      outputs: energy,
      const: consts,
      meta,
      gridAssessment: gridAssessment || null,
      economics: economics || null,
    };
  }
  // Hub-läget: använd vald profil (inte flat) för att PDF:ens timgraf ska
  // spegla verklig beläggningsprofil. peakOcc sätts till occPct (hub-lägets
  // beläggning) som skalningsfaktor för profilen.
  const hubProfile = C.PROFILES[profileKey] || C.PROFILES.flat;
  const hubEnergy = C.computeEnergy({
    outlets, hubs: sizing.hubs, capPerHub, systemCap,
    parkingHours, profileHours: hubProfile.hours,
    peakOccupancyPct: occPct,
    hwLimitKW: carAcLimit, efficiency,
  });
  return {
    mode: 'hubs',
    inputs: {
      outlets, desiredKWhPerOutlet: desiredKWh,
      parkingHours, occupancyPct: occPct,
      capPerHub, systemCap,
      profileLabel: profile.label,
      carName: car.name, carKwh100: car.kwh100,
    },
    outputs: {
      ...sizing,
      hourly: hubEnergy.hourly,
      avgPowerPerOutlet: hubEnergy.avgPowerPerActive,
    },
    const: consts,
    meta,
    gridAssessment: gridAssessment || null,
    economics: economics || null,
  };
}

function buildComparePdfData({ scenarios, car, carAcLimit, efficiency, reportId, projectName }) {
  const C = window.Amp5Calc;
  const computed = scenarios.map((s) => {
    const profile = C.PROFILES[s.profileKey];
    const e = C.computeEnergy({
      outlets: s.outlets, hubs: s.hubs, capPerHub: s.capPerHub, systemCap: s.systemCap,
      parkingHours: s.parkingHours, profileHours: profile.hours,
      peakOccupancyPct: s.peakOcc,
      hwLimitKW: carAcLimit, efficiency,
      profileLabel: profile.label,
    });
    return {
      name: s.name,
      inputs: { ...s, profileLabel: profile.label },
      outputs: e,
      rangeKm: C.rangeKm(e.perOutletKWh, car.kwh100),
    };
  });
  return {
    mode: 'compare',
    scenarios: computed,
    car: { name: car.name, kwh100: car.kwh100 },
    const: {
      capPerHub: C.CAP_PER_HUB_KW, outletsPerHub: C.OUTLETS_PER_HUB,
      carAcLimit: carAcLimit ?? C.CAR_AC_LIMIT_KW,
      efficiency: efficiency ?? C.DEFAULT_EFFICIENCY,
    },
    meta: {
      projectName: projectName || '', // U2-fix: tom sträng = ej angivet
      date: new Date().toLocaleDateString('sv-SE'),
      reportId,
      version: '3.7',
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
  root.render(<Template data={data} />);

  await waitForRender(overlay);
  window.print();

  setTimeout(() => {
    try { root.unmount(); } catch (_) {}
    try { if (overlay.parentNode) overlay.remove(); } catch (_) {}
    _pdfExporting = false;
  }, 1200);
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
  const msg = 'Amp5Calc är inte laddad — kontrollera bundle-ordningen (calc.js måste köras före variant.jsx).';
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

// P1-fix: LIMIT_SUB och LIMIT_WARNINGS som modulnivåkonstanter — skapas ej om vid varje render.
// window.Amp5Calc är definierat när variant.jsx evalueras (calc.js körs först i bundlen).
const LIMIT_SUB = {
  [window.Amp5Calc.LIMIT_REASON.HW]:         'begränsad av bilens AC-laddartak',
  [window.Amp5Calc.LIMIT_REASON.SYSTEM_CAP]: 'begränsad av fastighetseffekttak',
  [window.Amp5Calc.LIMIT_REASON.HW_CONFIG]:  'ej uppnåeligt med vald konfiguration',
};
const LIMIT_WARNINGS = {
  [window.Amp5Calc.LIMIT_REASON.HW]:         `Målet kräver högre effekt per bil än fordonens AC-gräns (${window.Amp5Calc.HW_LIMIT_KW} kW) — kortare parkering eller fler uttag krävs.`,
  [window.Amp5Calc.LIMIT_REASON.SYSTEM_CAP]: 'Fastighetseffekttaket begränsar — målet kräver servisutökning.',
  [window.Amp5Calc.LIMIT_REASON.HW_CONFIG]:  'Målet uppnås inte med vald tid och beläggning.',
};

const SCENARIO_NAMES = ['Scenario A', 'Scenario B', 'Scenario C', 'Scenario D', 'Scenario E', 'Scenario F'];
const MAX_SCENARIOS = 6;

function defaultScenario(name) {
  return {
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
  const [mode, setMode] = React.useState('energy'); // energy | hubs | compare
  const [outlets, setOutlets] = React.useState(20);
  const [hubs, setHubs] = React.useState(null); // auto
  const [capPerHub, setCapPerHub] = React.useState(44);
  const [systemCap, setSystemCap] = React.useState(null);
  // Defaults matchar 'office'-presetet så att fastighetschippen stämmer vid första laddning (fix #1)
  const [parkingHours, setParkingHours] = React.useState(9);
  const [profileKey, setProfileKey] = React.useState('office');
  const [peakOcc, setPeakOcc] = React.useState(0.85);
  const [desiredKWh, setDesiredKWh] = React.useState(30);
  const [occPct, setOccPct] = React.useState(0.75);
  const [carId, setCarId] = React.useState('tesla3');
  const [carAcLimit, setCarAcLimit] = React.useState(C.CAR_AC_LIMIT_KW);
  const [efficiency, setEfficiency] = React.useState(C.DEFAULT_EFFICIENCY);
  const [projectName, setProjectName] = React.useState('');
  // P4 (v3.7+): Enkel/Avancerad UI-toggle + fastighetstyp-preset
  const [uiMode, setUiMode] = React.useState('simple');
  const applyPropertyType = React.useCallback((key) => {
    const preset = PROPERTY_PRESETS[key];
    if (!preset) return;
    setProfileKey(preset.profileKey);
    setParkingHours(preset.parkingHours);
    setPeakOcc(preset.peakOcc);
    setOccPct(preset.occPct);
  }, []);
  // fix #3: i enkelt läge sköts hub-antalet automatiskt — nollställ ev. manuellt värde från avancerat
  const handleSetUiMode = React.useCallback((m) => {
    setUiMode(m);
    if (m === 'simple') setHubs(null);
  }, []);
  // F1: Elnät (servissäkring 3-fas 400 V + befintlig last)
  const [fuseSizeA, setFuseSizeA] = React.useState(125);
  const [existingLoadPct, setExistingLoadPct] = React.useState(0.50);
  // F2: Ekonomi
  const [materialCost, setMaterialCost] = React.useState(100000);
  const [installationCost, setInstallationCost] = React.useState(150000);
  const [electricityPrice, setElectricityPrice] = React.useState(2.50);
  const [chargingFee, setChargingFee] = React.useState(0);
  // H1: effekttariff (kr/kW/månad) — påverkar månadskostnad via nätbolagets effektavgift
  const [powerTariff, setPowerTariff] = React.useState(60);
  // LCC: drift & underhåll, %/år av kapital
  const [omPctYear, setOmPctYear] = React.useState(3);
  const [scenarios, setScenarios] = React.useState(() => [
    defaultScenario(SCENARIO_NAMES[0]),
    { ...defaultScenario(SCENARIO_NAMES[1]), outlets: 50, profileKey: 'mall', peakOcc: 0.85 },
  ]);
  // Stabilt rapport-ID per session så omtryckning ger samma referens.
  const reportId = React.useRef('A5-' + Math.floor(Math.random() * 9000 + 1000)).current;

  const profile = C.PROFILES[profileKey];
  // Härled fastighetstyp ur faktiska värden (fix #1/#2) — chippen highlightas bara om värdena matchar
  const propertyType = matchPropertyType(profileKey, parkingHours, peakOcc, occPct);

  const energy = React.useMemo(() => C.computeEnergy({
    outlets, hubs, capPerHub, systemCap,
    parkingHours, profileHours: profile.hours, peakOccupancyPct: peakOcc,
    hwLimitKW: carAcLimit, efficiency,
    profileLabel: profile.label,
  }), [outlets, hubs, capPerHub, systemCap, parkingHours, profileKey, peakOcc, carAcLimit, efficiency]);

  const sizing = React.useMemo(() => C.computeHubs({
    outlets, desiredKWhPerOutlet: desiredKWh, parkingHours,
    occupancyPct: occPct, capPerHub, systemCap,
    hwLimitKW: carAcLimit, efficiency,
  }), [outlets, desiredKWh, parkingHours, occPct, capPerHub, systemCap, carAcLimit, efficiency]);

  // F1: Elnätsbedömning — systemets toppeffekt mot serviskapacitet
  const gridAssessment = React.useMemo(() => C.computeGridAssessment({
    fuseSizeA, existingLoadPct,
    systemPeakKW: mode === 'energy' ? energy.peakPowerKW : sizing.effectiveCap,
  }), [fuseSizeA, existingLoadPct, energy.peakPowerKW, sizing.effectiveCap, mode]);

  // K4-fix: räkna ut effekt per laddande bil vid samtidig peak — avslöjar "trickle"-scenarier
  // där SmartHub-taket sprids på så många bilar att varje får under 2 kW.
  const perCarPeakKW = React.useMemo(() => {
    const peakPower = mode === 'energy' ? energy.peakPowerKW : sizing.effectiveCap;
    const activeAtPeak = mode === 'energy'
      ? outlets * peakOcc
      : outlets * occPct;
    if (activeAtPeak < 0.5 || !isFinite(peakPower)) return null;
    return peakPower / activeAtPeak;
  }, [mode, energy.peakPowerKW, sizing.effectiveCap, outlets, peakOcc, occPct]);

  // F2: Kostnad & ROI
  const economics = React.useMemo(() => {
    const totalEnergy = mode === 'energy'
      ? energy.totalEnergyDay
      : sizing.kwhPerOutletPerDay * outlets;
    // fix #4: effekttariffen ska debiteras på faktisk samtidig topp, inte hela installerade
    // kapaciteten. I hubs-läge = min(systemtak, samtidig efterfrågan vid beläggning).
    const peakKw = mode === 'energy'
      ? energy.peakPowerKW
      : Math.min(sizing.effectiveCap, outlets * occPct * carAcLimit);
    return C.computeEconomics({
      materialCost, installationCost,
      electricityPrice, chargingFee, totalEnergyDay: totalEnergy,
      powerTariff, peakPowerKW: peakKw, omPctYear: omPctYear / 100,
    });
  }, [mode, energy.totalEnergyDay, energy.peakPowerKW, sizing.kwhPerOutletPerDay, sizing.effectiveCap,
      outlets, occPct, carAcLimit, materialCost, installationCost, electricityPrice, chargingFee, powerTariff, omPctYear]);

  const car = C.CARS.find((c) => c.id === carId) || C.CARS[0];
  const heroKWh = mode === 'energy' ? energy.perOutletKWh : sizing.actualEnergyPerOutlet;
  const heroRange = C.rangeKm(heroKWh, car.kwh100);

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
          projectName={projectName} setProjectName={setProjectName}
          onExportPdf={() => {
            const data = buildComparePdfData({ scenarios, car, carAcLimit, efficiency, reportId, projectName });
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
        desiredKWh={desiredKWh} setDesiredKWh={setDesiredKWh}
        occPct={occPct} setOccPct={setOccPct}
        carAcLimit={carAcLimit} setCarAcLimit={setCarAcLimit}
        efficiency={efficiency} setEfficiency={setEfficiency}
        projectName={projectName} setProjectName={setProjectName}
        fuseSizeA={fuseSizeA} setFuseSizeA={setFuseSizeA}
        existingLoadPct={existingLoadPct} setExistingLoadPct={setExistingLoadPct}
        materialCost={materialCost} setMaterialCost={setMaterialCost}
        installationCost={installationCost} setInstallationCost={setInstallationCost}
        powerTariff={powerTariff} setPowerTariff={setPowerTariff}
        omPctYear={omPctYear} setOmPctYear={setOmPctYear}
        electricityPrice={electricityPrice} setElectricityPrice={setElectricityPrice}
        chargingFee={chargingFee} setChargingFee={setChargingFee}
      />
      <RightPanel
        mode={mode}
        energy={energy} sizing={sizing}
        heroKWh={heroKWh} heroRange={heroRange}
        profile={profile} peakOcc={peakOcc}
        car={car} carId={carId} setCarId={setCarId}
        parkingHours={parkingHours}
        outlets={outlets} capPerHub={capPerHub} systemCap={systemCap}
        occPct={occPct} desiredKWh={desiredKWh} profileKey={profileKey}
        carAcLimit={carAcLimit} efficiency={efficiency}
        gridAssessment={gridAssessment} economics={economics}
        perCarPeakKW={perCarPeakKW}
        uiMode={uiMode} powerTariff={powerTariff} omPctYear={omPctYear} existingLoadPct={existingLoadPct}
        onExportPdf={() => {
          const data = buildPdfData({
            mode, outlets, hubs, capPerHub, systemCap, parkingHours,
            profileKey, peakOcc, desiredKWh, occPct, car,
            carAcLimit, efficiency, projectName,
            energy, sizing, reportId,
            gridAssessment, economics,
          });
          exportAsPdf(data);
        }}
      />
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
            hint={p.hubs == null ? `Auto (max ${C.OUTLETS_PER_HUB} uttag/hub)` : null}
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
              min={0} max={10000} suffix="kW" optional />
          </>
        )}
      </Group>

      {isSimple ? (
        <Group label="Fastighet">
          <PropertyTypePicker value={p.propertyType} onChange={p.applyPropertyType} />
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
              hint="Profilens toppvärde — formen bevaras" />
          )}
        </Group>
      )}

      {!isSimple && (
        <Group label="Avancerat">
          <CarAcLimitPicker value={p.carAcLimit} onChange={p.setCarAcLimit} />
          <SliderField label="Verkningsgrad" value={Math.round(p.efficiency*100)}
            onChange={(v) => p.setEfficiency(v/100)} min={85} max={100} step={1} suffix="%"
            hint="Kabel- och hub-förluster (default 95%)" />
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
        <NumberField label="Elpris" value={p.electricityPrice}
          onChange={p.setElectricityPrice} min={0} max={10} step={0.1} suffix="kr/kWh" />
        <NumberField label="Laddavgift" value={p.chargingFee}
          onChange={p.setChargingFee} min={0} max={10} step={0.1} suffix="kr/kWh"
          hint="0 = fri laddning · sätt > elpriset för att beräkna ROI" />
        {!isSimple && (
          <>
            <NumberField label="Effekttariff" value={p.powerTariff}
              onChange={p.setPowerTariff} min={0} max={500} step={5} suffix="kr/kW/mån"
              hint="Nätbolagets effektavgift (typ. 40–120 kr/kW/mån för kommersiella abonnemang)" />
            <SliderField label="Drift & underhåll" value={p.omPctYear}
              onChange={p.setOmPctYear} min={0} max={10} step={1} suffix="%/år"
              hint="Service, kommunikation, betalflöde — typiskt 2–4 % av kapital/år" />
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
        <img src={window.Amp5Assets.logo} alt="AmpSociety" style={{ display: 'block', height: 24, width: 'auto' }} />
        <div style={{ fontFamily: I.mono, fontSize: 10, letterSpacing: 2, color: I.mute, textTransform: 'uppercase', fontWeight: 700 }}>
          Laddkalkylator
        </div>
      </div>
      {/* Balken — AmpSocietys visuella signatur */}
      <div style={{ height: 4, width: 64, background: I.accent, marginBottom: 16 }} />
      <div style={{ fontFamily: I.serif, fontSize: 36, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1.05, marginBottom: 10, color: I.ink }}>
        Dimensionera rätt.<br/>Undvik plåsterlösningar.
      </div>
      <div style={{ fontSize: 13, color: I.ink2, lineHeight: 1.55, fontWeight: 400 }}>
        Ange din parkering — se hur mycket energi varje plats får, eller hur många SmartHubs som krävs.
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
    return (
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

function SliderField({ label, value, onChange, min, max, step = 1, suffix, hint }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontSize: 13, color: I.ink2 }}>{label}</label>
        <div style={{ fontFamily: I.mono, fontSize: 14, color: I.ink, fontFeatureSettings: '"tnum"' }}>
          {value}<span style={{ color: I.mute, fontSize: 11, marginLeft: 3 }}>{suffix}</span>
        </div>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: I.line }} />
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 2, background: I.ink }} />
        <div style={{ position: 'absolute', left: `calc(${pct}% - 6px)`, width: 12, height: 12, borderRadius: 6, background: I.accent, border: `2px solid ${I.bg}`, pointerEvents: 'none' }} />
        <input type="range" value={value} min={min} max={max} step={step}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', margin: 0 }} />
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

// ───────── Enkel/Avancerad — fastighetstyp-presets ─────────
const PROPERTY_PRESETS = {
  brf:    { label: 'BRF / bostad',  profileKey: 'residential', parkingHours: 10, peakOcc: 0.85, occPct: 0.85 },
  office: { label: 'Kontor',        profileKey: 'office',      parkingHours: 9,  peakOcc: 0.85, occPct: 0.75 },
  mall:   { label: 'Köpcentrum',    profileKey: 'mall',        parkingHours: 3,  peakOcc: 0.85, occPct: 0.60 },
  garage: { label: 'Parkeringshus', profileKey: 'flat',        parkingHours: 6,  peakOcc: 0.60, occPct: 0.55 },
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
    { k: 'simple',   t: 'Enkel',     s: 'Grundläggande inställningar' },
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
  const isCustom = !presets.includes(value);
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
            <button key={a} onClick={() => onChange(a)}
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
        <button onClick={() => { if (!isCustom) onChange(250); }}
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
function GridAssessment({ assessment, hubHint, perCarPeakKW, carAcLimit }) {
  const C = window.Amp5Calc;
  const { status, servisKW, existingKW, availableKW, surplusKW, upgradeCostLow, upgradeCostHigh } = assessment;
  const STATUS_CFG = {
    ok:       { color: '#2E7D32', bg: '#E8F5E9', label: 'OK — elnätet täcker laddningsbehovet' },
    marginal: { color: '#E65100', bg: '#FFF3E0', label: 'Marginellt — knappt tillräcklig kapacitet' },
    upgrade:  { color: '#C62828', bg: '#FFEBEE', label: 'Servisutökning krävs' },
  };
  const cfg = STATUS_CFG[status] || STATUS_CFG.ok;
  // K4: visa per-bil-effekt vid samtidig peak — varna vid trickle-laddning (< 2 kW)
  const showTrickleWarn = perCarPeakKW != null && perCarPeakKW < 2.0;
  const perCarLimitKW = Math.min(perCarPeakKW || 0, carAcLimit || 11);
  const rows = [
    ['Serviseffekt (√3 × 400 V × A)', `${C.fmt(servisKW, { digits: 0 })} kW`],
    ['Befintlig last',                 `${C.fmt(existingKW, { digits: 0 })} kW`],
    ['Tillgänglig för laddning',       `${C.fmt(availableKW, { digits: 0 })} kW`],
    ['Överskott / underskott',         `${surplusKW >= 0 ? '+' : ''}${C.fmt(surplusKW, { digits: 0 })} kW`],
    ...(perCarPeakKW != null ? [['Per bil vid samtidig peak', `${C.fmt(perCarLimitKW, { digits: 1 })} kW`]] : []),
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
        {(status === 'upgrade' || status === 'marginal') && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: I.accentWash, borderLeft: `3px solid ${I.accent}`,
            fontSize: 11, color: I.ink, lineHeight: 1.5,
          }}>
            Indikativ kostnad för servisutökning:{' '}
            <strong>{upgradeCostLow >= 1_000_000 ? `${C.fmt(upgradeCostLow / 1_000_000, { digits: 1 })} Mkr` : `${C.fmt(upgradeCostLow / 1000, { digits: 0 })} kkr`}–{upgradeCostHigh >= 1_000_000 ? `${C.fmt(upgradeCostHigh / 1_000_000, { digits: 1 })} Mkr` : `${C.fmt(upgradeCostHigh / 1000, { digits: 0 })} kkr`}</strong>
          </div>
        )}
        {hubHint && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: I.surface, borderLeft: `3px solid ${I.mute}`,
            fontSize: 11, color: I.mute, lineHeight: 1.5,
          }}>
            💡 Ange <strong>Fastighetseffekttak</strong> (kW) så delar SmartHubbarna automatiskt på den tillgängliga effekten — och elnätsbedömningen blir mer exakt.
          </div>
        )}
        {showTrickleWarn && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: '#FFF3E0', borderLeft: `3px solid #E65100`,
            fontSize: 11, color: '#5C2E00', lineHeight: 1.5,
          }}>
            ⚠️ <strong>Underdimensionerat:</strong> vid samtidig peak får varje aktiv bil bara{' '}
            <strong>{C.fmt(perCarLimitKW, { digits: 1 })} kW</strong> — det motsvarar bara ~{C.fmt(perCarLimitKW * 6, { digits: 0 })} km räckvidd per timme.
            Överväg fler SmartHubs eller färre samtidiga uttag för att leverera meningsfull laddning.
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── F2: EconomicsPanel ─────────
function EconomicsPanel({ economics }) {
  const C = window.Amp5Calc;
  const {
    capitalCost, hubCapital, outletCapital,
    monthlyEnergyKWh, monthlyEnergyCost, monthlyPowerCost, monthlyOmCost,
    monthlyRevenue, monthlyNet,
    paybackMonths, paybackYears,
  } = economics;
  const hasRevenue = monthlyRevenue > 0;
  const rows = [
    ['Energi / månad',        `${C.fmt(monthlyEnergyKWh, { digits: 0 })} kWh`],
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
      </div>
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
        {paybackYears != null && (
          <div style={{
            marginTop: 10, padding: '10px 14px',
            background: I.forestWash, borderLeft: `3px solid ${I.forestSoft}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, color: I.forest }}>Återbetalningstid</span>
            <span style={{ fontFamily: I.serif, fontSize: 24, fontWeight: 500, color: I.forest, letterSpacing: -0.5 }}>
              {paybackYears < 1
                ? `${Math.round(paybackMonths)} mån`
                : `${C.fmt(paybackYears, { digits: 1 })} år`}
            </span>
          </div>
        )}
        {paybackYears == null && (
          <div style={{ fontSize: 11, color: I.mute, fontStyle: 'italic', marginTop: 8, padding: '6px 0' }}>
            {hasRevenue
              ? 'Investering återbetalar sig ej med nuvarande inställningar.'
              : 'Ange en laddavgift (kr/kWh) för att beräkna återbetalningstid.'}
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
      Antar WLTP-förbrukning. Profilens ankomstfördelning faltas med
      parkeringstidsfönstret och skalas mot vald topp-beläggning.
      Per-bil-effekten är min(bilens AC-tak, hubens andel). Vintertid
      räkna 20–40 % högre energiåtgång.
    </div>
  );
}

// ───────── Compare panel ─────────
function ComparePanel({ mode, setMode, scenarios, setScenarios, car, carId, setCarId,
                        carAcLimit, setCarAcLimit, efficiency, setEfficiency,
                        projectName, setProjectName, onExportPdf }) {
  const C = window.Amp5Calc;
  const [exporting, setExporting] = React.useState(false);

  const { computed, maxKWh } = React.useMemo(() => {
    const rows = scenarios.map((s) => {
      const profile = C.PROFILES[s.profileKey];
      const e = C.computeEnergy({
        outlets: s.outlets, hubs: s.hubs, capPerHub: s.capPerHub, systemCap: s.systemCap,
        parkingHours: s.parkingHours, profileHours: profile.hours,
        peakOccupancyPct: s.peakOcc,
        hwLimitKW: carAcLimit, efficiency,
        profileLabel: profile.label,
      });
      return { scenario: s, energy: e, profile, rangeKm: C.rangeKm(e.perOutletKWh, car.kwh100) };
    });
    return { computed: rows, maxKWh: Math.max(...rows.map((r) => r.energy.perOutletKWh), 1) };
  }, [scenarios, carId, carAcLimit, efficiency]);

  const updateScenario = (i, patch) => {
    setScenarios((arr) => arr.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  };
  const addScenario = () => {
    if (scenarios.length >= MAX_SCENARIOS) return;
    setScenarios((arr) => [...arr, defaultScenario(SCENARIO_NAMES[arr.length])]);
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
          <img src={window.Amp5Assets.logo} alt="AmpSociety" style={{ display: 'block', height: 24, width: 'auto' }} />
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
        <CompareGlobalSetting label="Verkningsgrad">
          <input type="range" min={85} max={100} step={1}
            aria-label="Verkningsgrad"
            value={Math.round(efficiency * 100)}
            onChange={(e) => setEfficiency(Number(e.target.value) / 100)}
            style={{ width: 110, accentColor: I.accent }} />
          <span style={{ fontFamily: I.mono, fontSize: 12, color: I.ink, minWidth: 36 }}>
            {Math.round(efficiency * 100)}%
          </span>
        </CompareGlobalSetting>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16,
      }}>
        {computed.map((c, i) => (
          <ScenarioCard
            key={i}
            color={C.SCENARIO_PALETTE[i % C.SCENARIO_PALETTE.length]}
            scenario={c.scenario}
            energy={c.energy}
            rangeKm={c.rangeKm}
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
          const color = C.SCENARIO_PALETTE[i % C.SCENARIO_PALETTE.length];
          const pct = (c.energy.perOutletKWh / maxKWh) * 100;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 88px', alignItems: 'center', gap: 12 }}>
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

function ScenarioCard({ color, scenario, energy, rangeKm, canRemove, onChange, onRemove }) {
  const C = window.Amp5Calc;
  const s = scenario;
  const isLimited = energy.effectiveCap < energy.installedCap;

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
      <NumberField compact label="SmartHubs" value={s.hubs} placeholder={`auto (${energy.autoHubs})`}
        onChange={(v) => onChange({ hubs: v })} min={1} max={20} optional />
      <NumberField compact label="Parkering (h)" value={s.parkingHours}
        onChange={(v) => onChange({ parkingHours: v })} min={1} max={24} />
      <NumberField compact label="kW/hub" value={s.capPerHub}
        onChange={(v) => onChange({ capPerHub: v })} emptyValue={C.CAP_PER_HUB_KW}
        min={10} max={C.CAP_PER_HUB_KW} />
      <NumberField compact label="Systemtak (kW)" value={s.systemCap} placeholder="obegränsat"
        onChange={(v) => onChange({ systemCap: v })} min={0} max={10000} optional />

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
function RightPanel({ mode, energy, sizing, heroKWh, heroRange, profile, peakOcc, car, carId, setCarId, parkingHours, outlets, capPerHub, systemCap, occPct, desiredKWh, profileKey, carAcLimit, efficiency, gridAssessment, economics, perCarPeakKW, uiMode, powerTariff, omPctYear, existingLoadPct, onExportPdf }) {
  const C = window.Amp5Calc;
  const [exporting, setExporting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const handleExport = async () => {
    setExporting(true);
    try { await onExportPdf(); }
    finally { setExporting(false); }
  };

  const handleCopy = () => {
    const kWh = mode === 'energy'
      ? `${C.fmt(energy.perOutletKWh, { digits: 1 })} kWh/uttag · ${C.fmt(heroRange, { digits: 0 })} km räckvidd`
      : `${sizing.hubs} SmartHubs · ${C.fmt(sizing.actualEnergyPerOutlet, { digits: 1 })} kWh/uttag`;
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
          <HourlyChart energy={energy} />
        </div>
        <div>
          <SectionTitle title="Nyckeltal" />
          <StatList mode={mode} energy={energy} sizing={sizing} />
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
        />
      </div>

      <Divider />

      <div style={{ marginTop: 32 }}>
        <SectionTitle title="Elnätsbedömning" hint="3-fas 400 V · serviskapacitet vs laddningsbehov" />
        <GridAssessment assessment={gridAssessment}
          hubHint={mode === 'hubs' && sizing.effectiveCap > 100}
          perCarPeakKW={perCarPeakKW} carAcLimit={carAcLimit} />
      </div>

      <Divider />

      <div style={{ marginTop: 32, paddingBottom: 16 }}>
        <SectionTitle title="Investeringskalkyl" hint="Kostnad och återbetalningstid" />
        <EconomicsPanel economics={economics} />
        {uiMode === 'simple' && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            fontSize: 10.5, color: I.mute, lineHeight: 1.5,
            background: I.surface, border: `1px solid ${I.lineSoft}`, borderRadius: 2,
          }}>
            Antaganden (ändras i Avancerat): effekttariff {C.fmt(powerTariff, { digits: 0 })} kr/kW/mån ·
            drift &amp; underhåll {C.fmt(omPctYear, { digits: 0 })} %/år ·
            befintlig last {C.fmt(Math.round(existingLoadPct * 100), { digits: 0 })} %.
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
  const primarySub = mode === 'energy'
    ? `${energy.hubs} × ${C.CAP_PER_HUB_KW} kW · ${energy.profileLabel || 'Profil'} · peak ${Math.round((energy.peakOccupancyPct ?? peakOcc) * 100)}%`
    : sizing.achievesTarget
        ? 'når energimålet · marginal finns'
        : (LIMIT_SUB[sizing.limitReason] || 'ej uppnåeligt med vald konfiguration');

  const warning = mode === 'hubs' && !sizing.achievesTarget
    ? (LIMIT_WARNINGS[sizing.limitReason] || LIMIT_WARNINGS[C.LIMIT_REASON.HW_CONFIG])
    : null;

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
            {mode === 'energy' ? 'kWh' : `×${C.CAP_PER_HUB_KW} kW`}
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
          Beräkningen antar WLTP-förbrukning vid normal körning. Vintertid räkna 20–40 % högre energiåtgång per km.
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

function HourlyChart({ energy }) {
  const C = window.Amp5Calc;
  const cap = energy.effectiveCap;
  const demand = energy.hourlyDemand || energy.hourly;
  const yMax = Math.max(energy.peakDemandKW, cap, 1) * 1.05;
  const capPct = (cap / yMax) * 100;

  return (
    <div style={{ background: I.surface, border: `1px solid ${I.line}`, borderRadius: 2, padding: '16px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14, gap: 16, flexWrap: 'wrap' }}>
        <Stat small label="Efterfrågan" value={`${C.fmt(energy.peakDemandKW, {digits: 0})} kW`} />
        <Stat small label="Levererat" value={`${C.fmt(energy.peakPowerKW, {digits: 0})} kW`} />
        <Stat small label="Reduktion" value={`−${C.fmt(energy.peakReductionKW, {digits: 0})} kW`} />
        <Stat small label="Hub-tak" value={`${C.fmt(cap, {digits: 0})} kW`} />
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
            <div key={i} title={`${i}:00 · efterfrågan ${C.fmt(dem, {digits: 0})} kW · levererat ${C.fmt(delivered, {digits: 0})} kW`}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: I.mono, fontSize: 10, color: I.mute, letterSpacing: .5 }}>
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 10, color: I.mute, flexWrap: 'wrap' }}>
        <LegendSwatch color={I.ink} label="SmartHub levererat" />
        <LegendSwatch color="rgba(239,83,80,0.55)" label="Okontrollerad efterfrågan" />
        <LegendSwatch color={I.accent} dashed label="Hub-tak" />
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

function StatList({ mode, energy, sizing }) {
  const C = window.Amp5Calc;
  const fmtSessions = (n) => n >= 10 ? C.fmt(n, { digits: 0 }) : C.fmt(n, { digits: 1 });
  const rows = mode === 'energy' ? [
    ['Installerad kapacitet',  `${C.fmt(energy.installedCap, { digits: 0 })} kW`],
    ['Effektiv kapacitet',      `${C.fmt(energy.effectiveCap, { digits: 0 })} kW`],
    ['Topplast / medellast',    `${C.fmt(energy.peakPowerKW, { digits: 0 })} / ${C.fmt(energy.avgPowerKW, { digits: 0 })} kW`],
    ['Aktiva uttag (snitt)',    `${C.fmt(energy.activeOutlets, { digits: 1 })} av ${energy.maxOutlets}`],
    ['Laddningar / uttag·dygn', fmtSessions(energy.sessionsPerOutletPerDay)],
    ['Totalt laddningar / dygn', fmtSessions(energy.totalSessionsPerDay)],
    ['kWh / uttag·dygn',        `${C.fmt(energy.kwhPerOutletPerDay, { digits: 1 })} kWh`],
    ['Snitteffekt / aktivt uttag', `${C.fmt(energy.avgPowerPerActive, { digits: 1 })} kW`],
    ['SmartHubs',               `${energy.hubs} × ${C.CAP_PER_HUB_KW} kW`],
  ] : [
    ['Installerad kapacitet',  `${C.fmt(sizing.installedCap, { digits: 0 })} kW`],
    ['Effektiv kapacitet',      `${C.fmt(sizing.effectiveCap, { digits: 0 })} kW`],
    ['Effekt som krävs',        `${C.fmt(sizing.powerNeeded, { digits: 0 })} kW`],
    ['Hubs pga uttag',          `${sizing.hubsByOutlets}`],
    ['Hubs pga effekt',         `${sizing.hubsByPower}${sizing.hubsByPowerIdeal > sizing.hubsByPower ? ` (idealt ${sizing.hubsByPowerIdeal})` : ''}`],
    ['Laddningar / uttag·dygn', fmtSessions(sizing.sessionsPerOutletPerDay)],
    ['Totalt laddningar / dygn', fmtSessions(sizing.totalSessionsPerDay)],
    ['kWh / uttag·dygn',        `${C.fmt(sizing.kwhPerOutletPerDay, { digits: 1 })} kWh`],
    ['Faktisk kWh / uttag',
      sizing.achievesTarget
        ? `${C.fmt(sizing.actualEnergyPerOutlet, { digits: 1 })} kWh · +${C.fmt(sizing.headroomKWh, { digits: 1 })} marginal`
        : `${C.fmt(sizing.actualEnergyPerOutlet, { digits: 1 })} kWh · −${C.fmt(sizing.shortfallKWh, { digits: 1 })} under mål`,
    ],
  ];
  return (
    <div style={{ border: `1px solid ${I.line}`, borderRadius: 2, background: I.surface }}>
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

function SensitivityChart({ mode, energy, sizing, parkingHours, outlets, capPerHub, systemCap, occPct, peakOcc, desiredKWh, profile, carAcLimit, efficiency }) {
  const C = window.Amp5Calc;
  const width = 640, height = 200, pad = { l: 48, r: 16, t: 16, b: 40 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const { points, xLabel, yLabel, highlightX, xTicks } = React.useMemo(() => {
    if (mode === 'energy') {
      const vals = [];
      for (let h = 1; h <= 24; h++) {
        const e = C.computeEnergy({
          outlets, hubs: energy.hubs, capPerHub, systemCap,
          parkingHours: h, profileHours: profile.hours, peakOccupancyPct: peakOcc,
          hwLimitKW: carAcLimit, efficiency,
        });
        vals.push({ x: h, y: e.perOutletKWh });
      }
      return {
        points: vals,
        xLabel: 'Parkeringstid (h)', yLabel: 'kWh / uttag',
        highlightX: parkingHours,
        xTicks: [1, 4, 8, 12, 16, 20, 24],
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
    };
  }, [mode, outlets, capPerHub, systemCap, profile, peakOcc, occPct,
      parkingHours, desiredKWh, energy.hubs, energy.perOutletKWh, sizing.hubs,
      carAcLimit, efficiency]);

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
    </div>
  );
}

Object.assign(window, { InstrumentVariant });


