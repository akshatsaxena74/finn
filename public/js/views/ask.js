// Ask FINN: a small on-device intent parser. Deliberately not an LLM call — people questions
// (who knows whom) must not leave the phone, and the grammar of an investor's questions is narrow.
import { html, first } from '../lib.js';
import { Avatar, Strength } from './common.js';

function findCompany(text, ctx) {
  const t = text.toLowerCase();
  const list = [...ctx.data.ann.holdings, ...['AARTIIND', 'PIIND', 'JUBLFOOD'].map((s) => ({ symbol: s, name: s }))];
  for (const h of list) if (new RegExp(`\\b${h.symbol.toLowerCase()}\\b`).test(t)) return h.symbol;
  for (const h of list) {
    const core = (h.name || '').toLowerCase().replace(/\b(ltd|limited|india|industries|company|co|the|technology|technologies|&)\b\.?/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
    if (core && core.length > 3 && t.includes(core)) return h.symbol;
  }
  const raw = text.match(/\b([A-Z][A-Z0-9&-]{2,15})\b/);
  return raw ? raw[1] : null;
}

function filingPeople(ctx) {
  const m = new Map();
  for (const i of ctx.data.ann.items) for (const p of i.people || []) if (!m.has(p.name)) m.set(p.name, { p, symbol: i.symbol, item: i });
  return [...m.values()];
}

export function parseAsk(text, ctx) {
  const { network, nav } = ctx;
  const t = text.trim();
  const l = t.toLowerCase();
  if (!t) return { type: 'none' };
  if (/\b(what changed|today|this week|digest|my brief|morning)\b/.test(l)) return { go: () => nav.tab('brief') };
  if (/\b(alert|tripwire|threshold|unusual)\b/.test(l)) return { go: () => nav.open('tripwires') };

  const fp = filingPeople(ctx);
  const personHit = fp.find(({ p }) => l.includes(p.name.toLowerCase()) || l.includes(p.name.split(' ').slice(-1)[0].toLowerCase() + ' ') && l.includes(p.name.split(' ')[0].toLowerCase()));
  const contact = network.people.find((p) => l.includes(p.name.toLowerCase()));

  let m;
  if ((m = l.match(/^(research|dig( into)?|analy[sz]e|deep dive( on| into)?|open)\s+(.+)/))) {
    const sym = findCompany(t, ctx) || m[4].toUpperCase().replace(/[^A-Z0-9&-]/g, '');
    return { go: () => nav.dig(sym) };
  }
  if (/\b(path to|intro(duction)? to|reach|get to|who knows)\b/.test(l) && (personHit || /path to|intro|reach|get to/.test(l))) {
    const name = personHit?.p.name || t.replace(/.*\b(path to|introduction to|intro to|reach|get to|who knows)\b/i, '').replace(/[?.]/g, '').trim();
    const paths = network.pathTo(name);
    const dil = personHit ? network.diligence(personHit.p, personHit.symbol) : null;
    return { type: 'path', name, paths, dil, subject: personHit };
  }
  if (/\b(brief me on|who is|background on|diligence on|tell me about)\b/.test(l)) {
    if (personHit) return { type: 'path', name: personHit.p.name, paths: network.pathTo(personHit.p.name), dil: network.diligence(personHit.p, personHit.symbol), subject: personHit };
    if (contact) return { go: () => nav.open('person', { person: contact }) };
    const sym = findCompany(t, ctx);
    if (sym) return { go: () => nav.dig(sym) };
  }
  const sym = findCompany(t, ctx);
  if (/\b(who|anyone|someone|experts?|go-to|call)\b/.test(l) && sym && ctx.data.ann.holdings.some((h) => h.symbol === sym)) {
    const story = null;
    return { type: 'people', title: `Who can explain ${sym}`, rows: network.whoToCall({ symbol: sym, tags: /jv|joint venture|vishay|osat/.test(l) ? ['jv', 'osat', 'semiconductors'] : [], orgs: /vishay/.test(l) ? ['Vishay Intertechnology'] : [], limit: 6 }) };
  }
  m = l.match(/(?:who (?:knows|understands|can explain|can help with|has worked in)|experts? (?:on|in)|go-to (?:for|on)|lived through|been through|experience (?:with|of|in))\s+(?:an?\s+|the\s+)?(.+?)\??$/);
  const theme = (m?.[1] || l).replace(/[?.]/g, '').replace(/\bplant shutdown\b/, 'shutdown').trim();
  const rows = network.expertise(theme);
  if (rows.length) return { type: 'people', title: `Your go-to people on “${theme}”`, rows: rows.slice(0, 6) };
  if (contact) return { go: () => nav.open('person', { person: contact }) };
  if (sym && /^[A-Z0-9&-]{3,15}$/.test(t.toUpperCase().trim())) return { go: () => nav.dig(sym) };
  return { type: 'none', text: t };
}

export function AskAnswer({ a, network, nav }) {
  if (a.type === 'none') return html`<div class="quiet">Nothing in your network or portfolio matches “${a.text}”. Try a theme (“specialty chemicals”), a person, or a ticker.</div>`;
  if (a.type === 'people')
    return html`<div class="panel people-panel answer"><h4>${a.title}</h4>${a.rows.map((r) => html`<div class="person-row"><${Avatar} name=${r.person.name} cold=${r.warm?.cold} /><div class="body"><div class="name"><button onClick=${() => nav.open('person', { person: r.person })}>${r.person.name}</button> <${Strength} v=${r.person.relationship?.strength} /> <span class="sub">${r.warm?.label || ''}</span></div><div class="sub">${r.person.headline}</div>${r.reasons.map((x) => html`<div class="reason">${x.text}</div>`)}</div></div>`)}</div>`;
  if (a.type === 'path')
    return html`<div class="answer">
      ${a.subject && html`<div class="kicker">${a.subject.p.role} · ${a.subject.symbol}</div>`}
      <div class="panel people-panel"><h4>Your way to ${a.name}</h4>
        ${a.dil?.you?.map((t) => html`<div class="reason"><b>${t}</b></div>`)}
        ${a.paths.map((p) => html`<div class="person-row"><${Avatar} name=${p.hops[0].name} /><div class="body"><div class="name">You → <button onClick=${() => nav.open('person', { person: p.hops[0] })}>${p.hops[0].name}</button>${p.hops[1] ? ` → ${p.hops[1].name}` : ''}</div><div class="sub">path strength ${Math.round(p.strength * 100)}% · ${p.text}</div></div></div>`)}
        ${a.dil?.direct?.map((d) => html`<div class="person-row"><${Avatar} name=${d.person.name} cold=${d.warm.cold} /><div class="body"><div class="name"><button onClick=${() => nav.open('person', { person: d.person })}>${d.person.name}</button> <${Strength} v=${d.person.relationship?.strength} /></div>${d.reasons.map((x) => html`<div class="reason">${x.text}</div>`)}</div></div>`)}
        ${!a.paths.length && !a.dil?.direct?.length && !a.dil?.you?.length && html`<div class="muted">No path found in your network.</div>`}
      </div>
      ${a.subject && html`<button class="btn sec" onClick=${() => nav.open('story', { story: { id: a.subject.item.id, symbol: a.subject.symbol, lead: { ...a.subject.item, score: a.subject.item.baseScore }, items: [{ ...a.subject.item, score: a.subject.item.baseScore }], categories: [a.subject.item.category], why: [], net: [] } })}>Open the filing</button>`}
    </div>`;
  return null;
}
