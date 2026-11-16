// GET /api/market — EOD close/volume series for holdings + Nifty (raw, so the phone can backtest any threshold).
import { readData, json } from '../lib/data.js';

export async function GET() {
  const m = readData('market.json', { series: {} });
  return json(m, { cache: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' });
}
