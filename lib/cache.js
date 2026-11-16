// Two-level cache: per-instance memory, plus Upstash Redis (REST) when configured.
// Serverless instances are ephemeral, so the shared layer is what makes repeat research free.
const mem = new Map();
const R_URL = () => process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = () => process.env.UPSTASH_REDIS_REST_TOKEN;

export async function cacheGet(key) {
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return m.v;
  if (!R_URL()) return null;
  try {
    const r = await fetch(`${R_URL()}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${R_TOK()}` } });
    const j = await r.json();
    if (j.result == null) return null;
    const v = JSON.parse(j.result);
    mem.set(key, { v, exp: Date.now() + 5 * 60000 });
    return v;
  } catch {
    return null;
  }
}

export async function cacheSet(key, v, ttlSec = 86400) {
  mem.set(key, { v, exp: Date.now() + Math.min(ttlSec, 3600) * 1000 });
  if (!R_URL()) return;
  try {
    await fetch(`${R_URL()}/set/${encodeURIComponent(key)}?EX=${ttlSec}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${R_TOK()}` },
      body: JSON.stringify(v),
    });
  } catch {
    /* cache is best-effort */
  }
}
