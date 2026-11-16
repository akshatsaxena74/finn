import { render } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { html, getJSON, store, Icon } from './lib.js';
import { Network, loadNetwork } from './network.js';
import { loadRules, prefs } from './score.js';
import { Brief } from './views/brief.js';
import { Dig } from './views/dig.js';
import { People } from './views/people.js';
import { StorySheet, PersonSheet, TripwireSheet, AskSheet, AboutSheet, CallSheet } from './views/sheets.js';

function App() {
  const [tab, setTab] = useState(() => (location.hash.slice(1).split('/')[0] || store.get('tab', 'brief')));
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [netData, setNetData] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [digSymbol, setDigSymbol] = useState(() => (location.hash.startsWith('#dig/') ? location.hash.slice(5) : null));
  const [rules, setRules] = useState(loadRules);
  const [prefsV, setPrefsV] = useState(0);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([getJSON('/api/announcements?days=30'), getJSON('/api/market')])
      .then(([ann, market]) => setData({ ann, market }))
      .catch((e) => setErr(e.message));
    loadNetwork().then(setNetData).catch(() => setNetData({ net: { me: {}, people: [] }, orgs: { orgs: {} }, source: 'none' }));
  }, []);

  // the hash is the route: back button / shared links work, and a route change closes any open sheet
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      const t = h.split('/')[0];
      if (['brief', 'dig', 'people'].includes(t)) {
        setSheet(null);
        setTab(t);
        setDigSymbol(t === 'dig' && h.includes('/') ? h.split('/')[1].toUpperCase() : null);
      }
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    store.set('tab', tab);
    const h = tab === 'dig' && digSymbol ? `#dig/${digSymbol}` : `#${tab}`;
    if (location.hash !== h) history.replaceState(null, '', h);
    window.scrollTo(0, 0);
  }, [tab, digSymbol]);

  const now = data ? new Date(data.ann.asOf).getTime() : Date.now();
  const network = useMemo(() => (netData && data ? new Network(netData.net, netData.orgs, { now, holdings: data.ann.holdings }) : null), [netData, data]);

  const showToast = useCallback((msg, undo) => {
    setToast({ msg, undo, id: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.id > 3800 ? null : t)), 4000);
  }, []);

  const nav = {
    tab: (t) => { setSheet(null); setTab(t); },
    dig: (sym) => { setSheet(null); setDigSymbol(sym ? sym.toUpperCase() : null); setTab('dig'); },
    open: (type, props = {}) => setSheet({ type, props }),
    close: () => setSheet(null),
    toast: showToast,
    rules, setRules: (r) => { store.set('rules', r); setRules(r); },
    prefsV, bumpPrefs: () => setPrefsV((v) => v + 1),
    setNetwork: (net) => { store.set('network', net); setNetData((d) => ({ ...d, net, source: 'device' })); },
    resetNetwork: async () => { store.set('network', null); setNetData(await loadNetwork()); },
    netSource: netData?.source,
  };

  if (err) return html`<div class="page"><div class="mast"><span class="wordmark"><b>F</b><b>I</b><b>N</b>N</span></div><div class="quiet" style="margin-top:20px">Couldn't load the brief: ${err}. <button class="chip btn" onClick=${() => location.reload()}>Retry</button></div></div>`;
  if (!data || !network) return html`<div class="boot"><span class="wordmark"><b>F</b><b>I</b><b>N</b>N</span><span class="muted">Reading the tape…</span></div>`;

  const ctx = { data, network, nav, now };
  const S = sheet && { story: StorySheet, person: PersonSheet, tripwires: TripwireSheet, ask: AskSheet, about: AboutSheet, call: CallSheet }[sheet.type];

  return html`
    <div class="desk-note"><b>FINN is built for your phone.</b>Open this page on a phone, or narrow the window. Swipe a story left to bury it, right to see who to call.</div>
    ${tab === 'brief' && html`<${Brief} ...${ctx} />`}
    ${tab === 'dig' && html`<${Dig} ...${ctx} symbol=${digSymbol} />`}
    ${tab === 'people' && html`<${People} ...${ctx} />`}
    <nav class="tabs" aria-label="Main">
      <div class="tabs-in">
        <button class="tab" aria-current=${tab === 'brief' ? 'page' : null} onClick=${() => nav.tab('brief')}><${Icon.brief} />Brief</button>
        <button class="tab" aria-current=${tab === 'dig' ? 'page' : null} onClick=${() => nav.dig(digSymbol)}><${Icon.dig} />Dig</button>
        <button class="askfab" aria-label="Ask FINN" onClick=${() => nav.open('ask')}><${Icon.ask} /></button>
        <button class="tab" aria-current=${tab === 'people' ? 'page' : null} onClick=${() => nav.tab('people')}><${Icon.people} />People</button>
        <button class="tab" onClick=${() => nav.open('tripwires')}><${Icon.sliders} />Tripwires</button>
      </div>
    </nav>
    ${S && html`<div class="scrim" onClick=${nav.close}></div><div class="sheet" role="dialog" aria-modal="true">
      <div class="grab"><span></span><button class="iconbtn" aria-label="Close" onClick=${nav.close}><${Icon.x} /></button></div>
      <${S} ...${ctx} ...${sheet.props} />
    </div>`}
    ${toast && html`<div class="toast" role="status"><span>${toast.msg}</span>${toast.undo && html`<button onClick=${() => { toast.undo(); setToast(null); }}>Undo</button>`}</div>`}
  `;
}

const savedTheme = store.get('theme', null);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
render(html`<${App} />`, document.getElementById('app'));
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
