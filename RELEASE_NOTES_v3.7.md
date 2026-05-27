# Amp5 Laddkalkylator — Release notes v3.7

*För säljteamet · maj 2026*

Den här versionen tar kalkylatorn från ett tekniskt dimensioneringsverktyg till en komplett **säljpresentation i ett klick**. Du kan nu visa kund både *vad de behöver*, *vad det kostar* och *vad nätet klarar* — utan att lämna kalkylatorn.

---

## 🚀 De stora nyheterna

### 1. Elnätsbedömning — du ser direkt om servisen räcker
Lägg in servissäkringen (63 / 125 / 200 A eller annan) och hur mycket av nätet som redan används. Kalkylatorn räknar ut:

- Hur många kW elnätet klarar (√3 × 400 V × A)
- Hur mycket som finns kvar för laddning efter befintlig last
- **Status med trafikljus:**
  - 🟢 **OK** — elnätet täcker behovet
  - 🟠 **Marginellt** — knappt tillräckligt
  - 🔴 **Servisutökning krävs** — nätet räcker inte

Vid orange och röd status visas en **indikativ kostnad för servisutökning** (t.ex. 55–155 kkr) — så kunden direkt förstår vad alternativet kostar.

**Säljnytta:** Ingen extern elkonsult eller offert behövs för att svara på "kommer elnätet räcka?" — du kan svara på mötet.

---

### 2. Investeringskalkyl med återbetalningstid
Ny ekonomipanel som visar:

- **Total investering** (material + installation) — visas i kkr upp till 999, sedan automatiskt i Mkr
- **Månadsenergiförbrukning** och **energikostnad** (utifrån elpris)
- **Intäkt och netto/månad** om kunden tar betalt för laddning
- **Återbetalningstid** — visas tydligt med grön accent när laddavgiften ger lönsamhet

Stödjer både "fri laddning" (för BRF, kontor med förmånsladdning) och "betal-laddning" (där en laddavgift > elpriset ger ROI).

**Säljnytta:** Du kan direkt visa kund att "med 4 kr/kWh i laddavgift är investeringen återbetald på 7 månader". Konkret, inte abstrakt.

---

### 3. Enkel / Avancerad — anpassad UI efter publik
Ny toggle högst upp i kalkylatorn:

- **Enkel** (standard): bara det viktigaste — antal platser, fastighetstyp (BRF / Kontor / Köpcentrum / Parkeringshus), servissäkring och kostnader. Perfekt för möte med BRF-ordförande eller fastighetschef.
- **Avancerad**: full kontroll över alla tekniska parametrar — för dig som vill finjustera, eller när du sitter med teknisk projekteringsansvarig.

Fastighetstyp-väljaren i enkelt läge **sätter automatiskt** laddprofil, parkeringstid och belastning till rimliga grundvärden för respektive byggnadstyp.

**Säljnytta:** Du slipper förklara vad "peak-beläggning" eller "verkningsgrad" är. Tre klick → siffror på bordet.

---

## 📊 Förbättringar i siffrorna och PDF:en

### Mer realistiska energiberäkningar
Ett räknefel i fördelningen av effekt mellan uttag har rättats — tidigare visades 10–20 % för låga värden per uttag. Nu stämmer kWh-siffran per plats mer exakt mot verkligheten.

### PDF-export
- **Sida 2** rymmer nu både elnätsbedömning och investeringskalkyl utan att texten klipps eller flödar över sidfoten
- Uppgraderingskostnaden visas direkt i PDF:en — kund ser den även när de bläddrar tillbaka i mejlen
- Stora belopp visas korrekt i Mkr istället för svårlästa "3 350 kkr"

### Smart guidning i hubs-läget
Om du dimensionerar en stor anläggning (>100 kW installerad kapacitet) utan att ha satt fastighetens nätkapacitet, visas nu en hint:

> 💡 *Ange Fastighetseffekttak så delar SmartHubbarna automatiskt på den tillgängliga effekten — och elnätsbedömningen blir mer exakt.*

Detta förhindrar att kalkylatorn flaggar onödiga "servisutökning krävs" när lösningen egentligen bara är att tala om för SmartHubben hur mycket effekt fastigheten har.

---

## 💬 Cheat sheet för säljmötet

| Kundinvändning | Svar med v3.7 |
|---|---|
| "Klarar vårt elnät det här?" | *Visa elnätsbedömningen — direkt svar med trafikljus* |
| "Vad kostar det om elnätet inte räcker?" | *Indikativ servisutökningskostnad visas i kkr/Mkr* |
| "När får vi tillbaka pengarna?" | *Återbetalningstid med vald laddavgift, t.ex. "7 mån"* |
| "Det här är ju jättekomplicerat..." | *Toggla till Enkelt läge — tre fält och fastighetstyp* |
| "Vad blir det per plats?" | *kWh per plats och km räckvidd visas i PDF:en* |

---

## 🔧 Vad har inte ändrats

- Beräkningskärnan för energi och hubdimensionering (modellen som tidigare versioner använt)
- SmartHub-specifikationen: 54 uttag per hub, 44 kW max per hub
- Jämför-läget (sida vid sida) fungerar som tidigare — *grid- och ekonomidata visas dock inte här ännu, det kommer i v3.8*

---

## 📁 Filinfo

- Fil: `amp5_kalkylator3.7.html`
- Storlek: ~2,9 MB (självständig HTML — funkar offline, kan mejlas)
- Ingen installation, ingen inloggning, ingen serverkommunikation
