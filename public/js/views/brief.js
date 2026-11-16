import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { html, fmt, pct, ago, Icon, CATEGORY, CAT_COLOR, store, first } from '../lib.js';
import { scoreItem, cluster, fitBudget, itemTime, tripwires, prefs } from '../score.js';
import { headline, sourceNote, ResultsMini, Avatar, waLink } from './common.js';
import { clip } from '../network.js';

const WINDOWS = [
  { k: '24h', h: 24, sessions: 1, label: '24h' },
  { k: '3d', h: 72, sessions: 3, label: '3D' },
  { k: '7d', h: 168, sessions: 5, label: '7D' },
  { k: '30d', h: 720, sessions: 22, label: '30D' },
];

export function Brief({ data, network, nav, now }) {
  const [win, setWin] = useState(() => store.get('window', '24h'));
  const [budget, setBudget] = useState(() => store.get('budget', 3));
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => store.set('window', win), [win]);
  useEffect(() => store.set('budget', budget), [budget]);

  const W = WINDOWS.find((w) => w.k === win) || WINDOWS[0];
  const holdingMap = useMemo(() => Object.fromEntries(data.ann.holdings.map((h) => [h.symbol, h])), [data]);

  const view = useMemo(() => {
    const p = prefs.get();
    const since = now - W.h * 3600000;
    const inWin = data.ann.items.filter((i) => itemTime(i) >= since && itemTime(i) <= now + 86400000 && !p.dismissed[i.id]);
    const scored = inWin.map((i) => ({ ...i, ...scoreItem(i, { holdingMap, market: data.market, network, prefs: p }) }));
    const stories = cluster(scored);
    const fit = fitBudget(stories, budget * 60);
    const trips = tripwires(data.market, data.ann.holdings, nav.rules, W.sessions);
    const peopleStories = fit.fold.filter((s) => s.net.length || s.items.some((i) => i.people?.length)).length;
    // what a wider window would add (for the quiet-weekend nudge)
    const next = WINDOWS[WINDOWS.indexOf(W) + 1];
    let more = 0;
    if (next && fit.fold.length < 3) {
      const s2 = now - next.h * 3600000;
      const extra = data.ann.items.filter((i) => itemTime(i) >= s2 && itemTime(i) < since && !p.dismissed[i.id] && i.baseScore >= 40);
      more = new Set(extra.map((i) => i.symbol + i.category)).size;
    }
    return { inWin, stories, fit, trips, peopleStories, next, more, buried: fit.floor.reduce((s, x) => s + x.items.length, 0), dismissedCount: Object.keys(p.dismissed).length };
  }, [data, network, win, budget, nav.prefsV, nav.rules]);

  const { fit, trips } = view;
  const asOf = new Date(data.ann.asOf);
  const holdingsTouched = new Set(view.inWin.map((i) => i.symbol)).size;

  const speak = () => {
    if (!('speechSynthesis' in window)) return nav.toast('Audio brief needs a browser with speech synthesis.');
    if (speaking) {
      speechSynthesis.cancel();
      return setSpeaking(false);
    }
    const lines = [ledeText(fit, view, budget, W).replace(/<[^>]+>/g, '')];
    fit.fold.forEach((s, i) => lines.push(`${i + 1}. ${data.ann.holdings.find((h) => h.symbol === s.symbol)?.name || s.symbol}. ${headline(s.lead)}.${s.net[0] ? ` You could call ${first(s.net[0].person.name)}.` : ''}`));
    if (trips.length) lines.push(`Tripwires: ${trips.slice(0, 3).map((t) => `${t.symbol} ${t.move > 0 ? 'up' : 'down'} ${Math.abs(t.move).toFixed(1)} percent`).join('; ')}.`);
    const u = new SpeechSynthesisUtterance(lines.join(' '));
    u.lang = 'en-IN';
    u.rate = 1.04;
    u.onend = () => setSpeaking(false);
    speechSynthesis.speak(u);
    setSpeaking(true);
  };

  const bury = (story) => {
    for (const it of story.items) prefs.bury(it);
    const n = prefs.get().buriedCat[story.lead.category] || 0;
    nav.bumpPrefs();
    nav.toast(n >= 3 ? `Buried. FINN will now rank “${CATEGORY[story.lead.category]}” lower for you.` : 'Buried.', () => {
      for (const it of story.items) prefs.undo(it);
      nav.bumpPrefs();
    });
  };

  return html`<main class="page">
    <header class="mast">
      <span class="wordmark" aria-label="FINN"><b>F</b><b>I</b><b>N</b>N</span>
      <div class="mast-actions">
        <button class="iconbtn" aria-label=${speaking ? 'Stop audio brief' : 'Listen to the brief'} onClick=${speak}>${speaking ? html`<${Icon.stop} />` : html`<${Icon.play} />`}</button>
        <button class="iconbtn" aria-label="About this data" onClick=${() => nav.open('about')}><${Icon.info} /></button>
      </div>
    </header>
    <div class="dateline">${asOf.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · as of ${asOf.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST</div>

    <h1 class="lede" dangerouslySetInnerHTML=${{ __html: ledeText(fit, view, budget, W) }}></h1>
    <p class="sublede">${view.inWin.length} ${view.inWin.length === 1 ? 'filing' : 'filings'} across ${holdingsTouched} of your ${data.ann.holdings.length} holdings · <b>${view.buried}</b> routine ${view.buried === 1 ? 'one' : 'ones'} buried${trips.length ? html` · <span class="accent">${trips.length} tripwire${trips.length > 1 ? 's' : ''}</span>` : ''}</p>

    <div class="controls">
      <div class="seg" role="group" aria-label="Window">${WINDOWS.map((w) => html`<button aria-pressed=${w.k === win} onClick=${() => setWin(w.k)}>${w.label}</button>`)}</div>
      <label class="budget">I have <b>${budget} min</b><input type="range" min="1" max="10" step="1" value=${budget} onInput=${(e) => setBudget(+e.target.value)} aria-label="Attention budget in minutes" /></label>
    </div>

    ${trips.length > 0 && html`<div class="section-h"><h2>Tripwires</h2><button class="aside chip btn ghost" onClick=${() => nav.open('tripwires')}>±${nav.rules.move}% · ${nav.rules.volx}× vol</button></div>
      <div class="scrollx">${trips.slice(0, 12).map((t) => html`<button class="trip ${Math.abs(t.rel) >= nav.rules.move * 1.5 ? 'hot' : ''}" onClick=${() => nav.dig(t.symbol)}>
        <div class="t-sym">${t.symbol}</div>
        <div class="t-val ${t.move > 0 ? 'up' : 'down'}">${pct(t.move)} ${t.volx ? html`<span class="muted">· ${fmt(t.volx, 1)}×</span>` : ''}</div>
        <div class="t-why">${t.hitMove ? `${pct(t.rel)} vs Nifty` : 'volume spike'} · ${new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
      </button>`)}</div>`}

    <div class="section-h"><h2>Worth your time</h2><span class="aside">${fmt(fit.used / 60, 1)} of ${budget} min</span></div>
    ${fit.fold.length === 0 && html`<div class="quiet">Nothing material in this window.${view.next && view.more ? html` <button class="chip btn accent" onClick=${() => setWin(view.next.k)}>Widen to ${view.next.label} (+${view.more})</button>` : ''}</div>`}
    <div class="stack">${fit.fold.map((s) => html`<${StoryCard} key=${s.id} story=${s} nav=${nav} network=${network} now=${now} holding=${holdingMap[s.symbol]} rules=${nav.rules} onBury=${() => bury(s)} />`)}</div>
    ${fit.fold.length > 0 && fit.fold.length < 3 && view.next && view.more > 0 && html`<div class="budget-note">Quiet ${W.label}. <button class="chip btn accent" onClick=${() => setWin(view.next.k)}>Widen to ${view.next.label}: +${view.more} more</button></div>`}
    ${fit.over.length > 0 && html`<div class="budget-note"><span>${fit.over.length} more material ${fit.over.length > 1 ? 'stories' : 'story'} beyond your ${budget}-minute budget.</span><button class="chip btn" onClick=${() => setBudget(Math.min(10, budget + Math.ceil(fit.over.reduce((s, x) => s + x.cost, 0) / 60)))}>Make time</button></div>`}

    ${fit.floor.length > 0 && html`<${Floor} floor=${fit.floor} />`}

    <${KeepWarmStrip} network=${network} stories=${view.stories} nav=${nav} />

    <p class="foot">Ranking = filing type × position size × market reaction × your network × what you've buried.<br />${view.dismissedCount ? html`${view.dismissedCount} buried by you · <button class="chip btn ghost" onClick=${() => { prefs.reset(); nav.bumpPrefs(); }}>Reset</button>` : 'Swipe a story left to bury it, right to see who to call.'}</p>
  </main>`;
}

function ledeText(fit, view, budget, W) {
  const n = fit.fold.length;
  if (!n) return `A quiet ${W.k === '24h' ? 'day' : 'stretch'}. <em>Nothing</em> crossed the bar.`;
  const nums = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const word = nums[n] || String(n);
  const ppl = view.peopleStories;
  return `<em>${word} ${n === 1 ? 'thing' : 'things'}</em> worth your ${budget} minutes${ppl ? `. <span class="people-em">${ppl === n ? (n === 1 ? 'It involves' : 'All involve') : ppl === 1 ? 'One involves' : `${nums[ppl] || ppl} involve`} people you know.</span>` : '.'}`;
}

function StoryCard({ story, nav, network, now, holding, rules, onBury }) {
  const it = story.lead;
  const ref = useRef();
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const tripped = rules.categories[it.category] && story.score >= rules.minScore;
  const filingPerson = story.items.flatMap((i) => i.people || [])[0];
  const dil = useMemo(() => (filingPerson ? network.diligence(filingPerson, story.symbol) : null), [filingPerson]);
  const call = story.net[0];

  const onDown = (e) => (start.current = { x: e.clientX, y: e.clientY, t: Date.now(), lock: null });
  const onMove = (e) => {
    const s = start.current;
    if (!s) return;
    const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
    if (s.lock == null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) s.lock = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
    if (s.lock === 'x') setDx(ddx);
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (s?.lock === 'x') {
      if (dx < -90) return (setDx(-600), setTimeout(onBury, 160));
      if (dx > 90) {
        setDx(0);
        return nav.open('call', { story });
      }
    }
    setDx(0);
  };

  return html`<div class="cardwrap">
    <div class="swipe-bg" style=${`background:${dx > 0 ? 'var(--people-soft)' : dx < 0 ? 'var(--sunk)' : 'transparent'}`}><span class="l">${dx > 30 ? '→ Who to call' : ''}</span><span class="r">${dx < -30 ? 'Bury ←' : ''}</span></div>
    <article ref=${ref} class="card ${start.current ? 'dragging' : ''}" style=${`transform:translateX(${dx}px)`}
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${() => { start.current = null; setDx(0); }}>
      <span class="rail" style=${`background:${CAT_COLOR[it.category] || 'var(--accent)'}`}></span>
      <div class="meta"><span class="sym">${story.symbol}</span><span class="dot"></span><span>${CATEGORY[it.category]}${story.categories.length > 1 ? ` + ${CATEGORY[story.categories.find((c) => c !== it.category)]}` : ''}</span><span class="dot"></span><span>${ago(new Date(Math.max(...story.items.map((i) => new Date(i.at || i.date).getTime()))).toISOString(), now)}</span>${story.items.length > 1 ? html`<span class="dot"></span><span>${story.items.length} filings</span>` : ''}${tripped ? html`<span class="chip accent" style="margin-left:auto;padding:3px 7px">Tripwire</span>` : ''}</div>
      <h3 onClick=${() => nav.open('story', { story })} style="cursor:pointer">${headline(it)}</h3>
      ${it.category === 'results' && it.results && html`<${ResultsMini} results=${it.results} />`}
      ${filingPerson && html`<div class="personline" onClick=${() => nav.open('story', { story })}><${Avatar} name=${filingPerson.name} ext /><div class="who"><b>${filingPerson.name}</b> · ${filingPerson.role}<br /><span class="muted">${dil && (dil.direct.length || dil.you.length) ? `${dil.direct.length ? `${dil.direct.length} of your contacts crossed paths with ${first(filingPerson.name)}` : ''}${dil.direct.length && dil.you.length ? ' · ' : ''}${dil.you.length ? dil.you[0] : ''}` : 'No direct link in your network — see who knows the company'}</span></div></div>`}
      ${!filingPerson && call && html`<div class="personline" onClick=${() => nav.open('call', { story })}><${Avatar} name=${call.person.name} cold=${call.warm.cold} /><div class="who"><b>Call ${first(call.person.name)}</b> — ${call.reasons[0].text.replace(/^(Was at|At|Works at) /, (m) => m.toLowerCase())}</div></div>`}
      <div class="why chips">${story.why.map((w) => html`<span class="chip ${w.k}">${w.t}</span>`)}<span class="chip ghost" title="FINN materiality score">${story.score}</span></div>
      <div class="src" style="margin-top:7px">${sourceNote(it)}</div>
      <div class="acts">
        <button class="act" onClick=${onBury}><${Icon.bury} />Bury</button>
        <button class="act" onClick=${() => nav.open('story', { story })}><${Icon.dig} />Dig</button>
        <button class="act dial" onClick=${() => nav.open('call', { story })}><${Icon.phone} />Dial</button>
      </div>
    </article>
  </div>`;
}

function Floor({ floor }) {
  const items = floor.flatMap((s) => s.items);
  const groups = {};
  for (const i of items) (groups[i.category] ||= []).push(i);
  const order = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  return html`<div class="section-h"><h2>The floor</h2><span class="aside">buried, not deleted</span></div>
  <details class="floor">
    <summary><span><b>${items.length}</b> routine ${items.length === 1 ? 'filing' : 'filings'} · ${order.slice(0, 3).map(([c, v]) => `${v.length} ${CATEGORY[c].toLowerCase()}`).join(', ')}</span><span class="muted">▾</span></summary>
    <div class="bar">${order.map(([c, v]) => html`<span style=${`width:${(v.length / items.length) * 100}%;background:${CAT_COLOR[c] || '#ccc'}`} title=${CATEGORY[c]}></span>`)}</div>
    ${order.map(([c, v]) => html`<div class="grp"><div class="kicker" style="margin:6px 0 2px">${CATEGORY[c]} · ${v.length}</div>
      ${v.map((i) => html`<div class="row"><span class="s">${i.symbol}</span><a href=${i.url} target="_blank" rel="noopener" style="text-decoration:none">${headline(i).slice(0, 90)}</a></div>`)}</div>`)}
  </details>`;
}

function KeepWarmStrip({ network, stories, nav }) {
  const list = useMemo(() => network.keepWarm(stories, { limit: 2, describe: (st) => headline(st.lead) }), [network, stories]);
  if (!list.length) return null;
  return html`<div class="section-h"><h2>A reason to call</h2><button class="aside chip btn ghost" onClick=${() => nav.tab('people')}>All</button></div>
    ${list.map((k) => {
      const text = reconnectText(network, k);
      return html`<div class="panel people-panel" style="margin:8px 0">
        <div class="person-row" style="padding:0"><${Avatar} name=${k.person.name} cold /><div class="body"><div class="name">${k.person.name} <span class="sub">· ${k.warm.label}</span></div><div class="sub">${k.why}</div></div></div>
        <div class="opener">${text}<div class="acts2"><a class="btn people" href=${waLink(text)} target="_blank" rel="noopener">WhatsApp</a><button class="btn sec" onClick=${() => nav.open('person', { person: k.person })}>Profile</button></div></div>
      </div>`;
    })}`;
}

export function reconnectText(network, k) {
  const what = clip(headline(k.story.lead), 80);
  const company = (network.holdings[k.story.symbol]?.name || k.story.symbol).replace(/\s+(Ltd\.?|Limited)$/i, '');
  return network.opener(k.person, k.relOrg ? { kind: 'reconnect-adjacent', company, what, org: k.relOrg } : { kind: 'reconnect', company, what });
}
