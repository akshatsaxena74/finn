// The Promise Ledger: management's guidance claims judged against what was reported.
// Models may read transcripts; only this file decides verdicts, and it does so with arithmetic.

import { fyEnd } from './fundamentals.js';

export const VERDICT = {
  kept: { label: 'Kept', tone: 'good' },
  close: { label: 'Nearly', tone: 'warn' },
  missed: { label: 'Missed', tone: 'bad' },
  moved: { label: 'Goalposts moved', tone: 'bad' },
  ahead: { label: 'Tracking ahead', tone: 'good' },
  behind: { label: 'Tracking behind', tone: 'warn' },
  pending: { label: 'Too early', tone: 'neutral' },
  undated: { label: 'No deadline', tone: 'warn' },
  unmeasurable: { label: 'Not in the numbers', tone: 'neutral' },
};

const MEASURABLE = new Set(['revenue_growth', 'ebitda_margin', 'ebitda_abs', 'pat', 'revenue_abs']);

function fyOf(h) {
  const m = h?.match(/FY(\d{2})/);
  return m ? `FY${m[1]}` : null;
}

/** Year-to-date actuals for a fiscal year from quarterly data (for promises not yet due). */
function ytd(actuals, FY) {
  const y = 2000 + Number(FY.slice(2));
  const inFY = actuals.quarters.filter((q) => {
    const k = q.key || '';
    const d = new Date(k || `1 ${q.period}`);
    if (Number.isNaN(+d)) return false;
    return d > new Date(Date.UTC(y - 1, 2, 31)) && d <= new Date(Date.UTC(y, 2, 31));
  });
  if (!inFY.length) return null;
  const sum = (f) => inFY.reduce((s, q) => s + (q[f] ?? 0), 0);
  const prevFY = actuals.quarters.filter((q) => {
    const d = new Date(q.key || `1 ${q.period}`);
    return d > new Date(Date.UTC(y - 2, 2, 31)) && d <= new Date(Date.UTC(y - 1, 2, 31));
  }).slice(0, inFY.length);
  const rev = sum('revenue');
  const prevRev = prevFY.reduce((s, q) => s + (q.revenue ?? 0), 0);
  return {
    quarters: inFY.length,
    through: inFY[inFY.length - 1].period,
    revenue: rev,
    revenueGrowth: prevFY.length === inFY.length && prevRev ? Math.round(((rev - prevRev) / prevRev) * 1000) / 10 : null,
    ebitda: sum('ebitda'),
    ebitdaMargin: rev ? Math.round((sum('ebitda') / rev) * 1000) / 10 : null,
    pat: sum('pat'),
  };
}

function compare(actual, target, { annualise = 1 } = {}) {
  if (actual == null || !target || target.low == null) return null;
  const lo = target.low;
  const tol = target.unit === '%' ? 1 : Math.abs(lo) * 0.03; // 1pp for rates, 3% for absolutes
  const a = actual * annualise;
  if (a >= lo) return 'kept';
  if (a >= lo - tol) return 'close';
  return 'missed';
}

/**
 * Judge each verified claim. `asOf` decides whether a promise is due.
 * @param {Array} claims  [{id, metric, target:{low,high,unit}, horizon, madeOn, quote, ...}]
 * @param {{fy:object, quarters:Array}} actuals from fundamentals.actualsIndex
 */
export function judge(claims, actuals, asOf = new Date()) {
  const out = claims.map((c) => ({ ...c }));
  for (const c of out) {
    const FY = fyOf(c.horizon);
    c.dueBy = FY ? fyEnd(FY) : null;
    if (!c.horizon) {
      c.verdict = 'undated'; // a promise without a deadline can't be held to account — itself worth knowing
      continue;
    }
    if (!MEASURABLE.has(c.metric) || !FY) {
      c.verdict = new Date(c.dueBy || '2100-01-01') > new Date(asOf) ? 'pending' : 'unmeasurable';
      continue;
    }
    const due = new Date(c.dueBy) < new Date(asOf) && actuals.fy[FY];
    if (due) {
      const A = actuals.fy[FY];
      const actual =
        c.metric === 'revenue_growth' ? A.revenueGrowth
          : c.metric === 'ebitda_margin' ? A.ebitdaMargin
            : c.metric === 'ebitda_abs' ? A.ebitda
              : c.metric === 'revenue_abs' ? A.revenue
                : c.metric === 'pat' ? (c.target.unit === '%' ? A.patGrowth : A.pat) : null;
      c.actual = { value: actual, unit: c.target.unit === 'cr' ? 'cr' : '%', period: FY, basis: 'reported full year' };
      c.verdict = compare(actual, c.target) || 'unmeasurable';
    } else {
      const Y = ytd(actuals, FY);
      if (!Y) {
        c.verdict = 'pending';
        continue;
      }
      const ann = 4 / Y.quarters;
      const actual =
        c.metric === 'revenue_growth' ? Y.revenueGrowth
          : c.metric === 'ebitda_margin' ? Y.ebitdaMargin
            : c.metric === 'ebitda_abs' ? Y.ebitda
              : c.metric === 'revenue_abs' ? Y.revenue
                : c.metric === 'pat' && c.target.unit === 'cr' ? Y.pat : null;
      const annualise = /abs|^pat$/.test(c.metric) ? ann : 1;
      c.actual = { value: actual == null ? null : Math.round(actual * annualise * 10) / 10, unit: c.target.unit === 'cr' ? 'cr' : '%', period: `${FY} YTD (${Y.quarters}Q, through ${Y.through})`, basis: annualise > 1 ? 'run-rate, annualised' : 'year to date' };
      const v = compare(actual, c.target, { annualise });
      c.verdict = v === 'kept' ? 'ahead' : v === 'close' || v === 'missed' ? 'behind' : 'pending';
    }
  }
  // Goalposts: same metric + horizon restated lower in a later call.
  const groups = {};
  for (const c of out) {
    if (!c.target) continue;
    const k = c.horizon ? `${c.metric}|${fyOf(c.horizon) || c.horizon}|${c.target.unit}` : `${c.metric}|undated|${c.target.unit}|${c.target.low}`;
    (groups[k] ||= []).push(c);
  }
  const threads = [];
  for (const [k, cs] of Object.entries(groups)) {
    cs.sort((a, b) => (a.madeOn || '').localeCompare(b.madeOn || ''));
    for (let i = 1; i < cs.length; i++) {
      const prev = cs[i - 1].target;
      const cur = cs[i].target;
      if (prev.low != null && cur.low != null && cur.low < prev.low - (cur.unit === '%' ? 0.5 : Math.abs(prev.low) * 0.03)) {
        cs[i - 1].revisedTo = { claimId: cs[i].id, low: cur.low, high: cur.high, on: cs[i].madeOn };
        if (cs[i - 1].verdict !== 'kept') cs[i - 1].verdict = 'moved';
      }
      if (prev.low != null && cur.low != null && cur.low > prev.low + (cur.unit === '%' ? 0.5 : Math.abs(prev.low) * 0.03)) {
        cs[i - 1].raisedTo = { claimId: cs[i].id, low: cur.low, high: cur.high, on: cs[i].madeOn };
      }
    }
    if (cs.length > 1) threads.push({ key: k, metric: cs[0].metric, horizon: fyOf(cs[0].horizon) || cs[0].horizon || null, repeated: cs.length, undated: !cs[0].horizon, claimIds: cs.map((c) => c.id) });
  }
  return { claims: out, threads, score: sayDo(out) };
}

/** Say/Do: of the promises that can be judged, how many were honoured (moved goalposts count against). */
export function sayDo(claims) {
  const judged = claims.filter((c) => ['kept', 'close', 'missed', 'moved'].includes(c.verdict));
  const tracking = claims.filter((c) => ['ahead', 'behind'].includes(c.verdict));
  const pts = judged.reduce((s, c) => s + (c.verdict === 'kept' ? 1 : c.verdict === 'close' ? 0.5 : 0), 0);
  return {
    judged: judged.length,
    kept: judged.filter((c) => c.verdict === 'kept').length,
    close: judged.filter((c) => c.verdict === 'close').length,
    missed: judged.filter((c) => c.verdict === 'missed').length,
    moved: claims.filter((c) => c.verdict === 'moved').length,
    ahead: tracking.filter((c) => c.verdict === 'ahead').length,
    behind: tracking.filter((c) => c.verdict === 'behind').length,
    ratio: judged.length ? Math.round((pts / judged.length) * 100) : null,
  };
}
