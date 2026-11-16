// GET  /api/research?ticker=PIIND&stage=facts|ledger
// POST /api/research?ticker=PIIND&stage=synthesis   body: { ledger }   (stateless: the phone holds the ledger)
//
// Works for ANY NSE symbol screener.in covers. Demo names are served from precomputed dossiers
// (data/research/<SYM>.json); everything else is computed live, stage by stage, so each call stays short.
import { readData, json } from '../lib/data.js';
import { researchFacts, researchLedger, researchSynthesis } from '../lib/research.js';
import { llmEnabled } from '../lib/llm.js';

const clean = (t) => (t || '').toUpperCase().replace(/\.NS$|\.BO$/, '').replace(/[^A-Z0-9&-]/g, '').slice(0, 20);

export async function GET(request) {
  const url = new URL(request.url);
  const sym = clean(url.searchParams.get('ticker'));
  const stage = url.searchParams.get('stage') || 'facts';
  const fresh = url.searchParams.get('fresh') === '1';
  if (!sym) return json({ error: 'ticker required' }, { status: 400, cache: 'no-store' });

  const pre = !fresh && readData(`research/${sym}.json`);
  try {
    if (stage === 'facts') {
      if (pre) return json({ symbol: sym, name: pre.name, facts: pre.facts, provenance: { mode: 'precomputed', builtAt: pre.builtAt } });
      try {
        const base = await researchFacts(sym);
        return json({ symbol: sym, name: base.name, facts: base.facts, provenance: { mode: 'live', fetchedAt: base.fetchedAt } });
      } catch (e) {
        const snap = readData(`companies/${sym}.json`);
        if (snap) return json({ symbol: sym, name: snap.name, facts: snap.facts, provenance: { mode: 'snapshot', fetchedAt: snap.fetchedAt, note: 'live source unreachable' } });
        throw e;
      }
    }
    if (stage === 'ledger') {
      if (pre) return json({ symbol: sym, ledger: pre.ledger, provenance: { mode: 'precomputed', builtAt: pre.builtAt } });
      const base = await researchFacts(sym);
      const seed = readData(`research/seed/${sym}.claims.json`);
      const ledger = await researchLedger(base, { seedClaims: seed, maxTranscripts: 6 });
      return json({ symbol: sym, ledger, provenance: { mode: 'live', ai: llmEnabled() ? 'gemini' : 'heuristic' } }, { cache: 'public, max-age=300, s-maxage=21600' });
    }
    if (stage === 'synthesis' && pre) return json({ symbol: sym, synthesis: pre.synthesis, provenance: { mode: 'precomputed', builtAt: pre.builtAt } });
    return json({ error: 'use POST for live synthesis' }, { status: 405, cache: 'no-store' });
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 502;
    return json({ error: e.code === 'NOT_FOUND' ? `No listed company found for "${sym}"` : `Couldn't fetch ${sym}: ${e.message}` }, { status, cache: 'no-store' });
  }
}

export async function POST(request) {
  const url = new URL(request.url);
  const sym = clean(url.searchParams.get('ticker'));
  const pre = readData(`research/${sym}.json`);
  if (pre && url.searchParams.get('fresh') !== '1') return json({ symbol: sym, synthesis: pre.synthesis, provenance: { mode: 'precomputed' } });
  try {
    const { ledger } = await request.json();
    const base = await researchFacts(sym);
    const synthesis = await researchSynthesis(base, ledger || { claims: [], score: {} });
    return json({ symbol: sym, synthesis, provenance: { mode: 'live', engine: synthesis.engine } }, { cache: 'no-store' });
  } catch (e) {
    return json({ error: e.message }, { status: 502, cache: 'no-store' });
  }
}
