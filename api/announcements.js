// GET /api/announcements?days=30
// Serves the classified filing stream for the portfolio. Classification is rule-based (free, instant);
// with GEMINI_API_KEY set, material items without a FINN line get one batched gemini-3.5-flash call
// (cached), and NSE's live RSS is merged in. Without a key: cached/seed lines -> attributed notes -> subject.
import { readData, json } from '../lib/data.js';
import { filingPeriod } from '../lib/fundamentals.js';
import { classify, readCost } from '../lib/classify.js';
import { llmEnabled, summariseFilings, MODELS } from '../lib/llm.js';
import { fetchNseRss } from '../lib/nse_rss.js';
import { cacheGet, cacheSet } from '../lib/cache.js';

export async function GET(request) {
  const url = new URL(request.url);
  const days = Math.min(+url.searchParams.get('days') || 30, 90);
  const ann = readData('announcements.json', { items: [], asOf: null });
  const pf = readData('portfolio.json', { holdings: [] });
  const enrich = readData('enrichment.json', { byUrl: {} }).byUrl;
  const companies = Object.fromEntries(pf.holdings.map((h) => [h.symbol, readData(`companies/${h.symbol}.json`, {})]));
  const holdingSet = new Set(pf.holdings.map((h) => h.symbol));

  const asOf = new Date(ann.asOf || Date.now());
  const since = new Date(asOf.getTime() - days * 86400000);
  let items = ann.items.filter((i) => !i.at || new Date(i.at) >= since).map((i) => ({ ...i, ...(enrich[i.url] || {}) }));

  let live = { status: 'off' };
  if (url.searchParams.get('live') !== '0') {
    try {
      let rss = await cacheGet('nse-rss');
      if (!rss) {
        rss = await fetchNseRss();
        await cacheSet('nse-rss', rss, 300);
      }
      const known = new Set(items.map((i) => i.url));
      const fresh = rss.filter((r) => r.symbol && holdingSet.has(r.symbol) && !known.has(r.url));
      for (const r of fresh) {
        const c = classify({ title: r.title, body: r.body });
        items.unshift({ id: 'nse-' + r.url.split('/').pop().slice(0, 40), symbol: r.symbol, company: r.company, date: r.at?.slice(0, 10), at: r.at, timePrecision: 'minute', title: r.title, subject: c.subject, url: r.url, source: 'nse-rss', category: c.category, kind: c.kind, baseScore: c.score, readCost: readCost(c.category, c.score), rule: c.rule, confidence: c.confidence, live: true });
      }
      live = { status: 'ok', checked: rss.length, added: fresh.length };
    } catch (e) {
      live = { status: 'unreachable', error: e.message };
    }
  }

  let ai = { mode: llmEnabled() ? 'gemini' : 'cached', model: llmEnabled() ? MODELS.std() : null };
  if (llmEnabled()) {
    const todo = items.filter((i) => !i.line && i.baseScore >= 35 && (i.body || i.note || i.subject));
    if (todo.length) {
      try {
        const sums = await summariseFilings(todo.slice(0, 24));
        for (const i of items) if (sums[i.id]) Object.assign(i, { line: sums[i.id], lineSource: 'gemini' });
        ai.summarised = Object.keys(sums).length;
      } catch (e) {
        ai = { mode: 'cached', error: e.message };
      }
    }
  }

  // results cards carry their headline numbers; attach if missing
  for (const i of items) {
    if (i.category === 'results' && i.kind === 'results') {
      // never pair a filing with another quarter's numbers (screener can lag a fresh filing by a day or two)
      const fp = filingPeriod(`${i.title || ''} ${i.subject || ''} ${i.note || ''}`);
      const q = i.results || companies[i.symbol]?.facts?.latestQuarter || null;
      if (q && (!fp || q.period === fp)) i.results = q;
      else Object.assign(i, { results: null, resultsPending: fp });
    }
    delete i.body; // the phone doesn't need the PDF text; /api/filing serves it on demand
  }

  return json({
    asOf: ann.asOf,
    days,
    ai,
    live,
    holdings: pf.holdings.map((h) => ({ ...h, name: companies[h.symbol]?.name || h.symbol, industry: companies[h.symbol]?.industry || null, industryPath: companies[h.symbol]?.industryPath || [] })),
    items,
  });
}
