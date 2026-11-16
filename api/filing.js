// GET /api/filing?id=<id> — one filing with its PDF text excerpt and extracted people.
// With GEMINI_API_KEY, a management-change filing that has no curated people gets them extracted on demand.
import { readData, json } from '../lib/data.js';
import { llmEnabled, extractPeople } from '../lib/llm.js';
import { bodyCore } from '../lib/classify.js';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  const ann = readData('announcements.json', { items: [] });
  const item = ann.items.find((i) => i.id === id);
  if (!item) return json({ error: 'not found' }, { status: 404, cache: 'no-store' });
  const e = readData('enrichment.json', { byUrl: {} }).byUrl[item.url] || {};
  const out = { ...item, ...e, excerpt: bodyCore(item.body || '').slice(0, 1400) };
  delete out.body;
  if (!out.people && item.category === 'management_change' && llmEnabled() && item.body) {
    try {
      out.people = (await extractPeople(item)).map((p) => ({ ...p, profileSource: 'gemini (filing text)' }));
    } catch {
      /* show the filing excerpt instead */
    }
  }
  return json(out);
}
