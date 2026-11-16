import { useState, useMemo } from 'preact/hooks';
import { html, Icon, first, initials } from '../lib.js';
import { importLinkedInCsv } from '../network.js';
import { Avatar, Strength, waLink, headline } from './common.js';
import { reconnectText } from './brief.js';

export function People({ data, network, nav, now }) {
  const [q, setQ] = useState('');
  const [openTheme, setOpenTheme] = useState(null);
  const holdings = data.ann.holdings;

  // which holdings can the network speak to? (career / adjacency / lived-through links, not mere theme expertise)
  const coverage = useMemo(() => holdings.map((h) => ({ h, links: network.whoToCall({ symbol: h.symbol, limit: 40 }).filter((x) => x.reasons[0].kind !== 'expertise') })), [network]);
  const covered = coverage.filter((c) => c.links.length);
  const blind = coverage.filter((c) => !c.links.length);
  const weightCovered = covered.reduce((s, c) => s + (c.h.weight || 0), 0);

  const stories = useMemo(() => {
    const best = {};
    for (const i of data.ann.items) if ((i.baseScore || 0) >= 40 && (!best[i.symbol] || i.baseScore > best[i.symbol].score)) best[i.symbol] = { symbol: i.symbol, score: i.baseScore, lead: i };
    return Object.values(best);
  }, [data]);
  const warm = useMemo(() => network.keepWarm(stories, { limit: 4, describe: (st) => headline(st.lead) }), [network, stories]);
  const themes = useMemo(() => network.themes().slice(0, 12), [network]);
  const results = q.trim().length > 1 ? network.expertise(q).slice(0, 6) : null;
  const everyone = [...network.people].sort((a, b) => (b.relationship?.strength ?? 0) - (a.relationship?.strength ?? 0));

  const onImport = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const imported = importLinkedInCsv(await f.text());
      const keep = network.people.filter((p) => p.source !== 'linkedin-export');
      nav.setNetwork({ me: network.me, people: [...keep, ...imported] });
      nav.toast(`Imported ${imported.length} connections — stored on this phone only.`);
    } catch (err) {
      nav.toast(err.message);
    }
    e.target.value = '';
  };

  return html`<main class="page">
    <header class="mast"><span class="wordmark"><b>F</b><b>I</b><b>N</b>N</span><span class="dateline">Network</span></header>
    <h1 class="lede"><span class="people-em">${network.people.length} people</span> who can explain <em>${covered.length} of your ${holdings.length}</em> holdings.</h1>
    <p class="sublede">That's ${weightCovered}% of your book by weight with a direct line in.${blind.length ? html` Blind spots: <b>${blind.map((b) => b.h.symbol).join(', ')}</b>.` : ''}</p>

    <div class="privacy"><${Icon.lock} /><div><b>This list never leaves your phone.</b> FINN matches it against public filings on the device. The server only ever sees tickers, never names. ${nav.netSource === 'demo' ? html`You're looking at a <b>synthetic</b> demo network.` : html`Using your copy, stored on this device.`}</div></div>

    <form class="askbox" onSubmit=${(e) => { e.preventDefault(); if (!results?.length) nav.open('ask'); }}>
      <input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Who knows… (rural credit, OSAT, GST, paints)" aria-label="Search your network by expertise" />
      <button type="button" class="mic" aria-label="Ask FINN" onClick=${() => nav.open('ask')}><${Icon.mic} /></button>
    </form>
    ${results && html`<div class="panel people-panel"><h4>${results.length ? `Your go-to people on “${q}”` : `Nobody tagged “${q}” — try Ask FINN`}</h4>${results.map((r) => html`<${Row} r=${r} nav=${nav} />`)}</div>`}

    <div class="section-h"><h2>Your book, through your people</h2><span class="aside">tap a dot</span></div>
    <${Constellation} coverage=${coverage} network=${network} nav=${nav} />

    ${warm.length > 0 && html`<div class="section-h"><h2>A reason to call</h2><span class="aside">gone cold, now relevant</span></div>
      ${warm.map((k) => {
        const text = reconnectText(network, k);
        return html`<div class="panel people-panel" style="margin:8px 0"><div class="person-row" style="padding:0"><${Avatar} name=${k.person.name} cold /><div class="body"><div class="name"><button onClick=${() => nav.open('person', { person: k.person })}>${k.person.name}</button> <span class="sub">· ${k.warm.label}</span></div><div class="sub">${k.why}</div></div></div>
          <div class="opener">${text}<div class="acts2"><a class="btn people" href=${waLink(text)} target="_blank" rel="noopener">WhatsApp</a></div></div></div>`;
      })}`}

    <div class="section-h"><h2>Expertise map</h2><span class="aside">${themes.length} themes</span></div>
    <div class="panel">${themes.map((t) => html`<div>
      <button class="theme-row" style="width:100%;background:none;border-left:0;border-right:0;border-bottom:0;cursor:pointer;color:inherit" onClick=${() => setOpenTheme(openTheme === t.theme ? null : t.theme)}>
        <span class="t">${t.theme}</span><span class="faces">${t.people.slice(0, 4).map((p) => html`<${Avatar} name=${p.name} />`)}${t.people.length > 4 ? html`<span class="muted" style="font-size:11px;margin-left:4px;align-self:center">+${t.people.length - 4}</span>` : ''}</span>
      </button>
      ${openTheme === t.theme && html`<div style="padding:0 0 8px">${t.people.map((p) => html`<div class="reason"><button style="all:unset;cursor:pointer;font-weight:600" onClick=${() => nav.open('person', { person: p })}>${p.name}</button> · ${p.headline}</div>`)}</div>`}
    </div>`)}</div>

    <div class="section-h"><h2>Everyone</h2><span class="aside">by tie strength</span></div>
    <div class="panel">${everyone.map((p) => {
      const w = network.warmth(p);
      return html`<div class="person-row"><${Avatar} name=${p.name} cold=${w.cold} /><div class="body"><div class="name"><button onClick=${() => nav.open('person', { person: p })}>${p.name}</button> <${Strength} v=${p.relationship?.strength} /></div><div class="sub">${p.headline} · ${w.label}</div></div></div>`;
    })}</div>

    <div class="section-h"><h2>Bring your own network</h2></div>
    <div class="panel">
      <p class="prose" style="margin:0 0 8px;font-size:14px">LinkedIn → Settings → Data privacy → <i>Get a copy of your data</i> → Connections. Drop the CSV here; it is parsed on this phone and never uploaded. Add context (how you know them, what they're good at) and FINN gets sharper.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn people" style="cursor:pointer"><input type="file" accept=".csv,text/csv" onChange=${onImport} style="display:none" />Import Connections.csv</label>
      ${nav.netSource === 'device' && html`<button class="btn sec" onClick=${() => nav.resetNetwork().then(() => nav.toast('Back to the demo network.'))}>Reset to demo</button>`}</div>
    </div>
    <p class="foot">Synthetic people, real companies. In production the graph would come from consented imports (LinkedIn export, phone contacts, CRM) and stay encrypted on-device.</p>
  </main>`;
}

const Row = ({ r, nav }) => html`<div class="person-row"><${Avatar} name=${r.person.name} cold=${r.warm?.cold} /><div class="body"><div class="name"><button onClick=${() => nav.open('person', { person: r.person })}>${r.person.name}</button> <${Strength} v=${r.person.relationship?.strength} /> <span class="sub">${r.warm?.label || ''}</span></div><div class="sub">${r.person.headline}</div>${r.reasons.map((x) => html`<div class="reason">${x.text}</div>`)}</div></div>`;

/** Holdings on the outer ring, the contacts who can speak to them inside, you at the centre. */
function Constellation({ coverage, network, nav }) {
  const S = 340, c = S / 2, R1 = 136, R2 = 78;
  const n = coverage.length;
  const hpos = coverage.map((cv, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return { ...cv, a, x: c + R1 * Math.cos(a), y: c + R1 * Math.sin(a) };
  });
  // contacts placed at the circular mean angle of the holdings they link to
  const people = new Map();
  for (const h of hpos) for (const l of h.links.slice(0, 4)) {
    const e = people.get(l.person.id) || { p: l.person, hs: [], sx: 0, sy: 0 };
    e.hs.push({ h, s: l.score });
    e.sx += Math.cos(h.a);
    e.sy += Math.sin(h.a);
    people.set(l.person.id, e);
  }
  const ps = [...people.values()].map((e) => ({ ...e, a: Math.atan2(e.sy, e.sx) })).sort((a, b) => a.a - b.a);
  // spread contacts evenly around the inner ring, in angular order, so dots don't collide
  ps.forEach((e, i) => {
    const a = ps.length > 1 ? e.a * 0.5 + ((i / ps.length) * 2 * Math.PI - Math.PI) * 0.5 : e.a;
    const r = R2 + 14 - (i % 3) * 24;
    e.x = c + r * Math.cos(a);
    e.y = c + r * Math.sin(a);
  });
  return html`<div class="panel" style="padding:6px">
    <svg class="constellation" viewBox="-46 -4 ${S + 92} ${S + 8}" role="img" aria-label="Your contacts linked to your holdings">
      ${ps.flatMap((e) => e.hs.map(({ h, s }) => html`<line x1=${e.x} y1=${e.y} x2=${h.x} y2=${h.y} stroke="var(--people)" stroke-width=${0.6 + 1.8 * Math.min(1, s)} opacity=${0.18 + 0.5 * Math.min(1, s)} />`))}
      ${ps.map((e) => html`<line x1=${c} y1=${c} x2=${e.x} y2=${e.y} stroke="var(--hair)" stroke-width="1" />`)}
      <circle cx=${c} cy=${c} r="13" fill="var(--ink)" /><text x=${c} y=${c + 3.5} text-anchor="middle" style="fill:var(--surface);font-weight:700;font-size:10px">You</text>
      ${ps.map((e) => html`<g style="cursor:pointer" onClick=${() => nav.open('person', { person: e.p })}><title>${e.p.name} — ${e.hs.map((x) => x.h.h.symbol).join(', ')}</title><circle cx=${e.x} cy=${e.y} r="10" fill="var(--people)" opacity=${network.warmth(e.p).cold ? 0.55 : 1} /><text x=${e.x} y=${e.y + 3} text-anchor="middle" style="fill:#fff;font-weight:700;font-size:7.5px">${initials(e.p.name)}</text></g>`)}
      ${hpos.map((h) => {
        const blind = !h.links.length;
        const lx = c + (R1 + 16) * Math.cos(h.a), ly = c + (R1 + 16) * Math.sin(h.a);
        return html`<g style="cursor:pointer" onClick=${() => nav.open('call', { symbol: h.h.symbol })}><title>${h.h.name}: ${blind ? 'nobody in your network' : h.links.slice(0, 3).map((l) => first(l.person.name)).join(', ')}</title>
          <circle cx=${h.x} cy=${h.y} r=${3 + Math.sqrt(h.h.weight || 1) * 1.6} fill=${blind ? 'none' : 'var(--ink-2)'} stroke=${blind ? 'var(--accent)' : 'none'} stroke-width="1.5" stroke-dasharray=${blind ? '2 2' : ''} />
          <text x=${lx} y=${ly + 3} text-anchor=${Math.cos(h.a) > 0.3 ? 'start' : Math.cos(h.a) < -0.3 ? 'end' : 'middle'} style=${blind ? 'fill:var(--accent);font-weight:600' : ''}>${h.h.symbol}</text></g>`;
      })}
    </svg>
    <div style="display:flex;gap:14px;justify-content:center;font-size:11.5px;color:var(--muted);padding:2px 0 6px">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--people)"></span> contact</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ink-2)"></span> holding (size = weight)</span>
      <span style="color:var(--accent)">◌ blind spot</span>
    </div>
  </div>`;
}
