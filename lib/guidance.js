// Concall transcripts -> management guidance claims, each with a verbatim, page-cited quote.
//
// Pipeline (cheapest step first):
//   1. segment     : split transcript into speaker turns; tag management vs analyst vs moderator   (free)
//   2. prefilter   : keep only management sentences with a forward-looking cue AND a quantity     (free, ~85% cut)
//   3. extract     : heuristic parser (no key) or Gemini bulk model on the prefiltered windows    (cheap)
//   4. verify      : every quote must be found in the source text, else the claim is dropped      (free)
// The matcher in ledger.js then judges claims against reported numbers — code decides, not models.

import { pdfPages } from './pdf.js';
import { fiscalYear } from './fundamentals.js';

const FORWARD =
  /\b(expect|guid(e|ed|ing|ance)|target|aim|aspir|outlook|going forward|should (be|grow|see|reach|come|deliver|improve)|will (be|grow|see|achieve|reach|deliver|come|improve|cross|touch|add)|would (be|grow|like to see)|plan(ning)? to|confident|envisag|anticipat|estimat|next (year|quarter|fiscal|two|three|few)|by (the end of )?(fy|march|the end)|in (fy|h1|h2|the second half|the first half)|for (fy|the full year|the year|this year|the current year|next year)|over the (next|medium|coming)|medium[- ]term|full[- ]year|run[- ]rate|sustain)/i;
const QUANT =
  /(\d+(\.\d+)?\s*(%|percent|per cent|bps|basis points|crores?|cr\b|billion|bn\b|lakh|million|x\b|times|stores|mw|gw|mtpa|tonnes|tons|units)|₹\s?\d|rs\.?\s?\d|\b(double|high|mid|low|early)[- ](digit|single|teens|twenties)|\bteens\b)/i;

const MGMT_TITLE = /(managing director|\bmd\b|chief executive|ceo|chief financial|cfo|chairman|whole[- ]time director|executive director|president|head|coo|chief operating|vice[- ]president|director)/i;

/** Parse speaker turns. Returns [{speaker, role, text, page}] */
export function segment(pages) {
  const turns = [];
  const analysts = new Set();
  const management = new Set();
  // page 1 usually lists management: "MANAGEMENT: MR. ASHOK SONTHALIA – CHIEF FINANCIAL OFFICER"
  const head = pages.slice(0, 2).join('\n');
  const mgmtBlock = head.split(/moderator\s*:/i)[0];
  for (const m of mgmtBlock.matchAll(/(?:MR\.|MS\.|MRS\.|DR\.|SHRI)\s*([A-Z][A-Za-z.' ]{2,40}?)\s*[–—,-]+\s*([A-Za-z &,'-]{3,80})/g)) {
    if (MGMT_TITLE.test(m[2])) management.add(normName(m[1]));
  }
  const speakerRe = /^\s*([A-Z][A-Za-z.' ]{1,40}?)\s*:\s+(.*)$/;
  const flat = pages.join(' ').replace(/\s+/g, ' ');
  for (const m of flat.matchAll(/(?:question|questions|participant) (?:is |comes |will be )?(?:from|by) (?:the line of )?(?:Mr\.?|Ms\.?|Mrs\.?)?\s*([A-Z][A-Za-z.']+(?: [A-Z][A-Za-z.']+){0,3}) (?:from|of|with|at) /g)) {
    analysts.add(normName(m[1]));
  }
  let cur = null;
  pages.forEach((pg, pi) => {
    for (const line of pg.split('\n')) {
      const sm = line.match(speakerRe);
      if (sm && sm[1].split(' ').length <= 5 && !/^(page|note|disclaimer|www|http|sensitivity)$/i.test(sm[1].trim())) {
        cur = { speaker: sm[1].trim(), text: sm[2], page: pi + 1 };
        turns.push(cur);
      } else if (cur) {
        cur.text += ' ' + line.trim();
      }
    }
  });
  // first speakers after the moderator (opening remarks) are management
  const firstNonMod = turns.filter((t) => !/moderator|operator/i.test(t.speaker)).slice(0, 3);
  for (const t of firstNonMod) if (!analysts.has(normName(t.speaker))) management.add(normName(t.speaker));
  for (const t of turns) {
    const n = normName(t.speaker);
    t.role = /moderator|operator/i.test(t.speaker)
      ? 'moderator'
      : analysts.has(n)
        ? 'analyst'
        : management.has(n) || [...management].some((m) => m.endsWith(n) || n.endsWith(m))
          ? 'management'
          : 'unknown';
  }
  // unknown speakers who answer right after an analyst are management
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].role === 'unknown' && turns[i - 1].role === 'analyst') turns[i].role = 'management';
  }
  return turns;
}

function normName(s) {
  return s.toLowerCase().replace(/\b(mr|ms|mrs|dr|shri)\.?\s*/g, '').replace(/[^a-z ]/g, '').trim();
}

export function sentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+(?=[A-Z₹"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 600);
}

/** Step 2: cheap, deterministic narrowing to guidance-shaped sentences (with 1 sentence of context). */
export function prefilter(turns, { maxChars = 9000, broad = false } = {}) {
  const out = [];
  const METRIC_WORD = /(revenue|growth|margin|ebitda|pat|profit|capex|volume|guidance|aum|loan|credit cost|roe|roa|roce|store|capacity|utili[sz]ation|debt|order book)/i;
  for (const t of turns) {
    if (t.role !== 'management') continue;
    const ss = sentences(t.text);
    ss.forEach((s, k) => {
      if (broad) {
        // LLM path: wider net (forward cue + metric word, or quantity + metric word); the model does the precision work
        if ((FORWARD.test(s) && METRIC_WORD.test(s)) || (QUANT.test(s) && METRIC_WORD.test(s) && /\b(will|expect|guid|target|should|aim|plan|next|going forward|fy ?\d\d)/i.test(s))) {
          out.push({ speaker: t.speaker, page: t.page, text: s, context: ss[k - 1] || '' });
        }
        return;
      }
      const past = /\b(increased|grew|declined|decreased|was|were|reported|delivered|achieved|stood|closed|registered|recorded|posted|came in)\b/i.test(s);
      const fwdVerb = /\b(expect|guid|target|will|should|aim|plan|aspir|outlook|going forward|envisag|anticipat|confident|would)/i.test(s);
      if (FORWARD.test(s) && QUANT.test(s) && (!past || fwdVerb)) {
        out.push({ speaker: t.speaker, page: t.page, text: s, context: ss[k - 1] || '' });
      }
    });
  }
  // keep within a budget, preferring sentences that mention a headline metric
  const pri = (x) => (/(revenue|growth|margin|ebitda|pat|profit|capex|volume|guidance|aum|loan|credit cost|roe|roa|store)/i.test(x.text) ? 0 : 1);
  out.sort((a, b) => pri(a) - pri(b));
  const kept = [];
  let n = 0;
  for (const o of out) {
    if (n + o.text.length > maxChars) break;
    kept.push(o);
    n += o.text.length;
  }
  return kept.sort((a, b) => a.page - b.page);
}

const METRICS = [
  ['ebitda_margin', /(ebitda|ebit|operating|op\.?)\s*(margin|margins)|margins? (of|at|in the range|band|around|between)|\bmargin\b/i],
  ['revenue_growth', /(revenue|top ?line|sales|turnover|income from operations|business)\b.{0,60}\b(grow|growth)|\bgrow(th)?\b.{0,40}\b(revenue|top ?line|sales)|\b(top ?line|revenue) (growth|guidance)/i],
  ['aum_growth', /(aum|assets under management|loan book|advances|disbursement|book)\b.{0,50}\bgrow|\bgrow.{0,30}\b(aum|loan book|advances|book)/i],
  ['credit_cost', /credit cost/i],
  ['volume_growth', /\bvolume/i],
  ['ebitda_abs', /\bebitda\b/i],
  ['pat', /\b(pat|net profit|bottom ?line|profit after tax|earnings)\b/i],
  ['capex', /\bcapex|capital expenditure|invest(ing|ment)? (of|around|about)/i],
  ['roce', /\b(roce|roe|return on (capital|equity))\b/i],
  ['debt', /\b(net debt|debt|leverage|borrowing)/i],
  ['stores', /\bstores?\b|\boutlets?\b|\bbranches\b/i],
  ['revenue_growth', /\bgrow(th)?\b/i],
];

const WORD_RANGES = {
  'low single': [1, 4], 'mid single': [4, 6], 'high single': [7, 9], 'double digit': [10, null],
  'early teens': [11, 13], 'low teens': [11, 13], 'mid teens': [14, 16], 'high teens': [17, 19], teens: [12, 18],
  'low twenties': [20, 23], 'mid twenties': [24, 26], 'high twenties': [27, 29],
};

/** Pull a numeric target out of a sentence: {low, high, unit} */
export function parseTarget(s, metric) {
  if (metric && /^(ebitda_abs|capex|pat|debt)$/.test(metric)) {
    const cr = parseCrore(s);
    if (cr) return cr;
  }
  const t = s.replace(/–|—/g, '-').replace(/\bper cent\b|\bpercent\b/gi, '%');
  let m = t.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*%/);
  if (m) return { low: +m[1], high: +m[2], unit: '%' };
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(bps|basis points)/i);
  if (m) return { low: +m[1], high: +m[2], unit: 'bps' };
  m = t.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:crores?|cr\.?)?\s*(?:-|to)\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)(?:-odd)?\s*(crores?|cr\b)/i);
  if (m) return { low: +m[1].replace(/,/g, ''), high: +m[2].replace(/,/g, ''), unit: 'cr' };
  m = t.match(/(\d+(?:\.\d+)?)\s*%\s*(plus|\+)?/);
  if (m) return { low: +m[1], high: m[2] ? null : +m[1], unit: '%' };
  m = t.match(/(\d+(?:\.\d+)?)\s*(bps|basis points)/i);
  if (m) return { low: +m[1], high: +m[1], unit: 'bps' };
  m = t.match(/(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b)?|(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b)/i);
  if (m) {
    const v = +(m[1] || m[3]).replace(/,/g, '');
    return { low: v, high: v, unit: 'cr' };
  }
  for (const [w, [lo, hi]] of Object.entries(WORD_RANGES)) {
    if (new RegExp(`\\b${w.replace(' ', '[- ]')}`, 'i').test(t)) return { low: lo, high: hi, unit: '%', approx: true };
  }
  return null;
}

function parseCrore(s) {
  const t = s.replace(/–|—/g, '-');
  let m = t.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:crores?|cr\.?)?\s*(?:-|to)\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)(?:-odd)?\s*(crores?|cr\b)/i);
  if (m) return { low: +m[1].replace(/,/g, ''), high: +m[2].replace(/,/g, ''), unit: 'cr' };
  m = t.match(/(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b)?|(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b)/i);
  if (m) {
    const v = +(m[1] || m[3]).replace(/,/g, '');
    return { low: v, high: v, unit: 'cr' };
  }
  return null;
}

/** Resolve "FY27", "this year", "next year", "H2" relative to the call date. */
export function parseHorizon(s, callDate) {
  const cur = fiscalYear(callDate);
  const curN = Number(cur.slice(2));
  let m = s.match(/\b(h[12])\s*(?:of\s*)?fy\s*'?(\d{2,4})\b/i);
  if (m) return `${m[1].toUpperCase()} FY${m[2].slice(-2)}`;
  m = s.match(/\bfy\s*'?(\d{2,4})\b/i) || s.match(/\bfiscal (?:year )?(?:20)?(\d{2})\b/i);
  if (m) return `FY${m[1].slice(-2)}`;
  if (/\bnext (year|fiscal|financial year)\b/i.test(s)) return `FY${curN + 1}`;
  if (/\b(this|current|full|the) (year|fiscal|financial year)\b|\bfull[- ]year\b|\bfor the year\b/i.test(s)) return cur;
  if (/\b(second half|h2)\b/i.test(s)) return `H2 ${cur}`;
  if (/\b(next|coming) (two|2) years\b/i.test(s)) return `FY${curN + 2}`;
  if (/\b(next|coming) (three|3) years\b|medium[- ]term/i.test(s)) return `FY${curN + 3}`;
  if (/\b(next|coming) (quarter)\b/i.test(s)) return 'next quarter';
  return null;
}

export function metricOf(s) {
  for (const [k, re] of METRICS) if (re.test(s)) return k;
  return 'other';
}

/** Step 3 (no-key path): deterministic claim extraction from prefiltered sentences. */
export function heuristicClaims(windows, meta) {
  const claims = [];
  for (const w of windows) {
    const metric = metricOf(w.text);
    if (metric === 'other') continue;
    const target = parseTarget(w.text, metric);
    if (!target) continue;
    // a growth/margin claim expressed in crores is really an absolute claim
    const m2 = target.unit === 'cr' && /growth|margin/.test(metric) ? (/margin|ebitda/.test(w.text.toLowerCase()) ? 'ebitda_abs' : 'revenue_abs') : metric;
    const horizon = parseHorizon(w.text, meta.callDate) || parseHorizon(w.context, meta.callDate);
    claims.push({
      metric: m2,
      target,
      horizon,
      quote: w.text,
      speaker: w.speaker,
      page: w.page,
      confidence: horizon ? 0.6 : 0.4,
      extractor: 'heuristic',
    });
  }
  return dedupe(claims);
}

function dedupe(claims) {
  const seen = new Set();
  return claims.filter((c) => {
    const k = `${c.metric}|${c.horizon}|${c.target?.low}|${c.target?.high}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Step 4: the receipt check. Exact (normalised) substring, else ≥90% token-window overlap. */
export function verifyQuote(quote, fullText) {
  const q = norm(quote);
  const T = norm(fullText);
  if (!q) return { ok: false };
  if (T.includes(q)) return { ok: true, mode: 'exact' };
  const qt = q.split(' ');
  if (qt.length < 6) return { ok: false };
  const tt = T.split(' ');
  const need = Math.ceil(qt.length * 0.9);
  const qset = new Map();
  for (const w of qt) qset.set(w, (qset.get(w) || 0) + 1);
  for (let i = 0; i + qt.length <= tt.length; i += Math.max(1, Math.floor(qt.length / 4))) {
    const win = new Map();
    for (const w of tt.slice(i, i + qt.length + 4)) win.set(w, (win.get(w) || 0) + 1);
    let hit = 0;
    for (const [w, c] of qset) hit += Math.min(c, win.get(w) || 0);
    if (hit >= need) return { ok: true, mode: 'fuzzy' };
  }
  return { ok: false };
}

/** Month label from screener ("Nov 2026") -> approximate call date (15th). */
export function callDateFromMonth(month) {
  const d = new Date(`15 ${month} UTC`);
  return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

/** Fetch + segment + prefilter one transcript. */
export async function loadTranscript(url, month) {
  const pages = await pdfPages(url, { maxPages: 60 });
  const turns = segment(pages);
  const windows = prefilter(turns);
  const callDate = callDateFromMonth(month);
  return {
    url,
    month,
    callDate,
    quarterLabel: callLabel(callDate),
    pages: pages.length,
    chars: pages.join('').length,
    fullText: pages.join('\n'),
    pageTexts: pages,
    turns: turns.length,
    managementTurns: turns.filter((t) => t.role === 'management').length,
    windows,
    windowChars: windows.reduce((s, w) => s + w.text.length, 0),
    broadWindows: prefilter(turns, { broad: true, maxChars: 14000 }),
  };
}

/** A call in Nov 2026 discusses Q2 FY27 (quarter ended Sep 2026). */
export function callLabel(callDate) {
  if (!callDate) return null;
  const d = new Date(callDate);
  // results are discussed 0-2 months after quarter end
  const qEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const m = qEnd.getUTCMonth(); // 0..11
  const qEndMonth = [2, 5, 8, 11].reduce((best, x) => (x <= m ? x : best), -1);
  const endDate = qEndMonth === -1 ? new Date(Date.UTC(qEnd.getUTCFullYear() - 1, 11, 31)) : new Date(Date.UTC(qEnd.getUTCFullYear(), qEndMonth, 28));
  const fy = fiscalYear(endDate);
  const qn = { 5: 1, 8: 2, 11: 3, 2: 4 }[endDate.getUTCMonth()];
  return `Q${qn} ${fy}`;
}

/** Locate the page a verified quote lives on (for the receipt link). */
export function pageOf(quote, pageTexts) {
  const q = norm(quote).split(' ').slice(0, 8).join(' ');
  const i = pageTexts.findIndex((p) => norm(p).includes(q));
  return i >= 0 ? i + 1 : null;
}
