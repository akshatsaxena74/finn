import { useState, useEffect, useMemo } from 'preact/hooks';
import { html, fmt, fmtCr, pct, tone, Spark, Icon, getJSON, store, dayLabel } from '../lib.js';
import { ResultsTable, Avatar, Strength } from './common.js';

const VERDICT = {
  kept: ['Kept', 'good'], close: ['Nearly', 'warn'], missed: ['Missed', 'bad'], moved: ['Goalposts moved', 'bad'], ahead: ['Tracking ahead', 'good'],
  behind: ['Tracking behind', 'warn'], pending: ['Too early', ''], undated: ['No deadline', 'warn'], unmeasurable: ['Not in the numbers', ''],
};
const ORDER = ['moved', 'missed', 'behind', 'close', 'kept', 'ahead', 'undated', 'pending', 'unmeasurable'];
const METRIC = { revenue_growth: 'Revenue growth', revenue_abs: 'Revenue', ebitda_margin: 'EBITDA margin', ebitda_abs: 'EBITDA', pat: 'PAT', capex: 'Capex', volume_growth: 'Volume growth', aum_growth: 'AUM growth', credit_cost: 'Credit cost', roce: 'Returns', debt: 'Debt', stores: 'Stores', other: 'Other' };
const tgt = (t) => (t ? `${t.unit === 'cr' ? '₹' : ''}${fmt(t.low, t.low % 1 ? 1 : 0)}${t.high != null && t.high !== t.low ? `–${fmt(t.high, t.high % 1 ? 1 : 0)}` : t.high == null ? '+' : ''}${t.unit === 'cr' ? ' cr' : t.unit === '%' ? '%' : ' ' + t.unit}` : '—');

export function Dig({ symbol, data, network, nav }) {
  return symbol ? html`<${Dossier} key=${symbol} symbol=${symbol} data=${data} network=${network} nav=${nav} />` : html`<${DigHome} data=${data} nav=${nav} />`;
}

function DigHome({ data, nav }) {
  const [q, setQ] = useState('');
  const recent = store.get('recentDig', []);
  const research = [
    { symbol: 'KAYNES', why: 'Fresh OSAT JV + a guidance record to check' },
    { symbol: 'AARTIIND', why: 'Specialty chemicals; years of EBITDA targets' },
    { symbol: 'PIIND', why: 'Agrochem CSM; growth reset narrative' },
    { symbol: 'JUBLFOOD', why: 'Store and margin promises vs delivery' },
  ];
  return html`<main class="page">
    <header class="mast"><span class="wordmark"><b>F</b><b>I</b><b>N</b>N</span><span class="dateline">Pull</span></header>
    <h1 class="lede">Dig into any listed company.</h1>
    <p class="sublede">Grounded only in what the company filed — results, annual reports, concall transcripts. No news, no broker notes, no model memory.</p>
    <form class="search" onSubmit=${(e) => { e.preventDefault(); q.trim() && nav.dig(q.trim().toUpperCase()); }}>
      <${Icon.dig} /><input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="NSE ticker — e.g. TATAELXSI, ASTRAL, PIIND" autocapitalize="characters" autocomplete="off" enterkeyhint="search" aria-label="Ticker" />
    </form>
    <div class="section-h"><h2>Ready to read</h2><span class="aside">precomputed</span></div>
    <div class="stack">${research.map((r) => html`<button class="card" style="text-align:left" onClick=${() => nav.dig(r.symbol)}><div class="meta"><span class="sym">${r.symbol}</span></div><div style="font-size:14px;margin-top:3px">${r.why}</div></button>`)}</div>
    ${recent.length > 0 && html`<div class="section-h"><h2>Recent</h2></div><div class="chips">${recent.map((s) => html`<button class="chip btn" onClick=${() => nav.dig(s)}>${s}</button>`)}</div>`}
    <div class="section-h"><h2>Your holdings</h2></div>
    <div class="chips">${data.ann.holdings.map((h) => html`<button class="chip btn" onClick=${() => nav.dig(h.symbol)}>${h.symbol}</button>`)}</div>
    <p class="foot">Any other ticker is researched live: facts in ~2s, the promise ledger in ~10–25s.</p>
  </main>`;
}

function Dossier({ symbol, data, network, nav }) {
  const [facts, setFacts] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [syn, setSyn] = useState(null);
  const [err, setErr] = useState({});
  const [prov, setProv] = useState({});
  const [t0] = useState(Date.now());
  const [times, setTimes] = useState({});

  useEffect(() => {
    store.set('recentDig', [symbol, ...store.get('recentDig', []).filter((s) => s !== symbol)].slice(0, 6));
    let alive = true;
    getJSON(`/api/research?ticker=${symbol}&stage=facts`)
      .then((r) => { if (!alive) return; setFacts(r.facts); setProv((p) => ({ ...p, facts: r.provenance })); setTimes((t) => ({ ...t, facts: Date.now() - t0 })); })
      .catch((e) => alive && setErr((x) => ({ ...x, facts: e.message })));
    getJSON(`/api/research?ticker=${symbol}&stage=ledger`)
      .then(async (r) => {
        if (!alive) return;
        setLedger(r.ledger);
        setProv((p) => ({ ...p, ledger: r.provenance }));
        setTimes((t) => ({ ...t, ledger: Date.now() - t0 }));
        const s = r.provenance.mode === 'precomputed'
          ? await getJSON(`/api/research?ticker=${symbol}&stage=synthesis`)
          : await getJSON(`/api/research?ticker=${symbol}&stage=synthesis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ledger: r.ledger }) });
        if (!alive) return;
        setSyn(s.synthesis);
        setTimes((t) => ({ ...t, synthesis: Date.now() - t0 }));
      })
      .catch((e) => alive && setErr((x) => ({ ...x, ledger: e.message })));
    return () => (alive = false);
  }, [symbol]);

  const holding = data.ann.holdings.find((h) => h.symbol === symbol);
  const calls = useMemo(() => (facts ? network.whoToCall({ symbol, tags: [facts.snapshot.industry, facts.snapshot.sector].filter(Boolean).map((x) => x.toLowerCase()), limit: 4 }) : []), [facts]);
  const secs = ['Snapshot', 'Numbers', 'Trajectory', 'Balance sheet', 'Cash', 'Promises', 'Bull / bear', 'People', 'Sources'];
  const go = (s) => document.getElementById('sec-' + s.replace(/\W/g, ''))?.scrollIntoView({ behavior: 'smooth' });

  if (err.facts && !facts) return html`<main class="page"><header class="mast"><button class="chip btn" onClick=${() => nav.dig(null)}>← Search</button></header><div class="quiet" style="margin-top:16px">${err.facts}</div></main>`;
  if (!facts) return html`<main class="page"><header class="mast"><button class="chip btn" onClick=${() => nav.dig(null)}>← Search</button></header><div class="dhead"><div class="kicker">${symbol}</div><div class="nm">Reading filings…</div></div><div class="skeleton"></div><div class="skeleton" style="height:140px"></div><div class="skeleton"></div></main>`;

  const s = facts.snapshot;
  const tr = facts.trajectory;
  const bs = facts.balanceSheet;
  const cash = facts.cash;
  const lastV = (a) => a?.[a.length - 1]?.value;
  const g = tr.growth?.['Compounded Sales Growth'] || {};
  const opm = tr.opm || [];
  const opmThen = opm.length > 4 ? opm[opm.length - 5] : opm[0];

  return html`<main class="page">
    <header class="mast"><button class="chip btn" onClick=${() => nav.dig(null)}>← Search</button>
      <div class="chips">${holding && html`<span class="chip accent">${holding.weight}% of book</span>`}<span class="chip ghost">${prov.facts?.mode || ''}</span></div></header>
    <div class="dhead"><div class="kicker">${symbol} · ${s.industry || s.sector || ''}</div><div class="nm">${s.name}</div></div>
    <div class="kv">
      <div><div class="k">Price</div><div class="v">₹${fmt(s.price)}</div></div>
      <div><div class="k">Mkt cap</div><div class="v">${fmtCr(s.marketCapCr)}</div></div>
      <div><div class="k">P/E</div><div class="v">${fmt(s.pe, 1)}</div></div>
      <div><div class="k">ROCE</div><div class="v">${s.roce != null ? fmt(s.roce, 1) + '%' : '—'}</div></div>
      <div><div class="k">ROE</div><div class="v">${s.roe != null ? fmt(s.roe, 1) + '%' : '—'}</div></div>
      <div><div class="k">Div yield</div><div class="v">${s.dividendYield != null ? fmt(s.dividendYield, 2) + '%' : '—'}</div></div>
    </div>
    ${syn?.verdict && html`<p class="lede" style="font-size:21px;margin:14px 0 4px">${syn.verdict}</p>`}

    <nav class="secnav">${secs.map((x) => html`<button class="chip btn" onClick=${() => go(x)}>${x}</button>`)}</nav>

    <section class="dsec" id="sec-Snapshot"><h3>What it does</h3><p class="prose">${s.about || 'No description on file.'}</p><div class="receipt">Company profile as listed on screener.in</div></section>

    <section class="dsec" id="sec-Numbers"><h3>Latest quarter</h3>${facts.latestQuarter ? html`<div class="panel"><${ResultsTable} results=${facts.latestQuarter} /></div>` : html`<div class="muted">No quarterly data.</div>`}</section>

    <section class="dsec" id="sec-Trajectory"><h3>Trajectory</h3>
      <p class="prose">Revenue compounded <b>${fmt(g['5 Years'])}%</b> a year over 5 years (${fmt(g['3 Years'])}% over 3)${opm.length > 1 ? html`; EBITDA margin went from <b>${fmt(opmThen.value, 1)}%</b> (${opmThen.period}) to <b class=${tone(lastV(opm) - opmThen.value)}>${fmt(lastV(opm), 1)}%</b> (${opm.at(-1).period}) — ${lastV(opm) - opmThen.value > 1.5 ? 'expanding' : lastV(opm) - opmThen.value < -1.5 ? 'compressing' : 'roughly flat'}` : ''}.</p>
      <div class="sparks">
        <${SparkCard} k="Revenue (annual, ₹ cr)" v=${fmt(lastV(tr.revenue))} s=${tr.revenue} />
        <${SparkCard} k="EBITDA margin (annual)" v=${fmt(lastV(opm), 1) + '%'} s=${opm} />
        <${SparkCard} k="PAT (annual, ₹ cr)" v=${fmt(lastV(tr.pat))} s=${tr.pat} />
        <${SparkCard} k="Revenue (quarterly)" v=${fmt(lastV(tr.qRevenue))} s=${tr.qRevenue?.slice(-12)} />
      </div>
    </section>

    <section class="dsec" id="sec-Balancesheet"><h3>Balance sheet</h3>
      ${s.isFinancial ? html`<p class="prose">A lender: leverage is the business model, so FINN tracks borrowings vs equity rather than flagging them.</p>` : ''}
      <div class="sparks">
        <${SparkCard} k="Debt / equity" v=${fmt(lastV(bs.debtToEquity), 2)} s=${bs.debtToEquity} />
        <${SparkCard} k="Borrowings (₹ cr)" v=${fmt(lastV(bs.borrowings))} s=${bs.borrowings} />
        ${!s.isFinancial && html`<${SparkCard} k="Cash conversion cycle (days)" v=${fmt(lastV(bs.workingCapital.cashConversionCycle))} s=${bs.workingCapital.cashConversionCycle} />`}
        <${SparkCard} k="ROCE %" v=${fmt(lastV(bs.roce))} s=${bs.roce} />
      </div>
      ${!s.isFinancial && bs.workingCapital.debtorDays?.length > 0 && html`<p class="prose" style="font-size:13.5px">Latest: receivables ${fmt(lastV(bs.workingCapital.debtorDays))} days · inventory ${fmt(lastV(bs.workingCapital.inventoryDays))} days · payables ${fmt(lastV(bs.workingCapital.payableDays))} days.</p>`}
    </section>

    <section class="dsec" id="sec-Cash"><h3>Cash quality</h3>
      ${cash.conversion ? html`<p class="prose">Over ${cash.conversion.years} years, <b class=${cash.conversion.ratio >= 90 ? 'up' : cash.conversion.ratio < 70 ? 'down' : ''}>${fmt(cash.conversion.ratio)}%</b> of reported profit arrived as operating cash (₹${fmt(cash.conversion.cfo)} cr of cash vs ₹${fmt(cash.conversion.pat)} cr of PAT). ${cash.conversion.ratio >= 90 ? 'The profits are real.' : cash.conversion.ratio < 70 ? 'Profits are running ahead of cash — find out why.' : 'Acceptable, not exceptional.'}</p>` : html`<p class="prose muted">Not enough cash-flow history.</p>`}
      <div class="sparks"><${SparkCard} k="Operating cash flow (₹ cr)" v=${fmt(lastV(cash.cfo))} s=${cash.cfo} /><${SparkCard} k="Free cash flow (₹ cr)" v=${fmt(lastV(cash.fcf))} s=${cash.fcf} /></div>
    </section>

    <section class="dsec" id="sec-Promises"><h3>Promises vs delivery</h3>
      ${!ledger && !err.ledger && html`<div class="pipeline">Reading the last six earnings calls, extracting what management promised, and checking it against what they reported…</div><div class="skeleton" style="height:120px"></div>`}
      ${err.ledger && html`<div class="quiet">Couldn't read transcripts: ${err.ledger}</div>`}
      ${ledger && html`<${Ledger} ledger=${ledger} prov=${prov.ledger} ms=${times.ledger} />`}
    </section>

    <section class="dsec" id="sec-Bullbear"><h3>Narrative vs numbers</h3>
      ${!syn && html`<div class="skeleton"></div>`}
      ${syn && html`<${Synthesis} syn=${syn} />`}
    </section>

    <section class="dsec" id="sec-People"><h3>Who to call about ${symbol}</h3>
      <div class="panel people-panel">${calls.length ? calls.map((c) => html`<div class="person-row"><${Avatar} name=${c.person.name} cold=${c.warm.cold} /><div class="body"><div class="name"><button onClick=${() => nav.open('person', { person: c.person })}>${c.person.name}</button> <${Strength} v=${c.person.relationship?.strength} /> <span class="sub">${c.warm.label}</span></div><div class="sub">${c.person.headline}</div>${c.reasons.map((r) => html`<div class="reason">${r.text}</div>`)}</div></div>`) : html`<div class="muted" style="font-size:13.5px">No one in your network has worked at ${symbol}, its partners or competitors. Ask FINN for the theme instead.</div>`}
      ${syn?.askManagement?.length > 0 && calls.length > 0 && html`<div class="kicker" style="margin-top:10px">Take these questions to ${calls[0].person.name.split(' ')[0]}</div><ol style="margin:4px 0 0;padding-left:18px;font-size:14px">${syn.askManagement.map((q) => html`<li style="margin:3px 0">${q}</li>`)}</ol>`}
      </div>
    </section>

    <section class="dsec" id="sec-Sources"><h3>Sources</h3>
      <div class="panel">
        ${(ledger?.transcripts || []).map((t) => html`<div class="reason"><a href=${t.url} target="_blank" rel="noopener">Concall transcript · ${t.month}</a>${t.quarterLabel ? ` (${t.quarterLabel})` : ''}${t.pages ? ` · ${t.pages} pp` : ''}${t.error ? ' · unreadable' : ''}</div>`)}
        ${(facts.sources?.annualReports || []).map((a) => html`<div class="reason"><a href=${a.url} target="_blank" rel="noopener">Annual report ${a.year}</a></div>`)}
        <div class="reason"><a href=${facts.sources?.screener} target="_blank" rel="noopener">Standardised financials (screener.in)</a></div>
      </div>
    </section>
    <p class="foot">Every number is computed from filed data; every quote is verified against its transcript.<br />Facts ${times.facts ? `${(times.facts / 1000).toFixed(1)}s` : '…'} · ledger ${times.ledger ? `${(times.ledger / 1000).toFixed(1)}s` : '…'} · synthesis ${times.synthesis ? `${(times.synthesis / 1000).toFixed(1)}s` : '…'}</p>
  </main>`;
}

const SparkCard = ({ k, v, s }) => html`<div class="spark"><div class="k">${k}</div><div class="v">${v}</div><${Spark} values=${(s || []).map((x) => x.value)} stroke="var(--ink-2)" /><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--faint)"><span>${s?.[0]?.period || ''}</span><span>${s?.at(-1)?.period || ''}</span></div></div>`;

function Ledger({ ledger, prov, ms }) {
  const sc = ledger.score || {};
  const claims = [...ledger.claims].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || (a.madeOn || '').localeCompare(b.madeOn || ''));
  const byId = Object.fromEntries(ledger.claims.map((c) => [c.id, c]));
  const read = ledger.transcripts.filter((t) => !t.error);
  const chars = read.reduce((s, t) => s + (t.chars || 0), 0);
  const kept = read.reduce((s, t) => s + (t.broadChars || t.windowChars || 0), 0);
  const ratio = sc.ratio;
  const R = 30, C = 2 * Math.PI * R;
  return html`
    <div class="panel"><div class="sayDo">
      <svg class="ring" viewBox="0 0 76 76"><circle cx="38" cy="38" r=${R} fill="none" stroke="var(--hair)" stroke-width="7" />
        ${ratio != null && html`<circle cx="38" cy="38" r=${R} fill="none" stroke=${ratio >= 70 ? 'var(--up)' : ratio >= 50 ? 'var(--warn)' : 'var(--down)'} stroke-width="7" stroke-dasharray=${`${(ratio / 100) * C} ${C}`} transform="rotate(-90 38 38)" stroke-linecap="round" />`}
        <text x="38" y="44" text-anchor="middle">${ratio == null ? '—' : ratio}</text></svg>
      <div><div style="font-weight:600">Say / do score</div>
        <div class="sub" style="font-size:13px;color:var(--muted)">${sc.judged ? `${sc.kept} kept · ${sc.close || 0} nearly · ${sc.missed} missed · ${sc.moved} moved, of ${sc.judged} promises now measurable` : 'No dated, numeric promise has come due yet'}${sc.ahead || sc.behind ? ` · in-flight: ${sc.ahead} ahead, ${sc.behind} behind` : ''}</div>
        <div class="chips" style="margin-top:6px">${Object.entries(countBy(claims)).map(([v, n]) => html`<span class="chip ${VERDICT[v][1]}">${n} ${VERDICT[v][0].toLowerCase()}</span>`)}</div></div>
    </div></div>
    <div class="pipeline">Read <b>${read.length} earnings calls</b> (${fmt(chars / 1000)}K chars) → kept <b>${fmt(kept / 1000, 1)}K</b> chars of forward-looking management sentences (${chars ? fmt(100 - (kept / chars) * 100) : 0}% cut before any model) → <b>${ledger.claims.length} promises</b> extracted by ${extractorLabel(ledger.extractor)} → <b>${ledger.claims.length}/${ledger.claims.length + (ledger.dropped || 0)}</b> quotes verified word-for-word → judged against reported results in code. ${ledger.cost?.llmCalls ? `${ledger.cost.llmCalls} model calls, ${fmt((ledger.cost.inTokens + ledger.cost.outTokens) / 1000, 1)}K tokens.` : '0 model calls at read time.'}${prov?.mode === 'precomputed' ? ' Precomputed.' : ''}</div>
    ${ledger.threads.filter((t) => t.claimIds.length > 1).map((t) => html`<${Thread} t=${t} byId=${byId} />`)}
    <div class="panel">${claims.map((c) => html`<${Claim} c=${c} />`)}${!claims.length && html`<div class="muted">No quantified guidance found in recent calls${ledger.extractor === 'heuristic' ? ' by the rule-based reader — add a Gemini key for a fuller read' : ''}.</div>`}</div>`;
}
const extractorLabel = (e) => ({ seed: 'build-time extraction', gemini: 'Gemini Flash-Lite', heuristic: 'FINN’s rule-based reader (no model)' })[e] || e;
const countBy = (cs) => cs.reduce((m, c) => ((m[c.verdict] = (m[c.verdict] || 0) + 1), m), {});

function Thread({ t, byId }) {
  const cs = t.claimIds.map((id) => byId[id]).filter(Boolean);
  const actual = cs.find((c) => c.actual?.value != null)?.actual;
  const vals = cs.flatMap((c) => [c.target.low, c.target.high ?? c.target.low]).concat(actual ? [actual.value] : []).filter((x) => x != null);
  const min = Math.min(...vals) * 0.95, max = Math.max(...vals) * 1.05;
  const W = 300, H = 56, n = cs.length + (actual ? 1 : 0);
  const x = (i) => 18 + (i / Math.max(1, n - 1)) * (W - 36);
  const y = (v) => H - 8 - ((v - min) / (max - min || 1)) * (H - 18);
  const down = cs.length > 1 && cs.at(-1).target.low < cs[0].target.low;
  return html`<div class="panel"><h4>${METRIC[t.metric]}${t.horizon ? ` · ${t.horizon}` : ''} <span>${t.undated ? `said ${cs.length}× with no deadline` : down ? 'the target moved' : `restated ${cs.length}×`}</span></h4>
    <div class="drift"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${cs.map((c, i) => html`<g><line x1=${x(i)} x2=${x(i)} y1=${y(c.target.high ?? c.target.low)} y2=${y(c.target.low)} stroke="var(--ink-2)" stroke-width="6" stroke-linecap="round" opacity="0.75" /><text x=${x(i)} y=${H - 0} text-anchor="middle" font-size="8" fill="var(--muted)">${(c.month || '').replace(' 20', " '")}</text></g>`)}
      ${cs.length > 1 && html`<polyline points=${cs.map((c, i) => `${x(i)},${y(c.target.low)}`).join(' ')} fill="none" stroke=${down ? 'var(--down)' : 'var(--muted)'} stroke-dasharray="3 3" />`}
      ${actual && html`<circle cx=${x(n - 1)} cy=${y(actual.value)} r="5" fill=${actual.value >= cs.at(-1).target.low ? 'var(--up)' : 'var(--down)'} /><text x=${x(n - 1)} y=${H - 0} text-anchor="middle" font-size="8" fill="var(--ink)">actual</text>`}
    </svg></div>
    <div class="sub" style="font-size:12.5px;color:var(--muted)">${cs.map((c) => `${c.month}: ${tgt(c.target)}`).join(' → ')}${actual ? ` → reported ${fmt(actual.value, 1)}${actual.unit === 'cr' ? ' cr' : '%'}` : ''}</div>
  </div>`;
}

function Claim({ c }) {
  const [v, toneC] = VERDICT[c.verdict] || [c.verdict, ''];
  const href = c.source ? `${c.source}${c.page ? `#page=${c.page}` : ''}` : null;
  return html`<div class="claim">
    <div class="head"><div><div class="what">${METRIC[c.metric] || c.metric}${c.horizon ? ` · ${c.horizon}` : ''}</div><div class="when">${c.madeIn}${c.speaker ? ` · ${c.speaker}` : ''}</div></div><span class="chip ${toneC}">${v}</span></div>
    <div class="vs"><div><div class="k">Promised</div><div class="v">${tgt(c.target)}</div></div>${c.actual?.value != null && html`<div><div class="k">${c.verdict === 'ahead' || c.verdict === 'behind' ? 'Tracking' : 'Delivered'}</div><div class="v ${['kept', 'ahead'].includes(c.verdict) ? 'up' : ['missed', 'moved', 'behind'].includes(c.verdict) ? 'down' : ''}">${c.actual.unit === 'cr' ? '₹' : ''}${fmt(c.actual.value, 1)}${c.actual.unit === 'cr' ? ' cr' : '%'}</div></div>`}${c.actual?.period && html`<div><div class="k">Basis</div><div class="v" style="font-family:var(--sans);font-size:12px">${c.actual.period}</div></div>`}</div>
    ${c.revisedTo && html`<div class="reason" style="color:var(--down)">Later restated to ${tgt({ ...c.target, low: c.revisedTo.low, high: c.revisedTo.high })}</div>`}
    <p class="quote">“${c.quote}”</p>
    ${href && html`<a class="receipt" href=${href} target="_blank" rel="noopener"><span class="ok-tick">✓</span> verified ${c.verified === 'fuzzy' ? '(≈)' : 'verbatim'} · transcript${c.page ? ` p.${c.page}` : ''}</a>`}
  </div>`;
}

function Synthesis({ syn }) {
  const facts = Object.fromEntries((syn.factSheet || []).map((f) => [f.id, f.text]));
  const Cite = ({ ids }) => html`${(ids || []).map((id) => html`<span class="cite" title=${facts[id] || id}>${id}</span>`)}`;
  return html`
    ${syn.narrativeVsNumbers?.length > 0 && html`<div class="panel">${syn.narrativeVsNumbers.map((p) => html`<div class="reason"><span class="chip ${p.stance === 'agrees' ? 'good' : p.stance === 'diverges' ? 'bad' : ''}" style="padding:3px 6px;margin-right:4px">${p.stance}</span>${p.point}<${Cite} ids=${p.cites} /></div>`)}</div>`}
    <div class="bb">
      <div class="col" style="border-color:color-mix(in srgb,var(--up) 40%,var(--hair))"><h5 class="up">Bull</h5><ul>${(syn.bull || []).map((p) => html`<li>${p.point}<${Cite} ids=${p.cites} /></li>`)}${!syn.bull?.length && html`<li class="muted">No clear bull point in the numbers.</li>`}</ul></div>
      <div class="col" style="border-color:color-mix(in srgb,var(--down) 40%,var(--hair))"><h5 class="down">Bear</h5><ul>${(syn.bear || []).map((p) => html`<li>${p.point}<${Cite} ids=${p.cites} /></li>`)}${!syn.bear?.length && html`<li class="muted">No clear bear point in the numbers.</li>`}</ul></div>
    </div>
    ${syn.askManagement?.length > 0 && html`<div class="panel" style="margin-top:8px"><h4>Ask management on the next call</h4><ol style="margin:0;padding-left:18px;font-size:14px">${syn.askManagement.map((q) => html`<li style="margin:4px 0">${q}</li>`)}</ol></div>`}
    <div class="receipt" style="display:block;margin-top:6px">${syn.engine === 'gemini' ? 'Written by Gemini from the numbered facts and ledger only; uncited points are dropped.' : 'Rule-based analyst: deterministic rules over the numbered facts. Add a Gemini key for the written version.'} Hover a tag (F3, C2) to see what it cites.</div>`;
}
