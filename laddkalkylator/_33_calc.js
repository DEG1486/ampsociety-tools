// calc.js — shared calculation model for Amp5 Laddkalkylator redesign
// Pure functions; no DOM. Expose on window for Babel-transpiled callers.

(function () {
  // Produktkonstanter — avstämt mot SmartHub-spec v2024. Om specen ändras
  // uppdateras dessa här; all känslighet i UI/PDF hämtar via Amp5Calc.
  const CAP_PER_HUB_KW = 44;       // kW per SmartHub (nominal)
  const OUTLETS_PER_HUB = 54;      // fysiska uttag per SmartHub
  // Handbok 3.1: 54 uttag är den fysiska kapaciteten, 30 är taket för hur många
  // sessioner som kan vara igång samtidigt. Enligt precisionsreglerna i
  // avlivade-pastaenden.md MÅSTE "54 uttag" alltid följas av det här talet i
  // externt material — därför ligger det här och inte som en PDF-literal.
  const MAX_SESSIONS_PER_HUB = 30; // simultana laddsessioner per SmartHub
  // SmartHubens inkommande huvudsäkring (handbok 3.1: "Max inkommande ström
  // 63 A", "Huvudsäkring 63 A B"). CAP_PER_HUB_KW ovan ÄR de här 63 A avrundade
  // uppåt: √3 × 400 × 63 / 1000 = 43,648 kW. Skillnaden på 0,81 % betyder inget
  // för energin — men elnätsbedömningen lade den AVRUNDADE märkeffekten på ena
  // sidan av olikheten och en EXAKT beräknad servis på den andra, och lät
  // därmed läroboksfallet "en SmartHub på egen 63 A-servis, ingen annan last"
  // landa på -0,352 kW, status "Servisutökning krävs" och en prislapp på
  // 35-85 kkr (granskningsfynd A2, funnet oberoende av två granskare).
  // Dimensioneringen mot servisen sker därför mot den exakta infeed-gränsen.
  // Energimodellen behåller 44 kW: det är handbokens publicerade tal, och att
  // ändra det där hade flyttat varje kundvänt energital 0,8 % utan att någon
  // bett om det.
  const HUB_INFEED_A = 63;
  const HUB_INFEED_KW = (Math.sqrt(3) * 400 * HUB_INFEED_A) / 1000;
  const OUTLET_HW_LIMIT_KW = 22;   // hub-uttagets HW-tak (Type 2 trefas 32A)
  const CAR_AC_LIMIT_KW = 11;      // typisk modern EV on-board charger (trefas 16A)
  // Bilen är nästan alltid den lägre — endast en liten del av flottan
  // (t.ex. Renault Zoe, BMW i3 trefas) går till 22 kW.
  const HW_LIMIT_KW = Math.min(OUTLET_HW_LIMIT_KW, CAR_AC_LIMIT_KW);

  // Marginalkrav mot tillgänglig serviseffekt för grön elnätsstatus. EN källa:
  // tröskeln avgör statusen i computeGridAssessment OCH skrivs ut som "krav
  // 10 %" i UI:t. De låg tidigare som två oberoende literaler — samma värde,
  // men inget som höll dem ihop. Ändras den ena hade UI:t skrivit ut ett krav
  // som inte tillämpades, tyst.
  const GRID_MARGIN = 0.10;

  // Varningsorsaker från computeHubs när målet inte nås.
  const LIMIT_REASON = Object.freeze({
    HW: 'hwLimit',           // bilens AC-laddartak överskrids
    SYSTEM_CAP: 'systemCap', // fastighetseffekttaket
    HW_CONFIG: 'hwConfig',   // kombinationen tid/beläggning/mål
  });
  // Kort etikett per orsak — delas av UI (hero-undertext) och PDF så texterna
  // aldrig divergerar mellan skärm och kundrapport.
  const LIMIT_REASON_LABEL = Object.freeze({
    [LIMIT_REASON.HW]:         'begränsad av bilens AC-laddartak',
    [LIMIT_REASON.SYSTEM_CAP]: 'begränsad av fastighetseffekttak',
    [LIMIT_REASON.HW_CONFIG]:  'ej uppnåeligt med vald konfiguration',
  });
  // (TRICKLE_LIMIT_KW borttagen 2026-09: tröskeln på 2 kW kunde aldrig nås sedan
  // 6 A-golvet infördes — ingen session körs under 4,16 kW trefas. Varningen om
  // underdimensionering bygger nu på kö-andelen vid topp i stället.)

  // --- Lastbalansering enligt handbok 8.3.1 -------------------------------
  // Amp5 delar INTE ut effekten jämnt över alla närvarande bilar. Startström
  // tilldelas i prioritetsordning tills kapaciteten är förbrukad; sessioner
  // längre ned i ordningen får ingen ström alls. Minimigränsen är 6 A —
  // "inget fordon laddar mellan 0 och 6 A". Felläget vid underdimensionering
  // är alltså KÖ, inte att alla droppar till en rännil.
  const MIN_CHARGE_A = 6;
  const LB_STRATEGY = Object.freeze({
    priority: { key: 'priority', label: 'PriorityMaxPower (standard)', startA: 16 },
    fair:     { key: 'fair',     label: 'FairSharedPower',             startA: 8  },
  });
  const DEFAULT_STRATEGY = 'priority';

  // Fasgränsen: 3,7 och 7,4 kW är enfas (16/32 A), 11 och 22 kW är trefas.
  const isThreePhase = (limitKW) => limitKW > 7.5;
  const ampsToKW = (a, threePhase) => (threePhase ? Math.sqrt(3) * 400 * a : 230 * a) / 1000;

  // Fördelar tillgänglig effekt över de bilar som vill ladda.
  //   cap        kW som finns att fördela
  //   wanting    antal bilar som har session och ännu behöver energi
  //   hwLimit    bilens AC-tak (kW)
  //   startKW    strategins startströmsportion i kW
  //   minKW      6 A uttryckt i kW för aktuell fasning
  // Returnerar effekt per LADDANDE bil och hur många som faktiskt får ström.
  //   maxSlots   tak för antal laddpunkter som kan tilldelas ström samtidigt
  function allocatePower(cap, wanting, hwLimit, startKW, minKW, maxSlots) {
    if (!(cap > 0) || !(wanting > 0)) return { perCar: 0, charging: 0 };
    const start = Math.min(startKW, hwLimit);
    if (start < minKW) return { perCar: 0, charging: 0 };
    const tak = Number.isFinite(maxSlots) ? maxSlots : Infinity;
    if (cap >= wanting * start && wanting <= tak) {
      // Alla kommer igång. Runda 2 fyller på jämnt upp till bilens tak.
      return { perCar: Math.min(hwLimit, cap / wanting), charging: wanting };
    }
    // Kapaciteten (eller platstaket) räcker inte till alla: de som ryms får
    // startström, resten köar. Handbok 8.3.1 räknar taket som tillgänglig
    // ström / minimiströmmen, vilket ger tio punkter per central vid 63 A och
    // 6 A trefas. Enfas ger fler eftersom 6 A då är per fas — samma härledning,
    // annan fasning.
    const charging = Math.min(cap / start, tak);
    return { perCar: Math.min(hwLimit, cap / charging), charging };
  }

  const SCENARIO_PALETTE = ['#F46036', '#58A08B', '#F5A888', '#86341E', '#2E5449', '#B5CDC3'];

  // Beläggningsprofiler (24h, andel 0..1). Formen är det vi bryr oss om;
  // profilen skalas mot användarens avgOccupancyPct vid beräkning.
  // daysPerMonth = aktiva laddningsdagar per månad för ekonomikalkylen —
  // ett kontor är i praktiken dött lör-sön (~21 arbetsdagar), övriga ~30.
  const PROFILES = {
    office: {
      label: 'Kontor',
      daysPerMonth: 21,
      hours: [.05,.05,.05,.05,.05,.1,.3,.6,.85,.95,.95,.9,.75,.85,.9,.85,.7,.45,.25,.15,.1,.08,.05,.05],
    },
    mall: {
      label: 'Köpcentrum',
      daysPerMonth: 30,
      hours: [.05,.05,.05,.05,.05,.05,.1,.15,.25,.45,.65,.8,.85,.85,.85,.9,.95,.9,.75,.55,.35,.2,.1,.05],
    },
    residential: {
      label: 'Bostad',
      daysPerMonth: 30,
      hours: [.85,.9,.9,.9,.85,.75,.55,.3,.15,.1,.1,.15,.2,.2,.25,.35,.55,.75,.85,.9,.9,.9,.88,.85],
    },
    flat: {
      label: 'Jämn',
      daysPerMonth: 30,
      hours: new Array(24).fill(0.5),
    },
  };

  // Bilmodeller — förbrukning (kwh100, kWh/100 km) och ANVÄNDBAR
  // batterikapacitet (battery, kWh).
  //
  // KÄLLA OCH DEFINITION (verifierad mot ev-database.org 2026-09-13 — läs det
  // här innan någon "rättar" räckvidden igen):
  // Talen är EV Databases VERKLIGA förbrukning, inte WLTP. EV Database publicerar
  // tre olika tal per bil, och skillnaden mellan dem avgör om rangeKm ska ha ett
  // η-led eller inte:
  //   Vehicle Consumption (WLTP)  = användbart batteri / WLTP-räckvidd → BATTERISIDIG
  //   Rated Consumption  (WLTP)   = ovanstående + laddförlust          → NÄTSIDIG
  //   Vehicle Consumption (Real)  = användbart batteri / verklig räckvidd → BATTERISIDIG
  // Kontroll: Cupra Born 58 kWh, 350 km verklig räckvidd → 16,6 kWh/100 km, exakt
  // EV Databases 166 Wh/km. Talet är alltså batteri-till-hjul.
  //
  // Tabellen mätt mot 14 bilar: medelkvot 0,974 mot verklig förbrukning (spridning
  // 0,044) och 1,081 mot nätsidig WLTP (spridning 0,069). Tabellen är alltså
  // BATTERISIDIG, och rangeKm:s ONBOARD_EFFICIENCY är korrekt — den omvandlar
  // uttagsmätt AC till energi i batteriet, vilket är precis vad kwh100 förutsätter.
  //
  // Fällan som gav ett falskt granskningsfynd 2026-09-13: `battery / kwh100` ger
  // ~0,85 × tillverkarens WLTP-räckvidd, vilket ser ut som en laddförlust men är
  // gapet mellan WLTP och verklig körning. Jämför aldrig mot WLTP-RÄCKVIDD för att
  // avgöra den här frågan — jämför mot EV Databases FÖRBRUKNINGSTAL.
  //
  // Färskhet: avstämd mot EV Database 2026-09-13. EX30, Kona EV och EV3 låg då
  // 9-11 % under deras verkliga tal och gav därmed ~10 % för lång räckvidd — de
  // är uppdaterade till 17,8 / 16,8 / 17,1 och matchar nu exakt. Övriga ligger
  // inom ±3 %. Stäm av mot ev-database.org vid nästa modellårsuppdatering.
  //
  // batteriet används inte i beräkningen — det är ett rimlighetstak för
  // presentationen. Utan energibehov per bil laddar modellen så länge bilen
  // står, och med lång parkeringstid och låg beläggning gav det sessioner på
  // 148 kWh och "922 km räckvidd" för en bil som går 600 km på fullt batteri.
  // Modellen har rätt om ANLÄGGNINGEN (44 kW dygnet runt stämmer); det är
  // påståendet om bilen som blir omöjligt.
  const CARS = [
    // Volvo
    { id: 'ex30',       name: 'Volvo EX30',            kwh100: 17.8, battery: 64 },
    { id: 'xc40',       name: 'Volvo EX40',            kwh100: 19.3, battery: 75 },
    // Tesla
    { id: 'tesla3',     name: 'Tesla Model 3 LR',      kwh100: 14.5, battery: 75 },
    { id: 'tesla3rwd',  name: 'Tesla Model 3 RWD',     kwh100: 13.5, battery: 57 },
    { id: 'teslamy',    name: 'Tesla Model Y RWD',      kwh100: 15.8, battery: 57 },
    // VW/Škoda/Cupra
    { id: 'id4',        name: 'VW ID.4 Pro',           kwh100: 17.5, battery: 77 },
    { id: 'id7',        name: 'VW ID.7 Pro',           kwh100: 16.2, battery: 77 },
    { id: 'enyaq',      name: 'Škoda Enyaq 60',        kwh100: 15.9, battery: 58 },
    { id: 'born',       name: 'Cupra Born',            kwh100: 16.0, battery: 58 },
    // Hyundai/Kia
    { id: 'ioniq5',     name: 'Hyundai Ioniq 5 RWD',  kwh100: 17.5, battery: 77 },
    { id: 'kona',       name: 'Hyundai Kona EV',       kwh100: 16.8, battery: 65 },
    { id: 'kiaev3',     name: 'Kia EV3 Long Range',    kwh100: 17.1, battery: 81 },
    { id: 'kiaev6',     name: 'Kia EV6 RWD',          kwh100: 17.2, battery: 77 },
    // Polestar/BMW/MG/Ford
    { id: 'polestar2',  name: 'Polestar 2 SM',         kwh100: 17.1, battery: 69 },
    { id: 'bmwix1',     name: 'BMW iX1 eDrive20',      kwh100: 16.1, battery: 66 },
    { id: 'mg4',        name: 'MG4 Extended Range',    kwh100: 16.5, battery: 77 },
    { id: 'mache',      name: 'Ford Mustang Mach-E',   kwh100: 19.0, battery: 75 },
  ];

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const mean = (arr) => sum(arr) / arr.length;

  // (shapeToPeak BORTTAGEN 2026-09-13: den exponerades på det publika API:t
  // men nåddes av ingen kodväg — modellen normerar mot MEDEL via shapeToMean
  // sedan v3.8.1, just för att toppnormering lät parkeringstidens utsmetning
  // slå igenom på dygnsenergin. En oanvänd funktion på API:t ser ut som en
  // modell någon kan luta sig mot.)

  // Skalar en kurva så att dess MEDEL blir target. Används på den faltade
  // närvarokurvan i stället för toppnormering: parkeringstiden smetar ut
  // kurvan, och toppen växer då olika mycket beroende på om parkingInt delar
  // dygnet jämnt. Att normera mot toppen lät den godtyckligheten slå igenom
  // på dygnsenergin — ett steg på reglaget (10→11 h) flyttade energin 11 %
  // och känslighetskurvan dippade där texten lovade att den steg
  // (granskningsfynd B3/G3). Medelvärdet är stabilt mot utsmetningen, eftersom
  // faltningen bevarar arean.
  function shapeToMean(hours, target) {
    const t = Math.max(0, target);
    const m = mean(hours) || 1;
    const scale = t / m;
    return hours.map((h) => Math.max(0, Math.min(1, h * scale)));
  }

  // Livscykelkostnadens horisont. 10 år är brukligt för laddinfrastruktur och
  // ungefär den tekniska livslängd anläggningen dimensioneras för.
  const LCC_YEARS = 10;

  // Default systemverkningsgrad (kabel- + hub-förluster). Bilens onboard-
  // charger AC→DC räknas separat och ingår normalt INTE i EVSE-sizing.
  //
  // VILKEN SIDA ALLA EFFEKTTAK LIGGER PÅ — läs innan något ändras:
  // Simuleringen kör helt och hållet NÄTSIDIGT. Både anläggningens tak
  // (capPerHub) och fordonets tak (hwLimit) tolkas som effekt FÖRE
  // förlusterna, och levererad energi fås genom × efficiency vid utdata.
  //
  // Handbok 3.1 avgör inte frågan: den anger "max inkommande ström 63 A"
  // (= 43,65 kW) och "max simultan laddeffekt 44 kW" som samma storhet, och
  // specificerar ingen verkningsgrad alls. 44 kW ÄR de 63 A avrundade.
  // Konventionen här — allt nätsidigt — är därför ett val, men det säkra
  // valet: den inkommande sidan är hårt begränsad av en 63 A huvudsäkring,
  // vilket är den fysiska gräns elnätsbedömningen ska hållas mot.
  //
  // Priset: eftersom fordonets 11 kW egentligen är uttagsmätt blir högsta
  // LEVERERADE effekt per bil 11 × 0,95 = 10,45 kW i stället för 11,0.
  // Levererad energi underskattas därmed med exakt 1/0,95 − 1 = 5,26 % i de
  // fall där bilens tak binder ENSAMT (effektstarka anläggningar med få
  // uttag), och med noll när hubbtaket eller energibehovet binder — vilket är
  // de allra flesta. Riktningen är försiktig: energi, räckvidd och intäkt
  // underskattas, aldrig tvärtom.
  //
  // Att flytta fordonstaket till uttagssidan (dela med efficiency) är en
  // legitim modelländring men INTE en ren buggfix — den höjer kundvända tal.
  // Tas den: kör invariantsviten med --json före och efter och diffa.
  const DEFAULT_EFFICIENCY = 0.95;
  // Bilens egen laddare, AC→DC. Ingår INTE i DEFAULT_EFFICIENCY (som avser
  // kabel och hub fram till uttaget) men måste dras av innan uttagsmätta kWh
  // räknas om till km.
  const ONBOARD_EFFICIENCY = 0.90;

  // --- Tab 1: Energiberäkning --------------------------------------------
  // inputs:
  //   outlets, hubs (null => auto), capPerHub, systemCap (null => obegränsat),
  //   parkingHours, profileHours (24 värden 0..1),
  //   peakOccupancyPct (0..1) — profilens topp-värde efter skalning,
  //     (avgOccupancyPct accepteras som alias för bakåtkomp)
  //   hwLimitKW (optional, default HW_LIMIT_KW) — bilens AC-laddartak
  //   efficiency (optional, default 0.95) — system-η, drabbar levererad energi
  //   sessionNeedKWh (optional, null => obegränsat) — levererad energi en bil
  //     typiskt behöver per laddtillfälle; bilen slutar dra effekt när behovet är mött
  function computeEnergy(inp) {
    // Robusthet: numeriska indata defaultas om undefined/NaN/Infinity (parity med computeHubs).
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    const outlets = Math.max(1, num(inp.outlets, 1));
    const autoHubs = Math.max(1, Math.ceil(outlets / OUTLETS_PER_HUB));
    // Clampas: tillståndet kan komma från en handredigerad URL-hash, och
    // `hubs: -3` gav effektiv kapacitet -132 kW, sessionstak -90 och en
    // elnätsbedömning som svarade status 'ok' på nonsens.
    const hubs = Number.isFinite(inp.hubs) ? Math.max(1, Math.floor(inp.hubs)) : autoHubs;
    // SmartHub-spec: 44 kW är hårdvarutaket per hub.
    const capPerHub = Math.min(CAP_PER_HUB_KW, Math.max(1, num(inp.capPerHub, CAP_PER_HUB_KW)));
    const hwLimit = num(inp.hwLimitKW, HW_LIMIT_KW);
    const efficiency = Math.max(0.5, Math.min(1, num(inp.efficiency, DEFAULT_EFFICIENCY)));
    const installedCap = hubs * capPerHub;
    // systemCap <= 0 (eller null) = inget tak. 0 kW är inte ett meningsfullt effekttak.
    const systemCap = (inp.systemCap != null && inp.systemCap > 0) ? inp.systemCap : null;
    const effectiveCap = systemCap != null ? Math.min(installedCap, systemCap) : installedCap;

    // B2-fix: varna om peakOccupancyPct saknas (default 0 ger noll energi).
    const rawOcc = inp.peakOccupancyPct ?? inp.avgOccupancyPct;
    if (rawOcc == null && typeof console !== 'undefined') {
      console.warn('Amp5Calc.computeEnergy: peakOccupancyPct saknas, defaultar till 0 (noll energiutput).');
    }
    // Enda numeriska fältet som tidigare INTE gick genom num(): en hash med
    // peakOccupancyPct: NaN gav en beläggningskurva full av NaN (diagrammet
    // sprack) och peakOccupancyPct: 2 gav 27,6 närvarande bilar på 20 uttag,
    // medan invarianten 'belaggning-under-1' ändå passerade.
    const occInput = Math.max(0, Math.min(1, num(rawOcc, 0)));
    // parkingInt cappas till 24 så presence-faltningen inte wrappar dygnet flera varv.
    const parkingInt = Math.min(24, Math.max(1, Math.round(num(inp.parkingHours, 1))));

    // --- Ankomstmodell: likformig omsattning ------------------------------
    // Profilen sager hur manga bilar som STAR dar varje timme; parkeringstiden
    // hur lange en bil star. Tidigare loste vi ankomsterna ur narvaron genom
    // dekonvolution. Den ekvationen ar underbestamd — a(t) = a(t-L) + delta-o(t)
    // har lika manga frihetsgrader som gcd(L, 24) — och den strukturen hoppar
    // DISKONTINUERLIGT nar parkeringstiden andras. Losningen valde da olika
    // ankomstmonster for olika L, vilket fick dygnsenergin att saga 11-14 %
    // mellan tva granntimmar pa reglaget och kanslighetskurvan att dippa dar
    // texten lovade att den steg (granskningsfynd B3/G3).
    //
    // Nu parametriseras ankomsterna direkt i stallet: av de bilar som star dar
    // en viss timme anlande en andel 1/L just da. Det ger ankomster som ar
    // icke-negativa per konstruktion, slata, och en KONTINUERLIG funktion av L.
    //
    // Fonstret centreras: en bil som star kvar L timmar och bidrar till
    // narvaron kring timme t anlande i snitt (L-1)/2 timmar tidigare. Utan den
    // forskjutningen hamnade kontorets narvarotopp kl 16 i stallet for kl 9.
    //
    // Priset ar att narvaron blir profilen utsmetad av parkeringsfonstret i
    // stallet for att traffa den exakt. Det ar fysiskt korrekt: med nio timmars
    // parkering KAN belaggningen inte ha skarpare drag an sa. Modellen gar
    // kontinuerligt fran exakt (L = 1) till helt jamn (L = 24).
    //
    // Defensiv: alla numeriska falt defaultas ovan, men profileHours
    // derefererades oskyddat och gav en hard TypeError som kraschade hela
    // appen — och eftersom tillstandet lases tillbaka ur URL-hashen blev
    // kraschen permanent (granskningsfynd G18).
    const profile = (Array.isArray(inp.profileHours) && inp.profileHours.length === 24
      && inp.profileHours.every((v) => Number.isFinite(v)))
      ? inp.profileHours
      : new Array(24).fill(0.5);
    // Rutnätet är HALVTIMMAR, inte timmar. På ett timrutnät har parkerings-
    // fönstret heltalsbredd och centreringsskiftet (L-1)/2 blir halvtal för
    // jämna L. Kärnan får då stöd L för udda L men L+1 för jämna — en
    // paritetsväxling som inte gör något utskrivet tal fel, men som får
    // känslighetskurvans LUTNING att såga mellan granntimmar. Det är inte ett
    // implementationsfel: rect-faltning PÅ ett timrutnät är sådan. Botemedlet
    // är en finare diskretisering. På halvtimmesrutnätet är fönstret 2L steg
    // och skiftet L steg — heltal för alla L, samma kärnform oavsett paritet.
    //
    // Hela kohortsimuleringen nedan går på samma rutnät. Att lägga bara
    // närvarokurvan på halvtimmar men låta simuleringen ligga kvar på timmar
    // gav 5-8 % skillnad mellan den redovisade beläggningen och den som
    // faktiskt simulerades — modellen hade då motsagt sig själv.
    const STEG = 48;                  // halvtimmessteg per dygn
    const parkSteg = parkingInt * 2;  // parkeringsfönstret i halvtimmessteg
    const profil48 = new Array(STEG);
    for (let s = 0; s < STEG; s++) profil48[s] = profile[Math.floor(s / 2)];
    // Skiftet är parkingInt HALVTIMMESSTEG (= L/2 timmar) — heltal för alla L.
    // Fönstrets mittpunkt ligger på parkSteg/2 - 0,5 steg, så närvaron blir en
    // kvarts timme TIDIG i förhållande till profilen (presence[p] samplar
    // profilen kring p + 0,5 steg). Tecknet stod fel här tidigare; magnituden
    // och konstansen i L stämmer. Den biasen är KONSTANT i L
    // (till skillnad från den gamla paritetsväxlingen), ligger under utdatans
    // timupplösning, och delas av kohortsimuleringen nedan — som faltar samma
    // ankomster med samma fönster. Intern konsistens väger tyngre än en
    // kvartstimmes absolut fas: en exakt centrerad kärna hade krävt halva
    // vikter i fönstrets ändar, vilket simuleringen inte kan representera
    // (en bil har en session eller ingen).
    const arrivals48 = new Array(STEG);
    for (let s = 0; s < STEG; s++) {
      arrivals48[s] = profil48[(s + parkingInt) % STEG] / parkSteg;
    }
    const a48Sum = sum(arrivals48);
    const normArrivals = a48Sum > 1e-9
      ? arrivals48.map((a) => a / a48Sum)
      : profil48.map((p) => p / (sum(profil48) || 1));

    // Närvaro = ankomst faltad med parkeringsfönstret (rect, parkSteg steg).
    const presence48 = new Array(STEG).fill(0);
    for (let s = 0; s < STEG; s++) {
      const a = normArrivals[s];
      if (a === 0) continue;
      for (let ds = 0; ds < parkSteg; ds++) {
        presence48[(s + ds) % STEG] += a;
      }
    }
    // Timkurva för UI och PDF: medelvärdet av halvtimmesparen.
    const presence = new Array(24);
    for (let t = 0; t < 24; t++) {
      presence[t] = (presence48[2 * t] + presence48[2 * t + 1]) / 2;
    }
    // Reglaget anger profilens TOPP. Målet för den faltade kurvan är därför det
    // medel som profilen vid den toppen implicerar — så att utsmetningen inte
    // längre kan flytta energin när parkeringstiden ändras ett steg.
    const profPeak = Math.max(...profile) || 1;
    const targetMean = occInput * (mean(profile) / profPeak);
    const hours = shapeToMean(presence, targetMean);
    // (occupancyClamped borttagen: med den nya ankomstmodellen kan clampningen
    // aldrig bli bindande. Faltning med en normaliserad symmetrisk kärna kan
    // bara SÄNKA kvoten topp/medel, så skalad topp <= reglagevärdet <= 1 för
    // varje profil och varje parkeringstid. En flagga som inte kan bli sann
    // ser ut som ett skyddsnät utan att vara ett.)
    const outletHoursDay = sum(hours) * outlets;

    // Sessionsantal: total presence-tid över dygnet / parkeringstid per session.
    // sum(hours) = total uttag-närvaro-andel-timmar per uttag (24 timmar × snitt).
    const sessionsPerOutletPerDay = sum(hours) / parkingInt;
    const totalSessionsPerDay = sessionsPerOutletPerDay * outlets;

    // Kohortsimulering av laddningen. Kohort = bilarna som ankommer en viss
    // timme. Varje bil drar min(bilens AC-tak, sin andel av effekttaket) tills
    // sessionens energibehov är mött — därefter står den kvar utan att ladda.
    // (Fix: tidigare drog varje närvarande bil full effekt hela parkerings-
    // fönstret; utan behovstak kunde en session "ladda" 60+ kWh och blåsa upp
    // ekonomikalkylen flerfaldigt för effektstarka anläggningar.)
    // sessionNeedKWh anges levererat; simuleringen körs grid-side (behov / η).
    // Simuleringen körs till STATIONÄRT läge i stället för fasta fyra dygn.
    // Vid långa parkeringsfönster (17-19 h) hann systemet inte bli stationärt,
    // vilket gav upp till 3,6 kW rippel i en kurva som analytiskt måste vara
    // rak, och fick "per laddtillfälle × antal" att avvika 8,9 % från "total
    // per dygn" (granskningsfynd B4).
    // Golv på 0,1 kWh: 0 betyder "inget angivet behov" (= obegränsat, samma sak
    // som tomt fält), men 0,0001 tolkades bokstavligt och gav noll energi. Ett
    // behov under 0,1 kWh är inte ett meningsfullt laddtillfälle — behandla hela
    // intervallet likadant i stället för att låta en decimal vippa utfallet
    // mellan maximal och noll energi.
    const NEED_FLOOR_KWH = 0.1;
    const needDelivered = (Number.isFinite(inp.sessionNeedKWh) && inp.sessionNeedKWh >= NEED_FLOOR_KWH)
      ? inp.sessionNeedKWh : null;
    const needGrid = needDelivered != null ? needDelivered / efficiency : Infinity;
    const cohortCars = normArrivals.map((a) => a * totalSessionsPerDay); // ankommande bilar per halvtimmessteg

    // Spec-gränser per hub (handbok 3.1, 8.3.1): antal samtidiga sessioner och
    // 6 A-golvet. Bilar utöver sessionstaket får ingen session alls.
    const strategyKey = LB_STRATEGY[inp.strategy] ? inp.strategy : DEFAULT_STRATEGY;
    const strategy = LB_STRATEGY[strategyKey];
    const threePhase = isThreePhase(hwLimit);
    const minChargeKW = ampsToKW(MIN_CHARGE_A, threePhase);
    const startKW = ampsToKW(strategy.startA, threePhase);
    const sessionCapacity = hubs * MAX_SESSIONS_PER_HUB;
    // Hur många laddpunkter kan som mest tilldelas ström samtidigt (63 A / 6 A
    // ≈ 10 per central enligt 8.3.1). Rapporteras för varningstexter.
    //
    // OBS — DEN HÄR KAN ALDRIG BINDA, och det är matematik, inte tur:
    // allocatePower sätter charging = min(cap/start, tak), och eftersom
    // start >= minChargeKW gäller alltid cap/start <= cap/minChargeKW = tak.
    // Verifierat i 258 048 fall × 48 steg: noll träffar. Fältet returneras men
    // läses varken av UI eller PDF. Det ligger kvar som en fysisk gräns värd
    // att ha explicit i modellen — men behandla det som dokumentation, inte
    // som ett skyddsnät. Samma kategori som HW_CONFIG: utlöses det är det ett
    // modellfel att gräva i, inte ett normalfall.
    const maxChargingSlots = Math.floor(effectiveCap / minChargeKW);

    // Antal uppvärmningsdygn innan avläsning. Söks adaptivt: kör ett dygn i
    // taget och sluta när två dygn i rad ger identisk kurva.
    // Rutnätet är halvtimmar (STEG steg per dygn) — se ankomstmodellen ovan.
    // Höjt 40 -> 80 i v3.9.0 och 80 -> 200 i v3.9.3. Konvergenstestet kräver
    // sedan v3.9.0 att TILLSTÅNDET (kvarvarande behov per vistelsefas) upprepas,
    // inte bara flödet — ett strängare krav som långa parkeringsfönster med
    // mättad anläggning behöver betydligt fler dygn för att uppfylla.
    //
    // 80 räckte inte. Uppmätt över 13 824 konfigurationer: 99,87 % konvergerar
    // inom 50 dygn, men svansen går till **dygn 119** (residential, L = 21 h,
    // 100 % beläggning, 54 uttag, behov 25 kWh, 22 kW). Med taket 80 föll de
    // fallen tillbaka, och felet pekade ÅT FEL HÅLL: per laddtillfälle
    // rapporterades exakt det angivna behovet (18,000 kWh) medan det sanna
    // stationära värdet var 17,926 — alltså "behovet är mött" när det inte är
    // det, plus 0,41 % brott mot energibalansen.
    //
    // Notera taktbegränsningen: fallbacken nedan fyrar vid
    // h + 1 + 2×STEG + parkSteg > H, så konvergens kan aldrig DETEKTERAS senare
    // än ungefär dygn MAX_DAYS − 4. Med 80 låg den gränsen på 78, och det
    // tyngsta konvergerande fallet landade exakt där — marginalen var noll.
    //
    // Kostar inget i normalfallet: loopen bryter när den är stationär, så bara
    // svansen på 18 fall av 13 824 kör långt.
    const MAX_DAYS = 200;
    const DT = 24 / STEG; // steglängd i timmar (0,5)
    const simulate = (cap, slotCap) => {
      const H = MAX_DAYS * STEG;
      const power = new Array(STEG).fill(0);        // kW per steg (stationärt dygn)
      const sessionKWh = new Array(STEG).fill(0);   // grid-kWh per bil, per ankomststeg
      const chargingCars = new Array(STEG).fill(0); // antal bilar som FÅR ström
      const presentCars = new Array(STEG).fill(0);  // antal bilar vid uttag
      const wantingCars = new Array(STEG).fill(0);  // antal som ännu behöver energi
      const perCarKW = new Array(STEG).fill(0);     // effekt per laddande bil
      const remaining = new Array(H).fill(0);       // kvarvarande grid-behov per kohort
      // Rullande dygnsbuffert för konvergenstestet.
      let forra = null, denna = new Array(STEG).fill(0);
      let rec0 = -1; // första steget i det dygn som ska redovisas
      // M4: utebliven konvergens var tyst OCH pekade åt fel håll — totalen
      // stämde medan per-session-talet blev grovt för lågt, och identiteten
      // "per session × antal = total" bröts med upp till 46 % utan att något
      // fält avslöjade det. Rapporteras nu så en framtida modelländring som
      // gör dynamiken segare inte kan passera CI tyst.
      let konvergerade = false;
      let forraStat = null; // kvarvarande behov per vistelsefas vid förra dygnsgränsen
      for (let h = 0; h < H; h++) {
        remaining[h] = needGrid;
        let activeCars = 0, present = 0;
        const queue = [];
        for (let s0 = Math.max(0, h - parkSteg + 1); s0 <= h; s0++) {
          const n = cohortCars[s0 % STEG];
          if (n <= 1e-12) continue;
          present += n;
          if (remaining[s0] <= 1e-9) continue; // står kvar men är färdigladdad
          queue.push(s0);
          activeCars += n;
        }
        if (rec0 >= 0 && h >= rec0 && h < rec0 + STEG) {
          presentCars[h - rec0] = present;
          // Bilar som fortfarande behöver energi. Skiljer kö från färdigladdade
          // bilar som bara står kvar — utan den skillnaden räknades en uppfylld
          // anläggning som om alla stod i kö (granskningsfynd G5).
          wantingCars[h - rec0] = activeCars;
        }
        // OBS: inga continue-satser harifran och ner. Dygnsgranskontrollen
        // langst ned MASTE korás varje steg, aven nar ingen bil laddar —
        // annars hittas aldrig det stationara dygnet i anlaggningar som star
        // stilla nattetid, och hela kurvan blir noll.
        let stegKWh = 0, perCar = 0, charging = 0;
        if (queue.length > 0) {
        // Sessionstaket: ryms inte alla närvarande bilar som sessioner får
        // överskottet ingen laddpunkt alls. Modelleras som en andel av
        // populationen — aggregerad energi blir rätt, och överskottet
        // rapporteras separat så UI/PDF kan varna för underdimensionering.
        const sessionFrac = present > sessionCapacity ? sessionCapacity / present : 1;
        const wanting = activeCars * sessionFrac;

        // Poddelning (handbok 3.1): 22 kW gäller bara ensamt aktivt uttag på
        // ChargePoden. Är podens andra uttag upptaget delar de 32 A-skyddet
        // och får 11 kW vardera. Väntevärdet skalas med beläggningsgraden.
        const podBusy = outlets > 0 ? Math.min(1, present / outlets) : 0;
        const hwEff = hwLimit > 11 ? hwLimit - (hwLimit - 11) * podBusy : hwLimit;

        // MEDELFÄLTSANTAGANDE — dokumenterat, inte ett fel, men det har en
        // riktning. Vi räknar allocatePower på VÄNTEVÄRDET av antalet bilar
        // som vill ladda, dvs min(platser, E[n]). Verkligheten ger
        // E[min(platser, n)], och min() är konkav — Jensens olikhet säger då
        // att modellen ALDRIG underskattar och ibland överskattar.
        //
        // Storleken går att räkna ut exakt. Med n ~ Poisson och 44 kW som
        // rymmer fyra bilar à 11 kW:
        //   E[n] =  4,5  ->  85,3 % av modellens tal   (25 uttag, 18 % belägg.)
        //   E[n] =  6,6  ->  96,2 %
        //   E[n] = 18,3  -> 100,0 %
        // Felet är alltså noll när anläggningen har gott om bilar och som
        // störst när medelantalet närvarande ligger nära antalet som ryms på
        // effekten — samma lågbeläggningsfall som ger de orimligt stora
        // sessionerna. De två skevheterna pekar åt samma håll.
        //
        // Att byta till en stokastisk ankomstmodell vore att välja Poisson
        // framför jämn ström: ett NYTT antagande, inte ett borttaget. Verkliga
        // ankomster ligger mellan de två (kontorstider är delvis schemalagda).
        // Antagandet redovisas därför i modelltexten på skärmen och i båda
        // PDF-mallarna i stället för att döljas i koden.
        const alloc = allocatePower(cap, wanting, hwEff, startKW, minChargeKW, slotCap);
        perCar = alloc.perCar; charging = alloc.charging;
        if (charging > 0) {
          // Andel av de köande bilarna som får ström det här steget. Bilar som
          // står i kö klättrar i prioritetsordningen (köbonus, 8.3.1.3), så över
          // dygnet roterar tilldelningen — därför fördelas medeleffekten här.
          // (servedShare togs bort i v3.9.0: vattenfyllnaden nedan utgår från
          // allocatePowers egen budget, perCar × charging × DT, och behöver
          // inte medeleffekten per aktiv bil.)

          // OMFÖRDELNING INOM STEGET (granskningsfynd B2).
          // Tidigare gällde draw = min(servedShare × DT, remaining) rakt av: en
          // kohort som blev färdig tog bara sitt behov, och ÖVERSKOTTET kastades
          // — medan bilar som ännu behövde energi stod bredvid och begränsades av
          // sin egen tilldelning. Ett maxflödesoptimum visade att modellen låg på
          // 89,8-98,9 % av vad en FIFO-styrd hub (handbokens köbonus, 8.3.1.3)
          // levererar.
          //
          // UPPMÄTT EFFEKT av rättningen, svep om 5 760 konfigurationer:
          // som mest +3,1 % total energi och +3,1 % toppeffekt, och 0,0 % i
          // både defaultfallet och köpcentrumfallet. Granskningens skattning
          // (4,5 % / 9,1 %) var för hög: den mätte hur mycket tilldelning som
          // kastades, men mottagarna ligger oftast redan på sitt eget tak, så
          // långt ifrån allt går att återvinna. Den referensimplementation som
          // gav de högre talen viktade dessutom inte bilens tak med sessionFrac
          // och lät därmed omfördelningen kringgå sessionstaket — samma fel som
          // invarianten baslinje-energi fångade när det här skrevs.
          //
          // Vattenfyllnad: budgeten är exakt vad allocatePower säger att
          // anläggningen levererar detta steg. Varje kohort begränsas av sitt
          // kvarvarande behov OCH av vad en bil fysiskt hinner ta emot på DT
          // timmar. Det som blir över efter en mättad kohort går vidare till
          // övriga i stället för att försvinna. Totalen kan därför aldrig
          // överstiga cap × DT, och per bil aldrig hwEff.
          let budget = perCar * charging * DT;   // kWh anläggningen levererar
          // Taket per kohortbil är hwEff × sessionFrac, inte hwEff: modellen är
          // aggregerad, och en bil har bara session sessionFrac av tiden. Med
          // hwEff rakt av lät omfördelningen bilarna kringgå sessionstaket, och
          // den OKONTROLLERADE baslinjen levererade då mindre än den styrda —
          // fysiskt omöjligt, och sviten fångade det direkt (baslinje-energi).
          const bilTak = hwEff * sessionFrac * DT;
          const draget = new Map();
          // queue byggs redan med `if (remaining[s0] <= 1e-9) continue`, så
          // filtret var en no-op. Kopian behövs ändå — oppna krymper per varv.
          let oppna = queue.slice();
          while (budget > 1e-12 && oppna.length) {
            let bilar = 0;
            for (const s0 of oppna) bilar += cohortCars[s0 % STEG];
            if (bilar <= 1e-12) break;
            const perBil = budget / bilar;
            const nasta = [];
            let anvant = 0;
            for (const s0 of oppna) {
              const hittills = draget.get(s0) || 0;
              const tak = Math.min(remaining[s0] - hittills, bilTak - hittills);
              if (tak <= 1e-12) continue;
              const d = Math.min(perBil, tak);
              draget.set(s0, hittills + d);
              anvant += d * cohortCars[s0 % STEG];
              if (d < tak - 1e-12) nasta.push(s0); // ännu inte mättad
            }
            budget -= anvant;
            if (anvant <= 1e-12) break;           // ingen kan ta emot mer
            oppna = nasta;
          }
          for (const [s0, draw] of draget) {
            remaining[s0] -= draw;
            stegKWh += draw * cohortCars[s0 % STEG];
            if (rec0 >= 0 && s0 >= rec0 && s0 < rec0 + STEG) sessionKWh[s0 - rec0] += draw;
          }
        }
        }
        if (rec0 >= 0 && h >= rec0 && h < rec0 + STEG) {
          power[h - rec0] = stegKWh / DT; // kWh per steg → kW
          chargingCars[h - rec0] = charging;
          perCarKW[h - rec0] = perCar;
        }
        // Allt efter avläsningsdygnets sista kohort är bortkastat arbete.
        if (rec0 >= 0 && h >= rec0 + (STEG - 1) + parkSteg) break;
        denna[h % STEG] = stegKWh;
        // Vid varje dygnsslut: är dygnet identiskt med föregående är systemet
        // stationärt. Då lämnas ett helt extra dygn för avläsning, så att
        // kohorter som startar i avläsningsdygnet hinner ladda klart.
        if (h % STEG === STEG - 1 && rec0 < 0) {
          if (forra) {
            let diff = 0;
            for (let t = 0; t < STEG; t++) diff = Math.max(diff, Math.abs(denna[t] - forra[t]));
            // FLÖDET räcker inte som konvergenskriterium — TILLSTÅNDET måste
            // också ha satt sig. En mättad anläggning levererar konstant effekt
            // från första dygnet medan fördelningen MELLAN kohorter fortfarande
            // rör sig; testet slog då till på dygn 2 och avläsningsdygnet blev
            // inte stationärt. Identiteten "per session × antal = total" bröts
            // med upp till 13,2 % i 532 av 69 120 fall.
            //
            // Latent redan före v3.9.0: med uniform tilldelning följde
            // kohortfördelningen flödet så nära att det aldrig syntes. När
            // omfördelningen (B2) kopplade ihop kohorterna avslöjades det.
            // Jämför därför kvarvarande behov för hela parkeringsfönstrets
            // kohorter mot samma kohorter ett dygn tidigare.
            // Ögonblicksbilden måste SPARAS vid dygnsgränsen. remaining[] muteras
            // på plats, så att vid tiden h jämföra remaining[h-k] mot
            // remaining[h-k-STEG] jämför två OLIKA faser av vistelsen: den äldre
            // kohorten har då hunnit ladda ett helt dygn till och är urdränerad.
            // Det testet plana ut på 8-26 kWh och kunde aldrig slå till.
            const dennaStat = new Array(parkSteg);
            for (let k = 0; k < parkSteg; k++) {
              const nu = h - k;
              dennaStat[k] = nu >= 0 ? remaining[nu] : Infinity;
            }
            let statDiff = forraStat ? 0 : Infinity;
            if (forraStat) {
              for (let k = 0; k < parkSteg; k++) {
                const x = dennaStat[k], y = forraStat[k];
                if (x === Infinity && y === Infinity) continue; // obegränsat behov
                statDiff = Math.max(statDiff, Math.abs(x - y));
              }
            }
            forraStat = dennaStat;
            diff = Math.max(diff, statDiff);
            // Sista kohorten i avläsningsdygnet (s0 = rec0+STEG-1) måste hinna
            // ladda hela sitt fönster: rec0 + STEG-1 + parkSteg <= H - 1. Det
            // gamla villkoret pekade åt fel håll och trunkerade i stället för
            // att rädda.
            const stationart = diff < 1e-9;
            if (stationart || h + 1 + STEG + STEG + parkSteg > H) {
              rec0 = h + 1;
              konvergerade = stationart;
            }
          }
          forra = denna;
          denna = new Array(STEG).fill(0);
        }
      }
      return { power, sessionKWh, chargingCars, presentCars, wantingCars, perCarKW,
        konvergerade, simDygn: rec0 >= 0 ? Math.round(rec0 / STEG) : MAX_DAYS };
    };

    // Halvtimmesserier → timserier för UI, PDF och all logik nedan. Effekt och
    // antal bilar är medelvärdesstorheter, så medelvärdet av paret är rätt
    // nedsampling; energin bevaras (sum(kW per timme) × 1 h = sum(kW per
    // halvtimme) × 0,5 h). sessionKWh nedsamplas INTE — den är indexerad på
    // ankomststeg och viktas mot normArrivals i samma upplösning.
    const tillTimmar = (v) => {
      const ut = new Array(24);
      for (let t = 0; t < 24; t++) ut[t] = (v[2 * t] + v[2 * t + 1]) / 2;
      return ut;
    };

    // Okontrollerad efterfrågan = samma simulering utan effekttak (bilarna
    // slutar ändå vid mött behov). SmartHub-levererat = capat av effectiveCap.
    const sim48 = simulate(effectiveCap, maxChargingSlots);
    // M6: peakPowerKW nedan är ett TIMMEDEL av halvtimmesstegen — rätt för
    // effekttariffen, eftersom svenska nätbolag debiterar på högsta
    // timmedeleffekt. Men en säkring reagerar på strömmen över minuter, och
    // halvtimmestoppen ligger upp till 2,5 % högre.
    //
    // Talet REDOVISAS men styr ingenting: elnätsbedömningen får fortfarande
    // timmedlet. Att byta är ett modellbeslut, inte en buggfix — det skulle
    // flytta statusen i gränsfall, och sedan v3.9.0 är det ändå märkeffekten
    // som dimensionerar i de flesta fall. Fältet finns för att skillnaden ska
    // gå att inspektera, inte som ett skyddsnät.
    const peakPowerHalfHourKW = Math.max(...sim48.power, 0);
    const sim = {
      power: tillTimmar(sim48.power),
      chargingCars: tillTimmar(sim48.chargingCars),
      presentCars: tillTimmar(sim48.presentCars),
      wantingCars: tillTimmar(sim48.wantingCars),
      perCarKW: tillTimmar(sim48.perCarKW),
      sessionKWh: sim48.sessionKWh, // stannar i halvtimmesupplösning (se ovan)
    };
    const hourlyPower = sim.power;
    // Baslinjen "okontrollerad efterfrågan" = SAMMA Amp5-hårdvara utan
    // lastbalansering. Effekttak och platstak släpps, men sessionstaket och
    // ChargePodens delade skydd är fysiska gränser som finns kvar oavsett
    // styrning — de ligger därför medvetet kvar i loopkroppen.
    const hourlyDemand = tillTimmar(simulate(Infinity, Infinity).power);

    const totalEnergyFromGrid = sum(hourlyPower);
    const totalEnergyDay = totalEnergyFromGrid * efficiency;

    // Effekt per LADDANDE bil i den timme som ger toppeffekten. Kommer nu
    // direkt ur fördelningen (startström eller jämn påfyllning) i stället för
    // att räknas om som effekttak / antal närvarande — den gamla formeln gav
    // fysiskt omöjliga värden under 6 A.
    // Effekttoppen — används för effekttariff och elnätsbedömning.
    let peakHour = 0;
    for (let t = 1; t < 24; t++) {
      if (hourlyPower[t] > hourlyPower[peakHour]) peakHour = t;
    }
    // Folk-siffrorna ("laddar / köar") samplas i BELÄGGNINGSTOPPEN, inte i
    // effekttoppen. En effektbegränsad anläggning ligger på taket i många
    // timmar, och > ovan tar då första timmen på platån — ofta en morgontimme
    // med låg beläggning. Det underskattade kön grovt i exakt det fall
    // varningen finns till för, och gjorde talen icke-monotona i antal hubbar
    // (granskningsfynd G2).
    let busiestHour = 0;
    for (let t = 1; t < 24; t++) {
      if (sim.presentCars[t] > sim.presentCars[busiestHour]) busiestHour = t;
    }
    const chargingAtPeak = sim.chargingCars[busiestHour];
    const presentAtPeak = sim.presentCars[busiestHour];
    const perCarAtPeakKW = chargingAtPeak > 1e-9 ? sim.perCarKW[busiestHour] : null;
    // Lasten i SAMMA timme som folk-siffrorna samplas i. Utan den gick
    // "laddar N bilar à X kW" inte att stämma av mot något utskrivet tal, och
    // läsaren jämförde den mot dygnets Topplast — en ANNAN timme i 67 % av
    // fallen. Och även när timmarna sammanfaller överstiger produkten timmens
    // energi i 68 % av fallen (värst +97 %), eftersom perCarAtPeakKW är vad
    // allocatePower TILLDELADE medan vattenfyllnaden levererar mindre så fort
    // en kohort mött sitt behov. Båda talen är riktiga, de beskriver bara
    // olika saker — så nu står lasten i samma timme bredvid dem
    // (granskningsfynd A5, funnet oberoende av två granskare).
    const powerAtBusiestKW = hourlyPower[busiestHour];
    // Kö = bilar som fortfarande BEHÖVER energi men inte får ström. Färdig-
    // laddade bilar som står kvar på platsen räknas inte som köande (G5).
    const queuedAtPeak = Math.max(0, sim.wantingCars[busiestHour] - chargingAtPeak);
    // Bilar som inte ens ryms som session — anläggningen behöver fler hubbar.
    const sessionOverflow = Math.max(0, Math.round((presentAtPeak - sessionCapacity) * 100) / 100);
    // Flest samtidigt närvarande bilar över dygnet (dimensionerande för sessionstaket).
    const maxPresent = Math.max(...sim.presentCars, 0);
    const sessionOverflowMax = Math.max(0, Math.round((maxPresent - sessionCapacity) * 100) / 100);
    // Hur många fler SmartHubs sessionstaket kräver (G9).
    const hubsNeededForSessions = Math.max(0, Math.ceil(maxPresent / MAX_SESSIONS_PER_HUB) - hubs);

    // Per-bil-energi efter η: ankomstviktat snitt av kohorternas sessionsenergi.
    // Simuleringen sker i grid-units, η appliceras vid output.
    let perOutletKWhRaw = 0;
    for (let s0 = 0; s0 < STEG; s0++) {
      perOutletKWhRaw += normArrivals[s0] * sim.sessionKWh[s0];
    }
    // Vid noll beläggning (sum(hours)=0) levereras ingen energi — håll per-session
    // konsistent med totalEnergyDay i stället för att visa hwLimit×parkingInt.
    const perOutletKWh = sum(hours) > 0 ? perOutletKWhRaw * efficiency : 0;
    // Behovsbegränsad: snittbilen når ≈ hela sitt behov — mer effekt/tid ger
    // då ingen mer energi, bara snabbare laddning.
    const needLimited = needDelivered != null && perOutletKWh >= needDelivered * 0.995;

    const avgPowerPerActive = outletHoursDay > 0
      ? totalEnergyFromGrid / outletHoursDay
      : 0;
    const avgActive = outlets * mean(hours);
    const peakOccupancyPct = Math.max(...hours);
    const avgPowerPerOutlet = avgPowerPerActive; // behåll alias för bakåtkomp
    const peakPowerKW = Math.max(...hourlyPower, 0);
    const peakDemandKW = Math.max(...hourlyDemand, 0);
    const peakReductionKW = Math.max(0, peakDemandKW - peakPowerKW);
    const avgPowerKW = totalEnergyFromGrid / 24;

    const kwhPerOutletPerDay = perOutletKWh * sessionsPerOutletPerDay;

    return {
      hubs, autoHubs, installedCap, effectiveCap,
      perOutletKWh,
      totalEnergy: totalEnergyDay,
      totalEnergyDay, totalEnergyFromGrid,
      avgPowerPerOutlet, avgPowerPerActive,
      peakPowerKW, peakDemandKW, peakReductionKW, avgPowerKW,
      peakPowerHalfHourKW,
      simKonvergerade: sim48.konvergerade, simDygn: sim48.simDygn,
      activeOutlets: avgActive,
      maxOutlets: outlets,
      peakOccupancyPct, targetPeakPct: occInput,
      sessionsPerOutletPerDay, totalSessionsPerDay, kwhPerOutletPerDay,
      sessionNeedKWh: needDelivered, needLimited,
      perCarAtPeakKW, chargingAtPeak, powerAtBusiestKW,
      // Spec-gränser och kö (handbok 3.1, 8.3.1)
      presentAtPeak, queuedAtPeak, maxPresent, busiestHour, peakHour,
      wantingAtPeak: sim.wantingCars[busiestHour], hubsNeededForSessions,
      sessionCapacity, sessionOverflow, sessionOverflowMax,
      maxChargingSlots, minChargeKW, startKW, strategy: strategyKey,
      hourly: hourlyPower,
      hourlyDemand,
      occupancy: hours,
      hwLimit, efficiency,
      profileLabel: inp.profileLabel,
      _inputs: inp,
    };
  }

  // --- Tab 2: SmartHub-dimensionering ------------------------------------
  // inputs: outlets, desiredKWhPerOutlet, parkingHours, occupancyPct,
  //         capPerHub, systemCap (null => obegränsat)
  //
  // M2-not: occupancyPct tolkas som KONSTANT (platt) beläggning under hela
  // parkingH-fönstret. Det skiljer sig från computeEnergy som konvolverar
  // en beläggningsprofil — vilket är avsiktligt. computeHubs dimensionerar
  // för värsta-falls-peak (alla occ × outlets aktiva samtidigt), vilket ger
  // ett konservativt hubantal. För profil-baserade siffror, se computeEnergy.
  function computeHubs(inp) {
    // Robusthet: alla numeriska indata defaultas om de är undefined/NaN/Infinity
    // (computeHubs är en återanvändbar pure function på window.Amp5Calc).
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    const outlets = Math.max(1, num(inp.outlets, 1));
    const capPerHub = Math.min(CAP_PER_HUB_KW, Math.max(1, num(inp.capPerHub, CAP_PER_HUB_KW)));
    const efficiency = Math.max(0.5, Math.min(1, num(inp.efficiency, DEFAULT_EFFICIENCY)));
    const occ = Math.max(0, Math.min(1, num(inp.occupancyPct, 0)));
    // ChargePod-delning (handbok 3.1): 22 kW gäller bara ensamt aktivt uttag på
    // poden; är podens andra uttag upptaget delar de 32 A-skyddet och får
    // 11 kW vardera. Väntevärdet skalas med beläggningen — samma derate som
    // computeEnergy gör, så de två modellerna slutar motsäga varandra (G12).
    const hwLimitRaw = num(inp.hwLimitKW, HW_LIMIT_KW);
    const hwLimit = hwLimitRaw > 11 ? hwLimitRaw - (hwLimitRaw - 11) * occ : hwLimitRaw;
    const parkingH = Math.max(0.5, num(inp.parkingHours, 0.5));
    const desiredKWhPerOutlet = Math.max(0, num(inp.desiredKWhPerOutlet, 0));
    // systemCap <= 0 (eller null) = inget tak. 0 kW är inte ett meningsfullt effekttak.
    const systemCap = (inp.systemCap != null && inp.systemCap > 0) ? inp.systemCap : null;
    const activeOutlets = outlets * occ;

    // Levererad energi target → grid-side power needed = target / η.
    const powerNeeded = (desiredKWhPerOutlet * activeOutlets) / (parkingH * efficiency);

    const hubsByOutlets = Math.ceil(outlets / OUTLETS_PER_HUB);
    // Sessionstaket (handbok 3.1): en SmartHub kör max 30 simultana sessioner.
    // 54 uttag på en hub räcker alltså inte om beläggningen är hög — då krävs
    // fler hubbar även om både uttagsantal och effekt hade rymts.
    const hubsBySessions = Math.max(1, Math.ceil(activeOutlets / MAX_SESSIONS_PER_HUB));

    // Hubs som faktiskt tillför effekt — systemCap bestämmer taket.
    // Om systemCap finns är hubs över (systemCap/capPerHub) verkningslösa.
    const maxUsableHubs = systemCap != null
      ? Math.max(1, Math.ceil(systemCap / capPerHub))
      : Infinity;
    // Bilarna kan max absorbera activeOutlets × hwLimit — dimensionera inte
    // hubbar för efterfrågan som fysiskt aldrig kan tas emot. (Fix: mål över
    // AC-taket gav tidigare upp till ~45 % fler hubbar utan mer leverans.)
    // powerNeeded behålls ocappad för hwFeasible-/SYSTEM_CAP-klassningen.
    const maxAbsorbKW = activeOutlets * hwLimit;
    const hubsByPowerIdeal = Math.ceil(Math.min(powerNeeded, maxAbsorbKW) / capPerHub);
    const hubsByPower = Math.min(hubsByPowerIdeal, maxUsableHubs);

    const hubs = Math.max(1, hubsByOutlets, hubsBySessions, hubsByPower);
    const installedCap = hubs * capPerHub;
    const effectiveCap = systemCap != null
      ? Math.min(installedCap, systemCap)
      : installedCap;

    // actualEnergy är levererat till bilen efter η-förluster.
    const actualEnergyRaw = activeOutlets > 0
      ? (effectiveCap * parkingH * efficiency) / activeOutlets
      : 0;
    const targetEnergy = desiredKWhPerOutlet;

    // Bilens AC-laddare klarar max hwLimit grid-side; target/parkingH
    // är levererat, så jämförelsen ska divideras med η.
    const perCarPowerNeeded = targetEnergy / (parkingH * efficiency);
    const hwFeasible = perCarPowerNeeded <= hwLimit + 1e-6;
    const hwMaxPerOutletKWh = hwLimit * parkingH * efficiency;
    const actualEnergy = Math.min(actualEnergyRaw, hwMaxPerOutletKWh);

    const headroomKWh = Math.max(0, actualEnergy - targetEnergy);
    const shortfallKWh = Math.max(0, targetEnergy - actualEnergy);
    const capacityAchieves = activeOutlets > 0 && effectiveCap >= powerNeeded - 1e-6;
    // Med noll beläggning eller noll mål finns ingen last att möta. Då är
    // "målet uppnås inte" en falsk varning — användaren har själv satt
    // beläggningen till noll, och det finns inget mål att missa.
    //
    // Det var dessutom det ENDA sättet att nå HW_CONFIG: i 9 000 testfall med
    // mål > 0 och beläggning > 0 utlöstes den aldrig, men i degenererade fall
    // utlöstes den alltid. Varningen sa alltså bara något när den inte borde
    // säga något, och texten ("Målet uppnås inte med vald tid och beläggning")
    // pekade ut tid och beläggning som problem när användaren bara råkat
    // nollställa ett fält.
    const harLast = targetEnergy > 0 && activeOutlets > 0;
    const achievesTarget = harLast ? (capacityAchieves && hwFeasible) : true;

    // Alla bindande orsaker rapporteras, inte bara den första. Tidigare testades
    // bilens tak först och kedjan stannade där, vilket gömde fastighetstaket i
    // 42 % av de misslyckade fallen och gav rådet "längre parkeringstid" när det
    // i själva verket var servisen som tog stopp (granskningsfynd G11).
    // !achievesTarget implicerar harLast (se ovan), så ingen extra spärr behövs.
    const limitReasons = [];
    if (!achievesTarget) {
      if (systemCap != null && systemCap < powerNeeded - 1e-6) limitReasons.push(LIMIT_REASON.SYSTEM_CAP);
      if (!hwFeasible) limitReasons.push(LIMIT_REASON.HW);
      // Skyddsnät: fångar en bindande orsak som inte är någon av de två ovan.
      // Med nuvarande modell ska den inte kunna nås (hubs dimensioneras efter
      // powerNeeded, så installedCap räcker alltid när systemCap inte binder) —
      // men den lämnas kvar hellre än att limitReason blir null medan
      // achievesTarget är false. Utlöses den är det ett modellfel att gräva i.
      if (!limitReasons.length) limitReasons.push(LIMIT_REASON.HW_CONFIG);
    }
    // limitReason = den mest åtgärdbara orsaken. Fastighetstaket går att bygga
    // bort; bilens laddartak gör det inte.
    const limitReason = limitReasons.length ? limitReasons[0] : null;

    // Konstant beläggning antas i hub-dimensionering: varje aktivt uttag
    // omsätter sig en gång per parkingH-fönster, dvs 24/parkingH per dygn.
    const sessionsPerOutletPerDay = occ * 24 / parkingH;
    const totalSessionsPerDay = sessionsPerOutletPerDay * outlets;
    // Realiserad dygnsenergi: bilen tar inte emot mer än målet ens när det
    // finns marginal (samma behovsprincip som computeEnergy.sessionNeedKWh).
    // actualEnergy förblir kapacitetsmåttet som visas med headroom/shortfall.
    // Vad bilen faktiskt tar emot. actualEnergy är ett kapacitetstak och får
    // aldrig presenteras som levererad energi eller räckvidd (granskningsfynd G1) —
    // därför returneras det här talet så att skärm och PDF tvingas läsa samma fält.
    const deliveredPerSession = targetEnergy > 0 ? Math.min(actualEnergy, targetEnergy) : actualEnergy;
    const kwhPerOutletPerDay = deliveredPerSession * sessionsPerOutletPerDay;

    return {
      hubs, hubsByOutlets, hubsBySessions, hubsByPower, hubsByPowerIdeal, maxUsableHubs,
      sessionCapacity: hubs * MAX_SESSIONS_PER_HUB,
      powerNeeded, installedCap, effectiveCap,
      activeOutlets,
      actualEnergyPerOutlet: actualEnergy,
      deliveredEnergyPerOutlet: deliveredPerSession,
      actualEnergyRaw,
      targetEnergyPerOutlet: targetEnergy,
      headroomKWh, shortfallKWh,
      sessionsPerOutletPerDay, totalSessionsPerDay, kwhPerOutletPerDay,
      hwLimit, hwFeasible, perCarPowerNeeded,
      efficiency,
      achievesTarget, limitReason, limitReasons,
      hwLimitRaw, podDerated: hwLimit < hwLimitRaw - 1e-9,
      _inputs: inp,
    };
  }

  // --- F1: Elnätsbedömning (alltid 3-fas 400 V) --------------------------
  // inputs:
  //   fuseSizeA       — servissäkring (A)
  //   existingLoadPct — andel av serviseffekten som redan belastar nätet (0..1)
  //   systemPeakKW    — SmartHub-systemets toppeffekt (peakPowerKW el. effectiveCap)
  //   capPerHub, installedHubs (optional) — används för att räkna ut hur många
  //     SmartHubs den TILLGÄNGLIGA effekten rymmer. Utan det kan UI:t råda
  //     "fler SmartHubs" i ett läge där elnätet inte tar en enda till.
  function computeGridAssessment({ fuseSizeA, existingLoadPct, systemPeakKW, capPerHub, installedHubs, installedCapKW }) {
    // Samma robusthetsfilter som computeEnergy har. Tillståndet kan komma från
    // en handredigerad eller trunkerad URL-hash, och fälten gick tidigare in
    // oskyddade: fuseSizeA = NaN gav NaN i serviseffekt, tillgänglig effekt och
    // överskott — men status 'marginal', alltså ett självsäkert
    // "knappt tillräcklig kapacitet" utan ett enda giltigt tal bakom sig.
    // Icke-finita tal renderas som "–", så raderna såg tomma ut medan
    // STATUSRUBRIKEN lät som ett utlåtande.
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    const fuse = Math.max(1, num(fuseSizeA, 0));
    // P = √3 × 400 V × I
    const servisKW = (Math.sqrt(3) * 400 * fuse) / 1000;
    const existingKW = servisKW * Math.max(0, Math.min(0.99, num(existingLoadPct, 0)));
    const availableKW = servisKW - existingKW;

    // DIMENSIONERANDE LAST (granskningsfynd B1).
    // Statusen jämförde tidigare servisen mot den MODELLERADE toppen — ett tal
    // som följer av antagen beläggning, inte av vad anläggningen får dra. Appens
    // egen defaultstart sa därför "OK, överskott +5,4 kW" för 1 SmartHub (44 kW)
    // på en 63 A-servis med 20 % grundlast (34,9 kW tillgängligt), samtidigt som
    // hubsWithinAvailable i SAMMA returobjekt var 0. Kundrapporten skrev ut båda
    // talen: "TAK 44 kW" på sida 1 och "Överskott +5 kW · OK" på sida 2.
    //
    // En servis dimensioneras mot vad installationen KAN dra. installedCapKW är
    // anläggningens effektiva tak (hubbar × kW/hub, redan nedkapat av ett
    // angivet fastighetseffekttak). Är det taket högre än den lediga effekten
    // räcker servisen inte — oavsett hur lugn den antagna beläggningen är.
    //
    // Utelämnas installedCapKW faller allt tillbaka på det gamla beteendet, så
    // äldre anropare påverkas inte.
    const installedRawKW = (Number.isFinite(installedCapKW) && installedCapKW > 0) ? installedCapKW : null;
    // Anläggningen kan aldrig dra mer ur servisen än sina egna huvudsäkringar
    // släpper igenom: 63 A per SmartHub (se HUB_INFEED_A). Utan hubbantal är
    // gränsen okänd och märkeffekten används rakt av — bakåtkompatibelt.
    const infeedKW = (Number.isFinite(installedHubs) && installedHubs > 0)
      ? installedHubs * HUB_INFEED_KW
      : null;
    const installedKW = installedRawKW != null
      ? (infeedKW != null ? Math.min(installedRawKW, infeedKW) : installedRawKW)
      : null;
    const peakKW = Math.max(0, num(systemPeakKW, 0));
    const dimensionerandeKW = Math.max(peakKW, installedKW || 0);
    const surplusKW = availableKW - dimensionerandeKW;
    // Överskottet mot enbart den modellerade lasten — svarar på "räcker elnätet
    // för det antagna laddbehovet?", vilket är en annan fråga än om
    // installationens märkeffekt ryms.
    const surplusVsPeakKW = availableKW - peakKW;
    // Binder installationens märkeffekt i stället för den modellerade toppen?
    // Då är åtgärden inte nödvändigtvis servisutökning: ett statiskt
    // fastighetseffekttak eller dynamisk lastbalansering (ALM, handbok 8.2 —
    // kräver extern energimätare) begränsar anläggningen mot servisen i stället.
    const limitedByInstalled = installedKW != null && installedKW > peakKW + 1e-9;
    const coverageRatio = peakKW > 0 ? availableKW / peakKW : Infinity;
    // Marginalband: en servis som körs på sitt märkvärde är inte "OK". Kräver
    // minst 10 % ledig kapacitet kvar efter laddningen för grön status —
    // tidigare gav 0,1 % marginal grönt ljus (granskningsfynd C4).
    const MARGIN = GRID_MARGIN;
    const marginRatio = availableKW > 0 ? surplusKW / availableKW : 0;
    // Negativt överskott betyder alltid att servisen inte räcker. Den gamla
    // coverageRatio-grenen lät "Marginellt: knappt tillräcklig kapacitet" stå
    // kvar ända till 25 % överlast — etiketten var då direkt osann.
    // 'marginal' betyder nu entydigt: räcker, men mindre än 10 % marginal kvar.
    // Toleransen finns för att ett överskott på exakt noll är ett legitimt
    // gränsfall som flyttalsaritmetiken gärna gör till -1e-14. Utan den blev
    // "en SmartHub på egen 63 A-servis" (överskott 0,000) godtyckligt antingen
    // 'marginal' eller 'upgrade' beroende på avrundningen i sista biten — och
    // 'upgrade' drar med sig en prislapp på 35 kkr i kundrapporten.
    const NOLL = 1e-9;
    const status = surplusKW < -NOLL
      ? 'upgrade'
      : (marginRatio >= MARGIN - NOLL ? 'ok' : 'marginal');
    // Samma tolerans som status: ett underskott på 1e-14 kW är noll, och utan
    // golvet hade needsUpgradeCost nedan blivit sann och skrivit ut kostnadens
    // fasta startbelopp (35 kkr) för en anläggning som precis går ihop.
    const extraNeeded = -surplusKW > NOLL ? -surplusKW : 0;
    // extraNeeded tar anläggningen till överskott 0 — alltså status 'marginal',
    // "räcker, men utan marginal". Appens egen GRÖNA status kräver GRID_MARGIN
    // ledigt DÄRUTÖVER, och det talet fanns inte: rådet gick aldrig att följa
    // hela vägen till OK, och prislappen bredvid gällde den mindre utökningen
    // (granskningsfynd A1). Nu redovisas båda leden.
    //
    // BÅDA talen förutsätter att fastighetens BEFINTLIGA last är oförändrad
    // efter utökningen. Det är den fysiskt riktiga antagandet — en byggnad
    // förbrukar inte mer för att säkringen bytts — men det är värt att säga
    // uttryckligen, eftersom lasten matas in som en ANDEL av nuvarande servis.
    // Matar man tillbaka en större säkring i appen skalas andelen upp och
    // bedömningen blir en annan; det är inte en motsägelse mot talen här utan
    // en följd av att indata är relativt.
    // Faktorn (1 + NOLL) finns för att talet ska vara ett RÅD som går att följa:
    // utan den landar den exakta lösningen på marginRatio = MARGIN − 1e-17 och
    // statusen blir 'marginal', alltså precis inte det rådet lovade.
    const extraNeededForOkRaw = dimensionerandeKW / (1 - MARGIN) * (1 + NOLL) - availableKW;
    const extraNeededForOk = extraNeededForOkRaw > NOLL ? extraNeededForOkRaw : 0;
    // Uppskattning servisutökning — H2: tre regimer baserat på storlek av utökning.
    // Linjär modell underskattade 3-10× vid stora behov enligt elprojektör-granskning.
    //   0–80 kW   : befintlig kabel räcker, säkrings-/mätarbyte. 30–150 kkr.
    //   80–300 kW : ny serviskabel, ev. utökat servisrum. 100–600 kkr.
    //   >300 kW   : ofta ny nätstation/transformator. 500 kkr – flera Mkr.
    // Kostnaden villkoras på faktiskt behov, inte på status. Ett marginalfall
    // med positivt överskott behöver noll extra kW, och fick ändå prislappen
    // "servisutökning 30–80 kkr" utskriven i både UI och PDF.
    const needsUpgradeCost = extraNeeded > 0;
    let upgradeCostLow = 0, upgradeCostHigh = 0;
    if (needsUpgradeCost) {
      if (extraNeeded <= 80) {
        // Liten utökning — säkrings-/mätarbyte
        upgradeCostLow  = Math.ceil((30000  + extraNeeded * 800)  / 5000) * 5000;
        upgradeCostHigh = Math.ceil((80000  + extraNeeded * 1500) / 5000) * 5000;
      } else if (extraNeeded <= 300) {
        // Medelstor — ny kabel + servisutökning
        const over80 = extraNeeded - 80;
        upgradeCostLow  = Math.ceil((100000 + over80 * 1500) / 5000) * 5000;
        upgradeCostHigh = Math.ceil((250000 + over80 * 3000) / 5000) * 5000;
      } else {
        // Stor — sannolikt egen nätstation/transformator
        const over300 = extraNeeded - 300;
        upgradeCostLow  = Math.ceil((500000  + over300 * 2500) / 10000) * 10000;
        upgradeCostHigh = Math.ceil((1500000 + over300 * 6000) / 10000) * 10000;
      }
    }
    // Hur många SmartHubs ryms i den effekt som faktiskt är TILLGÄNGLIG, dvs
    // efter avdrag för fastighetens befintliga last? Rådet "fler SmartHubs" var
    // tidigare omöjligt att följa i just de fall det gavs: 125 A servis med
    // 20 % grundlast ger 69 kW tillgängligt, vilket rymmer EN hub på 44 kW —
    // inte två. Utan det här talet fick säljaren räkna ut det själv, och
    // elnätspanelen och effektvarningen kunde säga emot varandra.
    const hubKW = Number.isFinite(capPerHub) && capPerHub > 0 ? capPerHub : CAP_PER_HUB_KW;
    const hubsWithinAvailable = Math.max(0, Math.floor(availableKW / hubKW));
    const hubsHeadroom = Number.isFinite(installedHubs)
      ? Math.max(0, hubsWithinAvailable - installedHubs)
      : null;
    return {
      servisKW, existingKW, availableKW, surplusKW, coverageRatio, marginRatio,
      status, extraNeeded, extraNeededForOk, upgradeCostLow, upgradeCostHigh,
      hubsWithinAvailable, hubsHeadroom,
      installedCapKW: installedKW, dimensionerandeKW, surplusVsPeakKW, limitedByInstalled,
    };
  }

  // --- F2: Kostnad & ROI -----------------------------------------------
  // inputs:
  //   materialCost     — total kostnad för material (kr, klumpbelopp för hela projektet)
  //   installationCost — total kostnad för installation (kr, klumpbelopp för hela projektet)
  //   electricityPrice — inköpspris el (kr/kWh)
  //   chargingFee      — debiterad laddavgift (kr/kWh); 0 = fri laddning
  //   totalEnergyDay   — LEVERERAD kWh/dygn (computeEnergy.totalEnergyDay) — intäktsbas
  //   gridEnergyDay    — INKÖPT kWh/dygn före förluster (computeEnergy.totalEnergyFromGrid)
  //                      — kostnadsbas; utelämnad => fallback på totalEnergyDay
  //   powerTariff      — nätbolagets effektavgift (kr/kW/månad) — H1
  //   peakPowerKW      — systemets toppeffekt för effekttariffsberäkning (kW)
  //   omPctYear        — drift & underhåll, % av kapital per år (default 3%)
  //   daysPerMonth     — aktiva laddningsdagar/månad (default 30; kontor ≈ 21)
  //   investmentGrant  — investeringsstöd (kr), t.ex. Naturvårdsverkets "Ladda
  //                      bilen" (50 % av material+installation, max 15 kkr per
  //                      laddpunkt). Dras från kapitalet före payback; O&M
  //                      räknas fortsatt på bruttokapitalet (utrustningen
  //                      kostar lika mycket att underhålla oavsett stöd).
  function computeEconomics({ materialCost, installationCost, electricityPrice, chargingFee, totalEnergyDay, gridEnergyDay, powerTariff, peakPowerKW, omPctYear, daysPerMonth, investmentGrant }) {
    // Samma robusthetsfilter som computeEnergy och computeGridAssessment.
    // chargingFee = Infinity eller peakPowerKW = Infinity ur en trasig
    // delningslänk gav tidigare monthlyNet = ±Infinity och en payback som inte
    // gick att tolka. Alla fält defaultas i stället till noll.
    const tal = (v, d = 0) => (Number.isFinite(v) ? v : d);
    const material           = tal(materialCost);
    const installation       = tal(installationCost);
    const capitalCost        = material + installation;
    const grant              = Math.max(0, Math.min(tal(investmentGrant), capitalCost));
    const netCapitalCost     = capitalCost - grant;
    // Dagar-fix: typdygnet × 30 överskattade kontorssegmentet ~30-40 % —
    // helger/semestrar har nära noll laddning. Profilen styr via daysPerMonth.
    const days               = (Number.isFinite(daysPerMonth) && daysPerMonth > 0) ? daysPerMonth : 30;
    const monthlyEnergyKWh   = Math.max(0, tal(totalEnergyDay)) * days;
    // η-fix: elen köps grid-side FÖRE förlusterna — kostnaden räknas på inköpt
    // volym, intäkten på levererad (uttagsmätt). Med samma bas för båda
    // underskattades kostnaden ~5 % och paybacken blev systematiskt för kort.
    const monthlyPurchasedKWh = (Number.isFinite(gridEnergyDay) && gridEnergyDay > 0 ? gridEnergyDay : Math.max(0, tal(totalEnergyDay))) * days;
    const monthlyEnergyCost  = monthlyPurchasedKWh * Math.max(0, tal(electricityPrice));
    const monthlyPowerCost   = Math.max(0, tal(peakPowerKW)) * Math.max(0, tal(powerTariff));
    const monthlyOpCost      = monthlyEnergyCost + monthlyPowerCost;
    const monthlyRevenue     = monthlyEnergyKWh * Math.max(0, tal(chargingFee));
    // O&M som månadssnitt — typiskt 2-4% av kapital/år (default 3%)
    const monthlyOmCost      = capitalCost * Math.max(0, tal(omPctYear, 0.03)) / 12;
    const monthlyNet         = monthlyRevenue - monthlyOpCost - monthlyOmCost;
    // capitalCost > 0: utan investering finns ingen meningsfull återbetalningstid (undvik "0 mån").
    // Payback på NETTOkapitalet (efter ev. investeringsstöd).
    const paybackMonths      = (monthlyNet > 0 && capitalCost > 0) ? netCapitalCost / monthlyNet : null;
    const paybackYears       = paybackMonths != null ? paybackMonths / 12 : null;

    // --- Livscykelkostnad över LCC_YEARS år ------------------------------
    // ODISKONTERAD, som paybacken. Att blanda en diskonterad LCC med en
    // odiskonterad payback i samma ruta vore att presentera två tal som ser
    // jämförbara ut men bygger på olika antaganden. Vill man ha nuvärde krävs
    // en kalkylränta som säljaren kan försvara — ett medvetet bortval.
    //
    // Inga prisökningar heller: elpriset antas realt konstant. Ett påslag på
    // säg 2 %/år skulle flytta tioårstalet ~10 %, men det är en gissning om
    // elmarknaden som kalkylatorn inte har grund för.
    const lccMonths = LCC_YEARS * 12;
    const lccEnergyCost  = monthlyEnergyCost * lccMonths;
    const lccPowerCost   = monthlyPowerCost * lccMonths;
    const lccOmCost      = monthlyOmCost * lccMonths;
    // Investeringen räknas NETTO (efter stöd) — det är den faktiska utgiften.
    const lccTotal       = netCapitalCost + lccEnergyCost + lccPowerCost + lccOmCost;
    const lccRevenue     = monthlyRevenue * lccMonths;
    const lccNet         = lccTotal - lccRevenue;
    const lccEnergyKWh   = monthlyEnergyKWh * lccMonths;
    // LCoE = vad varje LEVERERAD kWh kostar när investeringen slås ut över
    // perioden. Det är talet som går att hålla mot ett laddoperatörsavtal
    // eller mot att inte bygga alls. Intäkter räknas INTE av — LCoE är en
    // kostnad per kWh, inte ett netto.
    const lcoe = lccEnergyKWh > 0 ? lccTotal / lccEnergyKWh : null;

    return {
      lccYears: LCC_YEARS,
      lccEnergyCost, lccPowerCost, lccOmCost, lccTotal, lccRevenue, lccNet,
      lccEnergyKWh, lcoe,
      capitalCost, investmentGrant: grant, netCapitalCost,
      materialCost: material, installationCost: installation,
      // Priserna ekas tillbaka så att PDF:en kan redovisa vad paybacken bygger på.
      // Utan dem kan mottagaren inte kontrollräkna rubriktalet (granskningsfynd E3).
      // Effekttariffen, dess topplast och D&U-procenten saknades: beloppen stod
      // i rapporten men satsen bakom dem gick inte att härleda, och D&U räknas
      // dessutom på BRUTTOkapitalet även när investeringsstöd dragits av — ett
      // medvetet val som bara stod i koden (granskningsfynd M7).
      electricityPrice: Math.max(0, tal(electricityPrice)), chargingFee: Math.max(0, tal(chargingFee)),
      powerTariff: Math.max(0, tal(powerTariff)), tariffPeakKW: Math.max(0, tal(peakPowerKW)),
      omPctYear: Math.max(0, tal(omPctYear, 0.03)),
      // Bakåtkomp — behåll äldre fältnamn som alias så PDF/övrig kod inte bryts
      hubCapital: material, outletCapital: installation,
      daysPerMonth: days,
      monthlyEnergyKWh, monthlyPurchasedKWh, monthlyEnergyCost, monthlyPowerCost, monthlyOpCost,
      monthlyOmCost, monthlyRevenue, monthlyNet,
      paybackMonths, paybackYears,
    };
  }


  // --- F3: Enkla lägets beräkning ----------------------------------------
  // Frågan: kunden har N parkeringsplatser och en viss huvudsäkring — hur
  // långt kan varje bil köra på en laddning?
  //
  //     energi per bil = effekttak × parkeringstid / antal platser
  //
  // MODELLEN ÄR MED FLIT EN ANNAN ÄN computeEnergy, och det är ett beslut värt
  // att förstå innan någon "förbättrar" den här funktionen genom att koppla in
  // profilmodellen igen.
  //
  // Första versionen anropade computeEnergy. Den sprider ut närvaron över hela
  // dygnet: parkeringstiden blir hur länge EN bil står, beläggningsprofilen
  // avgör hur många som står där varje timme, och platserna OMSÄTTS. För BRF
  // med 40 platser och 10 h gav det 1,33 bilar per plats och dygn, en
  // anläggning som arbetar 22,8 av 24 timmar, och 18,7 kWh per laddning.
  //
  // Daniel räknade 44 kW × 10 h / 40 platser = 11 kWh, kände inte igen svaret,
  // och frågade varför. Det ledde till två saker: ett osant påstående i UI:t
  // ("alla 40 platser — samtidigt") och det här beslutet:
  //
  //   "När vi säger parkeringstid så räknar vi PER DYGN, det blir enklast att
  //    förstå. Bostad 15 h parkeringstid per dygn. Dvs man räknar inte med att
  //    det sprids ut 15 h så att hela dygnet kan nyttjas."   — 2026-09-17
  //
  // Alltså: EN laddning per plats och dygn, och laddfönstret är parkeringstiden.
  // Talet går att räkna efter på en servett, vilket är hela poängen med läget.
  // Avancerat behåller profilmodellen — där är frågan en annan (hur ser lasten
  // ut över dygnet när närvaron varierar), och där är computeEnergy rätt.
  //
  // MODELLVALET FÖR EFFEKTTAKET — läs det här innan någon "rättar" systemCap:
  //
  // Elnätsbedömningen dimensionerar sedan v3.9.0 (fynd B1) mot vad anläggningen
  // KAN dra, alltså hubbarnas märkeffekt. Det gör enkla lägets fråga obesvarbar:
  // en enda SmartHub à 44 kW spränger redan en 63 A-servis. Svaret är inte att
  // mjuka upp bedömningen utan att använda produkten — med dynamisk
  // lastbalansering mot extern energimätare (ALM, handbok 8.2) begränsas
  // anläggningen mot servisen i stället för att kräva utökning.
  //
  // Ingen marginal dras av (Daniel 2026-09-17: "10 % marginal mot säkring, det
  // behövs inte"): ALM håller taket aktivt, så huvudsäkringen ÄR gränsen och
  // 63 A betyder 44 kW. Följden är att elnätsstatus blir 'marginal', inte 'ok';
  // spärren i test-fynd.mjs kräver därför bara att den aldrig blir 'upgrade'.
  //
  // FOTNOT OM 6 A-GOLVET: med många platser på ett litet tak kan energin per bil
  // motsvara mindre än 6 A kontinuerligt, och Amp5 laddar aldrig under 6 A
  // (handbok 8.3.1) — i verkligheten laddar färre bilar åt gången och de andra
  // köar. Energin per bil är ändå total/antal, så talet står sig; det är bara
  // ordet "samtidigt" som inte gör det. UI:t påstår därför inte det.
  //
  // inputs:
  //   fuseSizeA        — servissäkring (A), 3-fas 400 V
  //   existingLoadPct  — andel av servisen som redan är belastad (0–1)
  //   outlets          — antal laddplatser (reglaget användaren drar i)
  //   parkingHours     — laddfönster per dygn (h)
  //   profileHours     — närvaroprofil, 24 värden; används BARA för att placera
  //                      laddfönstret på dygnet, inte för att forma efterfrågan
  //   hwLimitKW        — bilens AC-tak (kW)
  //   efficiency       — verkningsgrad nät → uttag
  function computeSimple(inp) {
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    const fuse = Math.max(1, num(inp.fuseSizeA, 63));
    const servisKW = (Math.sqrt(3) * 400 * fuse) / 1000;
    const existingPct = Math.max(0, Math.min(0.99, num(inp.existingLoadPct, 0)));
    const existingKW = servisKW * existingPct;
    const availableKW = servisKW - existingKW;
    const systemCapKW = availableKW;

    const capPerHub = Math.min(CAP_PER_HUB_KW, Math.max(1, num(inp.capPerHub, CAP_PER_HUB_KW)));
    const outlets = Math.max(1, Math.floor(num(inp.outlets, 1)));
    const L = Math.min(24, Math.max(1, Math.round(num(inp.parkingHours, 1))));
    const eff = Math.max(0.5, Math.min(1, num(inp.efficiency, DEFAULT_EFFICIENCY)));
    const hwLimit = Math.max(0.1, num(inp.hwLimitKW, HW_LIMIT_KW));

    // --- Energin per bil ---------------------------------------------------
    // Anläggningens effekt delad på platserna, under laddfönstret. Två tak:
    //   1. vad anläggningen kan leverera: systemCap × L, fördelat på outlets
    //   2. vad bilen kan ta emot: dess AC-laddare × L
    const franNatetPerBil = (systemCapKW * L) / outlets;      // kWh, nätsidigt
    const perOutletKWh = Math.min(franNatetPerBil * eff, hwLimit * L);
    const totalEnergyDay = perOutletKWh * outlets;            // levererat
    const totalEnergyFromGrid = totalEnergyDay / eff;
    // Binder bilens tak ligger anläggningen under sitt eget effekttak.
    const effektKW = Math.min(systemCapKW, totalEnergyFromGrid / L);

    // --- Laddfönstret ------------------------------------------------------
    // L sammanhängande timmar där profilen har flest bilar på plats. Profilen
    // används alltså bara för att PLACERA fönstret på dygnet, inte för att
    // forma efterfrågan — bostadsprofilen lägger det över natten, kontorets
    // mitt på dagen. Utan profil: från midnatt.
    const profil = Array.isArray(inp.profileHours) && inp.profileHours.length === 24
      ? inp.profileHours.map((x) => Math.max(0, num(x, 0)))
      : null;
    let start = 0;
    if (profil) {
      let bast = -1;
      for (let s = 0; s < 24; s++) {
        let summa = 0;
        for (let k = 0; k < L; k++) summa += profil[(s + k) % 24];
        if (summa > bast) { bast = summa; start = s; }
      }
    }
    const iFonstret = new Array(24).fill(false);
    for (let k = 0; k < L; k++) iFonstret[(start + k) % 24] = true;
    const hourly = iFonstret.map((p) => (p ? effektKW : 0));

    // Okontrollerad efterfrågan: alla bilar drar sitt eget maxtak samtidigt.
    // Skillnaden mot hourly ÄR lastbalanseringens bidrag, och den är stor —
    // det är den som gör att anläggningen ryms i servisen.
    const efterfraganKW = outlets * hwLimit;
    const hourlyDemand = iFonstret.map((p) => (p ? efterfraganKW : 0));

    const hubs = Math.max(
      1,
      Math.ceil(systemCapKW / capPerHub),                 // utnyttja servisen
      Math.ceil(outlets / OUTLETS_PER_HUB),               // fysiska uttag (54/hub)
      Math.ceil(outlets / MAX_SESSIONS_PER_HUB),          // simultana sessioner (30/hub)
    );

    return {
      outlets, hubs, systemCapKW, availableKW, servisKW, existingKW,
      perOutletKWh,
      parkingHours: L,
      // EN laddning per plats och dygn. Det är hela skillnaden mot
      // computeEnergy, som låter platserna omsättas — se noten ovan.
      sessionsPerDay: outlets,
      sessionsPerOutlet: 1,
      // Binder bilens AC-tak i stället för anläggningens effekt? Då hjälper
      // varken fler hubbar eller en större säkring.
      limitedByCar: hwLimit * L <= franNatetPerBil * eff + 1e-9,
      laddfonsterStart: start,
      // Formen HourlyChart och PowerChart förväntar sig. Inget kohortsvep
      // behövs: modellen är en rektangel, och det är precis vad den ritar.
      energy: {
        hourly,
        hourlyDemand,
        effectiveCap: systemCapKW,
        installedCap: hubs * capPerHub,
        peakPowerKW: effektKW,
        peakDemandKW: efterfraganKW,
        peakReductionKW: Math.max(0, efterfraganKW - effektKW),
        totalEnergyDay,
        totalEnergyFromGrid,
        perOutletKWh,
        hubs,
        profileLabel: inp.profileLabel,
      },
    };
  }

  // --- Formateringshjälp -------------------------------------------------
  function fmt(n, opts = {}) {
    if (n == null || !isFinite(n)) return '–';
    const { digits = 0, suffix = '' } = opts;
    return n.toLocaleString('sv-SE', { maximumFractionDigits: digits, minimumFractionDigits: digits }) + suffix;
  }

  // Onboard-laddarens AC→DC-verkningsgrad. η ovan täcker kabel och hub fram till
  // uttaget; kwh100 är batteri-till-hjul (se KÄLLA OCH DEFINITION vid CARS).
  // Ledet omvandlar alltså uttagsmätt AC till energi i batteriet, och behövs
  // därför — utan det blev räckvidden 8–10 % för hög (granskningsfynd C2).
  //
  // Verifierat mot källan 2026-09-13. Den tidigare formuleringen här — "WLTP
  // mäter energi UR batteriet" — var fel som påstående om WLTP: deklarerad
  // WLTP-förbrukning mäts FRÅN NÄTET och innehåller laddförlusten. Slutsatsen
  // råkade ändå bli rätt, eftersom tabellen inte är WLTP utan EV Databases
  // verkliga förbrukning, som ÄR batterisidig. Rör inte det här ledet utan att
  // först läsa noten vid CARS.
  function rangeKm(kwh, kwh100, onboardEff) {
    if (!kwh || !kwh100) return 0;
    const eff = Number.isFinite(onboardEff) ? onboardEff : ONBOARD_EFFICIENCY;
    return ((kwh * eff) / kwh100) * 100;
  }

  window.Amp5Calc = {
    CAP_PER_HUB_KW, OUTLETS_PER_HUB, MAX_SESSIONS_PER_HUB, HW_LIMIT_KW, LCC_YEARS,
    HUB_INFEED_A, HUB_INFEED_KW,
    OUTLET_HW_LIMIT_KW, CAR_AC_LIMIT_KW,
    DEFAULT_EFFICIENCY, ONBOARD_EFFICIENCY,
    LIMIT_REASON, LIMIT_REASON_LABEL, SCENARIO_PALETTE,
    LB_STRATEGY, DEFAULT_STRATEGY, MIN_CHARGE_A, GRID_MARGIN,
    allocatePower, ampsToKW, isThreePhase,
    PROFILES, CARS,
    computeEnergy, computeHubs, computeGridAssessment, computeEconomics,
    computeSimple,
    fmt, rangeKm, mean, sum,
  };
})();


