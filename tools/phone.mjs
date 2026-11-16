// Zero-dependency phone emulation (390x844, touch) over the Chrome DevTools Protocol.
// Drives each screen, saves screenshots, reports console errors and horizontal overflow.
// usage: npm run dev   (in another terminal), then:  node tools/phone.mjs <scenario[,scenario]|all> [dark|light]
// env:   CHROME=/path/to/chrome   BASE=http://localhost:3000/   OUT=.shots/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const S = path.resolve(process.env.OUT || '.shots') + '/';
fs.mkdirSync(S, { recursive: true });
const CH = process.env.CHROME || { darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }[process.platform] || 'google-chrome';
const PORT = 9333;
const BASE = process.env.BASE || 'http://localhost:3000/';
const scheme = process.argv[3] || 'dark';

const chrome = spawn(CH, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(os.tmpdir(), 'finn-chrome-cdp')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const errors = [];
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not start');
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

async function shot(name, { full = true } = {}) {
  const m = await send('Page.getLayoutMetrics');
  const h = Math.min(6000, Math.ceil(m.cssContentSize?.height || 844));
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: full ? { x: 0, y: 0, width: 390, height: h, scale: 1 } : undefined });
  fs.writeFileSync(`${S}${name}.png`, Buffer.from(r.data, 'base64'));
  const overflow = await evaluate(`document.documentElement.scrollWidth > window.innerWidth ? [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0,5).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(', ') : ''`);
  console.log(`${name}.png  h=${h}${overflow ? '  OVERFLOW: ' + overflow : ''}`);
}
const go = async (hash, wait = 2500) => {
  await send('Page.navigate', { url: BASE + '?r=' + Math.random().toString(36).slice(2) + hash });
  await sleep(wait);
};
const click = (sel, idx = 0) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})][${idx}]; if (!el) return 'missing ${sel}'; el.click(); return 'ok'; })()`);
const clickText = (sel, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
const sheetShot = async (name) => {
  // capture the sheet's full scroll height by expanding it
  await evaluate(`(() => { const s = document.querySelector('.sheet'); if (s) { s.style.maxHeight = 'none'; s.style.position = 'absolute'; s.style.top = '0'; s.style.bottom = 'auto'; } })()`);
  await sleep(300);
  await shot(name);
};

const SCENARIOS = {
  brief: async () => { await go('#brief'); await shot('p-brief'); },
  brief7d: async () => { await go('#brief'); await clickText('.seg button', '7D'); await sleep(600); await shot('p-brief7d'); },
  story: async () => { await go('#brief'); await clickText('.seg button', '30D'); await sleep(600); console.log(await clickText('.card h3', 'Bagchi')); await sleep(1500); await sheetShot('p-story-bagchi'); },
  call: async () => { await go('#brief'); await clickText('.seg button', '30D'); await sleep(600); console.log(await clickText('.card h3', 'closure')); await sleep(1200); await sheetShot('p-story-cg'); },
  people: async () => { await go('#people', 2000); await shot('p-people'); },
  peopletop: async () => { await go('#people', 2000); await evaluate(`document.querySelector('.constellation').scrollIntoView()`); await sleep(300); await shot('p-people-top', { full: false }); },
  dig: async () => { await go('#dig/KAYNES', 5000); await shot('p-dig-kaynes'); },
  dighome: async () => { await go('#dig', 1500); await click('.chip.btn', 0); await go('#dig', 1500); await shot('p-dig-home'); },
  ask: async () => { await go('#brief'); await click('.askfab'); await sleep(400); await clickText('.chip.btn', 'Anup Bagchi'); await sleep(600); await sheetShot('p-ask'); },
  ask2: async () => { await go('#brief'); await click('.askfab'); await sleep(400); await clickText('.chip.btn', 'plant shutdown'); await sleep(600); await sheetShot('p-ask2'); },
  trip: async () => { await go('#brief'); await clickText('.tab', 'Tripwires'); await sleep(600); await sheetShot('p-trip'); },
  person: async () => { await go('#people', 2000); await clickText('.person-row .name button', 'Rohan'); await sleep(600); await sheetShot('p-person'); },
};

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { (m.error ? pending.get(m.id).rej : pending.get(m.id).res)(m.error || m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || ''));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  const which = process.argv[2] || 'brief';
  for (const [k, f] of Object.entries(SCENARIOS)) if (which === 'all' || which.split(',').includes(k)) {
    try { await f(); } catch (e) { console.log(k, 'failed', e.message || JSON.stringify(e)); }
  }
} finally {
  if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
  else console.log('no console errors');
  chrome.kill();
  process.exit(0);
}
