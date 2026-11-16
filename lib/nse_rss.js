// NSE's public "Latest Announcements" RSS feed (published for consumption; ~18h rolling window).
import { getText } from './http.js';

export const NSE_RSS = 'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const unxml = (s) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

/** "15-Nov-2026 17:20:27" (IST) -> ISO UTC */
function parseNseDate(s) {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const utc = Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5], +(m[6] || 0)) - 330 * 60000;
  return new Date(utc).toISOString();
}

export const normCo = (s) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|the|company|co|corporation|corp|india|industries|inc)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export async function fetchNseRss() {
  const xml = await getText(NSE_RSS, { timeoutMs: 15000, accept: 'application/rss+xml,application/xml,text/xml' });
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => unxml(m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || '');
    const desc = get('description');
    const subject = desc.split('|SUBJECT:')[1]?.trim() || desc.replace(/^.*?has informed the Exchange (about|regarding)\s*/i, '');
    const symbol = get('link').match(/\/corporate\/([A-Z0-9&-]+)_\d{8,}/)?.[1] || null;
    items.push({ company: get('title'), symbol, title: subject, body: desc, url: get('link'), at: parseNseDate(get('pubDate')), source: 'nse-rss' });
  }
  return items;
}
