// Client-side ranking. The server gives a base materiality per filing (category + specifics).
// The phone adds what only it knows: position size, the market's reaction, the investor's own
// network, and what this investor has buried before. Then it fits the result into an attention budget.
import { store } from './util.js';

const DAY = 86400000;
/** Day-precision filings are treated as end-of-day IST for windowing. */
export const itemTime = (i) => new Date(i.timePrecision === 'day' || !i.at ? `${i.date}T18:29:00Z` : i.at).getTime();

// ---------- market reaction & tripwires
export function seriesStats(s, idx) {
  // stats for session idx: % move, move relative to Nifty, volume vs trailing 20-session average
  if (!s || idx < 1) return null;
  const c = s.c[idx], p = s.c[idx - 1];
  const win = s.v.slice(Math.max(0, idx - 20), idx);
  const avg = win.reduce((a, b) => a + b, 0) / (win.length || 1);
  return { date: s.d[idx], close: c, move: ((c - p) / p) * 100, volx: avg ? s.v[idx] / avg : null };
}

export function reaction(item, market) {
  const s = market?.series?.[item.symbol];
  const n = market?.series?.NIFTY;
  if (!s || !item.date) return null;
  // first session on/after the filing date (filings after close move the next day)
  let idx = s.d.findIndex((d) => d >= item.date);
  if (idx < 0) return null;
  if (s.d[idx] === item.date && idx + 1 < s.d.length) idx = idx + 1 <= s.d.length - 1 ? idx : idx; // same-day session counts
  const st = seriesStats(s, idx);
  if (!st) return null;
  const ni = n ? n.d.indexOf(st.date) : -1;
  const nm = ni > 0 ? ((n.c[ni] - n.c[ni - 1]) / n.c[ni - 1]) * 100 : 0;
  return { ...st, rel: st.move - nm, nifty: nm };
}

export const DEFAULT_RULES = {
  move: 4, // ± % stock-specific move
  volx: 2, // x 20-session average volume
  relative: true, // judge moves net of Nifty
  categories: { results: true, 'M&A': true, management_change: true, litigation: true, fund_raise: true, capex: false, credit_rating: true, pledging: true, insider_trading: false, press_release: false },
  minScore: 55,
};
export const loadRules = () => ({ ...DEFAULT_RULES, ...store.get('rules', {}), categories: { ...DEFAULT_RULES.categories, ...(store.get('rules', {}).categories || {}) } });

/** Evaluate EOD tripwires for every holding over the last `sessions` sessions. */
export function tripwires(market, holdings, rules, sessions = 30) {
  const out = [];
  const n = market?.series?.NIFTY;
  for (const h of holdings) {
    const s = market?.series?.[h.symbol];
    if (!s) continue;
    for (let i = Math.max(21, s.d.length - sessions); i < s.d.length; i++) {
      const st = seriesStats(s, i);
      const ni = n ? n.d.indexOf(st.date) : -1;
      const nm = ni > 0 ? ((n.c[ni] - n.c[ni - 1]) / n.c[ni - 1]) * 100 : 0;
      const mv = rules.relative ? st.move - nm : st.move;
      const hitMove = Math.abs(mv) >= rules.move;
      const hitVol = st.volx != null && st.volx >= rules.volx;
      if (hitMove || hitVol) out.push({ symbol: h.symbol, date: st.date, move: st.move, rel: st.move - nm, volx: st.volx, hitMove, hitVol, close: st.close });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.rel) - Math.abs(a.rel));
}

// ---------- learned preferences (Dismiss teaches FINN)
export const prefs = {
  get: () => store.get('prefs', { buriedCat: {}, buriedSym: {}, dismissed: {} }),
  bury(item) {
    const p = prefs.get();
    p.dismissed[item.id] = Date.now();
    p.buriedCat[item.category] = (p.buriedCat[item.category] || 0) + 1;
    store.set('prefs', p);
    return p.buriedCat[item.category];
  },
  undo(item) {
    const p = prefs.get();
    delete p.dismissed[item.id];
    p.buriedCat[item.category] = Math.max(0, (p.buriedCat[item.category] || 1) - 1);
    store.set('prefs', p);
  },
  reset: () => store.set('prefs', { buriedCat: {}, buriedSym: {}, dismissed: {} }),
};
const catMult = (p, cat) => Math.pow(0.82, Math.max(0, (p.buriedCat[cat] || 0) - 1)); // first bury is free: it's about that item

// ---------- scoring
export function scoreItem(item, ctx) {
  const h = ctx.holdingMap[item.symbol];
  const weight = h?.weight ?? 3;
  const why = [];
  let s = item.baseScore;
  const posMult = 0.78 + weight / 18; // 9% → 1.28x, 3% → 0.95x
  s *= posMult;
  if (weight >= 7) why.push({ t: `${weight}% of book`, k: '' });
  const rx = reaction(item, ctx.market);
  if (rx && item.baseScore >= 20) {
    const r = Math.abs(rx.rel);
    if (r >= 2) {
      s += Math.min(16, r * 2.6);
      why.push({ t: `${rx.move > 0 ? '▲' : '▼'} ${Math.abs(rx.move).toFixed(1)}% on ${new Date(rx.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, k: rx.move > 0 ? 'good' : 'bad' });
    }
    if (rx.volx >= 2) {
      s += 6;
      why.push({ t: `vol ${rx.volx.toFixed(1)}×`, k: 'warn' });
    }
  }
  const net = ctx.network ? ctx.network.forItem(item, { limit: 8 }) : [];
  if (net.length && item.baseScore >= 30) {
    s += 7 + Math.min(6, net.length * 2);
    why.push({ t: `you know ${net.length === 1 ? 'someone' : net.length + ' people'} here`, k: 'people' });
  }
  s *= catMult(ctx.prefs, item.category);
  // soft ceiling: keep order among the most material items instead of flattening them all to 100
  if (s > 80) s = 80 + 19 * (1 - Math.exp(-(s - 80) / 30));
  return { score: Math.round(Math.max(0, s)), why, reaction: rx, net: net.slice(0, 3), netCount: net.length };
}

// ---------- story clustering: several filings, one event
export function cluster(items) {
  const sorted = [...items].sort((a, b) => itemTime(b) - itemTime(a));
  const stories = [];
  for (const i of sorted) {
    const t = itemTime(i);
    const same = stories.find(
      (s) => s.symbol === i.symbol && Math.abs(s.t - t) <= 3 * DAY &&
        (s.lead.category === i.category || (['results', 'M&A'].includes(s.lead.category) && ['results', 'M&A'].includes(i.category) && Math.abs(s.t - t) <= 1.5 * DAY)) &&
        i.category !== 'unclassified' && i.category !== 'investor_meetings',
    );
    if (same) same.items.push(i);
    else stories.push({ id: i.id, symbol: i.symbol, t, lead: i, items: [i] });
  }
  for (const s of stories) {
    s.items.sort((a, b) => b.score - a.score);
    const top = s.items[0];
    const slack = top.category === 'results' && !top.results && !top.line ? 30 : 12; // numbers not out yet: prefer the sibling that says something
    s.lead = s.items.find((x) => x.line && x.score >= top.score - slack) || top;
    s.score = Math.min(99, s.items[0].score + 2 * (s.items.length - 1));
    s.cost = Math.max(...s.items.map((x) => x.readCost || 8)) + 4 * (s.items.length - 1);
    s.why = s.items[0].why;
    s.net = s.items.find((x) => x.net?.length)?.net || [];
    s.categories = [...new Set(s.items.map((x) => x.category))];
  }
  return stories.sort((a, b) => b.score - a.score);
}

/** Fit stories into an attention budget (seconds). Most material first; never split a story. */
export function fitBudget(stories, seconds, threshold = 38) {
  const material = stories.filter((s) => s.score >= threshold);
  const fold = [];
  const over = [];
  let used = 0;
  for (const s of material) {
    if (used + s.cost <= seconds || fold.length === 0) {
      fold.push(s);
      used += s.cost;
    } else over.push(s);
  }
  const floor = stories.filter((s) => s.score < threshold);
  return { fold, over, floor, used };
}
