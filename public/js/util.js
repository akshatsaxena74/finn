// Pure helpers with no UI dependency (shared by the views, the scoring engine and the node tests).
// ---------- formatting
export const fmt = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtCr = (v) => (v == null ? '—' : Math.abs(v) >= 100000 ? `₹${fmt(v / 100000, 2)}L cr` : `₹${fmt(v)} cr`);
export const pct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, d)}%`);
export const tone = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
export const initials = (n = '') => n.replace(/\b(mr|ms|mrs|dr)\.?\s+/gi, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const first = (n = '') => {
  const t = n.replace(/\b(mr|ms|mrs|dr|shri)\.?\s+/gi, '').split(/\s+/).filter(Boolean);
  return t.find((w) => !/^[A-Z]\.?$/i.test(w)) || t[0] || ''; // "V. Srinivasa Rangan" -> "Srinivasa"
};

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}
export const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const monthsSince = (iso, now) => Math.max(0, Math.round((now - new Date(iso).getTime()) / (30.44 * 86400000)));
export const yrs = (from, to) => `${from ?? '?'}–${to == null ? 'now' : to}`;

// ---------- storage (best-effort; app works without it)
export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('finn:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('finn:' + k, JSON.stringify(v));
    } catch {}
  },
};
