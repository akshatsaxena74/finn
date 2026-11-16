// Pull: on-demand research for ANY NSE ticker, grounded only in primary sources
// (exchange-filed results via screener's standardised tables, concall transcripts, annual reports).
// Three stages so the phone renders progressively and no serverless call runs long:
//   facts      ~1-2s   screener page -> deterministic numbers
//   ledger     ~5-25s  transcripts -> guidance claims (Gemini | seed | heuristic) -> verified -> judged
//   synthesis  ~2-15s  narrative-vs-numbers, bull/bear, questions (Gemini | rule-based analyst)

import { fetchCompany } from './screener.js';
import { dossierFacts, actualsIndex, fiscalYear } from './fundamentals.js';
import { loadTranscript, heuristicClaims, verifyQuote, pageOf } from './guidance.js';
import { judge } from './ledger.js';
import { llmEnabled, extractGuidance, synthesise, usage } from './llm.js';
import { cacheGet, cacheSet } from './cache.js';

export async function researchFacts(symbol) {
  const sym = symbol.toUpperCase().replace(/\.NS$|\.BO$/, '');
  const key = `facts:${sym}`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const c = await fetchCompany(sym);
  const out = { symbol: sym, name: c.name, facts: dossierFacts(c), actuals: actualsIndex(c), concalls: c.documents.concalls, fetchedAt: c.fetchedAt };
  await cacheSet(key, out, 60 * 60 * 6);
  return out;
}

/**
 * @param {object} base   output of researchFacts
 * @param {object} opts   { seedClaims?: Array, maxTranscripts?: number, asOf?: Date }
 */
export async function researchLedger(base, { seedClaims = null, maxTranscripts = 4, asOf = new Date() } = {}) {
  const calls = base.concalls.filter((c) => c.transcript).slice(0, maxTranscripts);
  const t0 = Date.now();
  const before = { ...usage };
  const transcripts = (await Promise.allSettled(calls.map((c) => loadTranscript(c.transcript, c.month)))).map((r, i) => (r.status === 'fulfilled' ? r.value : { url: calls[i].transcript, month: calls[i].month, error: String(r.reason?.message || r.reason) }));
  const ok = transcripts.filter((t) => !t.error);

  let extractor = 'heuristic';
  let raw = [];
  if (seedClaims?.length) {
    extractor = 'seed';
    raw = seedClaims.map((c) => ({ ...c, extractor: c.extractor || 'seed' }));
  } else if (llmEnabled()) {
    extractor = 'gemini';
    const per = await Promise.allSettled(
      ok.map((t) =>
        extractGuidance(t.broadWindows, { company: base.name, month: t.month, quarterLabel: t.quarterLabel, fy: fiscalYear(t.callDate) }).then((cs) => cs.map((c) => ({ ...c, month: t.month }))),
      ),
    );
    raw = per.flatMap((p) => (p.status === 'fulfilled' ? p.value : []));
    if (!raw.length) extractor = 'heuristic'; // model failed/quota: degrade, don't die
  }
  if (extractor === 'heuristic') {
    raw = ok.flatMap((t) => heuristicClaims(t.windows, t).map((c) => ({ ...c, month: t.month })));
  }

  // receipt check: a claim survives only if its quote is in the transcript it claims to come from
  const byMonth = Object.fromEntries(ok.map((t) => [t.month, t]));
  const verified = [];
  let dropped = 0;
  for (const c of raw) {
    const t = byMonth[c.month] || ok.find((x) => verifyQuote(c.quote, x.fullText).ok);
    const v = t ? verifyQuote(c.quote, t.fullText) : { ok: false };
    if (!v.ok) {
      dropped++;
      continue;
    }
    verified.push({
      ...c,
      month: t.month,
      madeIn: t.quarterLabel ? `${t.quarterLabel} call (${t.month})` : t.month,
      madeOn: t.callDate,
      source: t.url,
      page: c.page || pageOf(c.quote, t.pageTexts),
      verified: v.mode,
    });
  }
  verified.forEach((c, i) => (c.id = `C${i + 1}`));
  const judged = judge(verified, base.actuals, asOf);
  return {
    extractor,
    transcripts: transcripts.map((t) => ({ month: t.month, quarterLabel: t.quarterLabel, url: t.url, pages: t.pages, chars: t.chars, windowChars: t.windowChars, broadChars: t.broadWindows?.reduce((s, w) => s + w.text.length, 0), error: t.error })),
    claims: judged.claims,
    threads: judged.threads,
    score: judged.score,
    dropped,
    cost: { ms: Date.now() - t0, llmCalls: usage.calls - before.calls, inTokens: usage.inTokens - before.inTokens, outTokens: usage.outTokens - before.outTokens, cacheHits: usage.cacheHits - before.cacheHits },
  };
}

// ------------------------------------------------------------------ synthesis
const lastV = (s) => (s?.length ? s[s.length - 1] : null);
const nAgo = (s, n) => (s?.length > n ? s[s.length - 1 - n] : s?.[0] || null);
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }));

/** Numbered fact sheet: the only thing the synthesis step (model or rules) may cite. */
export function factSheet(f) {
  const F = [];
  const add = (id, text, data) => F.push({ id, text, data });
  const g = f.trajectory.growth || {};
  const sales = g['Compounded Sales Growth'] || {};
  const profit = g['Compounded Profit Growth'] || {};
  if (sales['3 Years'] != null) add('F1', `Revenue CAGR: ${fmt(sales['5 Years'])}% (5y), ${fmt(sales['3 Years'])}% (3y), ${fmt(sales.TTM)}% (TTM)`, sales);
  if (profit['3 Years'] != null) add('F2', `Profit CAGR: ${fmt(profit['5 Years'])}% (5y), ${fmt(profit['3 Years'])}% (3y), ${fmt(profit.TTM)}% (TTM)`, profit);
  const opm = f.trajectory.opm;
  if (opm?.length >= 4) add('F3', `EBITDA margin ${fmt(lastV(opm).value, 1)}% in ${lastV(opm).period} vs ${fmt(nAgo(opm, 3).value, 1)}% in ${nAgo(opm, 3).period}`, { now: lastV(opm), then: nAgo(opm, 3) });
  const roce = f.balanceSheet.roce;
  if (roce?.length >= 3) add('F4', `ROCE ${fmt(lastV(roce).value)}% (${lastV(roce).period}) vs ${fmt(nAgo(roce, 3).value)}% (${nAgo(roce, 3).period})`, { now: lastV(roce), then: nAgo(roce, 3) });
  const de = f.balanceSheet.debtToEquity;
  if (de?.length >= 3) add('F5', `Debt/Equity ${fmt(lastV(de).value, 2)} (${lastV(de).period}) vs ${fmt(nAgo(de, 3).value, 2)} (${nAgo(de, 3).period}); borrowings ₹${fmt(lastV(f.balanceSheet.borrowings)?.value)} cr`, { now: lastV(de), then: nAgo(de, 3) });
  const ccc = f.balanceSheet.workingCapital.cashConversionCycle;
  if (ccc?.length >= 3) add('F6', `Cash conversion cycle ${fmt(lastV(ccc).value)} days (${lastV(ccc).period}) vs ${fmt(nAgo(ccc, 3).value)} days (${nAgo(ccc, 3).period})`, { now: lastV(ccc), then: nAgo(ccc, 3) });
  if (f.cash.conversion) add('F7', `Cash from operations was ${fmt(f.cash.conversion.ratio)}% of PAT over the last ${f.cash.conversion.years} years (₹${fmt(f.cash.conversion.cfo)} cr vs ₹${fmt(f.cash.conversion.pat)} cr)`, f.cash.conversion);
  const fcf = f.cash.fcf?.slice(-5) || [];
  if (fcf.length >= 3) add('F8', `Free cash flow negative in ${fcf.filter((x) => x.value < 0).length} of the last ${fcf.length} years; latest ₹${fmt(lastV(fcf).value)} cr (${lastV(fcf).period})`, fcf);
  const pr = f.ownership?.promoters;
  if (pr?.length >= 4) add('F9', `Promoter holding ${fmt(lastV(pr).value, 2)}% (${lastV(pr).period}) vs ${fmt(nAgo(pr, 4).value, 2)}% (${nAgo(pr, 4).period})`, { now: lastV(pr), then: nAgo(pr, 4) });
  const q = f.latestQuarter;
  if (q) {
    const r = Object.fromEntries(q.rows.map((x) => [x.key, x]));
    add('F10', `${q.period}: revenue ₹${fmt(r.revenue?.value)} cr (${fmt(r.revenue?.yoy, 1)}% YoY), PAT ₹${fmt(r.pat?.value)} cr (${fmt(r.pat?.yoy, 1)}% YoY), EBITDA margin ${fmt(q.margins.ebitda.cur, 1)}% vs ${fmt(q.margins.ebitda.yago, 1)}% a year ago`, q);
    if (q.otherIncomeShareOfPbt != null) add('F12', `Other income is ${fmt(q.otherIncomeShareOfPbt)}% of PBT in ${q.period}`, q.otherIncomeShareOfPbt);
  }
  if (f.snapshot.pe != null) add('F11', `P/E ${fmt(f.snapshot.pe, 1)}; market cap ₹${fmt(f.snapshot.marketCapCr)} cr`, f.snapshot);
  return F;
}

/** Deterministic "rule-based analyst": used without a key, and as the guard-rail baseline with one. */
export function ruleSynthesis(f, ledger) {
  const F = Object.fromEntries(factSheet(f).map((x) => [x.id, x]));
  const bull = [];
  const bear = [];
  const nvn = [];
  const ask = [];
  const s3 = F.F1?.data?.['3 Years'];
  if (s3 != null) (s3 >= 15 ? bull : s3 < 8 ? bear : null)?.push({ point: s3 >= 15 ? `Revenue has compounded ${s3}% a year over 3 years.` : `Revenue growth is slow: ${s3}% a year over 3 years.`, cites: ['F1'] });
  if (F.F3) {
    const d = F.F3.data.now.value - F.F3.data.then.value;
    if (d >= 2) bull.push({ point: `Margins expanded ${d.toFixed(1)} pts to ${F.F3.data.now.value}% since ${F.F3.data.then.period}.`, cites: ['F3'] });
    if (d <= -2) bear.push({ point: `Margins compressed ${Math.abs(d).toFixed(1)} pts to ${F.F3.data.now.value}% since ${F.F3.data.then.period}.`, cites: ['F3'] });
  }
  if (F.F4?.data.now.value >= 18) bull.push({ point: `ROCE of ${F.F4.data.now.value}% — the business earns well above its cost of capital.`, cites: ['F4'] });
  if (F.F4 && F.F4.data.now.value < 12) bear.push({ point: `ROCE is ${F.F4.data.now.value}%, thin for the capital it consumes.`, cites: ['F4'] });
  if (F.F5 && !f.snapshot.isFinancial) {
    if (F.F5.data.now.value > 1 || F.F5.data.now.value - F.F5.data.then.value > 0.3) bear.push({ point: `Leverage up: debt/equity ${F.F5.data.then.value} → ${F.F5.data.now.value}.`, cites: ['F5'] });
    else if (F.F5.data.now.value < 0.3) bull.push({ point: `Balance sheet is light: debt/equity ${F.F5.data.now.value}.`, cites: ['F5'] });
  }
  if (F.F6 && !f.snapshot.isFinancial) {
    const d = F.F6.data.now.value - F.F6.data.then.value;
    if (d > 20) bear.push({ point: `Working capital is stretching: cash cycle up ${d} days to ${F.F6.data.now.value}.`, cites: ['F6'] });
    if (d < -20) bull.push({ point: `Cash cycle tightened by ${Math.abs(d)} days to ${F.F6.data.now.value}.`, cites: ['F6'] });
  }
  if (F.F7 && !f.snapshot.isFinancial) {
    if (F.F7.data.ratio >= 90) bull.push({ point: `Profits are real: ${F.F7.data.ratio}% of PAT arrived as operating cash over ${F.F7.data.years} years.`, cites: ['F7'] });
    if (F.F7.data.ratio < 70) bear.push({ point: `Only ${F.F7.data.ratio}% of reported profit turned into operating cash over ${F.F7.data.years} years.`, cites: ['F7'] });
  }
  if (F.F8 && F.F8.data.filter((x) => x.value < 0).length >= 3) bear.push({ point: F.F8.text + '.', cites: ['F8'] });
  if (F.F9) {
    const d = F.F9.data.now.value - F.F9.data.then.value;
    if (d <= -2) bear.push({ point: `Promoters have sold down ${Math.abs(d).toFixed(1)} pts in a year.`, cites: ['F9'] });
  }
  if (F.F12?.data > 25) bear.push({ point: `${F.F12.data}% of pre-tax profit is other income, not operations.`, cites: ['F12'] });
  if (F.F11 && f.snapshot.pe > 60 && (s3 ?? 0) < 20) bear.push({ point: `Valuation (P/E ${f.snapshot.pe}) assumes growth the last 3 years haven't shown.`, cites: ['F11', 'F1'] });

  // narrative vs numbers from the ledger
  const cl = ledger?.claims || [];
  const sc = ledger?.score;
  for (const c of cl.filter((c) => ['missed', 'moved', 'behind'].includes(c.verdict)).slice(0, 4)) {
    const tgt = `${c.target.low}${c.target.high && c.target.high !== c.target.low ? '–' + c.target.high : ''}${c.target.unit === 'cr' ? ' cr' : c.target.unit}`;
    const act = c.actual?.value != null ? `${fmt(c.actual.value, 1)}${c.actual.unit === 'cr' ? ' cr' : '%'} (${c.actual.period})` : 'n/a';
    nvn.push({
      point: c.verdict === 'moved'
        ? `${label(c.metric)} for ${c.horizon}: guided ${tgt} on the ${c.madeIn}, later cut to ${c.revisedTo.low}${c.revisedTo.high && c.revisedTo.high !== c.revisedTo.low ? '–' + c.revisedTo.high : ''}${c.target.unit === 'cr' ? ' cr' : c.target.unit}.`
        : `${label(c.metric)} for ${c.horizon}: guided ${tgt}; ${c.verdict === 'behind' ? 'tracking' : 'delivered'} ${act}.`,
      stance: 'diverges',
      cites: [c.id, ...(c.revisedTo ? [c.revisedTo.claimId] : [])],
    });
    ask.push(c.verdict === 'moved' ? `What changed between the ${c.madeIn} and the revision to your ${c.horizon} ${label(c.metric).toLowerCase()} guidance?` : `${label(c.metric)} is ${act} against your ${tgt} guide for ${c.horizon} — what has to go right to close the gap?`);
  }
  for (const c of cl.filter((c) => ['kept', 'ahead'].includes(c.verdict)).slice(0, 3)) {
    nvn.push({ point: `${label(c.metric)} for ${c.horizon}: guided ${c.target.low}${c.target.unit === 'cr' ? ' cr' : c.target.unit}; ${c.verdict === 'ahead' ? 'tracking' : 'delivered'} ${fmt(c.actual?.value, 1)}${c.actual?.unit === 'cr' ? ' cr' : '%'}.`, stance: 'agrees', cites: [c.id] });
  }
  if (sc?.judged >= 2) (sc.ratio >= 70 ? bull : sc.ratio < 50 ? bear : nvn).push({ point: `Management kept ${sc.kept} of ${sc.judged} measurable promises${sc.moved ? ` and moved the goalposts ${sc.moved} time${sc.moved > 1 ? 's' : ''}` : ''}.`, cites: cl.filter((c) => ['kept', 'missed', 'moved', 'close'].includes(c.verdict)).map((c) => c.id).slice(0, 6), stance: 'unclear' });
  if (F.F6 && !f.snapshot.isFinancial && F.F6.data.now.value - F.F6.data.then.value > 20) ask.push(`The cash cycle has gone from ${F.F6.data.then.value} to ${F.F6.data.now.value} days — is that a choice or a symptom?`);
  if (F.F7 && F.F7.data.ratio < 70) ask.push(`Why has operating cash flow trailed reported profit (${F.F7.data.ratio}% conversion over ${F.F7.data.years} years)?`);

  const verdict = sc?.judged
    ? sc.ratio >= 70 ? `Management has largely done what it said (${sc.kept}/${sc.judged} measurable promises kept).` : sc.ratio >= 50 ? `A mixed record: ${sc.kept} of ${sc.judged} measurable promises kept.` : `Treat guidance with a discount: ${sc.kept} of ${sc.judged} measurable promises kept${sc.moved ? `, ${sc.moved} quietly revised` : ''}.`
    : 'Not enough dated, quantified guidance in recent calls to score management yet.';
  return { verdict, narrativeVsNumbers: nvn, bull: bull.slice(0, 4), bear: bear.slice(0, 4), askManagement: ask.slice(0, 3), engine: 'rules' };
}

export const label = (m) => ({ revenue_growth: 'Revenue growth', revenue_abs: 'Revenue', ebitda_margin: 'EBITDA margin', ebitda_abs: 'EBITDA', pat: 'PAT', capex: 'Capex', volume_growth: 'Volume growth', aum_growth: 'AUM growth', credit_cost: 'Credit cost', roce: 'Return ratio', debt: 'Debt', stores: 'Store count', other: 'Other' })[m] || m;

export async function researchSynthesis(base, ledger) {
  const rules = ruleSynthesis(base.facts, ledger);
  if (!llmEnabled()) return { ...rules, factSheet: factSheet(base.facts) };
  try {
    const fs = factSheet(base.facts);
    const out = await synthesise({ company: base.name, facts: base.facts, ledger: ledger.claims, factSheet: fs.map((x) => `${x.id}: ${x.text}`).join('\n') });
    // guard-rail: drop any point that cites an id we never supplied
    const ids = new Set([...fs.map((x) => x.id), ...ledger.claims.map((c) => c.id)]);
    const keep = (arr) => (arr || []).filter((p) => (p.cites || []).length && p.cites.every((c) => ids.has(c)));
    return { verdict: out.verdict, narrativeVsNumbers: keep(out.narrativeVsNumbers), bull: keep(out.bull), bear: keep(out.bear), askManagement: out.askManagement || [], engine: 'gemini', factSheet: fs };
  } catch (e) {
    return { ...rules, factSheet: factSheet(base.facts), note: 'Model unavailable — rule-based analyst used.' };
  }
}
