#!/usr/bin/env node
// Batch pipeline: portfolio companies -> classified, enriched filings + per-company fundamentals.
//   node scripts/ingest_filings.mjs            (all holdings + research names)
//   node scripts/ingest_filings.mjs TITAN SRF  (subset)
//
// Writes:
//   data/announcements.json   merged, de-duplicated, classified filing stream (append-only by id)
//   data/companies/<SYM>.json fundamentals + actuals used by Push result cards and Pull dossiers
//
// Runs nightly + every 30 min in market hours via GitHub Actions (.github/workflows/refresh.yml).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { fetchCompany } from '../lib/screener.js';
import { classify, readCost } from '../lib/classify.js';
import { dossierFacts, actualsIndex, attachResults } from '../lib/fundamentals.js';
import { fetchNseRss } from '../lib/nse_rss.js';
import { pdfPages } from '../lib/pdf.js';
import { sleep } from '../lib/http.js';
import { summariseFilings, llmEnabled } from '../lib/llm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const portfolio = JSON.parse(fs.readFileSync(path.join(DATA, 'portfolio.json'), 'utf8'));
const holdings = new Map(portfolio.holdings.map((h) => [h.symbol, h]));
const only = process.argv.slice(2);
const symbols = only.length ? only : [...new Set([...portfolio.holdings.map((h) => h.symbol), ...portfolio.research.map((r) => r.symbol)])];

const annPath = path.join(DATA, 'announcements.json');
const existing = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { items: [] };
const byId = new Map(existing.items.map((i) => [i.id, i]));

const idOf = (sym, url, title) => crypto.createHash('sha1').update(`${sym}|${url || title}`).digest('hex').slice(0, 12);
const dupKey = (sym, date, title) => `${sym}|${date}|${title.toLowerCase().replace(/[^a-z]/g, '').slice(0, 28)}`;

// Read the first pages of the filing PDF only when the subject alone can't tell us enough.
const NEEDS_BODY = new Set(['management_change', 'M&A', 'litigation', 'fund_raise', 'capex', 'unclassified', 'postal_ballot']);

async function bodyOf(url) {
  try {
    const pages = await pdfPages(url, { maxPages: 4 });
    return pages.join('\n').replace(/\s+/g, ' ').slice(0, 7000);
  } catch (e) {
    return null;
  }
}

const companies = {};
for (const sym of symbols) {
  process.stdout.write(`· ${sym} `);
  let c;
  try {
    c = await fetchCompany(sym);
  } catch (e) {
    console.log('ERR', e.message);
    continue;
  }
  companies[sym] = c;
  const facts = dossierFacts(c);
  fs.writeFileSync(
    path.join(DATA, 'companies', `${sym}.json`),
    JSON.stringify({ symbol: sym, name: c.name, sector: c.sector, industry: c.industry, industryPath: c.industryPath, bseCode: c.bseCode, fetchedAt: c.fetchedAt, facts, actuals: actualsIndex(c) }),
  );
  if (!holdings.has(sym)) {
    console.log('(research — fundamentals only)');
    continue;
  }
  let n = 0;
  for (const a of c.documents.announcements) {
    const id = idOf(sym, a.url, a.title);
    if (byId.has(id) && byId.get(id).bodyFetched) continue;
    let cls = classify({ title: a.title, note: a.note });
    let body = null;
    if (NEEDS_BODY.has(cls.category) || cls.subject.length < 12) {
      body = await bodyOf(a.url);
      if (body) cls = classify({ title: a.title, body, note: a.note });
      await sleep(400);
    }
    const item = {
      id,
      symbol: sym,
      company: c.name,
      date: a.date,
      at: a.date ? `${a.date}T12:00:00.000Z` : null,
      timePrecision: 'day',
      title: a.title,
      subject: cls.subject,
      note: a.note,
      noteSource: a.note ? 'screener.in' : null,
      url: a.url,
      source: 'screener/bse',
      category: cls.category,
      kind: cls.kind,
      baseScore: cls.score,
      readCost: readCost(cls.category, cls.score),
      rule: cls.rule,
      confidence: cls.confidence,
      body: body ? body.slice(0, 4000) : null,
      bodyFetched: !!body,
    };
    if (cls.category === 'results' && cls.kind === 'results') Object.assign(item, attachResults(item, c));
    byId.set(id, { ...(byId.get(id) || {}), ...item });
    n++;
  }
  console.log(`${n} filings`);
  await sleep(900);
}

// Live layer: NSE public RSS (last ~18h, all companies) filtered to holdings.
try {
  const rss = await fetchNseRss();
  const seen = new Set([...byId.values()].map((i) => dupKey(i.symbol, i.date, i.subject || i.title)));
  let added = 0;
  for (const r of rss) {
    if (!r.symbol || !holdings.has(r.symbol)) continue;
    const date = r.at?.slice(0, 10);
    const cls = classify({ title: r.title, body: r.body });
    if (seen.has(dupKey(r.symbol, date, cls.subject))) continue;
    const id = idOf(r.symbol, r.url, r.title);
    byId.set(id, {
      id, symbol: r.symbol, company: r.company, date, at: r.at, timePrecision: 'minute', title: r.title, subject: cls.subject,
      note: null, url: r.url, source: 'nse-rss', category: cls.category, kind: cls.kind, baseScore: cls.score,
      readCost: readCost(cls.category, cls.score), rule: cls.rule, confidence: cls.confidence, body: null, bodyFetched: false,
      // results numbers are attached (quarter-matched) by the re-classify pass below
    });
    added++;
  }
  console.log(`NSE RSS: ${rss.length} items, ${added} new for holdings`);
} catch (e) {
  console.log('NSE RSS unavailable:', e.message);
}

// Re-classify everything from stored text so rule improvements apply retroactively (microseconds per item).
for (const i of byId.values()) {
  const cls = classify({ title: i.title, body: i.body, note: i.note });
  Object.assign(i, { subject: cls.subject, category: cls.category, kind: cls.kind, baseScore: cls.score, readCost: readCost(cls.category, cls.score), rule: cls.rule, confidence: cls.confidence });
  if (cls.category === 'results' && cls.kind === 'results') Object.assign(i, attachResults(i, companies[i.symbol]));
  else delete i.results;
}

let items = [...byId.values()].sort((a, b) => (b.at || '').localeCompare(a.at || ''));

// Optional: one batched cheap-model call for one-line summaries of material items (cached by id).
if (llmEnabled()) {
  const todo = items.filter((i) => i.baseScore >= 40 && !i.summary && (i.body || i.note));
  if (todo.length) {
    const sums = await summariseFilings(todo);
    for (const i of items) if (sums[i.id]) Object.assign(i, { summary: sums[i.id], summarySource: 'gemini' });
    console.log(`Gemini summaries: ${Object.keys(sums).length}`);
  }
}

// Apply hand-checked enrichment overrides (people extracted from filings, etc.).
const enrichPath = path.join(DATA, 'enrichment.json');
if (fs.existsSync(enrichPath)) {
  const enrich = JSON.parse(fs.readFileSync(enrichPath, 'utf8'));
  for (const i of items) {
    const e = enrich.byUrl?.[i.url];
    if (e) Object.assign(i, e);
  }
}

fs.writeFileSync(annPath, JSON.stringify({ asOf: new Date().toISOString(), count: items.length, items }, null, 0));
console.log(`\n${items.length} filings -> data/announcements.json`);
