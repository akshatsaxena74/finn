import { useState, useEffect, useMemo } from 'preact/hooks';
import { html, fmt, pct, dayLabel, yrs, Icon, CATEGORY, getJSON, first, store } from '../lib.js';
import { tripwires, reaction, DEFAULT_RULES } from '../score.js';
import { headline, cleanSubject, sourceNote, ResultsTable, Avatar, Strength, whatHappened, waLink } from './common.js';
import { parseAsk, AskAnswer } from './ask.js';

// ------------------------------------------------------------------ story detail (Push → Pull → Network)
export function StorySheet({ story, data, network, nav, now }) {
  const lead = story.lead;
  const company = data.ann.holdings.find((h) => h.symbol === story.symbol);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (lead.id && !String(lead.id).startsWith('nse-')) getJSON(`/api/filing?id=${lead.id}`).then(setDetail).catch(() => {});
  }, [lead.id]);
  const people = story.items.flatMap((i) => i.people || []).concat(detail?.people && !lead.people ? detail.people : []);
  const uniq = people.filter((p, i) => people.findIndex((q) => q.name === p.name) === i);
  const rx = reaction(lead, data.market);
  const shown = useMemo(() => new Set(uniq.flatMap((p) => network.diligence(p, story.symbol).direct.slice(0, 4).map((d) => d.person.id))), [story]);
  const calls = useMemo(() => network.whoToCall({ symbol: story.symbol, tags: story.items.flatMap((i) => i.eventTags || []), orgs: story.items.flatMap((i) => i.orgs || []), people: uniq, limit: 8 }).filter((c) => !shown.has(c.person.id)).slice(0, 4), [story]);
  const results = story.items.find((i) => i.category === 'results' && i.results)?.results;

  return html`<div>
    <div class="kicker">${company?.name || story.symbol} · ${CATEGORY[lead.category]} · ${dayLabel(lead.at || lead.date)}</div>
    <h2>${headline(lead)}</h2>
    <div class="src" style="font-size:12px;color:var(--muted)">${sourceNote(lead)}</div>

    ${results && html`<div class="panel"><h4>Headline numbers <span>₹ crore</span></h4><${ResultsTable} results=${results} />
      ${results.sourcePdf && html`<a class="receipt" style="margin-top:8px" href=${results.sourcePdf} target="_blank" rel="noopener"><${Icon.doc} style="width:13px" />The results filing (PDF)</a>`}</div>`}

    ${!results && lead.resultsPending && html`<div class="panel"><h4>Headline numbers <span>${lead.resultsPending}</span></h4><div class="reason">The company filed these ${dayLabel(lead.at || lead.date)}. FINN shows standardised numbers once they're published (usually within a day or two) and never pairs a filing with another quarter's figures.</div><a class="receipt" style="margin-top:8px" href=${lead.url} target="_blank" rel="noopener"><${Icon.doc} style="width:13px" />Read the filing</a></div>`}
    ${uniq.map((p) => html`<${SubjectPanel} p=${p} story=${story} network=${network} nav=${nav} lead=${lead} coName=${(company?.name || story.symbol).replace(/\s+(Ltd\.?|Limited)$/i, '')} />`)}

    ${detail?.excerpt && !results && html`<details class="panel"><summary style="cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">From the filing</summary><p class="quote" style="font-size:14px">${detail.excerpt.slice(0, 900)}${detail.excerpt.length > 900 ? '…' : ''}</p><a class="receipt" href=${lead.url} target="_blank" rel="noopener"><${Icon.doc} style="width:13px" />Full filing</a></details>`}

    ${rx && html`<div class="panel"><h4>Market reaction <span>${dayLabel(rx.date)}</span></h4>
      <div class="vs"><div><div class="k">Stock</div><div class="v ${rx.move > 0 ? 'up' : 'down'}">${pct(rx.move)}</div></div><div><div class="k">Nifty</div><div class="v">${pct(rx.nifty)}</div></div><div><div class="k">Stock-specific</div><div class="v ${rx.rel > 0 ? 'up' : 'down'}">${pct(rx.rel)}</div></div><div><div class="k">Volume</div><div class="v">${fmt(rx.volx, 1)}×</div></div></div></div>`}

    ${(calls.length > 0 || !uniq.length) && html`<div class="panel people-panel"><h4>${uniq.length ? 'Also worth a call' : 'Who can explain this'} <span>${calls.length ? 'ranked' : ''}</span></h4>
      ${calls.length ? calls.map((c, i) => html`<${CallRow} c=${c} open=${i === 0 && !uniq.length} network=${network} nav=${nav} ctx=${{ company: company?.name || story.symbol, what: whatHappened(lead) }} />`) : html`<div class="muted" style="font-size:13.5px">No one in your network has a direct line here. Try the expertise map in People.</div>`}
    </div>`}

    <div class="panel"><h4>Filings in this story <span>${story.items.length}</span></h4>
      ${story.items.map((i) => html`<div style="padding:6px 0;border-top:1px solid var(--hair);font-size:13.5px"><a href=${i.url} target="_blank" rel="noopener">${cleanSubject(i)}</a><div class="muted" style="font-size:12px">${dayLabel(i.at || i.date)} · ${CATEGORY[i.category]} · score ${i.score} · ${i.source}</div></div>`)}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" onClick=${() => nav.dig(story.symbol)}><${Icon.dig} />Dig into ${story.symbol}</button><button class="btn sec" onClick=${() => nav.open('call', { story })}><${Icon.phone} />Who to call</button></div>
  </div>`;
}

function SubjectPanel({ p, story, network, nav, lead, coName }) {
  const dil = useMemo(() => network.diligence(p, story.symbol), [p]);
  const leaving = /resign|retire|ceas/.test(p.action);
  const qs = leaving
    ? [`Why now, and where to? (“${p.profileQuote ? 'to pursue an external opportunity' : 'external opportunity'}”)`, 'Who inherits the P&L — and was this succession planned or forced?', 'Does the exit change the plan management guided to?']
    : ['What changes in the first year — people, priorities, capital allocation?', 'Who comes along from the last job, and who leaves?', 'Growth-first or risk-first? How did that show up in the last role?'];
  return html`<div class="panel people-panel">
    <h4>${leaving ? 'Who is leaving' : 'Who is coming in'} <span>${p.effective ? `effective ${dayLabel(p.effective)}` : ''}</span></h4>
    <div class="person-row" style="padding-top:0"><${Avatar} name=${p.name} ext lg /><div class="body"><div class="name" style="font-size:17px">${p.name}</div><div class="sub">${p.role} · ${p.action}</div></div></div>
    ${p.career?.length > 0 && html`<div class="tl">${p.career.map((c) => html`<div class="e ${dil.direct.some((d) => d.reasons.some((r) => r.text.includes(c.org.replace(/ (Limited|Ltd\.?)$/, '')))) ? 'hit' : ''}"><span class="yrs">${c.from || c.to ? yrs(c.from, c.to) : 'dates n/a'}</span> · <b>${c.org}</b>${c.title ? html`<span class="muted"> — ${c.title}</span>` : ''}</div>`)}${(p.education || []).map((e) => html`<div class="e"><span class="yrs">edu</span> · ${e.institution}${e.degree ? html`<span class="muted"> — ${e.degree}</span>` : ''}</div>`)}</div>`}
    ${p.profileSource && html`<div class="receipt" style="display:block;margin:4px 0 8px">Source: ${p.profileSource}</div>`}

    <div class="kicker" style="margin-top:6px;color:var(--people)">Your network × ${first(p.name)}</div>
    ${dil.you.map((t) => html`<div class="reason"><b>${t}</b></div>`)}
    ${dil.direct.length === 0 && dil.hops.length === 0 && dil.you.length === 0 && html`<div class="muted" style="font-size:13.5px;margin-top:4px">Nobody you know has overlapped with ${first(p.name)} — the people below know the company.</div>`}
    ${dil.direct.slice(0, 4).map((d, i) => html`<div class="person-row"><${Avatar} name=${d.person.name} cold=${d.warm.cold} /><div class="body">
      <div class="name"><button onClick=${() => nav.open('person', { person: d.person })}>${d.person.name}</button> <${Strength} v=${d.person.relationship?.strength} /> <span class="sub">${d.warm.label}</span></div>
      ${d.reasons.map((r) => html`<div class="reason">${r.text}</div>`)}
      <${Opener} open=${i === 0} text=${network.opener(d.person, { target: p.name, leaving, what: leaving ? `${p.action === 'retired' ? 'retired' : 'resigned'} as ${p.role} at ${coName}` : `been named ${p.role} at ${coName}`, link: d.link || 'you know the place well' })} />
    </div></div>`)}
    ${dil.hops.map((h) => html`<div class="reason" style="margin-top:6px">One hop: ${h.text}</div>`)}
    <div class="kicker" style="margin-top:12px">Worth asking</div>
    <ol style="margin:4px 0 0;padding-left:18px;font-size:14px">${qs.map((q) => html`<li style="margin:3px 0">${q}</li>`)}</ol>
  </div>`;
}

function CallRow({ c, network, nav, ctx, open = true }) {
  const angle = c.reasons[0].kind === 'lived' ? 'experience with exactly this' : c.reasons[0].kind === 'expertise' ? 'expertise here' : 'time there';
  return html`<div class="person-row"><${Avatar} name=${c.person.name} cold=${c.warm.cold} /><div class="body">
    <div class="name"><button onClick=${() => nav.open('person', { person: c.person })}>${c.person.name}</button> <${Strength} v=${c.person.relationship?.strength} /> <span class="sub">${c.warm.label}</span></div>
    <div class="sub">${c.person.headline}</div>
    ${c.reasons.map((r) => html`<div class="reason">${r.text}</div>`)}
    <${Opener} open=${open} text=${network.opener(c.person, { company: ctx.company, what: ctx.what, angle })} />
  </div></div>`;
}

function Opener({ text, open: initial = true }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(initial);
  if (!open) return html`<button class="chip btn people" style="margin-top:6px" onClick=${() => setOpen(true)}><${Icon.phone} style="width:12px" />Draft a message</button>`;
  return html`<div class="opener">${text}<div class="acts2">
    <a class="btn people" href=${waLink(text)} target="_blank" rel="noopener"><${Icon.phone} />WhatsApp</a>
    <button class="btn sec" onClick=${() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}><${Icon.copy} />${copied ? 'Copied' : 'Copy'}</button>
  </div></div>`;
}

export function CallSheet({ story, symbol, data, network, nav }) {
  const sym = story?.symbol || symbol;
  const company = data.ann.holdings.find((h) => h.symbol === sym);
  const items = story?.items || [];
  const people = items.flatMap((i) => i.people || []);
  const calls = network.whoToCall({ symbol: sym, tags: items.flatMap((i) => i.eventTags || []), orgs: items.flatMap((i) => i.orgs || []), people, limit: 6 });
  return html`<div>
    <div class="kicker">Dial · ${company?.name || sym}</div>
    <h2>Who can help you understand ${story ? 'this' : sym}</h2>
    ${story && html`<p class="prose" style="margin:0 0 6px">${headline(story.lead)}</p>`}
    <div class="panel people-panel"><h4>Ranked by how close they are to it × how close they are to you</h4>
      ${calls.length ? calls.map((c, i) => html`<${CallRow} c=${c} open=${i === 0} network=${network} nav=${nav} ctx=${{ company: company?.name || sym, what: story ? whatHappened(story.lead) : 'been on my mind' }} />`) : html`<div class="muted">Nobody yet — import your LinkedIn connections in People.</div>`}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ contact profile
export function PersonSheet({ person: p, data, network, nav, now }) {
  const w = network.warmth(p);
  const links = useMemo(() => {
    const out = [];
    for (const h of data.ann.holdings) {
      const r = network.whoToCall({ symbol: h.symbol, limit: 40 }).find((x) => x.person.id === p.id);
      if (r && r.reasons[0].kind !== 'expertise') out.push({ symbol: h.symbol, name: h.name, reason: r.reasons[0].text });
    }
    return out.slice(0, 6);
  }, [p]);
  return html`<div>
    <div class="person-row" style="border:0;padding-top:4px"><${Avatar} name=${p.name} lg cold=${w.cold} /><div class="body"><h2 style="margin:0">${p.name}</h2><div class="sub">${p.headline}${p.city ? ` · ${p.city}` : ''}</div></div></div>
    <div class="panel people-panel"><h4>You and ${first(p.name)} <span>${p.source === 'synthetic' ? 'synthetic demo contact' : p.source}</span></h4>
      <div style="font-size:14px">${p.relationship?.how}${p.relationship?.since ? ` · since ${p.relationship.since}` : ''}</div>
      <div class="sub" style="margin-top:4px">Tie strength <${Strength} v=${p.relationship?.strength} /> · last spoke ${p.relationship?.lastContact ? dayLabel(p.relationship.lastContact) + ' ' + new Date(p.relationship.lastContact).getFullYear() : '—'} (${w.label})${p.relationship?.channel ? ` · ${p.relationship.channel}` : ''}</div>
      ${p.relationship?.notes && html`<div class="reason">${p.relationship.notes}</div>`}
    </div>
    ${links.length > 0 && html`<div class="panel"><h4>Can speak to your holdings</h4>${links.map((l) => html`<div class="reason"><b style="margin-right:4px">${l.symbol}</b>${l.reason}</div>`)}</div>`}
    <div class="panel"><h4>Career</h4><div class="tl">${network.stints(p).sort((a, b) => (b.from || 0) - (a.from || 0)).map((c) => html`<div class="e ${data.ann.holdings.some((h) => network.orgOf(h.symbol) === c.canon) ? 'hit' : ''}"><span class="yrs">${yrs(c.from, c.to)}</span> · <b>${c.org}</b><span class="muted"> — ${c.title}</span>${c.notes ? html`<div class="muted" style="font-size:12.5px">${c.notes}</div>` : ''}</div>`)}
      ${(p.education || []).map((e) => html`<div class="e"><span class="yrs">${yrs(e.from, e.to)}</span> · ${e.institution}<span class="muted"> — ${e.degree || ''}</span></div>`)}</div></div>
    ${p.expertise?.length > 0 && html`<div class="panel"><h4>Go-to on</h4><div class="chips">${p.expertise.map((e) => html`<span class="chip">${e}</span>`)}</div></div>`}
    ${p.livedThrough?.length > 0 && html`<div class="panel"><h4>Has lived through</h4>${p.livedThrough.map((l) => html`<div class="reason">${l.event}${l.year ? ` (${l.year})` : ''}</div>`)}</div>`}
    ${p.knows?.length > 0 && html`<div class="panel"><h4>Knows</h4>${p.knows.map((k) => html`<div class="reason"><b style="margin-right:4px">${k.name}</b>${k.org ? `${k.org} — ` : ''}${k.context}</div>`)}</div>`}
  </div>`;
}

// ------------------------------------------------------------------ tripwires: you decide what "unusual" means
export function TripwireSheet({ data, nav }) {
  const [r, setR] = useState(nav.rules);
  const save = (nr) => {
    setR(nr);
    nav.setRules(nr);
  };
  const hits = useMemo(() => tripwires(data.market, data.ann.holdings, r, 30), [r]);
  const dates = data.market.series.NIFTY?.d.slice(-30) || [];
  const perDay = dates.map((d) => hits.filter((h) => h.date === d).length);
  const max = Math.max(1, ...perDay);
  const perWeek = (hits.length / 6).toFixed(1);
  return html`<div>
    <div class="kicker">Triggered alerts</div>
    <h2>Tripwires</h2>
    <p class="prose" style="margin:0">You decide what “unusual” means. FINN replays the last 30 sessions so you can see how noisy a threshold would have been before you commit to it.</p>
    <div class="panel">
      <div class="slider"><div class="top"><span>Price move</span><b class="mono">±${r.move}%</b></div><input type="range" min="1" max="12" step="0.5" value=${r.move} onInput=${(e) => save({ ...r, move: +e.target.value })} /></div>
      <div class="slider"><div class="top"><span>Volume vs 20-day average</span><b class="mono">${r.volx}×</b></div><input type="range" min="1.2" max="6" step="0.1" value=${r.volx} onInput=${(e) => save({ ...r, volx: +e.target.value })} /></div>
      <div class="toggle-row"><span>Judge moves net of Nifty<div class="sub">a 4% fall on a 3% market day is only 1% news</div></span><button class="switch" role="switch" aria-checked=${r.relative} onClick=${() => save({ ...r, relative: !r.relative })}></button></div>
    </div>
    <div class="panel"><h4>Backtest · last 30 sessions <span>${hits.length} alerts ≈ ${perWeek}/week</span></h4>
      <div class="bars">${perDay.map((n, i) => html`<span class=${n ? 'on' : ''} style=${`height:${(n / max) * 100}%`} title=${`${dates[i]}: ${n}`}></span>`)}</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:3px"><span>${dates[0] ? dayLabel(dates[0]) : ''}</span><span>${dates.at(-1) ? dayLabel(dates.at(-1)) : ''}</span></div>
      ${hits.length > 25 ? html`<div class="reason" style="color:var(--warn)">That's noisy — you'd likely start ignoring these. Try a wider threshold.</div>` : hits.length === 0 ? html`<div class="reason">Nothing would have fired. Too strict to be useful?</div>` : ''}
      <div style="margin-top:8px">${hits.slice(0, 6).map((h) => html`<div class="reason"><b style="margin-right:4px">${h.symbol}</b>${dayLabel(h.date)}: ${pct(h.move)} (${pct(h.rel)} vs Nifty)${h.volx ? `, ${fmt(h.volx, 1)}× volume` : ''}</div>`)}</div>
    </div>
    <div class="panel"><h4>Filing types that should interrupt you</h4>
      ${Object.keys(DEFAULT_RULES.categories).map((c) => html`<div class="toggle-row"><span>${CATEGORY[c]}</span><button class="switch" role="switch" aria-checked=${!!r.categories[c]} onClick=${() => save({ ...r, categories: { ...r.categories, [c]: !r.categories[c] } })}></button></div>`)}
      <div class="slider"><div class="top"><span>…and only above materiality</span><b class="mono">${r.minScore}</b></div><input type="range" min="20" max="90" step="5" value=${r.minScore} onInput=${(e) => save({ ...r, minScore: +e.target.value })} /></div>
    </div>
    <p class="foot">In production these run server-side on each EOD/filing refresh and arrive as Web Push notifications.</p>
  </div>`;
}

// ------------------------------------------------------------------ Ask FINN (text or voice)
export function AskSheet(ctx) {
  const { nav } = ctx;
  const [q, setQ] = useState('');
  const [ans, setAns] = useState(null);
  const [listening, setListening] = useState(false);
  const run = (text) => {
    const a = parseAsk(text, ctx);
    if (a.go) return a.go();
    setAns(a);
  };
  const mic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return nav.toast('Voice needs Chrome or Safari.');
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setQ(t);
      run(t);
    };
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };
  const examples = ['Who knows rural lending?', 'Who can explain the Kaynes–Vishay JV?', 'Path to Raghu Panicker', 'Brief me on Anup Bagchi', 'Research PIIND', 'Who has lived through a plant shutdown?', 'What changed this week?'];
  return html`<div>
    <div class="kicker">Ask FINN</div>
    <h2>Ask about a company, a theme or a person</h2>
    <form class="askbox" onSubmit=${(e) => { e.preventDefault(); run(q); }}>
      <input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="e.g. who knows semiconductors?" autofocus enterkeyhint="go" />
      <button type="button" class="mic ${listening ? 'on' : ''}" aria-label="Speak" onClick=${mic}><${Icon.mic} /></button>
    </form>
    ${!ans && html`<div class="chips">${examples.map((x) => html`<button class="chip btn" onClick=${() => { setQ(x); run(x); }}>${x}</button>`)}</div>`}
    ${ans && html`<${AskAnswer} a=${ans} ...${ctx} />`}
    <p class="foot">Parsed on your phone — people questions never leave it.</p>
  </div>`;
}

// ------------------------------------------------------------------ about / provenance
export function AboutSheet({ data, nav }) {
  const [h, setH] = useState(null);
  useEffect(() => { getJSON('/api/health').then(setH).catch(() => {}); }, []);
  const theme = store.get('theme', null);
  const setTheme = (t) => { store.set('theme', t); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  return html`<div>
    <div class="kicker">About this data</div>
    <h2>What FINN read, and how</h2>
    <div class="panel"><h4>Sources</h4>
      <div class="reason">Filings: BSE/NSE disclosures via screener.in + NSE's public RSS feed · ${data.ann.items.length} in the last 30 days · as of ${new Date(data.ann.asOf).toLocaleString('en-IN')}</div>
      <div class="reason">Prices: Yahoo Finance EOD via yfinance · ${data.market.series.NIFTY?.d.at(-1) || ''}</div>
      <div class="reason">Fundamentals: exchange-filed results, annual reports and concall transcripts (primary sources only for Dig)</div>
      <div class="reason">Network: a <b>synthetic</b> demo network stored on this device${nav.netSource === 'device' ? ' (your edited copy)' : ''}</div>
    </div>
    <div class="panel"><h4>AI mode</h4>
      ${h ? (h.ai.provider === 'gemini' ? html`<div class="reason">Gemini on — ${h.ai.fast} (bulk extraction), ${h.ai.std} (filings), ${h.ai.deep} (synthesis)</div>` : html`<div class="reason">No model key set — FINN runs on rules, heuristics and cached build-time extractions. ${h.ai.note}</div>`) : html`<div class="muted">checking…</div>`}
      <div class="reason">Models only read and phrase. Every number and every verdict is computed in code; every quote is machine-checked against its source.</div>
    </div>
    <div class="panel"><h4>Privacy</h4><div class="reason">Your network never leaves this phone: matching runs locally, and the server only serves public market data.</div></div>
    <div class="panel"><h4>Appearance</h4><div class="seg">${[['Auto', null], ['Light', 'light'], ['Dark', 'dark']].map(([l, t]) => html`<button aria-pressed=${theme === t} onClick=${() => { setTheme(t); nav.close(); }}>${l}</button>`)}</div></div>
  </div>`;
}
