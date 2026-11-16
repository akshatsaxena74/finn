// GET /api/health — what mode FINN is running in (shown in the app's "About this data" sheet).
import { readData, json } from '../lib/data.js';
import { llmEnabled, MODELS } from '../lib/llm.js';

export async function GET() {
  const ann = readData('announcements.json', {});
  const mkt = readData('market.json', {});
  return json(
    {
      ok: true,
      ai: llmEnabled() ? { provider: 'gemini', fast: MODELS.fast(), std: MODELS.std(), deep: MODELS.deep() } : { provider: 'none', note: 'Add GEMINI_API_KEY to enable live summaries, guidance extraction and synthesis.' },
      cache: process.env.UPSTASH_REDIS_REST_URL ? 'upstash+memory' : 'memory',
      data: { filingsAsOf: ann.asOf || null, filings: ann.count || 0, marketAsOf: mkt.asOf || null },
    },
    { cache: 'no-store' },
  );
}
