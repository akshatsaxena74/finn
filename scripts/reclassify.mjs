#!/usr/bin/env node
// Re-run the classifier over stored filings (no network). Useful after editing lib/classify.js rules.
import fs from 'node:fs';
import { classify, readCost } from '../lib/classify.js';
import { attachResults } from '../lib/fundamentals.js';
const company = (sym) => { try { return JSON.parse(fs.readFileSync(new URL(`../data/companies/${sym}.json`, import.meta.url), 'utf8')); } catch { return null; } };
const p = new URL('../data/announcements.json', import.meta.url);
const a = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const i of a.items) {
  if (i.url?.startsWith('/')) i.url = 'https://www.screener.in' + i.url;
  const c = classify({ title: i.title, body: i.body, note: i.note });
  Object.assign(i, { subject: c.subject, category: c.category, kind: c.kind, baseScore: c.score, readCost: readCost(c.category, c.score), rule: c.rule, confidence: c.confidence });
  if (c.category === 'results' && c.kind === 'results') Object.assign(i, attachResults(i, company(i.symbol)));
  else delete i.results;
}
fs.writeFileSync(p, JSON.stringify(a));
const rows = a.items.map((i) => [i.baseScore, i.date, i.symbol, i.category, i.rule.split(':')[0], (i.subject || '').slice(0, 55)]).sort((x, y) => y[0] - x[0]);
for (const r of rows.slice(0, +(process.argv[2] || 35))) console.log(r.join(' | '));
