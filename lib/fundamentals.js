// Deterministic derivations from screener tables. Every figure FINN shows is computed here,
// never by a model, and carries the period + source it came from.

import { row } from './screener.js';

const pct = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const last = (arr, k = 1) => (arr ? arr[arr.length - k] : null);

/** Normalise the P&L rows across industries (banks/NBFCs label them differently). */
export function plRows(table) {
  if (!table) return null;
  const revenue = row(table, 'Sales', 'Revenue');
  const ebitda = row(table, 'Operating Profit', 'Financing Profit');
  const margin = row(table, 'OPM %', 'Financing Margin %');
  const pbt = row(table, 'Profit before tax');
  const pat = row(table, 'Net Profit');
  const other = row(table, 'Other Income');
  const interest = row(table, 'Interest');
  const dep = row(table, 'Depreciation');
  const eps = row(table, 'EPS in Rs');
  const isFinancial = !row(table, 'Sales') && !!row(table, 'Revenue');
  return { revenue, ebitda, margin, pbt, pat, other, interest, dep, eps, isFinancial };
}

/** Headline numbers for the latest quarter vs previous quarter and the same quarter last year. */
const MON = { jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec' };
/** The quarter a results filing is about ("…quarter ended 30 September 2026" -> "Sep 2026"), or null. */
export function filingPeriod(text = '') {
  const t = text.replace(/_/g, ' ');
  let m = t.match(/end(?:ed|ing)\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s,.-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.-]*(\d{4})/i);
  if (m) return `${MON[m[2].toLowerCase()]} ${m[3]}`;
  m = t.match(/end(?:ed|ing)\s+(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m) return `${MON[m[1].toLowerCase()]} ${m[3]}`;
  m = t.match(/(\d{1,2})[./-](0[369]|12)[./-](\d{4})/);
  if (m && /end/i.test(t)) return `${['', '', '', 'Mar', '', '', 'Jun', '', '', 'Sep', '', '', 'Dec'][+m[2]]} ${m[3]}`;
  return null;
}

/** Attach standardised numbers to a results filing only when they are for the quarter the filing reports. */
export function attachResults(item, company) {
  const q = !company ? null : company.facts?.latestQuarter || (company.quarters ? quarterHeadline(company) : null);
  const fp = filingPeriod(`${item.title || ''} ${item.subject || ''} ${item.note || ''}`);
  if (q && (!fp || q.period === fp)) return { results: q, resultsPending: null };
  return { results: null, resultsPending: fp || null };
}

export function quarterHeadline(company) {
  const q = company.quarters;
  const pl = plRows(q);
  if (!pl || !pl.revenue) return null;
  const n = q.periods.length;
  const i = n - 1;
  const metric = (name, arr, label) => {
    if (!arr) return null;
    const cur = arr[i];
    const prev = arr[i - 1];
    const yago = n >= 5 ? arr[i - 4] : null;
    return { key: name, label, value: cur, qoq: r1(pct(cur, prev)), yoy: r1(pct(cur, yago)), prev, yago };
  };
  const margin = (num, den, j) => (num?.[j] != null && den?.[j] ? r1((num[j] / den[j]) * 100) : null);
  return {
    period: q.periods[i],
    periodKey: q.keys?.[i] || null,
    prevPeriod: q.periods[i - 1],
    yagoPeriod: n >= 5 ? q.periods[i - 4] : null,
    isFinancial: pl.isFinancial,
    rows: [
      metric('revenue', pl.revenue, pl.isFinancial ? 'Revenue (total income)' : 'Revenue'),
      metric('ebitda', pl.ebitda, pl.isFinancial ? 'Pre-provision op. profit' : 'EBITDA'),
      metric('pbt', pl.pbt, 'PBT'),
      metric('pat', pl.pat, 'PAT'),
    ].filter(Boolean),
    margins: {
      ebitda: { cur: margin(pl.ebitda, pl.revenue, i), prev: margin(pl.ebitda, pl.revenue, i - 1), yago: n >= 5 ? margin(pl.ebitda, pl.revenue, i - 4) : null },
      pat: { cur: margin(pl.pat, pl.revenue, i), prev: margin(pl.pat, pl.revenue, i - 1), yago: n >= 5 ? margin(pl.pat, pl.revenue, i - 4) : null },
    },
    otherIncomeShareOfPbt: pl.other?.[i] != null && pl.pbt?.[i] ? r1((pl.other[i] / pl.pbt[i]) * 100) : null,
    sourcePdf: q.rawPdf?.[i] || null,
    source: company.source + '#quarters',
  };
}

function series(table, arr, { dropTTM = true } = {}) {
  if (!table || !arr) return [];
  return table.periods
    .map((p, j) => ({ period: p, value: arr[j] }))
    .filter((d) => d.value != null && !(dropTTM && /TTM/i.test(d.period)));
}

/** Everything the Pull dossier needs, derived deterministically. */
export function dossierFacts(c) {
  const pl = plRows(c.annual);
  const qpl = plRows(c.quarters);
  const bs = c.balanceSheet;
  const cf = c.cashFlow;
  const eff = c.efficiency;

  const equity = (() => {
    const cap = row(bs, 'Equity Capital');
    const res = row(bs, 'Reserves');
    if (!cap || !res) return null;
    return cap.map((v, j) => (v ?? 0) + (res[j] ?? 0));
  })();
  const borrowings = row(bs, 'Borrowings', 'Borrowing');
  const de = equity && borrowings ? borrowings.map((b, j) => (equity[j] ? r1((b / equity[j]) * 100) / 100 : null)) : null;

  const cfo = row(cf, 'Cash from Operating Activity');
  const fcf = row(cf, 'Free Cash Flow');
  const cfoEbitda = row(cf, 'CFO/EBITDA');

  // cash conversion: sum(CFO) / sum(PAT) over the last 5 reported years (aligned by period label)
  let conversion = null;
  if (cfo && pl?.pat) {
    const patBy = Object.fromEntries(c.annual.periods.map((p, j) => [p, pl.pat[j]]));
    const pairs = cf.periods.map((p, j) => [cfo[j], patBy[p]]).filter(([a, b]) => a != null && b != null).slice(-5);
    const sc = pairs.reduce((s, [a]) => s + a, 0);
    const sp = pairs.reduce((s, [, b]) => s + b, 0);
    if (pairs.length >= 3 && sp > 0) conversion = { years: pairs.length, cfo: Math.round(sc), pat: Math.round(sp), ratio: r1((sc / sp) * 100) };
  }

  const annualOPM = pl?.revenue && pl?.ebitda ? pl.revenue.map((rv, j) => (rv ? r1((pl.ebitda[j] / rv) * 100) : null)) : null;
  const sh = c.shareholding;

  return {
    snapshot: {
      name: c.name,
      symbol: c.symbol,
      sector: c.sector,
      industry: c.industry,
      about: c.about,
      website: c.website,
      marketCapCr: c.ratios['Market Cap'] ?? null,
      price: c.ratios['Current Price'] ?? null,
      highLow: c.ratios['High / Low'] ?? null,
      pe: c.ratios['Stock P/E'] ?? null,
      bookValue: c.ratios['Book Value'] ?? null,
      dividendYield: c.ratios['Dividend Yield'] ?? null,
      roce: c.ratios['ROCE'] ?? null,
      roe: c.ratios['ROE'] ?? null,
      isFinancial: pl?.isFinancial || false,
    },
    latestQuarter: quarterHeadline(c),
    trajectory: {
      revenue: series(c.annual, pl?.revenue),
      ebitda: series(c.annual, pl?.ebitda),
      opm: series(c.annual, annualOPM),
      pat: series(c.annual, pl?.pat),
      qRevenue: series(c.quarters, qpl?.revenue),
      qOpm: series(c.quarters, qpl?.margin),
      qPat: series(c.quarters, qpl?.pat),
      growth: c.growth,
    },
    balanceSheet: {
      borrowings: series(bs, borrowings, { dropTTM: false }),
      equity: series(bs, equity, { dropTTM: false }),
      debtToEquity: series(bs, de, { dropTTM: false }),
      cwip: series(bs, row(bs, 'CWIP'), { dropTTM: false }),
      workingCapital: {
        debtorDays: series(eff, row(eff, 'Debtor Days')),
        inventoryDays: series(eff, row(eff, 'Inventory Days')),
        payableDays: series(eff, row(eff, 'Days Payable')),
        cashConversionCycle: series(eff, row(eff, 'Cash Conversion Cycle')),
      },
      roce: series(eff, row(eff, 'ROCE %')),
    },
    cash: {
      cfo: series(cf, cfo),
      fcf: series(cf, fcf),
      cfoToEbitda: series(cf, cfoEbitda),
      conversion,
    },
    ownership: sh
      ? {
          promoters: series(sh, row(sh, 'Promoters'), { dropTTM: false }),
          fii: series(sh, row(sh, 'FIIs'), { dropTTM: false }),
          dii: series(sh, row(sh, 'DIIs'), { dropTTM: false }),
        }
      : null,
    sources: {
      screener: c.source,
      annualReports: c.documents.annualReports.slice(0, 3),
      concalls: c.documents.concalls.slice(0, 6),
    },
  };
}

/** Actuals the ledger judges promises against: by fiscal year and by quarter. */
export function actualsIndex(c) {
  const pl = plRows(c.annual);
  const qpl = plRows(c.quarters);
  const fy = {};
  if (pl?.revenue) {
    c.annual.periods.forEach((p, j) => {
      const m = p.match(/Mar (\d{4})/);
      if (!m) return;
      const FY = `FY${String(m[1]).slice(2)}`;
      const prevRev = pl.revenue[j - 1];
      const prevPat = pl.pat?.[j - 1];
      fy[FY] = {
        revenue: pl.revenue[j],
        revenueGrowth: r1(pct(pl.revenue[j], prevRev)),
        ebitda: pl.ebitda?.[j] ?? null,
        ebitdaMargin: pl.revenue[j] ? r1((pl.ebitda?.[j] / pl.revenue[j]) * 100) : null,
        pat: pl.pat?.[j] ?? null,
        patGrowth: r1(pct(pl.pat?.[j], prevPat)),
      };
    });
  }
  const quarters = [];
  if (qpl?.revenue) {
    c.quarters.periods.forEach((p, j) => {
      quarters.push({
        period: p,
        key: c.quarters.keys?.[j],
        revenue: qpl.revenue[j],
        revenueYoY: j >= 4 ? r1(pct(qpl.revenue[j], qpl.revenue[j - 4])) : null,
        ebitda: qpl.ebitda?.[j] ?? null,
        ebitdaMargin: qpl.revenue[j] ? r1((qpl.ebitda?.[j] / qpl.revenue[j]) * 100) : null,
        pat: qpl.pat?.[j] ?? null,
        patYoY: j >= 4 ? r1(pct(qpl.pat?.[j], qpl.pat?.[j - 4])) : null,
      });
    });
  }
  return { fy, quarters };
}

/** Indian fiscal year for a date: Apr 2026 - Mar 2027 => FY27. */
export function fiscalYear(d) {
  const dt = new Date(d);
  const y = dt.getUTCFullYear() + (dt.getUTCMonth() >= 3 ? 1 : 0);
  return `FY${String(y).slice(2)}`;
}
export function fyEnd(FY) {
  const y = 2000 + Number(FY.replace(/\D/g, '').slice(-2));
  return `${y}-03-31`;
}
