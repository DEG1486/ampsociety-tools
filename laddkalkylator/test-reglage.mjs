// test-reglage.mjs — går reglagen att DRA? Mus och touch, i en riktig webbläsare.
//
// Kör:  node laddkalkylator/test-reglage.mjs
//       node laddkalkylator/test-reglage.mjs --touch
//
// VARFÖR: 2026-09-14 rapporterade Daniel att reglagen "inte går att slida —
// man får klicka längs axeln för att flytta dem". Ingen av de andra sviterna
// kunde se det: de kör räknemotorn eller läser källkod, och ingen av dem
// TRYCKER på något. Felklassen är osynlig för allt utom en riktig webbläsare
// med riktiga pekarhändelser.
//
// Fyra mått per reglage, i tre lägen (enkelt, avancerat, hubs):
//   1. DRAGNING — greppa pucken, dra i 30 små steg, landa på EXAKT det värde
//      släpppunkten motsvarar. Ett reglage som bara hoppar vid nedtryck klarar
//      inte det: värdet skulle stanna kvar där pucken låg.
//   2. KLICK längs axeln — hoppar till rätt värde.
//   3. PUCKEN under pekaren — högst ett halvt steg fel. Fångar förskjutningen
//      som ramen gav: pucken är 20 px bred PLUS 3 px ram på varje sida, alltså
//      26, och låg med `- 10px` tre pixlar för långt åt höger.
//   4. TANGENTBORD — piltangent flyttar ett steg, så att <input type="range">
//      inte tappas bort när pekarhändelserna tar över själva dragningen.
//
// Kräver Chrome lokalt. Saknas den hoppar skriptet över med exit 0 — en
// kontroll före commit, inte en CI-grind (samma villkor som matt-pdf.mjs).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const harHar = path.dirname(fileURLToPath(import.meta.url));
const roten = path.resolve(harHar, '..');
const TOUCH = process.argv.includes('--touch');
const PORT = TOUCH ? 9231 : 9230;

// CHROME_PATH går först: felet 2026-09-14 syntes i Edge men inte i Chrome, så
// att kunna peka ut en annan Chromium är hela poängen.
const KROM = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

if (!KROM) {
  console.log('\ntest-reglage: hittade ingen Chrome — hoppar över.');
  console.log('  Sätt CHROME_PATH om den ligger på en egen plats.\n');
  process.exit(0);
}

// Utan argument testas repots index.html. Ett argument kan vara antingen en
// .html-sökväg (t.ex. `git show HEAD:index.html` sparad någonstans) eller en
// http(s)-adress — live-sajten går alltså att prova direkt, med rätt ursprung.
const ADRESS = process.argv.find((a) => /^https?:\/\//i.test(a));
const FIL = process.argv.find((a) => a.toLowerCase().endsWith('.html') && !/^https?:/i.test(a))
  || path.join(roten, 'index.html');
const APP = ADRESS || ('file:///' + encodeURI(path.resolve(FIL).replace(/\\/g, '/')));

// Lägena sätts via URL-hashen (#k= + base64 av JSON, se decodeCalcState) —
// snabbare och pålitligare än att klicka sig dit genom UI:t.
const LAGEN = [
  { namn: 'enkelt läge', hash: { uiMode: 'simple', mode: 'energy' }, reglage: ['Parkeringstid'] },
  { namn: 'avancerat',   hash: { uiMode: 'advanced', mode: 'energy' },
    reglage: ['Parkeringstid', 'Peak-beläggning', 'Befintlig last', 'Drift & underhåll'] },
  { namn: 'hubs-läget',  hash: { uiMode: 'advanced', mode: 'hubs' },
    reglage: ['Parkeringstid', 'Beläggningsgrad', 'Befintlig last', 'Drift & underhåll'] },
];

const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'amp5-reglage-'));
const krom = spawn(KROM, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  '--window-size=1400,950', 'about:blank'], { stdio: 'ignore' });

const sov = (ms) => new Promise((r) => setTimeout(r, ms));
const stada = () => {
  try { krom.kill(); } catch {}
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch {}
};

let sida;
for (let i = 0; i < 60 && !sida; i++) {
  try {
    sida = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
      .find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
  if (!sida) await sov(250);
}
if (!sida) {
  console.error('test-reglage: Chrome svarade inte på felsökningsporten');
  stada();
  process.exit(1);
}

const ws = new WebSocket(sida.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const vantar = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && vantar.has(d.id)) { vantar.get(d.id)(d); vantar.delete(d.id); }
};
const cdp = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((res, rej) => vantar.set(i, (d) => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)));
};
const js = async (uttryck) => {
  const r = await cdp('Runtime.evaluate', { expression: uttryck, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

if (TOUCH) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const pekpunkt = (x, y) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
const ned = (x, y) => TOUCH
  ? cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pekpunkt(x, y) })
  : cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
const ror = (x, y) => TOUCH
  ? cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pekpunkt(x, y) })
  : cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
const upp = (x, y) => TOUCH
  ? cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  : cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });

// Spåret är reglagets förälder; barn nr 3 är pucken (spår, fyllnad, puck, input).
const matt = (etikett) => js(`(() => {
  const i = document.querySelector('input[type=range][aria-label=${JSON.stringify(etikett)}]');
  if (!i) return null;
  const spar = i.parentElement, b = spar.getBoundingClientRect();
  const puck = spar.children[2].getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, v: +i.value,
           min: +i.min, max: +i.max, step: +i.step, puckMitt: puck.x + puck.width / 2 };
})()`);

console.log(`\ntest-reglage — ${TOUCH ? 'TOUCH' : 'MUS'}\n`);
let fel = 0;

for (const lage of LAGEN) {
  const hash = Buffer.from(JSON.stringify(lage.hash), 'utf8').toString('base64');
  await cdp('Page.navigate', { url: 'about:blank' });
  await sov(150);
  await cdp('Page.navigate', { url: `${APP}#k=${hash}` });
  let uppe = false;
  for (let i = 0; i < 80 && !uppe; i++) {
    try { uppe = (await js(`document.querySelectorAll('input[type=range]').length`)) > 0; } catch {}
    if (!uppe) await sov(250);
  }
  if (!uppe) { console.log(`  FEL  ${lage.namn} — appen renderade aldrig`); fel++; continue; }
  console.log(`  ${lage.namn}`);

  for (const etikett of lage.reglage) {
    await js(`(document.querySelector('input[type=range][aria-label=${JSON.stringify(etikett)}]') || { scrollIntoView() {} }).scrollIntoView({ block: 'center' })`);
    await sov(120);
    const r = await matt(etikett);
    if (!r) { console.log(`    SAKNAS  ${etikett}`); fel++; continue; }

    const y = Math.round(r.y + r.h / 2);
    const vidX = (x) => {
      const andel = Math.min(1, Math.max(0, (x - r.x) / r.w));
      return Math.min(r.max, Math.max(r.min, r.min + Math.round((andel * (r.max - r.min)) / r.step) * r.step));
    };

    // 1) DRAGNING — greppa pucken, dra i små steg till 78 % av spåret
    const x0 = Math.round(r.puckMitt), x1 = Math.round(r.x + r.w * 0.78);
    await ned(x0, y);
    const efterNed = (await matt(etikett)).v;
    for (let k = 1; k <= 30; k++) {
      await ror(Math.round(x0 + ((x1 - x0) * k) / 30), y + (k % 3) - 1);
      await sov(10);
    }
    await upp(x1, y);
    await sov(200);
    const e1 = await matt(etikett);
    const dragOk = e1.v === vidX(x1) && e1.v !== efterNed;

    // 2) KLICK längs axeln (25 %)
    const xk = Math.round(r.x + r.w * 0.25);
    await ned(xk, y); await sov(40); await upp(xk, y); await sov(200);
    const e2 = await matt(etikett);
    const klickOk = e2.v === vidX(xk);

    // 3) PUCKEN under pekaren
    const puckFel = Math.abs(e2.puckMitt - xk);
    const halvtSteg = r.w / ((r.max - r.min) / r.step) / 2;
    const puckOk = puckFel <= halvtSteg + 2;

    // 4) TANGENTBORD — ett steg höger
    for (const type of ['keyDown', 'keyUp']) {
      await cdp('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 39, key: 'ArrowRight', code: 'ArrowRight' });
    }
    await sov(200);
    const e3 = await matt(etikett);
    const tgbOk = e2.v === r.max || Math.abs(e3.v - (e2.v + r.step)) < 1e-6;

    const allt = dragOk && klickOk && puckOk && tgbOk;
    if (!allt) fel++;
    console.log(`    ${allt ? 'OK  ' : 'FEL '} ${etikett.padEnd(18)}`
      + ` drag ${efterNed}→${e1.v} (väntat ${vidX(x1)})${dragOk ? '' : ' <-FEL'}`
      + ` · klick ${e2.v} (väntat ${vidX(xk)})${klickOk ? '' : ' <-FEL'}`
      + ` · puck ${puckFel.toFixed(1)} px av ${halvtSteg.toFixed(1)}${puckOk ? '' : ' <-FEL'}`
      + ` · pil ${e2.v}→${e3.v}${tgbOk ? '' : ' <-FEL'}`);
  }
}

console.log(fel
  ? `\nRESULTAT: FEL — ${fel} reglage klarar inte dragning, klick, puckläge eller tangentbord\n`
  : '\nRESULTAT: alla reglage går att dra, klicka och styra med tangentbord\n');

try { ws.close(); } catch {}
stada();
process.exit(fel ? 1 : 0);
