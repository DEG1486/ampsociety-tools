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

  const SCENARIO_PALETTE = ['#F46036', '#58A08B', '#F5A888', '#86341E', '#2E5449', '#B5CDC3'];

  // Beläggningsprofiler (24h, andel 0..1). Formen är det vi bryr oss om;
  // profilen skalas mot användarens avgOccupancyPct vid beräkning.
  const PROFILES = {
    office: {
      label: 'Kontor',
      hours: [.05,.05,.05,.05,.05,.1,.3,.6,.85,.95,.95,.9,.75,.85,.9,.85,.7,.45,.25,.15,.1,.08,.05,.05],
    },
    mall: {
      label: 'Köpcentrum',
      hours: [.05,.05,.05,.05,.05,.05,.1,.15,.25,.45,.65,.8,.85,.85,.85,.9,.95,.9,.75,.55,.35,.2,.1,.05],
    },
    residential: {
      label: 'Bostad',
      hours: [.85,.9,.9,.9,.85,.75,.55,.3,.15,.1,.1,.15,.2,.2,.25,.35,.55,.75,.85,.9,.9,.9,.88,.85],
    },
    flat: {
      label: 'Jämn',
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

    // Ankomstfördelning = profilens stigande flank. Profilen säger NÄR
    // bilar dyker upp; parkeringstiden säger HUR LÄNGE de står. Platta
    // profiler (gradient ≈ 0) faller tillbaka på profilen själv.
    const profile = inp.profileHours;
    const arrivalsRaw = profile.map((o, i) =>
      Math.max(0, o - profile[(i - 1 + 24) % 24])
    );
    const aSum = sum(arrivalsRaw);
    const normArrivals = aSum > 1e-9
      ? arrivalsRaw.map((a) => a / aSum)
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

    // Okontrollerad efterfrågan: alla närvarande bilar drar full hwLimit.
    // SmartHub-levererad effekt: capad av effectiveCap. Diff = peak-reduktion.
    const hourlyDemand = hours.map((occ) => outlets * occ * hwLimit);
    const hourlyPower = hourlyDemand.map((d) => Math.min(d, effectiveCap));

    const totalEnergyFromGrid = sum(hourlyPower);
    const totalEnergyDay = totalEnergyFromGrid * efficiency;
    const outletHoursDay = sum(hours) * outlets;

    // Per-bil-energi efter η. Simuleringen sker i grid-units, η appliceras vid output.
    let perOutletKWhRaw = 0;
    for (let t0 = 0; t0 < 24; t0++) {
      if (normArrivals[t0] === 0) continue;
      let energyForThisStart = 0;
      for (let dh = 0; dh < parkingInt; dh++) {
        const h = (t0 + dh) % 24;
        const otherActive = outlets * hours[h];
        // bilen ingår redan i otherActive (hours[h] = beläggningsfraktion inkl. bilen)
        const activeWithHer = Math.max(1, otherActive);
        const perActive = Math.min(hwLimit, effectiveCap / activeWithHer);
        energyForThisStart += perActive; // 1h → kWh
      }
      perOutletKWhRaw += normArrivals[t0] * energyForThisStart;
    }
    // Vid noll beläggning (sum(hours)=0) levereras ingen energi — håll per-session
    // konsistent med totalEnergyDay i stället för att visa hwLimit×parkingInt.
    const perOutletKWh = sum(hours) > 0 ? perOutletKWhRaw * efficiency : 0;

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

    // Sessionsantal: total presence-tid över dygnet / parkeringstid per session.
    // sum(hours) = total uttag-närvaro-andel-timmar per uttag (24 timmar × snitt).
    const sessionsPerOutletPerDay = sum(hours) / parkingInt;
    const totalSessionsPerDay = sessionsPerOutletPerDay * outlets;
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
    const hubsByPowerIdeal = Math.ceil(powerNeeded / capPerHub);
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
    const kwhPerOutletPerDay = actualEnergy * sessionsPerOutletPerDay;

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
  //   totalEnergyDay   — kWh/dygn från computeEnergy.totalEnergyDay
  //   powerTariff      — nätbolagets effektavgift (kr/kW/månad) — H1
  //   peakPowerKW      — systemets toppeffekt för effekttariffsberäkning (kW)
  //   omPctYear        — drift & underhåll, % av kapital per år (default 3%)
  function computeEconomics({ materialCost, installationCost, electricityPrice, chargingFee, totalEnergyDay, powerTariff, peakPowerKW, omPctYear }) {
    const material           = materialCost || 0;
    const installation       = installationCost || 0;
    const capitalCost        = material + installation;
    const monthlyEnergyKWh   = (totalEnergyDay || 0) * 30;
    const monthlyEnergyCost  = monthlyEnergyKWh * (electricityPrice || 0);
    const monthlyPowerCost   = (peakPowerKW || 0) * (powerTariff || 0);
    const monthlyOpCost      = monthlyEnergyCost + monthlyPowerCost;
    const monthlyRevenue     = monthlyEnergyKWh * (chargingFee || 0);
    // O&M som månadssnitt — typiskt 2-4% av kapital/år (default 3%)
    const monthlyOmCost      = capitalCost * (Number.isFinite(omPctYear) ? omPctYear : 0.03) / 12;
    const monthlyNet         = monthlyRevenue - monthlyOpCost - monthlyOmCost;
    // capitalCost > 0: utan investering finns ingen meningsfull återbetalningstid (undvik "0 mån").
    const paybackMonths      = (monthlyNet > 0 && capitalCost > 0) ? capitalCost / monthlyNet : null;
    const paybackYears       = paybackMonths != null ? paybackMonths / 12 : null;
    return {
      capitalCost,
      materialCost: material, installationCost: installation,
      // Bakåtkomp — behåll äldre fältnamn som alias så PDF/övrig kod inte bryts
      hubCapital: material, outletCapital: installation,
      monthlyEnergyKWh, monthlyEnergyCost, monthlyPowerCost, monthlyOpCost,
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
    LIMIT_REASON, SCENARIO_PALETTE,
    PROFILES, CARS,
    computeEnergy, computeHubs, computeGridAssessment, computeEconomics,
    shapeToPeak,
    fmt, rangeKm, mean, sum,
  };
})();


