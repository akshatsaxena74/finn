// Model router. FINN works with NO key (rules + heuristics + cached seeds); a GEMINI_API_KEY upgrades
// the reading steps. Models only ever *read and phrase*; numbers and verdicts are computed in code.
//
//   tier   default model            used for                                         why
//   fast   gemini-3.5-flash-lite    guidance extraction from prefiltered transcript   bulk, structured, cheapest; free tier
//   std    gemini-3.5-flash         filing classification + one-liners, bio extract   needs judgment on messy PDFs
//   deep   gemini-3.5-flash (+thinking budget)  narrative-vs-numbers, bull/bear      the only step that "reasons"
//
// Every call: JSON-schema-constrained output, temperature ≤0.2, response cached by hash(model+prompt).

import crypto from 'node:crypto';
import { cacheGet, cacheSet } from './cache.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const MODELS = {
  fast: () => process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash-lite',
  std: () => process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  deep: () => process.env.GEMINI_MODEL_DEEP || 'gemini-3.5-flash',
};
export const llmEnabled = () => !!process.env.GEMINI_API_KEY;

export const usage = { calls: 0, cacheHits: 0, inTokens: 0, outTokens: 0, errors: 0 };

async function gemini({ tier = 'std', system, prompt, schema, temperature = 0.1, maxTokens = 4096, thinking = 0, timeoutMs = 45000 }) {
  if (!llmEnabled()) throw Object.assign(new Error('GEMINI_API_KEY not set'), { code: 'NO_KEY' });
  const model = MODELS[tier]();
  const key = 'llm:' + crypto.createHash('sha1').update(`${model}|${system}|${prompt}|${JSON.stringify(schema)}`).digest('hex');
  const hit = await cacheGet(key);
  if (hit) {
    usage.cacheHits++;
    return hit;
  }
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
      ...(/flash-lite/.test(model) ? {} : { thinkingConfig: { thinkingBudget: thinking } }),
    },
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Retry briefly on "busy" (429/503): Gemini returns these in demand spikes.
    let res, j;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      j = await res.json();
      if (res.status !== 503 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${j?.error?.message || 'error'}`);
    usage.calls++;
    usage.inTokens += j.usageMetadata?.promptTokenCount || 0;
    usage.outTokens += j.usageMetadata?.candidatesTokenCount || 0;
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const parsed = JSON.parse(text);
    await cacheSet(key, parsed, 60 * 60 * 24 * 14);
    return parsed;
  } catch (e) {
    usage.errors++;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const S = (type, extra = {}) => ({ type, ...extra });
const STR = S('STRING');
const NUM = S('NUMBER', { nullable: true });

// ---------------------------------------------------------------- filings
const CATEGORIES = ['results', 'M&A', 'fund_raise', 'management_change', 'litigation', 'insider_trading', 'earnings_call', 'investor_meetings', 'credit_rating', 'dividend', 'bonus_split', 'capex', 'press_release', 'postal_ballot', 'agm_egm', 'pledging', 'unclassified'];

/** One batched call for N filings: category check + a one-line "why it matters" + materiality. */
export async function summariseFilings(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 12) {
    const batch = items.slice(i, i + 12);
    const prompt = batch
      .map((f) => `### id=${f.id}\ncompany: ${f.company}\nsubject: ${f.subject || f.title}\ntext: ${(f.body || f.note || '').slice(0, 1600)}`)
      .join('\n\n');
    try {
      const r = await gemini({
        tier: 'std',
        system:
          'You triage Indian stock-exchange filings for a portfolio manager. For each filing, write ONE line (max 22 words) saying what happened and the number that matters, using only the filing text. No adjectives, no advice, no outside knowledge. If the filing is routine paperwork, say so in under 8 words.',
        prompt,
        schema: S('ARRAY', {
          items: S('OBJECT', {
            properties: { id: STR, category: S('STRING', { enum: CATEGORIES }), oneLiner: STR, materiality: S('INTEGER') },
            required: ['id', 'category', 'oneLiner', 'materiality'],
          }),
        }),
      });
      for (const x of r) out[x.id] = x.oneLiner;
    } catch (e) {
      // fall back silently: the UI shows the exchange subject (and screener's note, attributed)
    }
  }
  return out;
}

/** Management-change filing -> structured people (incoming / outgoing) with the profile text quoted. */
export async function extractPeople(filing) {
  return gemini({
    tier: 'std',
    system:
      'Extract people whose roles change in this Indian listed-company filing. Use ONLY the filing text. For each person give name, new or old role, action (appointed|resigned|retired|re-appointed|ceased|redesignated), effective date (ISO or null), and their career history and education exactly as the filing states them (often under "Brief profile"). Include a verbatim profileQuote (≤60 words) copied from the filing.',
    prompt: `Company: ${filing.company}\nSubject: ${filing.subject}\n\n${(filing.body || '').slice(0, 6000)}`,
    schema: S('ARRAY', {
      items: S('OBJECT', {
        properties: {
          name: STR, role: STR, action: STR, effective: S('STRING', { nullable: true }),
          career: S('ARRAY', { items: S('OBJECT', { properties: { org: STR, title: S('STRING', { nullable: true }), from: S('INTEGER', { nullable: true }), to: S('INTEGER', { nullable: true }) }, required: ['org'] }) }),
          education: S('ARRAY', { items: S('OBJECT', { properties: { institution: STR, degree: S('STRING', { nullable: true }), year: S('INTEGER', { nullable: true }) }, required: ['institution'] }) }),
          profileQuote: STR,
        },
        required: ['name', 'role', 'action', 'career', 'education', 'profileQuote'],
      }),
    }),
  });
}

// ---------------------------------------------------------------- guidance
const METRIC_ENUM = ['revenue_growth', 'revenue_abs', 'ebitda_margin', 'ebitda_abs', 'pat', 'capex', 'volume_growth', 'aum_growth', 'credit_cost', 'roce', 'debt', 'stores', 'other'];

/** Bulk tier: prefiltered management sentences from ONE transcript -> forward-looking numeric claims. */
export async function extractGuidance(windows, meta) {
  const text = windows.map((w, i) => `[${i}] (p${w.page}, ${w.speaker}) ${w.context ? '…' + w.context.slice(-160) + ' ' : ''}${w.text}`).join('\n');
  const r = await gemini({
    tier: 'fast',
    maxTokens: 3000,
    system:
      `You extract MANAGEMENT GUIDANCE from an earnings-call transcript of ${meta.company} (call: ${meta.month}, discussing ${meta.quarterLabel}). ` +
      'A claim is a forward-looking, quantified statement by management about the company\'s own future numbers (growth, margin, EBITDA, PAT, capex, volumes, AUM, credit cost, store count, debt). ' +
      'EXCLUDE: past results, analyst questions, industry/macro forecasts, vague hopes without a number. ' +
      `Resolve horizons relative to the call date: Indian fiscal year runs Apr-Mar; FY27 = Apr 2026-Mar 2027; "this year" on a ${meta.month} call = ${meta.fy}. ` +
      'quote MUST be copied character-for-character from the numbered sentence it came from (it will be machine-verified; paraphrases are discarded). Units: % for rates, cr for ₹ crore, bps for basis points.',
    prompt: text,
    schema: S('ARRAY', {
      items: S('OBJECT', {
        properties: {
          sentence: S('INTEGER'),
          metric: S('STRING', { enum: METRIC_ENUM }),
          low: NUM, high: NUM, unit: S('STRING', { enum: ['%', 'cr', 'bps', 'x', 'units', 'other'] }),
          horizon: S('STRING', { nullable: true, description: 'e.g. FY27, H2 FY27, FY28, Q3 FY27' }),
          quote: STR,
          gist: S('STRING', { description: '≤12 words, plain English' }),
        },
        required: ['sentence', 'metric', 'unit', 'quote', 'gist'],
      }),
    }),
  });
  return r.map((x) => {
    const w = windows[x.sentence] || {};
    return {
      metric: x.metric,
      target: { low: x.low, high: x.high ?? x.low, unit: x.unit },
      horizon: x.horizon,
      quote: x.quote,
      gist: x.gist,
      speaker: w.speaker || null,
      page: w.page || null,
      extractor: `gemini:${MODELS.fast()}`,
    };
  });
}

// ---------------------------------------------------------------- synthesis
/** Deep tier: narrative-vs-numbers, bull/bear and questions — allowed to cite ONLY supplied facts/claims. */
export async function synthesise({ company, facts, ledger, factSheet }) {
  return gemini({
    tier: 'deep',
    thinking: 1024,
    maxTokens: 3000,
    timeoutMs: 55000,
    temperature: 0.2,
    system:
      'You are a buy-side analyst writing for a portfolio manager who has 90 seconds. Use ONLY the facts and promise-ledger entries provided; do not use outside knowledge of the company, news, or broker views. ' +
      'Every point must cite at least one id from the input (fact ids like F3, claim ids like C2). Be specific with numbers. No hedging filler, no adjectives like "robust".',
    prompt: `Company: ${company}\n\nFACTS\n${factSheet}\n\nPROMISE LEDGER (verdicts computed from reported numbers)\n${ledger
      .map((c) => `${c.id}: [${c.verdict}] ${c.metric} ${c.target?.low ?? ''}${c.target?.high && c.target.high !== c.target.low ? '-' + c.target.high : ''}${c.target?.unit || ''} for ${c.horizon || '?'} (said ${c.madeIn}); actual: ${c.actual?.value ?? 'n/a'} ${c.actual?.unit || ''} ${c.actual?.period || ''} — "${c.quote.slice(0, 220)}"`)
      .join('\n')}`,
    schema: S('OBJECT', {
      properties: {
        verdict: S('STRING', { description: 'One sentence: does management do what it says?' }),
        narrativeVsNumbers: S('ARRAY', { items: S('OBJECT', { properties: { point: STR, stance: S('STRING', { enum: ['agrees', 'diverges', 'unclear'] }), cites: S('ARRAY', { items: STR }) }, required: ['point', 'stance', 'cites'] }) }),
        bull: S('ARRAY', { items: S('OBJECT', { properties: { point: STR, cites: S('ARRAY', { items: STR }) }, required: ['point', 'cites'] }) }),
        bear: S('ARRAY', { items: S('OBJECT', { properties: { point: STR, cites: S('ARRAY', { items: STR }) }, required: ['point', 'cites'] }) }),
        askManagement: S('ARRAY', { items: STR, description: '3 sharp questions for the next call, grounded in misses/divergences' }),
      },
      required: ['verdict', 'narrativeVsNumbers', 'bull', 'bear', 'askManagement'],
    }),
  });
}
