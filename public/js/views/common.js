import { html, fmt, pct, tone, initials, first, CATEGORY } from '../lib.js';

/** A results filing gets a headline computed from its numbers, not its boilerplate subject. */
export function headline(item) {
  if (item.category === 'results' && item.kind === 'results' && item.results?.rows) {
    const r = Object.fromEntries(item.results.rows.map((x) => [x.key, x]));
    const parts = [];
    if (r.revenue?.yoy != null) parts.push(`revenue ${pct(r.revenue.yoy, 0)}`);
    if (r.pat?.yoy != null) parts.push(`profit ${pct(r.pat.yoy, 0)}`);
    const m = item.results.margins?.ebitda;
    if (m?.cur != null && m?.yago != null) parts.push(`margin ${m.cur > m.yago ? 'up' : m.cur < m.yago ? 'down' : 'flat'} ${fmt(Math.abs(m.cur - m.yago), 1)} pts`);
    return `${item.results.period} results: ${parts.join(', ')} YoY`;
  }
  if (item.category === 'results' && item.resultsPending && !item.line) return `${item.resultsPending} quarter results are out`;
  return item.line || item.note || cleanSubject(item);
}

export function cleanSubject(item) {
  const s = (item.subject || item.title || '').replace(/_/g, ' ').replace(/\s+-\s+/g, ' — ').trim();
  if (!s || s.length < 6) return item.note || item.title || CATEGORY[item.category];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sourceNote(item) {
  if (item.category === 'results' && item.results) return 'Numbers: exchange-filed results, standardised by screener.in';
  if (item.category === 'results' && item.resultsPending) return `Filed ${item.date}. Standardised numbers for ${item.resultsPending} aren't out yet; FINN won't show you last quarter's instead. Open the filing for the raw statement.`;
  if (item.lineSource === 'gemini') return 'FINN summary (Gemini) of the filing';
  if (item.lineSource === 'filing') return 'FINN read the filing';
  if (item.note) return `Summary: screener.in's note on the filing · subject “${cleanSubject(item).slice(0, 70)}”`;
  return 'Exchange subject line';
}

export function ResultsMini({ results }) {
  if (!results?.rows) return null;
  const pick = ['revenue', 'ebitda', 'pbt', 'pat'];
  const lab = { revenue: 'Rev', ebitda: results.isFinancial ? 'PPOP' : 'EBITDA', pbt: 'PBT', pat: 'PAT' };
  const rows = Object.fromEntries(results.rows.map((r) => [r.key, r]));
  return html`<div class="mini-results">${pick.map((k) => rows[k] && html`<div><div class="k">${lab[k]}</div><div class="v">${fmt(rows[k].value)}</div><div class="d ${tone(rows[k].yoy)}">${pct(rows[k].yoy, 0)} YoY</div></div>`)}</div>`;
}

export function ResultsTable({ results }) {
  if (!results?.rows) return null;
  const m = results.margins;
  return html`<table class="fig">
    <thead><tr><th>₹ crore</th><th>${results.period}</th><th>QoQ</th><th>YoY</th></tr></thead>
    <tbody>
      ${results.rows.map((r) => html`<tr><td>${r.label}</td><td class="v">${fmt(r.value)}</td><td class="v ${tone(r.qoq)}">${pct(r.qoq)}</td><td class="v ${tone(r.yoy)}">${pct(r.yoy)}</td></tr>`)}
      ${m?.ebitda?.cur != null && html`<tr><td>${results.isFinancial ? 'PPOP margin' : 'EBITDA margin'}</td><td class="v">${fmt(m.ebitda.cur, 1)}%</td><td class="v ${tone(m.ebitda.cur - m.ebitda.prev)}">${m.ebitda.prev != null ? `${m.ebitda.cur - m.ebitda.prev > 0 ? '+' : ''}${fmt(m.ebitda.cur - m.ebitda.prev, 1)} pt` : '—'}</td><td class="v ${tone(m.ebitda.cur - m.ebitda.yago)}">${m.ebitda.yago != null ? `${m.ebitda.cur - m.ebitda.yago > 0 ? '+' : ''}${fmt(m.ebitda.cur - m.ebitda.yago, 1)} pt` : '—'}</td></tr>`}
      ${m?.pat?.cur != null && html`<tr><td>PAT margin</td><td class="v">${fmt(m.pat.cur, 1)}%</td><td class="v ${tone(m.pat.cur - m.pat.prev)}">${m.pat.prev != null ? `${m.pat.cur - m.pat.prev > 0 ? '+' : ''}${fmt(m.pat.cur - m.pat.prev, 1)} pt` : '—'}</td><td class="v ${tone(m.pat.cur - m.pat.yago)}">${m.pat.yago != null ? `${m.pat.cur - m.pat.yago > 0 ? '+' : ''}${fmt(m.pat.cur - m.pat.yago, 1)} pt` : '—'}</td></tr>`}
    </tbody>
  </table>
  <div class="src" style="margin-top:6px;font-size:11.5px;color:var(--faint)">vs ${results.prevPeriod} (QoQ) and ${results.yagoPeriod || '—'} (YoY)${results.otherIncomeShareOfPbt > 20 ? html` · <span class="accent">other income is ${fmt(results.otherIncomeShareOfPbt)}% of PBT</span>` : ''}</div>`;
}

export const Avatar = ({ name, ext, cold, lg }) => html`<span class="avatar ${ext ? 'ext' : ''} ${cold ? 'cold' : ''} ${lg ? 'lg' : ''}" aria-hidden="true">${initials(name)}</span>`;
export const Strength = ({ v }) => html`<span class="strength" title=${`tie strength ${Math.round((v ?? 0) * 100)}%`}><i style=${`width:${Math.round((v ?? 0) * 100)}%`}></i></span>`;

export function whatHappened(item) {
  const p = item.people?.[0];
  if (p) return `${p.action === 'resigned' ? 'lost' : p.action === 'retired' ? 'seen the retirement of' : 'named'} ${p.name} ${p.action === 'resigned' || p.action === 'retired' ? `(${p.role})` : `as ${p.role}`}`;
  const h = headline(item).replace(/\.$/, '');
  return `filed “${h.length > 100 ? h.slice(0, h.lastIndexOf(' ', 98)) + '…' : h}”`;
}

export function waLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
export { first };
