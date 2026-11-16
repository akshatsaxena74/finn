// Read-only access to the pipeline's JSON outputs (bundled with the functions via vercel.json includeFiles).
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const memo = new Map();

export function readData(rel, fallback = null) {
  const p = path.join(DATA, rel);
  try {
    const st = fs.statSync(p);
    const m = memo.get(p);
    if (m && m.mtime === st.mtimeMs) return m.v;
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    memo.set(p, { v, mtime: st.mtimeMs });
    return v;
  } catch {
    return fallback;
  }
}

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': init.cache || 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400', ...(init.headers || {}) },
  });
