// screener.in company page -> structured, source-linked fundamentals.
// Deterministic parsing only: no model ever touches a number in FINN.

import { parse } from 'node-html-parser';
import { getText } from './http.js';

const BASE = 'https://www.screener.in';

export function screenerUrl(symbol, consolidated = true) {
  return `${BASE}/company/${encodeURIComponent(symbol.toUpperCase())}/${consolidated ? 'consolidated/' : ''}`;
}

/** Parse "1,23,456" / "+37%" / "-2.5" / "" -> number | null */
export function num(s) {
  if (s == null) return null;
  const t = String(s).replace(/[₹,\s]|Cr\.?/g, '').replace('%', '');
  if (t === '' || t === '-' || t === '--') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** "12 Nov" -> ISO date, assuming the most recent past occurrence (IST). */
export function inferDate(s, now = new Date()) {
  const m = s.match(/(\d{1,2}) ([A-Za-z]{3})(?: (\d{4}))?/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  let year = m[3] ? +m[3] : now.getUTCFullYear();
  if (!m[3] && (mon > now.getUTCMonth() || (mon === now.getUTCMonth() && +m[1] > now.getUTCDate() + 1))) year -= 1;
  return `${year}-${String(mon + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
}
const label = (s) => clean(s).replace(/\s*\+\s*$/, '');

function parseTable(root, sectionId) {
  const sec = root.querySelector(`#${sectionId}`);
  const table = sec?.querySelector('table');
  if (!table) return null;
  const heads = table.querySelectorAll('thead th').slice(1);
  const periods = heads.map((th) => clean(th.text));
  const keys = heads.map((th) => th.getAttribute('data-date-key') || null);
  const rows = {};
  const links = {};
  for (const tr of table.querySelectorAll('tbody tr')) {
    const tds = tr.querySelectorAll('td');
    if (!tds.length) continue;
    // first cell may contain a tooltip; take the leading button/text only
    const first = tds[0];
    const btn = first.querySelector('button');
    let name = label(btn ? btn.text : first.childNodes.map((n) => (n.nodeType === 3 ? n.text : '')).join(' ') || first.text);
    if (!name) name = label(first.text);
    if (/^Raw PDF/i.test(name)) {
      links.rawPdf = tds.slice(1).map((td) => {
        const a = td.querySelector('a');
        return a ? new URL(a.getAttribute('href'), BASE).href : null;
      });
      continue;
    }
    rows[name] = tds.slice(1).map((td) => num(td.text));
  }
  return { periods, keys, rows, ...links };
}

function parseRanges(root) {
  const out = {};
  for (const t of root.querySelectorAll('#profit-loss .ranges-table')) {
    const trs = t.querySelectorAll('tr');
    const title = clean(trs[0]?.text || '');
    const vals = {};
    for (const tr of trs.slice(1)) {
      const [k, v] = tr.querySelectorAll('td').map((td) => clean(td.text));
      if (k) vals[k.replace(':', '')] = num(v);
    }
    if (title) out[title] = vals;
  }
  return out;
}

function parseTopRatios(root) {
  const out = {};
  for (const li of root.querySelectorAll('#top-ratios li')) {
    const name = clean(li.querySelector('.name')?.text || '');
    const nums = li.querySelectorAll('.number').map((n) => num(n.text));
    if (!name) continue;
    out[name] = nums.length > 1 ? nums : nums[0] ?? null;
  }
  return out;
}

function parseDocuments(root) {
  const docs = { announcements: [], annualReports: [], concalls: [], creditRatings: [] };
  for (const blk of root.querySelectorAll('#documents .documents')) {
    const h = clean(blk.querySelector('h3')?.text || '').toLowerCase();
    const items = blk.querySelectorAll('li');
    if (h.startsWith('announcements')) {
      for (const li of items) {
        const a = li.querySelector('a');
        if (!a) continue;
        const meta = clean(li.querySelector('.ink-600')?.text || '');
        const title = clean(a.text.replace(meta, ''));
        const m = meta.match(/^(\d{1,2} [A-Za-z]{3}(?: \d{4})?)\s*(?:-\s*(.*))?$/);
        docs.announcements.push({
          title,
          dateText: m ? m[1] : meta,
          date: m ? inferDate(m[1]) : null,
          note: m?.[2] || null, // screener.in's own one-liner; shown only with attribution
          url: new URL(a.getAttribute('href'), BASE).href,
        });
      }
    } else if (h.startsWith('annual')) {
      for (const li of items) {
        const a = li.querySelector('a');
        if (!a) continue;
        const m = clean(a.text).match(/(\d{4})/);
        docs.annualReports.push({ year: m ? +m[1] : null, url: a.getAttribute('href') });
      }
    } else if (h.startsWith('concalls')) {
      for (const li of items) {
        const month = clean(li.querySelector('.ink-600, .nowrap')?.text || '');
        const entry = { month, transcript: null, ppt: null, rec: null };
        for (const a of li.querySelectorAll('a')) {
          const t = clean(a.text).toLowerCase();
          const href = a.getAttribute('href');
          if (t.startsWith('transcript')) entry.transcript = href;
          else if (t === 'ppt') entry.ppt = href;
          else if (t === 'rec') entry.rec = href;
        }
        if (!entry.month) entry.month = clean(li.text).split(/Transcript|PPT|REC|Notes/)[0];
        docs.concalls.push(entry);
      }
    } else if (h.startsWith('credit')) {
      for (const li of items) {
        const a = li.querySelector('a');
        if (a) docs.creditRatings.push({ title: clean(a.text), url: a.getAttribute('href') });
      }
    }
  }
  return docs;
}

/**
 * Fetch and parse one company. Falls back to standalone if consolidated tables are empty.
 * @returns {Promise<object>} company fundamentals with source URLs
 */
export async function fetchCompany(symbol, { consolidated = true } = {}) {
  const url = screenerUrl(symbol, consolidated);
  const html = await getText(url);
  const root = parse(html);
  const nameEl = root.querySelector('h1');
  if (!nameEl || /not found/i.test(root.querySelector('title')?.text || '')) {
    throw Object.assign(new Error(`Unknown ticker ${symbol}`), { code: 'NOT_FOUND' });
  }
  const quarters = parseTable(root, 'quarters');
  const hasData = quarters && Object.values(quarters.rows).some((r) => r.some((v) => v != null));
  if (consolidated && !hasData) return fetchCompany(symbol, { consolidated: false });

  const info = root.querySelector('#company-info');
  const industry = root
    .querySelectorAll('#peers a[href^="/market/"]')
    .map((a) => clean(a.text))
    .filter(Boolean);
  const aboutEl = root.querySelector('.company-profile .about');
  const links = root
    .querySelectorAll('.company-links a')
    .map((a) => ({ text: clean(a.text), href: a.getAttribute('href') }));
  const bseHref = root.querySelector('a[href*="bseindia.com/stock-share-price/"]')?.getAttribute('href') || '';
  const bseCode = bseHref.match(/\/(\d{6})\//)?.[1] || null;

  return {
    symbol: symbol.toUpperCase(),
    name: clean(nameEl.text),
    source: url,
    consolidated,
    warehouseId: info?.getAttribute('data-warehouse-id') || null,
    companyId: info?.getAttribute('data-company-id') || null,
    bseCode,
    about: aboutEl ? clean(aboutEl.text) : null,
    website: links.find((l) => /^https?:/.test(l.href) && !/bseindia|nseindia/.test(l.href))?.href || null,
    sector: industry[0] || null,
    industry: industry[industry.length - 1] || null,
    industryPath: [...new Set(industry)],
    ratios: parseTopRatios(root),
    quarters,
    annual: parseTable(root, 'profit-loss'),
    growth: parseRanges(root),
    balanceSheet: parseTable(root, 'balance-sheet'),
    cashFlow: parseTable(root, 'cash-flow'),
    efficiency: parseTable(root, 'ratios'),
    shareholding: parseTable(root, 'shareholding'),
    documents: parseDocuments(root),
    fetchedAt: new Date().toISOString(),
  };
}

/** Pick a row by any of several candidate labels (banks / NBFCs use different names). */
export function row(table, ...names) {
  if (!table) return null;
  for (const n of names) {
    const hit = Object.keys(table.rows).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit) return table.rows[hit];
  }
  for (const n of names) {
    const hit = Object.keys(table.rows).find((k) => k.toLowerCase().startsWith(n.toLowerCase()));
    if (hit) return table.rows[hit];
  }
  return null;
}
