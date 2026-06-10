// calc.js — shared calculation model for Amp5 Laddkalkylator redesign
// Pure functions; no DOM. Expose on window for Babel-transpiled callers.

(function () {
  // Produktkonstanter — avstämt mot SmartHub-spec v2024. Om specen ändras
  // uppdateras dessa här; all känslighet i UI/PDF hämtar via Amp5Calc.
  const CAP_PER_HUB_KW = 44;       // kW per SmartHub (nominal)
  const OUTLETS_PER_HUB = 54;      // fysiska uttag per SmartHub
  const OUTLET_HW_LIMIT_KW = 22;   // hub-uttagets HW-tak (Type 2 trefas 32A)
  const CAR_AC_LIMIT_KW = 11;      // typisk modern EV on-board charger (trefas 16A)
  // Bilen är nästan alltid den lägre — endast en liten del av flottan
  // (t.ex. Renault Zoe, BMW i3 trefas) går till 22 kW.
  const HW_LIMIT_KW = Math.min(OUTLET_HW_LIMIT_KW, CAR_AC_LIMIT_KW);

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
  // Trickle-gräns: under denna effekt per laddande bil vid samtidig peak
  // varnar både UI och PDF för underdimensionering.
  const TRICKLE_LIMIT_KW = 2.0;

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

  // Bilmodeller — WLTP kombinerad (kWh/100 km).
  const CARS = [
    // Volvo
    { id: 'ex30',       name: 'Volvo EX30',            kwh100: 16.0 },
    { id: 'xc40',       name: 'Volvo EX40',            kwh100: 19.3 },
    // Tesla
    { id: 'tesla3',     name: 'Tesla Model 3 LR',      kwh100: 14.5 },
    { id: 'tesla3rwd',  name: 'Tesla Model 3 RWD',     kwh100: 13.5 },
    { id: 'teslamy',    name: 'Tesla Model Y RWD',      kwh100: 15.8 },
    // VW/Škoda/Cupra
    { id: 'id4',        name: 'VW ID.4 Pro',           kwh100: 17.5 },
    { id: 'id7',        name: 'VW ID.7 Pro',           kwh100: 16.2 },
    { id: 'enyaq',      name: 'Škoda Enyaq 60',        kwh100: 15.9 },
    { id: 'born',       name: 'Cupra Born',            kwh100: 16.0 },
    // Hyundai/Kia
    { id: 'ioniq5',     name: 'Hyundai Ioniq 5 RWD',  kwh100: 17.5 },
    { id: 'kona',       name: 'Hyundai Kona EV',       kwh100: 15.0 },
    { id: 'kiaev3',     name: 'Kia EV3 Long Range',    kwh100: 15.5 },
    { id: 'kiaev6',     name: 'Kia EV6 RWD',          kwh100: 17.2 },
    // Polestar/BMW/MG/Ford
    { id: 'polestar2',  name: 'Polestar 2 SM',         kwh100: 17.1 },
    { id: 'bmwix1',     name: 'BMW iX1 eDrive20',      kwh100: 16.1 },
    { id: 'mg4',        name: 'MG4 Extended Range',    kwh100: 16.5 },
    { id: 'mache',      name: 'Ford Mustang Mach-E',   kwh100: 19.0 },
  ];

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const mean = (arr) => sum(arr) / arr.length;

  // Skalar profilen så att dess MAX = target. Bevarar profilens form
  // (kontor ser ut som kontor, bostad som bostad). Clampar [0, 1].
  // Detta är default-modellen — slidern styr peak, inte medel.
  function shapeToPeak(hours, target) {
    const t = Math.max(0, Math.min(1, target));
    const peak = Math.max(...hours) || 1;
    const scale = t / peak;
    return hours.map((h) => Math.max(0, Math.min(1, h * scale)));
  }

  // Default systemverkningsgrad (kabel- + hub-förluster). Bilens onboard-
  // charger AC→DC räknas separat och ingår normalt INTE i EVSE-sizing.
  const DEFAULT_EFFICIENCY = 0.95;

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
    const hubs = Number.isFinite(inp.hubs) ? inp.hubs : autoHubs;
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
    const occInput = rawOcc ?? 0;
    // parkingInt cappas till 24 så presence-faltningen inte wrappar dygnet flera varv.
    const parkingInt = Math.min(24, Math.max(1, Math.round(num(inp.parkingHours, 1))));

    // Ankomstrekonstruktion via dekonvolution mot profilnivån. Profilen säger
    // hur många bilar som STÅR där varje timme; parkeringstiden hur länge en
    // bil står. arrivals[t] sätts så att summan av ännu närvarande ankomster
    // når profilens nivå: Σ arrivals[t−parkingInt+1 .. t] ≈ profile[t].
    // (Fix: tidigare gradientmodell gav noll ankomster på platåer/fallande
    // flank — anläggningen "tömdes" parkingInt timmar efter sista stigningen,
    // t.ex. köpcentrum tomt kl 19-23 och BRF-garage tomt kl 03-05.)
    // Startgissning: profilnivån likformigt fördelad över fönstret — exakt
    // fixpunkt för platta profiler. Dämpad uppdatering (0,5-mix) krävs:
    // odämpad Gauss-Seidel oscillerar med period 2 när parkingInt inte delar
    // 24 (ger paritetsberoende energi och hål i beläggningen). Avbryt när
    // lösningen är stabil. Där profilen faller brantare än bilarna hinner
    // lämna ligger närvaron kvar över profilen — fysiskt korrekt: en bil
    // står minst parkingInt timmar.
    const profile = inp.profileHours;
    const arrivals = profile.map((p) => p / parkingInt);
    for (let pass = 0; pass < 60; pass++) {
      let maxDelta = 0;
      for (let t = 0; t < 24; t++) {
        let stillPresent = 0;
        for (let dh = 1; dh < parkingInt; dh++) {
          stillPresent += arrivals[(t - dh + 24) % 24];
        }
        const next = 0.5 * arrivals[t] + 0.5 * Math.max(0, profile[t] - stillPresent);
        maxDelta = Math.max(maxDelta, Math.abs(next - arrivals[t]));
        arrivals[t] = next;
      }
      if (maxDelta < 1e-9) break;
    }
    const aSum = sum(arrivals);
    const normArrivals = aSum > 1e-9
      ? arrivals.map((a) => a / aSum)
      : profile.map((p) => p / (sum(profile) || 1));

    // Närvaro = ankomst faltad med parkeringsfönster (rect, längd parkingInt).
    const presence = new Array(24).fill(0);
    for (let t = 0; t < 24; t++) {
      const a = normArrivals[t];
      if (a === 0) continue;
      for (let dh = 0; dh < parkingInt; dh++) {
        presence[(t + dh) % 24] += a;
      }
    }
    const hours = shapeToPeak(presence, occInput);
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
    // 4 dygn simuleras: dygn 3 är stationärt och ger timeffekten, och kohorter
    // med start i dygn 3 hinner alltid ladda klart före simuleringens slut.
    const needDelivered = (inp.sessionNeedKWh != null && inp.sessionNeedKWh > 0)
      ? inp.sessionNeedKWh : null;
    const needGrid = needDelivered != null ? needDelivered / efficiency : Infinity;
    const cohortCars = normArrivals.map((a) => a * totalSessionsPerDay); // ankommande bilar per timme

    const simulate = (cap) => {
      const power = new Array(24).fill(0);      // kW per timme (stationärt dygn)
      const sessionKWh = new Array(24).fill(0); // grid-kWh per bil, per ankomsttimme
      const chargingCars = new Array(24).fill(0); // antal LADDANDE bilar per timme
      const remaining = new Array(96).fill(0);  // kvarvarande grid-behov per kohort
      for (let h = 0; h < 96; h++) {
        remaining[h] = needGrid;
        let activeCars = 0;
        const charging = [];
        for (let s0 = Math.max(0, h - parkingInt + 1); s0 <= h; s0++) {
          if (cohortCars[s0 % 24] <= 1e-12 || remaining[s0] <= 1e-9) continue;
          charging.push(s0);
          activeCars += cohortCars[s0 % 24];
        }
        if (charging.length === 0) continue;
        // Kapacitetsdelning bland bilar som fortfarande laddar. En bil i sin
        // sista deltimme utnyttjar inte hela sin andel — överskottet om-
        // fördelas inte (marginellt konservativt mot smart lastbalansering).
        const perCar = Math.min(hwLimit, cap / Math.max(activeCars, 1));
        let totalKW = 0;
        for (const s0 of charging) {
          const draw = Math.min(perCar, remaining[s0]); // 1 h → kWh
          remaining[s0] -= draw;
          totalKW += draw * cohortCars[s0 % 24];
          if (s0 >= 48 && s0 < 72) sessionKWh[s0 - 48] += draw;
        }
        if (h >= 48 && h < 72) {
          power[h - 48] = totalKW;
          chargingCars[h - 48] = activeCars;
        }
      }
      return { power, sessionKWh, chargingCars };
    };

    // Okontrollerad efterfrågan = samma simulering utan effekttak (bilarna
    // slutar ändå vid mött behov). SmartHub-levererat = capat av effectiveCap.
    const sim = simulate(effectiveCap);
    const hourlyPower = sim.power;
    const hourlyDemand = simulate(Infinity).power;

    const totalEnergyFromGrid = sum(hourlyPower);
    const totalEnergyDay = totalEnergyFromGrid * efficiency;

    // Effekt per LADDANDE bil i den timme som ger toppeffekten. Bilar som
    // mött sitt behov står kvar utan att ladda och ingår inte i nämnaren —
    // till skillnad från närvaro-baserade mått (peakPower / närvarande).
    let peakHour = 0;
    for (let t = 1; t < 24; t++) {
      if (hourlyPower[t] > hourlyPower[peakHour]) peakHour = t;
    }
    const chargingAtPeak = sim.chargingCars[peakHour];
    const perCarAtPeakKW = chargingAtPeak > 1e-9
      ? Math.min(hwLimit, effectiveCap / Math.max(chargingAtPeak, 1))
      : null;

    // Per-bil-energi efter η: ankomstviktat snitt av kohorternas sessionsenergi.
    // Simuleringen sker i grid-units, η appliceras vid output.
    let perOutletKWhRaw = 0;
    for (let t0 = 0; t0 < 24; t0++) {
      perOutletKWhRaw += normArrivals[t0] * sim.sessionKWh[t0];
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
      activeOutlets: avgActive,
      maxOutlets: outlets,
      peakOccupancyPct,
      sessionsPerOutletPerDay, totalSessionsPerDay, kwhPerOutletPerDay,
      sessionNeedKWh: needDelivered, needLimited,
      perCarAtPeakKW, chargingAtPeak,
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
    const hwLimit = num(inp.hwLimitKW, HW_LIMIT_KW);
    const efficiency = Math.max(0.5, Math.min(1, num(inp.efficiency, DEFAULT_EFFICIENCY)));
    const occ = Math.max(0, Math.min(1, num(inp.occupancyPct, 0)));
    const parkingH = Math.max(0.5, num(inp.parkingHours, 0.5));
    const desiredKWhPerOutlet = Math.max(0, num(inp.desiredKWhPerOutlet, 0));
    // systemCap <= 0 (eller null) = inget tak. 0 kW är inte ett meningsfullt effekttak.
    const systemCap = (inp.systemCap != null && inp.systemCap > 0) ? inp.systemCap : null;
    const activeOutlets = outlets * occ;

    // Levererad energi target → grid-side power needed = target / η.
    const powerNeeded = (desiredKWhPerOutlet * activeOutlets) / (parkingH * efficiency);

    const hubsByOutlets = Math.ceil(outlets / OUTLETS_PER_HUB);

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

    const hubs = Math.max(1, hubsByOutlets, hubsByPower);
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
    // activeOutlets > 0: vid noll beläggning levereras 0 kWh — då är målet inte "nått".
    const capacityAchieves = activeOutlets > 0 && effectiveCap >= powerNeeded - 1e-6;
    const achievesTarget = capacityAchieves && hwFeasible;

    let limitReason = null;
    if (!achievesTarget) {
      if (!hwFeasible) limitReason = LIMIT_REASON.HW;
      // Kapacitetsbaserat test: om systemtaket självt ligger under behovet är det
      // servisen som begränsar (fler hubs hjälper inte), inte hub-konfigurationen.
      else if (systemCap != null && systemCap < powerNeeded - 1e-6) limitReason = LIMIT_REASON.SYSTEM_CAP;
      else limitReason = LIMIT_REASON.HW_CONFIG;
    }

    // Konstant beläggning antas i hub-dimensionering: varje aktivt uttag
    // omsätter sig en gång per parkingH-fönster, dvs 24/parkingH per dygn.
    const sessionsPerOutletPerDay = occ * 24 / parkingH;
    const totalSessionsPerDay = sessionsPerOutletPerDay * outlets;
    // Realiserad dygnsenergi: bilen tar inte emot mer än målet ens när det
    // finns marginal (samma behovsprincip som computeEnergy.sessionNeedKWh).
    // actualEnergy förblir kapacitetsmåttet som visas med headroom/shortfall.
    const deliveredPerSession = targetEnergy > 0 ? Math.min(actualEnergy, targetEnergy) : actualEnergy;
    const kwhPerOutletPerDay = deliveredPerSession * sessionsPerOutletPerDay;

    return {
      hubs, hubsByOutlets, hubsByPower, hubsByPowerIdeal, maxUsableHubs,
      powerNeeded, installedCap, effectiveCap,
      activeOutlets,
      actualEnergyPerOutlet: actualEnergy,
      actualEnergyRaw,
      targetEnergyPerOutlet: targetEnergy,
      headroomKWh, shortfallKWh,
      sessionsPerOutletPerDay, totalSessionsPerDay, kwhPerOutletPerDay,
      hwLimit, hwFeasible, perCarPowerNeeded,
      efficiency,
      achievesTarget, limitReason,
      _inputs: inp,
    };
  }

  // --- F1: Elnätsbedömning (alltid 3-fas 400 V) --------------------------
  // inputs:
  //   fuseSizeA       — servissäkring (A)
  //   existingLoadPct — andel av serviseffekten som redan belastar nätet (0..1)
  //   systemPeakKW    — SmartHub-systemets toppeffekt (peakPowerKW el. effectiveCap)
  function computeGridAssessment({ fuseSizeA, existingLoadPct, systemPeakKW }) {
    const fuse = Math.max(1, fuseSizeA != null ? fuseSizeA : 0);
    // P = √3 × 400 V × I
    const servisKW = (Math.sqrt(3) * 400 * fuse) / 1000;
    const existingKW = servisKW * Math.max(0, Math.min(0.99, existingLoadPct ?? 0));
    const availableKW = servisKW - existingKW;
    const surplusKW = availableKW - (systemPeakKW || 0);
    const coverageRatio = systemPeakKW > 0 ? availableKW / systemPeakKW : Infinity;
    // ok = täcks helt (surplus ≥ 0), marginal = 80–99% av behov täcks, upgrade = under 80%
    const status = surplusKW >= 0 ? 'ok' : coverageRatio >= 0.8 ? 'marginal' : 'upgrade';
    const extraNeeded = Math.max(0, -surplusKW);
    // Uppskattning servisutökning — H2: tre regimer baserat på storlek av utökning.
    // Linjär modell underskattade 3-10× vid stora behov enligt elprojektör-granskning.
    //   0–80 kW   : befintlig kabel räcker, säkrings-/mätarbyte. 30–150 kkr.
    //   80–300 kW : ny serviskabel, ev. utökat servisrum. 100–600 kkr.
    //   >300 kW   : ofta ny nätstation/transformator. 500 kkr – flera Mkr.
    const needsUpgradeCost = status !== 'ok';
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
    return {
      servisKW, existingKW, availableKW, surplusKW, coverageRatio,
      status, extraNeeded, upgradeCostLow, upgradeCostHigh,
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
    const material           = materialCost || 0;
    const installation       = installationCost || 0;
    const capitalCost        = material + installation;
    const grant              = Math.max(0, Math.min(investmentGrant || 0, capitalCost));
    const netCapitalCost     = capitalCost - grant;
    // Dagar-fix: typdygnet × 30 överskattade kontorssegmentet ~30-40 % —
    // helger/semestrar har nära noll laddning. Profilen styr via daysPerMonth.
    const days               = (Number.isFinite(daysPerMonth) && daysPerMonth > 0) ? daysPerMonth : 30;
    const monthlyEnergyKWh   = (totalEnergyDay || 0) * days;
    // η-fix: elen köps grid-side FÖRE förlusterna — kostnaden räknas på inköpt
    // volym, intäkten på levererad (uttagsmätt). Med samma bas för båda
    // underskattades kostnaden ~5 % och paybacken blev systematiskt för kort.
    const monthlyPurchasedKWh = ((gridEnergyDay != null && gridEnergyDay > 0) ? gridEnergyDay : (totalEnergyDay || 0)) * days;
    const monthlyEnergyCost  = monthlyPurchasedKWh * (electricityPrice || 0);
    const monthlyPowerCost   = (peakPowerKW || 0) * (powerTariff || 0);
    const monthlyOpCost      = monthlyEnergyCost + monthlyPowerCost;
    const monthlyRevenue     = monthlyEnergyKWh * (chargingFee || 0);
    // O&M som månadssnitt — typiskt 2-4% av kapital/år (default 3%)
    const monthlyOmCost      = capitalCost * (Number.isFinite(omPctYear) ? omPctYear : 0.03) / 12;
    const monthlyNet         = monthlyRevenue - monthlyOpCost - monthlyOmCost;
    // capitalCost > 0: utan investering finns ingen meningsfull återbetalningstid (undvik "0 mån").
    // Payback på NETTOkapitalet (efter ev. investeringsstöd).
    const paybackMonths      = (monthlyNet > 0 && capitalCost > 0) ? netCapitalCost / monthlyNet : null;
    const paybackYears       = paybackMonths != null ? paybackMonths / 12 : null;
    return {
      capitalCost, investmentGrant: grant, netCapitalCost,
      materialCost: material, installationCost: installation,
      // Bakåtkomp — behåll äldre fältnamn som alias så PDF/övrig kod inte bryts
      hubCapital: material, outletCapital: installation,
      daysPerMonth: days,
      monthlyEnergyKWh, monthlyPurchasedKWh, monthlyEnergyCost, monthlyPowerCost, monthlyOpCost,
      monthlyOmCost, monthlyRevenue, monthlyNet,
      paybackMonths, paybackYears,
    };
  }

  // --- Formateringshjälp -------------------------------------------------
  function fmt(n, opts = {}) {
    if (n == null || !isFinite(n)) return '–';
    const { digits = 0, suffix = '' } = opts;
    return n.toLocaleString('sv-SE', { maximumFractionDigits: digits, minimumFractionDigits: digits }) + suffix;
  }

  function rangeKm(kwh, kwh100) {
    if (!kwh || !kwh100) return 0;
    return (kwh / kwh100) * 100;
  }

  window.Amp5Calc = {
    CAP_PER_HUB_KW, OUTLETS_PER_HUB, HW_LIMIT_KW,
    OUTLET_HW_LIMIT_KW, CAR_AC_LIMIT_KW,
    DEFAULT_EFFICIENCY,
    LIMIT_REASON, LIMIT_REASON_LABEL, TRICKLE_LIMIT_KW, SCENARIO_PALETTE,
    PROFILES, CARS,
    computeEnergy, computeHubs, computeGridAssessment, computeEconomics,
    shapeToPeak,
    fmt, rangeKm, mean, sum,
  };
})();


