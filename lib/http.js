// Small fetch wrapper: browser-like UA, timeout, one retry on transient errors.
// Everything FINN fetches is a public page or a public document link.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function get(url, { timeoutMs = 20000, accept = '*/*', retries = 1, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-IN,en;q=0.9', ...headers },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export async function getText(url, opts) {
  const res = await get(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function getBytes(url, opts) {
  const res = await get(url, { accept: 'application/pdf,*/*', ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
