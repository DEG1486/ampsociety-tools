// pdf-variants.jsx — PDF layouts for AmpSociety Laddkalkylator.
// A4 portrait (210 × 297 mm). At 96dpi -> 794 × 1123 px.
// Exposes window.PDFEditorial and window.PDFCompare,
// each accepting a full `data` object with inputs, outputs and meta.

/* global React */

// A4 @ 96dpi. We design in px, print @ 96dpi → 1:1.
const PAGE_W = 794;
const PAGE_H = 1123;

// P2-fix: kontaktuppgifter som konstanter — uppdatera här istället för att söka i koden.
// Telefonnummer medvetet utelämnat tills ett officiellt nummer finns (Daniel 2026-06-10).
const CONTACT_EMAIL = 'info@ampsociety.com';

const BRAND = {
  ink: '#272120',
  ink2: '#3E3836',
  mute: '#838282',
  muteSoft: '#B8B4B2',
  line: '#DADADA',
  lineSoft: '#EEEEEE',
  paper: '#FFFFFF',
  warm: '#F6F4EF',
  accent: '#F46036',
  accentDeep: '#86341E',
  accentSoft: '#F5A888',
  accentWash: '#FDE3D4',
  forest: '#2E5449',
  forestSoft: '#58A08B',
  forestWash: '#E7F1ED',
  serif: '"GT Super Display", "Playfair Display", Georgia, serif',
  sans: '"Apercu", "Karla", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

// --------------------------------------------------------------------------
// Shared primitives
// --------------------------------------------------------------------------

function PDFLogomark({ size = 22, stroke, fill, invert }) {
  const strokeColor = invert ? '#fff' : (stroke || BRAND.ink);
  const fillColor = invert ? '#fff' : (fill || BRAND.accent);
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" style={{ display: 'block' }}>
      <rect x="1" y="1" width="20" height="20" rx="4" stroke={strokeColor} strokeWidth="1.5"/>
      <path d="M12 5L6 13H10L9 17L15 9H11L12 5Z" fill={fillColor}/>
    </svg>
  );
}

function Page({ children, background, id }) {
  return (
    <div className="pdf-page" data-pdf-page id={id} style={{
      width: PAGE_W, height: PAGE_H,
      background: background || BRAND.paper,
      color: BRAND.ink,
      fontFamily: BRAND.sans,
      position: 'relative',
      overflow: 'hidden',
      boxSizing: 'border-box',
      pageBreakAfter: 'always',
      breakAfter: 'page',
    }}>
      {children}
    </div>
  );
}

// The AmpSociety "balken" — horizontal bar that acts as brand accent
function Balk({ width = 56, color = BRAND.accent, height = 4, style }) {
  return <div style={{ width, height, background: color, ...style }} />;
}

function PDFFooter({ page, total, date, version }) {
  return (
    <div style={{
      position: 'absolute', left: 56, right: 56, bottom: 32,
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      fontSize: 9, color: BRAND.mute, letterSpacing: 0.6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={window.Amp5Assets.symbol} alt="" style={{ display: 'block', height: 14, width: 'auto', opacity: 0.85 }} />
        <span style={{ textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1.2 }}>AmpSociety · Laddkalkylator</span>
      </div>
      <div style={{ display: 'flex', gap: 18, fontFamily: BRAND.mono }}>
        <span>{date}</span>
        <span>v{version}</span>
        <span>{page} / {total}</span>
      </div>
    </div>
  );
}

// Riktig QR-kod, statiskt förgenererad (segno, EC-nivå M, version 4) för
// QR_URL nedan. URL:en är fast så ingen runtime-encoder behövs — men ändras
// adressen MÅSTE matrisen genereras om (python: segno.make(url, error='m')).
// Verifierad avkodningsbar med OpenCV QRCodeDetector 2026-06-10.
const QR_URL = 'https://deg1486.github.io/ampsociety-tools/';
const QR_MATRIX = [
  '111111101101001001111011101111111',
  '100000100000001101001110101000001',
  '101110100100001001101110001011101',
  '101110100000110110000010101011101',
  '101110101100010000100011101011101',
  '100000101000010111100100001000001',
  '111111101010101010101010101111111',
  '000000000001101100100100100000000',
  '011111110110100001101001000110001',
  '101010000000111100111111101101101',
  '011011101111011010100110011010100',
  '111111001010101100000100111011111',
  '010010100100100010110010010111011',
  '001111000001110110000101001001011',
  '110111111110011110101010111011010',
  '001110011011001011111100011101100',
  '100011101100010000010000010110001',
  '010011011101000011111001101101101',
  '000001110011001100000010000110110',
  '101110010011010011101111011111110',
  '010000110011100100100010010011001',
  '110001001100101010010001001000101',
  '101010101011111110101010010101110',
  '100101011001100111110100000101111',
  '100011111011111011101010111110001',
  '000000001111010110011000100010101',
  '111111101000010110101011101010110',
  '100000101000111011000111100011101',
  '101110101101010001111010111111011',
  '101110101011100000111101110011001',
  '101110101101101110100011101101100',
  '100000101101101000101110001011100',
  '111111100001101010010011110101010',
];
function QRCode({ size = 96, className }) {
  const N = QR_MATRIX.length;
  const quiet = 3; // moduler vit marginal (quiet zone) — krävs för skanning mot färgad bakgrund
  const total = N + quiet * 2;
  return (
    <div className={className} data-qr style={{ width: size, height: size, background: '#fff', boxSizing: 'border-box' }}>
      <svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges" style={{ display: 'block' }}>
        <rect x="0" y="0" width={total} height={total} fill="#fff" />
        {QR_MATRIX.map((row, y) => row.split('').map((c, x) => (
          c === '1' ? <rect key={`${y}-${x}`} x={x + quiet} y={y + quiet} width="1" height="1" fill="#000" /> : null
        )))}
      </svg>
    </div>
  );
}

// Thin typographic label — tracked uppercase Apercu
function Eyebrow({ children, color = BRAND.mute, style }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
      color, fontFamily: BRAND.sans, ...style,
    }}>{children}</div>
  );
}

function Num({ value, unit, size = 96, color = BRAND.ink, weight = 500, italic = false }) {
  return (
    <div style={{
      fontFamily: BRAND.serif,
      fontSize: size, fontWeight: weight,
      fontStyle: italic ? 'italic' : 'normal',
      lineHeight: 0.9, letterSpacing: -size * 0.025,
      color, fontFeatureSettings: '"tnum"',
      display: 'flex', alignItems: 'baseline', gap: size * 0.08,
    }}>
      <span>{value}</span>
      {unit && <span style={{ fontSize: size * 0.28, fontWeight: 400, color: BRAND.mute, fontStyle: 'normal', fontFamily: BRAND.sans, letterSpacing: 1, textTransform: 'uppercase' }}>{unit}</span>}
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers over computation output
// --------------------------------------------------------------------------

function summarizeInputs(data) {
  const i = data.inputs;
  if (data.mode === 'energy') {
    return [
      { label: 'Parkeringsplatser', value: i.outlets, unit: 'st' },
      { label: 'SmartHubs', value: i.hubs == null ? `${i.autoHubs} (auto)` : i.hubs, unit: 'st' },
      { label: 'Systemtak', value: i.systemCap != null ? i.systemCap : 'Obegränsat', unit: i.systemCap != null ? 'kW' : '' },
      { label: 'Parkeringstid', value: i.parkingHours, unit: 'h' },
      { label: 'Peak-beläggning (profil)', value: Math.round(i.peakOccupancyPct * 100), unit: '%' },
      { label: 'Faktisk topp', value: Math.round((data.outputs.peakOccupancyPct || 0) * 100), unit: '%' },
      { label: 'Profil', value: i.profileLabel, unit: '' },
    ];
  }
  return [
    { label: 'Parkeringsplatser', value: i.outlets, unit: 'st' },
    { label: 'Mål per plats', value: i.desiredKWhPerOutlet, unit: 'kWh' },
    { label: 'Parkeringstid', value: i.parkingHours, unit: 'h' },
    { label: 'Beläggning', value: Math.round(i.occupancyPct * 100), unit: '%' },
    { label: 'Systemtak', value: i.systemCap != null ? i.systemCap : 'Obegränsat', unit: i.systemCap != null ? 'kW' : '' },
    { label: 'Referensbil', value: i.carName, unit: '' },
  ];
}

// --------------------------------------------------------------------------
// Chart — hourly power over day
// --------------------------------------------------------------------------

// Saknas timserien ritas INGEN graf. Tidigare fyllde anropen i en påhittad
// platt kurva på halva kapaciteten — en uppdiktad graf i ett kunddokument är
// värre än ingen graf alls (granskningsfynd D2).
function hasHourly(hourly) {
  return Array.isArray(hourly) && hourly.length === 24 && hourly.every((v) => Number.isFinite(v));
}

function PowerChart({ hourly, cap, height = 140, width = 682, theme = 'light' }) {
  if (!hasHourly(hourly)) return null;
  // Golv på 1 så vi aldrig delar med 0 (NaN-koordinater) när cap/hourly är 0.
  const max = Math.max(cap, ...hourly, 1) * 1.08;
  const ax = { left: 32, right: 10, top: 8, bottom: 22 };
  const W = width - ax.left - ax.right;
  const H = height - ax.top - ax.bottom;
  const barW = W / 24;
  // D1-fix: fg var oanvänd — borttagen
  const muted = theme === 'dark' ? 'rgba(255,255,255,.4)' : BRAND.mute;
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,.12)' : BRAND.lineSoft;
  const capColor = BRAND.accent;
  const barColor = theme === 'dark' ? 'rgba(244,96,54,.8)' : BRAND.accent;
  const barBg = theme === 'dark' ? 'rgba(255,255,255,.08)' : '#F1EEE8';

  const yTicks = [0, max * 0.25, max * 0.5, max * 0.75, max].map((v, i) => ({
    v, y: ax.top + H - (v / max) * H, label: Math.round(v) + ' kW', show: i % 2 === 0,
  }));

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* gridlines */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={ax.left} x2={width - ax.right} y1={t.y} y2={t.y} stroke={gridColor} strokeWidth="1" />
          {t.show && <text x={ax.left - 6} y={t.y + 3} fontSize="9" fill={muted} textAnchor="end" fontFamily={BRAND.mono}>{t.label}</text>}
        </g>
      ))}
      {/* capacity line */}
      <line x1={ax.left} x2={width - ax.right} y1={ax.top + H - (cap / max) * H} y2={ax.top + H - (cap / max) * H} stroke={capColor} strokeWidth="1" strokeDasharray="3 3" />
      <rect x={ax.left + 2} y={ax.top + H - (cap / max) * H - 13} width={70} height={11} fill={theme === 'dark' ? BRAND.ink : '#fff'} opacity="0.92" />
      <text x={ax.left + 5} y={ax.top + H - (cap / max) * H - 4} fontSize="9" fill={capColor} textAnchor="start" fontFamily={BRAND.mono} fontWeight="700">TAK {Math.round(cap)} kW</text>
      {/* bars */}
      {hourly.map((v, i) => {
        const h = (v / max) * H;
        return (
          <g key={i}>
            <rect x={ax.left + i * barW + 1.5} y={ax.top + H - H} width={barW - 3} height={H} fill={barBg} />
            <rect x={ax.left + i * barW + 1.5} y={ax.top + H - h} width={barW - 3} height={h} fill={barColor} />
          </g>
        );
      })}
      {/* hour axis */}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={ax.left + (h + 0.5) * barW} y={height - 6} fontSize="9" fill={muted} textAnchor="middle" fontFamily={BRAND.mono}>{String(h).padStart(2, '0')}</text>
      ))}
    </svg>
  );
}

// Range bar: en stapel per plats, alla lika höga eftersom MODELLEN ger alla
// platser samma energi. Det är ett modellgenomsnitt, inte en utfästelse:
// Amp5 fördelar efter prioritet och kö (handbok 8.3.1, 8.5), så enskilda bilar
// får olika mycket. Bildtexten måste säga det (granskningsfynd A3).
// Höjden kodar räckvidden mot en fast referens så grafiken är jämförbar
// mellan rapporter.
// Skalan och synlighetsgolvet ligger på modulnivå så att bildtexten kan härleda
// sina tal ur samma konstanter i stället för att upprepa dem.
//
// Golvet var tidigare 8 PIXLAR, vilket gjorde avkortningströskeln beroende av
// stapelhöjden: 53 km vid height=60 men 61 km vid height=52. Bildtexten kunde
// bara stämma för en av dem, och gjorde det bara för att den råkade sitta hos
// rätt anrop. Som ANDEL av höjden blir tröskeln densamma oavsett höjd.
// 8/60 är den gamla andelen vid standardhöjden, så utseendet är oförändrat.
const RANGE_REF_KM = 400;              // fast skala 0–400 km
const RANGE_MIN_FRAC = 8 / 60;         // synlighetsgolv som andel av höjden
const RANGE_FLOOR_KM = Math.round(RANGE_REF_KM * RANGE_MIN_FRAC); // 53

function RangeStrip({ perOutletKm, outlets, width = 682, height = 60 }) {
  const N = Math.min(outlets, 80);
  const gap = 4;
  const dot = (width - gap * (N - 1)) / N;
  const frac = Math.max(RANGE_MIN_FRAC, Math.min(1, perOutletKm / RANGE_REF_KM));
  const h = height * frac;
  return (
    <div style={{ width }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
        {Array.from({ length: N }, (_, i) => (
          <div key={i} style={{
            width: dot, height: h,
            background: `linear-gradient(180deg, ${BRAND.accent} 0%, ${BRAND.accentDeep} 100%)`,
            borderRadius: 1,
          }} />
        ))}
      </div>
      {outlets > 80 && <div style={{ fontSize: 9, color: BRAND.mute, marginTop: 4, fontFamily: BRAND.mono }}>× {outlets} platser totalt</div>}
    </div>
  );
}

// Varningar som skärmen visar men rapporten tidigare teg om (granskningsfynd):
// missat energimål i hubs-läget och trickle-laddning vid samtidig peak.
// Texter och trösklar delas med UI:t via Amp5Calc (LIMIT_REASON_LABEL, MAX_SESSIONS_PER_HUB).
function pdfWarnings(data) {
  const Amp = window.Amp5Calc;
  const warns = [];
  if (data.mode === 'hubs' && data.outputs && data.outputs.achievesTarget === false) {
    // Alla bindande orsaker, inte bara den primära (granskningsfynd G11).
    const skal = (data.outputs.limitReasons && data.outputs.limitReasons.length)
      ? data.outputs.limitReasons
      : [data.outputs.limitReason];
    const reason = skal.map((r) => Amp.LIMIT_REASON_LABEL[r]).filter(Boolean).join(' och ')
      || 'ej uppnåeligt med vald konfiguration';
    warns.push(`Energimålet ${Amp.fmt(data.inputs.desiredKWhPerOutlet, { digits: 0 })} kWh/plats nås inte — `
      + `systemet levererar ${Amp.fmt(data.outputs.actualEnergyPerOutlet, { digits: 1 })} kWh `
      + `(${Amp.fmt(data.outputs.shortfallKWh, { digits: 1 })} kWh under målet), ${reason}.`);
  }
  // Kö och sessionstak (handbok 3.1, 8.3.1). Ersätter den gamla trickle-varningen,
  // som utgick från att effekten späds ut jämnt över alla bilar — det gör Amp5 inte.
  const q = data.queue;
  if (q) {
    if ((q.sessionOverflowMax || 0) > 0.5) {
      warns.push(`Fler bilar än SmartHubben tar sessioner för: vid topp står `
        + `${Amp.fmt(q.sessionOverflowMax, { digits: 0 })} bilar utan laddsession `
        + `(${Amp.fmt(q.maxPresent, { digits: 0 })} närvarande mot taket ${q.sessionCapacity}). `
        + `En SmartHub kör max ${Amp.MAX_SESSIONS_PER_HUB} simultana sessioner.`);
    }
    const present = q.presentAtPeak || 0;
    const queueShare = present > 0.5 ? (q.queuedAtPeak || 0) / present : 0;
    // Utan angivet energibehov finns inget behov att missa — då är kö bara
    // lastbalansering. Samma villkor som skärmen; saknades här och lät
    // kundrapporten påstå ett underskott mot ett behov kunden aldrig angett.
    const harBehov = q.sessionNeedKWh != null;
    // Visa inte kövarningen när överskottsvarningen redan täcker samma sak.
    if (harBehov && !q.needLimited && queueShare > 0.4 && (q.chargingAtPeak || 0) > 0
        && (q.sessionOverflowMax || 0) <= 0.5) {
      warns.push(`Kö vid topplast: ${Amp.fmt(q.chargingAtPeak, { digits: 0 })} av `
        + `${Amp.fmt(present, { digits: 0 })} bilar laddar samtidigt à `
        + `ca ${Amp.fmt(q.perCarAtPeakKW, { digits: 1 })} kW, resten väntar på tur. `
        + `Bilarna når inte sitt energibehov under parkeringen.`);
    }
  }
  // Energi per laddtillfälle över bilens batteri. Utan angivet energibehov
  // laddar modellen så länge bilen står, vilket vid lång parkeringstid och låg
  // beläggning gav 148 kWh per session och "922 km" i den här rapporten — för
  // en bil som går 600 km på fullt batteri. Modellen har rätt om anläggningen;
  // det är påståendet om bilen som blir omöjligt. Skärmen flaggar det sedan
  // tidigare, men utan den här raden kunde talet ändå exporteras till kund.
  const perSession = data.mode === 'hubs'
    ? (data.outputs && data.outputs.deliveredEnergyPerOutlet)
    : (data.outputs && data.outputs.perOutletKWh);
  const batteri = data.inputs && data.inputs.carBattery;
  if (perSession > 0 && batteri > 0 && perSession > batteri) {
    warns.push(`Energin per laddtillfälle (${Amp.fmt(perSession, { digits: 0 })} kWh) överstiger `
      + `${data.inputs.carName}s batteri på ${Amp.fmt(batteri, { digits: 0 })} kWh. `
      + `Anläggningen kan leverera det, men bilen kan inte ta emot det — `
      + `räckvidden ovan förutsätter att bilen rymmer hela mängden. `
      + `Ange ett energibehov per bil för ett realistiskt tal.`);
  }
  return warns;
}

function PDFWarningStrip({ warns }) {
  if (!warns.length) return null;
  return (
    <div style={{
      margin: '14px 56px 0 56px', padding: '8px 14px',
      background: '#FFF3E0', borderLeft: '4px solid #E65100',
      fontSize: 9.5, lineHeight: 1.5, color: '#5C2E00', fontWeight: 600,
    }}>
      {warns.map((w, i) => <div key={i}>⚠ {w}</div>)}
    </div>
  );
}

// --------------------------------------------------------------------------
// Variant 1: Editorial — magazine feel
// --------------------------------------------------------------------------

function PDFEditorial({ data }) {
  const Amp = window.Amp5Calc;
  const warns = pdfWarnings(data);
  const primary = data.mode === 'energy'
    ? { value: Math.round(data.outputs.perOutletKWh), unit: 'kWh', label: 'Energi per laddtillfälle' }
    : { value: data.outputs.hubs, unit: 'st', label: 'SmartHubs som krävs' };

  // Levererad energi, aldrig kapacitetstaket — och via Amp5Calc.rangeKm så att
  // bilens laddförlust dras av på samma sätt som på skärmen (G1, C2).
  const levereratKWh = data.mode === 'energy'
    ? data.outputs.perOutletKWh
    : data.outputs.deliveredEnergyPerOutlet;
  const rangeKm = Math.round(window.Amp5Calc.rangeKm(levereratKWh, data.inputs.carKwh100));

  const inputs = summarizeInputs(data);

  return (
    <>
      {/* =========== PAGE 1 =========== */}
      <Page id="ed-1">
        {/* masthead */}
        <div style={{ padding: '44px 56px 0 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <img src={window.Amp5Assets.logo} alt="AmpSociety" style={{ display: 'block', height: 22, width: 'auto' }} />
          <div style={{ fontFamily: BRAND.mono, fontSize: 9, color: BRAND.mute, textAlign: 'right', letterSpacing: 0.8 }}>
            <div>{data.meta.date}</div>
            <div>Rapport #{data.meta.reportId}</div>
          </div>
        </div>

        {/* hero */}
        <div style={{ padding: '56px 56px 0 56px' }}>
          {/* U2-fix: visa projektnamn endast om användaren angett ett */}
          <Eyebrow>{data.mode === 'energy' ? 'Energianalys' : 'Dimensionering'}{data.meta.projectName ? ` · ${data.meta.projectName}` : ''}</Eyebrow>
          <div style={{ height: 14 }} />
          <div style={{
            fontFamily: BRAND.serif, fontSize: 56, fontWeight: 500,
            lineHeight: 1.02, letterSpacing: -1.2, color: BRAND.ink,
            maxWidth: 600,
          }}>
            {data.mode === 'energy'
              ? (<>Så mycket energi<br/>får varje plats.</>)
              : (<>Så dimensioneras<br/>er laddinfrastruktur.</>)}
          </div>
          <div style={{ height: 22 }} />
          <Balk width={64} />
          <div style={{ height: 20 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55, color: BRAND.ink2, maxWidth: 440 }}>
            Den här rapporten är genererad ur AmpSocietys laddkalkylator
            baserat på era inmatade värden. Den ska ses som ett
            dimensioneringsunderlag, inte en bindande offert.
          </div>
        </div>

        {/* hero number + image */}
        <div style={{
          margin: '36px 56px 0 56px',
          display: 'grid', gridTemplateColumns: '1fr 260px', gap: 32,
          alignItems: 'flex-end',
        }}>
          <div>
            <Eyebrow style={{ marginBottom: 10 }}>{primary.label}</Eyebrow>
            <Num value={primary.value.toLocaleString('sv-SE')} unit={primary.unit} size={124} weight={500} />
            <div style={{ height: 12 }} />
            <div style={{ fontFamily: BRAND.serif, fontStyle: 'italic', fontSize: 17, color: BRAND.accentDeep, lineHeight: 1.35, maxWidth: 360 }}>
              {data.mode === 'energy'
                ? `≈ ${rangeKm} km räckvidd · ${data.inputs.carName}`
                : `Levererar ${window.Amp5Calc.fmt(levereratKWh, { digits: 0 })} kWh / plats vid ${Math.round((data.inputs.occupancyPct || 0) * 100)} % beläggning`}
            </div>
          </div>
          {/* hero image — Amp5 LED detail */}
          <div style={{
            height: 220, position: 'relative', overflow: 'hidden',
            background: '#272120',
          }}>
            <img src={window.Amp5Assets.ledDetail} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        </div>

        {/* Inputs — table */}
        <div style={{ margin: '40px 56px 0 56px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <Balk width={24} color={BRAND.ink} height={3} style={{ position: 'relative', top: -6 }} />
            <div style={{ fontFamily: BRAND.serif, fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}>Utgångsläge</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 14, columnGap: 24, borderTop: `1px solid ${BRAND.ink}`, paddingTop: 14 }}>
            {inputs.map((row, i) => (
              <div key={i}>
                <div style={{ fontSize: 9, color: BRAND.mute, letterSpacing: 1.3, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{row.label}</div>
                <div style={{ fontFamily: BRAND.serif, fontSize: 24, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1 }}>
                  {row.value}{row.unit && <span style={{ fontFamily: BRAND.sans, fontSize: 11, color: BRAND.mute, fontWeight: 400, marginLeft: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{row.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* chart — hela blocket utgår om timserien saknas, rubrik och allt */}
        {hasHourly(data.outputs.hourly) && (
        <div style={{ margin: '28px 56px 0 56px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <Balk width={24} color={BRAND.ink} height={3} style={{ position: 'relative', top: -6 }} />
              <div style={{ fontFamily: BRAND.serif, fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}>Effektuttag över dygnet</div>
            </div>
            <div style={{ fontFamily: BRAND.mono, fontSize: 10, color: BRAND.mute, letterSpacing: 1 }}>kW · {data.inputs.profileLabel || 'Profil'}</div>
          </div>
          <PowerChart hourly={data.outputs.hourly} cap={data.outputs.effectiveCap} height={130} width={682} />
        </div>
        )}

        <PDFFooter page={1} total={2} date={data.meta.date} version={data.meta.version} />
      </Page>

      {/* =========== PAGE 2 =========== */}
      <Page id="ed-2">
        {/* Sida 2 är en flexkolumn där miljöbilden är det elastiska elementet.
            Tidigare hade bilden fast höjd med en handtrimmad specialregel för
            varningsremsan — när antagande- eller friskrivningstexten växte sköts
            den i stället ut ur sidan och klipptes bort tyst (overflow: hidden).
            Nu ger bilden ifrån sig utrymme automatiskt och texten överlever. */}
        <div style={{
          height: '100%', display: 'flex', flexDirection: 'column',
          paddingBottom: 54, boxSizing: 'border-box',
        }}>
        {/* range strip hero */}
        <div style={{ padding: '40px 56px 0 56px' }}>
          <Eyebrow>Räckvidd per plats</Eyebrow>
          <div style={{ height: 14 }} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ fontFamily: BRAND.serif, fontSize: 40, fontWeight: 500, letterSpacing: -0.8, lineHeight: 1, color: BRAND.ink }}>
              Varje bil får{' '}
              <span style={{ color: BRAND.accent }}>{rangeKm} km</span>
              <br/><span style={{ fontStyle: 'italic', color: BRAND.ink2 }}>i räckvidd tillbaka.</span>
            </div>
            <div style={{ fontFamily: BRAND.mono, fontSize: 10, color: BRAND.mute, letterSpacing: 1, textAlign: 'right' }}>
              {data.inputs.carName}<br/>{Amp.fmt(data.inputs.carKwh100, { digits: 1 })} kWh/100 km
            </div>
          </div>
          <div style={{ height: 24 }} />
          <RangeStrip perOutletKm={rangeKm} outlets={data.inputs.outlets} width={682} />
          <div style={{ height: 10 }} />
          <div style={{ fontSize: 10, color: BRAND.mute, fontFamily: BRAND.mono, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            En stapel = en plats. Staplarna visar modellens genomsnitt per plats, inte
            enskilda bilar — faktisk fördelning styrs av lastbalanseringens prioritetsordning.
            Höjden är avkortad under {RANGE_FLOOR_KM} km och över {RANGE_REF_KM} km; läs värdet i siffran ovan.
          </div>
        </div>

        {/* Elnätsbedömning badge (F1) — sida 2 för att inte pressa sida 1 */}
        {data.gridAssessment && (
          <GridStatusBadgePDF assessment={data.gridAssessment} />
        )}

        {/* Varningar — samma som skärmen visar (missat mål / trickle) */}
        <PDFWarningStrip warns={warns} />

        {/* Investeringskalkyl (F2) — visas om data finns och kapital > 0 */}
        {data.economics && data.economics.capitalCost > 0 && (
          <EconomicsSectionPDF economics={data.economics} />
        )}

        {/* Environment image — Amp5 exterior parking. Elastisk: tar det utrymme
            som blir över när texten fått sitt. Finns varningar att visa utgår
            bilden helt — en dekorativ bild ska aldrig tränga undan en varning
            eller friskrivningen (sidan har overflow: hidden och klipper tyst). */}
        {warns.length ? <div style={{ flex: '1 1 0', minHeight: 8 }} /> : (
        <div style={{
          margin: '16px 56px 0 56px',
          flex: '1 1 0', minHeight: 40, maxHeight: 130,
          position: 'relative', overflow: 'hidden',
          background: '#0F0C0B',
        }}>
          <img src={window.Amp5Assets.exteriorParking} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.65) 100%)' }} />
          <div style={{ position: 'absolute', bottom: 20, left: 20, right: 20, maxWidth: 440 }}>
            <div style={{ fontFamily: BRAND.serif, fontStyle: 'italic', fontSize: 20, color: '#fff', lineHeight: 1.25, textShadow: '0 2px 8px rgba(0,0,0,.6)' }}>
              "Dimensionera rätt från början, undvik plåsterlösningar."
            </div>
          </div>
        </div>
        )}

        {/* CTA block with orange wash */}
        <div style={{
          margin: '16px 56px 0 56px',
          background: BRAND.accentWash, padding: '22px 32px',
          display: 'grid', gridTemplateColumns: '1fr 112px', gap: 24, alignItems: 'center',
        }}>
          <div>
            <Eyebrow color={BRAND.accentDeep}>Nästa steg</Eyebrow>
            <div style={{ height: 10 }} />
            <div style={{ fontFamily: BRAND.serif, fontSize: 28, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1.05, color: BRAND.ink, marginBottom: 10 }}>
              Boka ett möte.<br/><span style={{ fontStyle: 'italic' }}>Vi går igenom ert förslag.</span>
            </div>
            <div style={{ fontSize: 12, color: BRAND.ink2, lineHeight: 1.5, maxWidth: 380 }}>
              Vi tar fram en dimensioneringsplan, kostnadsuppskattning och
              tidplan utifrån era värden. Skanna koden för att öppna
              kalkylatorn igen, eller kontakta oss direkt.
            </div>
            <div style={{ height: 18 }} />
            <div style={{ fontFamily: BRAND.mono, fontSize: 11, color: BRAND.ink }}>
              {CONTACT_EMAIL}
            </div>
          </div>
          <div>
            <QRCode size={112} />
            <div style={{ fontSize: 8, letterSpacing: 1, fontFamily: BRAND.mono, color: BRAND.accentDeep, textAlign: 'center', marginTop: 6, textTransform: 'uppercase', fontWeight: 700 }}>Öppna igen</div>
          </div>
        </div>

        {/* Assumptions */}
        <div style={{ margin: '12px 56px 0 56px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: BRAND.mute, marginBottom: 8 }}>Antaganden</div>
            <div style={{ fontSize: 10.5, lineHeight: 1.6, color: BRAND.ink2 }}>
              Beräkningen utgår från ett SmartHub-system med {data.const.capPerHub} kW max simultan
              laddeffekt per hub, {data.const.outletsPerHub} uttag och {Amp.MAX_SESSIONS_PER_HUB} simultana
              laddsessioner per hub.
              Beläggningsprofilen <em>{data.inputs.profileLabel}</em> faltas med
              parkeringstidsfönstret och skalas så att antalet bilplatstimmar per
              dygn matchar vald topp-beläggning. Vid lång parkeringstid blir
              närvarokurvans topp därför lägre än profilens — en bil som står nio
              timmar kan inte ge en skarpare topp än så. Effekten fördelas som i Amp5:s lastbalansering
              ({data.const.strategy}): startström i prioritetsordning tills
              kapaciteten är slut, resten köar — inget fordon laddar under 6 A.
              {data.mode === 'energy' && data.inputs.sessionNeedKWh > 0
                ? <> Varje bil antas behöva högst {data.inputs.sessionNeedKWh} kWh per laddtillfälle.</>
                : null}
              {' '}Räckvidd beräknas mot WLTP-förbrukning med avdrag för fordonets
              laddförlust. Vintertid räkna 20–40 % högre energiåtgång per km.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: BRAND.mute, marginBottom: 8 }}>Ansvar & risker</div>
            <div style={{ fontSize: 10.5, lineHeight: 1.6, color: BRAND.ink2 }}>
              Siffrorna är modellberäkningar på era indata och ersätter inte
              projektering eller bindande offert från nätägaren. Verkligt utfall
              styrs av fordonsmix, årstid och faktiskt laddbeteende. Priser anges
              exkl. moms. Servisutökning, försäkring, vandalisering och kabelstöld
              omfattas ej. Installation ska utföras av behörig elinstallatör
              enligt ELSÄK-FS.
            </div>
          </div>
        </div>
        </div>

        <PDFFooter page={2} total={2} date={data.meta.date} version={data.meta.version} />
      </Page>
    </>
  );
}

// --------------------------------------------------------------------------
// PDFCompare — side-by-side scenario comparison (single A4 page)
// --------------------------------------------------------------------------

const GRID_TEXT = { ok: 'Räcker', marginal: 'Knapp marginal', upgrade: 'Servisutökning' };

function PDFCompare({ data }) {
  const Amp = window.Amp5Calc;
  const PALETTE = Amp.SCENARIO_PALETTE;
  const scenarios = data.scenarios || [];
  const maxKWh = Math.max(...scenarios.map((s) => s.outputs.perOutletKWh), 1);
  const profileLabelFor = (key) => (Amp.PROFILES[key]?.label || key);

  return (
    <Page id="cmp-1">
      {/* Header */}
      <div style={{ padding: '40px 56px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PDFLogomark size={26} />
            <div style={{ fontFamily: BRAND.serif, fontStyle: 'italic', fontSize: 22, color: BRAND.ink }}>
              Laddkalkylator
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: BRAND.mute }}>Jämförelserapport</div>
            <div style={{ fontSize: 10, color: BRAND.ink2, marginTop: 2 }}>{data.meta.date} · {data.meta.reportId}</div>
          </div>
        </div>
        {/* B1-fix: visa projektnamn om användaren angett ett (tom sträng = ej satt, ingen hårdkodad strängkoll) */}
        {data.meta.projectName && (
          <div style={{ fontFamily: BRAND.mono, fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: BRAND.mute, marginTop: 18 }}>
            {data.meta.projectName}
          </div>
        )}
        <div style={{ fontFamily: BRAND.serif, fontSize: 30, fontWeight: 700, color: BRAND.ink, marginTop: 14, letterSpacing: -0.3 }}>
          Scenarioj&auml;mf&ouml;relse
        </div>
        {/* Balken — direkt under rubriken per brand-manual */}
        <Balk style={{ marginTop: 12 }} />
        <div style={{ fontSize: 11, color: BRAND.mute, marginTop: 6 }}>
          Sida vid sida-utvärdering. Räckvidd beräknad mot {data.car.name} ({Amp.fmt(data.car.kwh100, { digits: 1 })} kWh/100&nbsp;km).
        </div>
      </div>

      {/* Scenario grid */}
      <div style={{
        margin: '28px 56px 0',
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(scenarios.length, 6)}, 1fr)`,
        gap: 12,
      }}>
        {scenarios.map((sc, i) => {
          const color = PALETTE[(sc.colorIndex != null ? sc.colorIndex : i) % PALETTE.length];
          const inp = sc.inputs;
          const out = sc.outputs;
          const isLimited = out.effectiveCap < out.installedCap;
          return (
            <div key={sc.colorIndex != null ? sc.colorIndex : i} style={{
              border: `1px solid ${BRAND.line}`,
              borderTop: `3px solid ${color}`,
              padding: '12px 12px 14px',
              background: BRAND.paper,
              breakInside: 'avoid',
            }}>
              <div style={{
                fontFamily: BRAND.mono, fontSize: 9, fontWeight: 700,
                letterSpacing: 1.2, textTransform: 'uppercase', color,
                paddingBottom: 8, borderBottom: `1px solid ${BRAND.lineSoft}`, marginBottom: 10,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{sc.name}</div>

              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <div style={{ fontFamily: BRAND.serif, fontSize: 30, fontWeight: 700, color, lineHeight: 1, letterSpacing: -1 }}>
                  {Amp.fmt(out.perOutletKWh, { digits: 1 })}
                </div>
                <div style={{ fontSize: 8.5, color: BRAND.mute, marginTop: 3 }}>kWh / uttag</div>
              </div>

              <PDFCompareRow k="Profil" v={profileLabelFor(inp.profileKey)} />
              <PDFCompareRow k="Uttag" v={inp.outlets} />
              <PDFCompareRow k="SmartHubs" v={out.hubs} />
              <PDFCompareRow k="Parkering" v={`${inp.parkingHours} h`} />
              {/* "Topp" visade REGLAGETS värde men såg ut som ett resultat.
                  Med kontorsprofil och 95 % på reglaget är den faktiska toppen
                  87 % — rapporten påstod alltså en högre beläggning än modellen
                  räknar med. PDFEditorial visar båda sedan v3.8.3
                  ("Peak-beläggning (profil)" / "Faktisk topp"); compare fick
                  aldrig samma fix. Samma två rader och samma ord här. */}
              <PDFCompareRow k="Peak-beläggning" v={`${Math.round(inp.peakOcc * 100)} %`} />
              <PDFCompareRow k="Faktisk topp" v={`${Math.round((out.peakOccupancyPct || 0) * 100)} %`} />
              <PDFCompareRow k="kW/hub" v={inp.capPerHub} />
              {inp.systemCap != null && <PDFCompareRow k="Systemtak" v={`${inp.systemCap} kW`} />}

              <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BRAND.lineSoft}` }}>
                <PDFCompareRow k="Räckvidd" v={`${Amp.fmt(sc.rangeKm, { digits: 0 })} km`} highlight={color} />
                <PDFCompareRow k="Topp-effekt" v={`${Amp.fmt(out.peakPowerKW, { digits: 0 })} kW`} />
                <PDFCompareRow k="Laddn./uttag·dygn" v={
                  out.sessionsPerOutletPerDay >= 10
                    ? Amp.fmt(out.sessionsPerOutletPerDay, { digits: 0 })
                    : Amp.fmt(out.sessionsPerOutletPerDay, { digits: 1 })
                } />
                <PDFCompareRow k="kWh/uttag·dygn" v={`${Amp.fmt(out.kwhPerOutletPerDay, { digits: 0 })} kWh`} />
                <PDFCompareRow k="Installerad" v={`${out.installedCap} kW`} />
                {isLimited && <PDFCompareRow k="Effektiv" v={`${out.effectiveCap} kW`} highlight={BRAND.accentDeep} />}
                <PDFCompareRow k="Total/dygn" v={`${Amp.fmt(out.totalEnergyDay, { digits: 0 })} kWh`} />
              </div>

              {/* Elnät och drift per scenario. Jämförelserapporten saknade båda
                  — den visade bara kWh och räckvidd, alltså inte det som avgör
                  valet. Investeringen ingår inte: material och installation är
                  klumpbelopp för hela projektet och går inte att fördela per
                  scenario utan att gissa ett pris per hub. */}
              {(sc.grid || sc.ek) && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BRAND.lineSoft}` }}>
                  {sc.grid && (
                    <PDFCompareRow
                      k="Elnät"
                      v={`${GRID_TEXT[sc.grid.status] || sc.grid.status} · ${sc.grid.surplusKW >= 0 ? '+' : ''}${Amp.fmt(sc.grid.surplusKW, { digits: 0 })} kW`}
                      highlight={sc.grid.status !== 'ok' ? BRAND.accentDeep : undefined} />
                  )}
                  {sc.ek && sc.ek.monthlyEnergyCost > 0 && (
                    <PDFCompareRow k="Elkostnad/mån" v={`${Amp.fmt(sc.ek.monthlyEnergyCost, { digits: 0 })} kr`} />
                  )}
                  {sc.ek && sc.ek.monthlyPowerCost > 0 && (
                    <PDFCompareRow k="Effektavgift/mån" v={`${Amp.fmt(sc.ek.monthlyPowerCost, { digits: 0 })} kr`} />
                  )}
                </div>
              )}

              {/* Jämförelserapporten hade INGA varningar alls — pdfWarnings()
                  anropas bara av PDFEditorial. Ett scenario med lång
                  parkeringstid och låg beläggning kunde därför skriva ut
                  148,6 kWh och "922 km" rakt in i kundens hand utan att något
                  sades. Varningen hör hemma i kortet snarare än i en remsa:
                  den gäller ett scenario, inte rapporten. */}
              {data.car.battery > 0 && out.perOutletKWh > data.car.battery && (
                <div style={{
                  marginTop: 8, padding: '6px 7px',
                  background: BRAND.accentWash,
                  borderLeft: `2px solid ${BRAND.accent}`,
                  fontSize: 7.5, lineHeight: 1.35, color: BRAND.ink2,
                }}>
                  ⚠ Över {data.car.name}s batteri ({Amp.fmt(data.car.battery, { digits: 0 })} kWh).
                  Bilen kan inte ta emot hela mängden — ange energibehov per bil.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Comparison strip */}
      {scenarios.length > 1 && (
        <div style={{ margin: '24px 56px 0' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: BRAND.mute, marginBottom: 10 }}>
            Relativ jämförelse · kWh per uttag
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scenarios.map((sc, i) => {
              const color = PALETTE[(sc.colorIndex != null ? sc.colorIndex : i) % PALETTE.length];
              const pct = (sc.outputs.perOutletKWh / maxKWh) * 100;
              return (
                <div key={sc.colorIndex != null ? sc.colorIndex : i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 70px', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: BRAND.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: 1.1, color, textTransform: 'uppercase' }}>
                    {sc.name}
                  </span>
                  <div style={{ height: 6, background: BRAND.lineSoft, borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                  </div>
                  <span style={{ fontFamily: BRAND.mono, fontSize: 9.5, color: BRAND.ink, textAlign: 'right' }}>
                    {Amp.fmt(sc.outputs.perOutletKWh, { digits: 1 })} kWh
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Method + assumptions */}
      <div style={{ margin: '24px 56px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, borderTop: `1px solid ${BRAND.line}`, paddingTop: 18 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: BRAND.mute, marginBottom: 8 }}>Beräkningsmetod</div>
          <div style={{ fontSize: 10, lineHeight: 1.55, color: BRAND.ink2 }}>
            Av bilarna som står på en plats en viss timme antas en andel
            1/parkeringstiden ha anlänt just då, faltat med parkeringstidsfönstret.
            Kurvan skalas så att antalet bilplatstimmar per dygn matchar vald
            topp-beläggning. Effekten per aktiv bil är
            startström i prioritetsordning tills kapaciteten är förbrukad; resten
            köar. Inget fordon laddar under 6 A.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: BRAND.mute, marginBottom: 8 }}>Konstanter</div>
          <div style={{ fontSize: 10, lineHeight: 1.55, color: BRAND.ink2 }}>
            SmartHub: {data.const.capPerHub} kW max simultan effekt, {data.const.outletsPerHub} uttag
            och {Amp.MAX_SESSIONS_PER_HUB} simultana laddsessioner per hub.
            Bilens AC-tak: {data.const.carAcLimit ?? Amp.HW_LIMIT_KW} kW.
            Verkningsgrad: {Math.round((data.const.efficiency ?? Amp.DEFAULT_EFFICIENCY) * 100)}%.
            {data.const.sessionNeedKWh > 0
              ? <> Energibehov: {data.const.sessionNeedKWh} kWh/laddtillfälle.</>
              : null}
            {' '}Räckvidd via WLTP-blandad körcykel med avdrag för fordonets
            laddförlust; vintertid 20–40 % högre åtgång.
          </div>
        </div>
      </div>

      <PDFFooter page={1} total={1} date={data.meta.date} version={data.meta.version} />
    </Page>
  );
}

function PDFCompareRow({ k, v, highlight }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      fontSize: 9.5, padding: '3px 0',
      borderBottom: `1px solid ${BRAND.lineSoft}`,
    }}>
      <span style={{ color: BRAND.mute }}>{k}</span>
      <span style={{ color: highlight || BRAND.ink, fontFamily: BRAND.mono }}>{v}</span>
    </div>
  );
}

// --------------------------------------------------------------------------
// F1: Elnätsbedömning badge — compact 4-column bar for PDF page 1
// --------------------------------------------------------------------------

function GridStatusBadgePDF({ assessment }) {
  const Amp = window.Amp5Calc;
  const { status, servisKW, availableKW, surplusKW, upgradeCostLow, upgradeCostHigh } = assessment;
  const STATUS_CFG = {
    ok:       { color: '#2E7D32', bg: '#E8F5E9', label: 'Elnät: OK' },
    marginal: { color: '#E65100', bg: '#FFF3E0', label: 'Elnät: Marginellt' },
    upgrade:  { color: '#C62828', bg: '#FFEBEE', label: 'Elnät: Utökning krävs' },
  };
  const cfg = STATUS_CFG[status] || STATUS_CFG.ok;
  const cols = [
    { label: 'Elnätsstatus', val: cfg.label, bold: true, color: cfg.color },
    { label: 'Serviseffekt', val: `${Amp.fmt(servisKW, { digits: 0 })} kW` },
    { label: 'Tillgänglig',  val: `${Amp.fmt(availableKW, { digits: 0 })} kW` },
    { label: 'Överskott',    val: `${surplusKW >= 0 ? '+' : ''}${Amp.fmt(surplusKW, { digits: 0 })} kW`,
      color: surplusKW >= 0 ? '#2E7D32' : '#C62828' },
  ];
  return (
    <div style={{ margin: '14px 56px 0 56px' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        background: cfg.bg,
        border: `1px solid ${BRAND.line}`, borderLeft: `4px solid ${cfg.color}`,
      }}>
        {cols.map((c, i) => (
          <div key={i} style={{
            padding: '10px 14px',
            borderLeft: i > 0 ? `1px solid ${BRAND.line}` : 'none',
          }}>
            <div style={{ fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: BRAND.mute, fontWeight: 700, marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{
              fontFamily: c.bold ? BRAND.sans : BRAND.serif,
              fontSize: c.bold ? 11 : 20,
              fontWeight: c.bold ? 700 : 500,
              letterSpacing: c.bold ? 0 : -0.3,
              color: c.color || BRAND.ink,
              lineHeight: 1.15,
            }}>
              {c.val}
            </div>
          </div>
        ))}
      </div>
      {(status === 'upgrade' || status === 'marginal') && upgradeCostLow > 0 && (
        <div style={{
          marginTop: 4, padding: '6px 14px',
          background: cfg.bg, borderLeft: `4px solid ${cfg.color}`,
          border: `1px solid ${BRAND.line}`, borderTop: 'none',
          fontSize: 9, color: cfg.color, fontWeight: 600, letterSpacing: 0.3,
        }}>
          {(() => {
            const fmtC = (kr) => kr >= 1_000_000
              ? `${Amp.fmt(kr / 1_000_000, { digits: 1 })} Mkr`
              : `${Amp.fmt(kr / 1000, { digits: 0 })} kkr`;
            return `Indikativ kostnad för servisutökning: ${fmtC(upgradeCostLow)}–${fmtC(upgradeCostHigh)}`;
          })()}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// F2: Ekonomi section — compact 3-column grid for PDF page 2
// --------------------------------------------------------------------------

function EconomicsSectionPDF({ economics }) {
  const Amp = window.Amp5Calc;
  const {
    capitalCost, materialCost, installationCost, investmentGrant, netCapitalCost,
    monthlyEnergyCost, monthlyPowerCost, monthlyOmCost,
    monthlyRevenue, monthlyEnergyKWh, monthlyPurchasedKWh, paybackYears, paybackMonths,
    electricityPrice, chargingFee, daysPerMonth,
  } = economics;
  const hasGrant = (investmentGrant || 0) > 0;
  const hasRevenue = monthlyRevenue > 0;
  // H1: total månadskostnad inkl. effekttariff och O&M (mer realistisk än bara energikostnad)
  const monthlyTotalCost = (monthlyEnergyCost || 0) + (monthlyPowerCost || 0) + (monthlyOmCost || 0);
  // Tredje kolumn: återbetalningstid om möjlig, annars intäkt om satt, annars energi/mån
  // Går kalkylen med förlust ska rapporten säga det lika tydligt som skärmen —
  // tidigare byttes kolumnen tyst mot intäkt eller energi (granskningsfynd G10).
  const gorForlust = hasRevenue && paybackYears == null;
  const thirdCol = hasRevenue && paybackYears != null
    ? { label: 'Återbetalning (enkel)', v: paybackYears < 1 ? `${Math.round(paybackMonths)}` : Amp.fmt(paybackYears, { digits: 1 }), u: paybackYears < 1 ? 'mån' : 'år' }
    : gorForlust
      ? { label: 'Återbetalning', v: 'Ingen', u: '', warn: true }
      : { label: 'Energi / månad', v: Amp.fmt(monthlyEnergyKWh, { digits: 0 }), u: 'kWh' };

  const fmtCapital = (kr) => kr >= 1_000_000
    ? { v: Amp.fmt(kr / 1_000_000, { digits: 1 }), u: 'Mkr' }
    : { v: Amp.fmt(kr / 1000, { digits: 0 }), u: 'kkr' };
  // Med investeringsstöd visas NETTOT som huvudtal (det kunden faktiskt betalar);
  // brutto + stöd redovisas i uppdelningsraden under.
  const capitalFmt = fmtCapital(hasGrant ? netCapitalCost : capitalCost);
  const cols = [
    { label: hasGrant ? 'Investering (netto)' : 'Investering', v: capitalFmt.v, u: capitalFmt.u },
    { label: 'Driftkostnad / mån', v: Amp.fmt(monthlyTotalCost, { digits: 0 }), u: 'kr' },
    thirdCol,
  ];

  return (
    <div style={{ margin: '24px 56px 0 56px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <Balk width={24} color={BRAND.ink} height={3} style={{ position: 'relative', top: -6 }} />
        <div style={{ fontFamily: BRAND.serif, fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}>Investeringskalkyl</div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        borderTop: `1px solid ${BRAND.ink}`, borderBottom: `1px solid ${BRAND.line}`,
      }}>
        {cols.map((m, i) => (
          <div key={i} style={{ padding: '14px 14px', borderRight: i < 2 ? `1px solid ${BRAND.lineSoft}` : 'none' }}>
            <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: BRAND.mute, fontWeight: 700, marginBottom: 6 }}>
              {m.label}
            </div>
            <div style={{ fontFamily: BRAND.serif, fontSize: m.warn ? 20 : 26, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1, color: m.warn ? '#C62828' : BRAND.ink }}>
              {m.v}
              <span style={{ fontFamily: BRAND.sans, fontSize: 10, color: BRAND.mute, fontWeight: 400, marginLeft: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
                {m.u}
              </span>
            </div>
          </div>
        ))}
      </div>
      {/* Investeringsuppdelning + driftkostnadsbreakdown — kompakt 2-kolumns under huvudgriden */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        marginTop: 8, fontSize: 9, color: BRAND.mute, lineHeight: 1.5,
      }}>
        <div>
          <strong style={{ color: BRAND.ink2 }}>Investering: </strong>
          {(materialCost || 0) >= 1_000_000 ? `${Amp.fmt(materialCost / 1_000_000, { digits: 1 })} Mkr` : `${Amp.fmt((materialCost || 0) / 1000, { digits: 0 })} kkr`} material
          {' + '}
          {(installationCost || 0) >= 1_000_000 ? `${Amp.fmt(installationCost / 1_000_000, { digits: 1 })} Mkr` : `${Amp.fmt((installationCost || 0) / 1000, { digits: 0 })} kkr`} installation
          {hasGrant && ` − ${investmentGrant >= 1_000_000 ? `${Amp.fmt(investmentGrant / 1_000_000, { digits: 1 })} Mkr` : `${Amp.fmt(investmentGrant / 1000, { digits: 0 })} kkr`} stöd`}
        </div>
        <div>
          <strong style={{ color: BRAND.ink2 }}>Driftkostnad: </strong>
          {Amp.fmt(monthlyEnergyCost || 0, { digits: 0 })} kr energi
          {(monthlyPowerCost || 0) > 0 && ` + ${Amp.fmt(monthlyPowerCost, { digits: 0 })} kr effektavgift`}
          {(monthlyOmCost || 0) > 0 && ` + ${Amp.fmt(monthlyOmCost, { digits: 0 })} kr D&U`}
        </div>
      </div>
      {/* Priserna bakom paybacken måste stå i rapporten — annars kan mottagaren
          inte kontrollräkna rubriktalet (granskningsfynd E3/E4). */}
      <div style={{ marginTop: 6, fontSize: 9, color: BRAND.mute, lineHeight: 1.5 }}>
        <strong style={{ color: BRAND.ink2 }}>Antaganden: </strong>
        elpris {Amp.fmt(electricityPrice || 0, { digits: 2 })} kr/kWh på
        {' '}{Amp.fmt(monthlyPurchasedKWh || 0, { digits: 0 })} kWh inköpt ·
        laddavgift {chargingFee > 0 ? `${Amp.fmt(chargingFee, { digits: 2 })} kr/kWh` : 'ingen, fri laddning'} ·
        {' '}{Amp.fmt(daysPerMonth || 30, { digits: 0 })} laddningsdagar/mån ·
        {' '}{Amp.fmt(monthlyEnergyKWh || 0, { digits: 0 })} kWh levererat/mån
        {hasRevenue ? ` · intäkt ${Amp.fmt(monthlyRevenue, { digits: 0 })} kr/mån` : ''}.
        {' '}Priser exkl. moms. Återbetalningstiden är enkel och odiskonterad och
        omfattar inte kostnad för eventuell servisutökning.
        {gorForlust ? ' Med angivna priser går driften med förlust — investeringen återbetalar sig inte.' : ''}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Sample data for preview
// --------------------------------------------------------------------------

function sampleData() {
  const Amp = window.Amp5Calc;
  const profile = Amp.PROFILES.office;
  const inputs = {
    outlets: 48,
    hubs: null,
    capPerHub: Amp.CAP_PER_HUB_KW,
    systemCap: null,
    parkingHours: 9,
    profileHours: profile.hours,
    peakOccupancyPct: 0.95,
    profileLabel: profile.label,
    carName: 'Tesla Model 3 LR',
    carKwh100: 14.5,
  };
  const outputs = Amp.computeEnergy(inputs);
  // autoHubs passed through to summary
  inputs.autoHubs = outputs.autoHubs;
  return {
    mode: 'energy',
    inputs,
    outputs,
    const: {
      capPerHub: Amp.CAP_PER_HUB_KW, outletsPerHub: Amp.OUTLETS_PER_HUB,
      carAcLimit: Amp.CAR_AC_LIMIT_KW, efficiency: Amp.DEFAULT_EFFICIENCY,
    },
    meta: {
      projectName: 'Brf Lindhagen · Kungsholmen',
      date: new Date().toLocaleDateString('sv-SE'),
      reportId: 'A5-' + Math.floor(Math.random() * 9000 + 1000),
      version: '3.8.5',
    },
  };
}

Object.assign(window, { PDFEditorial, PDFCompare, PDF_PAGE_W: PAGE_W, PDF_PAGE_H: PAGE_H, samplePDFData: sampleData });

