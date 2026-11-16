import { h } from 'preact';
import htm from 'htm';
export const html = htm.bind(h);

export * from './util.js';

export async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- tiny charts
export function Spark({ values, w = 140, h = 42, stroke = 'currentColor', fill = true, dots = false }) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 2) return html`<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const min = Math.min(...v), max = Math.max(...v);
  const sx = (i) => (i / (v.length - 1)) * (w - 4) + 2;
  const sy = (x) => h - 3 - ((x - min) / (max - min || 1)) * (h - 8);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(x).toFixed(1)}`).join('');
  return html`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${fill && html`<path d="${d}L${sx(v.length - 1)},${h}L${sx(0)},${h}Z" fill=${stroke} opacity="0.08" />`}
    <path d=${d} fill="none" stroke=${stroke} stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
    ${dots && v.map((x, i) => html`<circle cx=${sx(i)} cy=${sy(x)} r="1.8" fill=${stroke} />`)}
    <circle cx=${sx(v.length - 1)} cy=${sy(v[v.length - 1])} r="2.6" fill=${stroke} />
  </svg>`;
}

// ---------- icons (inline, 24px grid, stroke)
const I = (d, extra = '') => () => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const Icon = {
  brief: I(html`<path d="M4 5h16M4 10h10M4 15h16M4 20h8" />`),
  dig: I(html`<circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />`),
  people: I(html`<circle cx="7" cy="8" r="3" /><circle cx="17" cy="7" r="2.5" /><circle cx="15" cy="17" r="3" /><path d="M9.6 9.6l3.4 5.4M9.8 7.6l4.8-.4" />`),
  bell: I(html`<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" />`),
  sliders: I(html`<path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />`),
  spark: I(html`<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />`),
  ask: I(html`<path d="M4 12a8 8 0 1114.2 5L20 21l-4.1-1.6A8 8 0 014 12z" /><path d="M9.5 10a2.5 2.5 0 114 2c-.9.5-1.5 1-1.5 2M12 16.5v.01" />`),
  mic: I(html`<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" />`),
  phone: I(html`<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" />`),
  x: I(html`<path d="M6 6l12 12M18 6L6 18" />`),
  down: I(html`<path d="M6 9l6 6 6-6" />`),
  play: I(html`<path d="M7 5l12 7-12 7z" />`),
  stop: I(html`<rect x="6" y="6" width="12" height="12" rx="1.5" />`),
  lock: I(html`<rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" />`),
  doc: I(html`<path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" />`),
  copy: I(html`<rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />`),
  arrow: I(html`<path d="M5 12h14M13 6l6 6-6 6" />`),
  bury: I(html`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />`),
  info: I(html`<circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" />`),
  sun: I(html`<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />`),
};

export const CATEGORY = {
  results: 'Results', 'M&A': 'M&A', fund_raise: 'Fund raise', management_change: 'Management', litigation: 'Legal / regulatory',
  insider_trading: 'Insider / SAST', earnings_call: 'Earnings call', investor_meetings: 'Investor meet', credit_rating: 'Credit rating',
  dividend: 'Dividend', bonus_split: 'Bonus / split', capex: 'Capex', press_release: 'Press release', postal_ballot: 'Postal ballot',
  agm_egm: 'AGM / EGM', pledging: 'Pledging', unclassified: 'Routine',
};
export const CAT_COLOR = {
  results: '#d9391c', 'M&A': '#7c3aed', management_change: '#2c48b3', litigation: '#b45309', fund_raise: '#0e7490', capex: '#15803d',
  press_release: '#64748b', earnings_call: '#94a3b8', investor_meetings: '#cbd5e1', credit_rating: '#0891b2', insider_trading: '#a16207',
  postal_ballot: '#a8a29e', agm_egm: '#a8a29e', unclassified: '#d6d3d1', dividend: '#65a30d', bonus_split: '#65a30d', pledging: '#be123c',
};
