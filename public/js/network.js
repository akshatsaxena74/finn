// The Network layer — runs entirely on the investor's device.
// FINN's server only ever sees public data (filings, prices, fundamentals). The private graph of who the
// investor knows is loaded into this module in the browser and joined against public events locally.
import { store, first, monthsSince } from './util.js';

const STOP = /\b(limited|ltd|pvt|private|the|india|co|company|corporation|corp|inc|llp|group|&)\b\.?/g;
export const normOrg = (s = '') => s.toLowerCase().replace(/&/g, ' ').replace(STOP, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const normName = (s = '') => s.toLowerCase().replace(/\b(mr|ms|mrs|dr|shri)\.?\s+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

function sameName(a, b) {
  const A = normName(a).split(' '), B = normName(b).split(' ');
  if (!A.length || !B.length) return false;
  const lastA = A[A.length - 1], lastB = B[B.length - 1];
  if (lastA !== lastB) return false;
  return A[0] === B[0] || A[0][0] === B[0][0];
}

const REL_W = { 'jv-partner': 0.78, competitor: 0.62, supplier: 0.6, customer: 0.6, regulator: 0.66, parent: 0.7, subsidiary: 0.72, acquirer: 0.7 };
const REL_TXT = { 'jv-partner': 'JV partner', competitor: 'a competitor', supplier: 'a supplier', customer: 'a customer', regulator: 'the regulator', parent: 'the parent', subsidiary: 'a subsidiary', acquirer: 'the acquirer' };

export class Network {
  constructor(net, orgs, { now = Date.now(), holdings = [] } = {}) {
    this.me = net.me;
    this.people = net.people || [];
    this.now = now;
    this.orgs = orgs.orgs || {};
    this.alias = new Map();
    for (const [name, o] of Object.entries(this.orgs)) {
      this.alias.set(normOrg(name), name);
      for (const a of o.aliases || []) this.alias.set(normOrg(a), name);
    }
    this.bySymbol = {};
    for (const [name, o] of Object.entries(this.orgs)) if (o.symbol) this.bySymbol[o.symbol] = name;
    this.holdings = Object.fromEntries(holdings.map((h) => [h.symbol, h]));
    this.byId = Object.fromEntries(this.people.map((p) => [p.id, p]));
  }

  canon(org) {
    if (!org) return null;
    return this.alias.get(normOrg(org)) || org;
  }
  orgOf(symbol) {
    return this.bySymbol[symbol] || null;
  }
  /** orgs with a stated relationship to a listed company */
  related(symbol) {
    const out = [];
    for (const [name, o] of Object.entries(this.orgs)) for (const r of o.relations || []) if (r.symbol === symbol) out.push({ org: name, type: r.type });
    return out;
  }
  tagsOf(symbol) {
    const name = this.orgOf(symbol);
    return [...new Set([...(this.orgs[name]?.tags || []), ...(this.holdings[symbol]?.theme || [])].map((t) => t.toLowerCase()))];
  }
  warmth(p) {
    const m = p.relationship?.lastContact ? monthsSince(p.relationship.lastContact, this.now) : 24;
    return { months: m, label: m <= 1 ? 'spoke recently' : m < 6 ? `${m} mo since you spoke` : `cold · ${m} mo`, cold: m >= 6 };
  }
  stints(p) {
    const list = [...(p.career || [])];
    if (p.current && !list.some((c) => this.canon(c.org) === this.canon(p.current.org))) list.push({ ...p.current, to: null });
    return list.map((c) => ({ ...c, canon: this.canon(c.org) }));
  }

  // ------------------------------------------------------------ who should I call?
  /**
   * Rank contacts for a company / event.
   * @param {{symbol?:string, tags?:string[], orgs?:string[], people?:Array, limit?:number}} q
   */
  whoToCall({ symbol, tags = [], orgs = [], people = [], limit = 5 } = {}) {
    const home = symbol ? this.orgOf(symbol) : null;
    const rel = symbol ? this.related(symbol) : [];
    const extra = orgs.map((o) => ({ org: this.canon(o), type: this.orgs[this.canon(o)]?.relations?.find((r) => r.symbol === symbol)?.type || 'related' }));
    const relAll = [...rel, ...extra.filter((e) => !rel.some((r) => r.org === e.org))];
    const themeTags = [...new Set([...(symbol ? this.tagsOf(symbol) : []), ...tags.map((t) => t.toLowerCase())])];
    const eventTags = tags.map((t) => t.toLowerCase());
    const yearNow = new Date(this.now).getFullYear();
    const res = [];
    for (const p of this.people) {
      const reasons = [];
      for (const s of this.stints(p)) {
        if (home && s.canon === home) {
          const current = s.to == null;
          const since = current ? 0 : yearNow - s.to;
          reasons.push({ w: current ? 1 : Math.max(0.6, 0.92 - since * 0.04), kind: 'worked-there', text: current ? `Works at ${short(home)} now — ${s.title}` : `Was at ${short(home)} ${s.from ?? ''}–${s.to} as ${s.title}` });
        }
        const r = relAll.find((x) => x.org === s.canon);
        if (r) reasons.push({ w: REL_W[r.type] || 0.55, kind: 'adjacent', text: `${s.to == null ? 'At' : 'Was at'} ${short(s.canon)}${REL_TXT[r.type] ? ` (${REL_TXT[r.type]})` : ''}${s.from ? `, ${s.from}–${s.to ?? 'now'}` : ''} — ${s.title}` });
      }
      for (const lt of p.livedThrough || []) {
        const hit = (lt.tags || []).map((t) => t.toLowerCase()).filter((t) => eventTags.includes(t));
        if (!hit.length) continue;
        const where = this.canon(lt.org);
        const atHome = home && where === home;
        const atRel = where && relAll.some((r) => r.org === where);
        // "lived through a capex project" is weak evidence; "lived through an MPCB closure at this very company" is not
        const specific = hit.some((t) => !GENERIC_TAGS.has(t));
        const w = atHome ? 0.92 : atRel ? 0.82 : specific ? 0.74 : 0.42;
        reasons.push({ w, kind: 'lived', text: `${atHome ? `Lived through this at ${short(home)}` : 'Lived through it'}: ${lt.event}${lt.year ? ` (${lt.year})` : ''}` });
      }
      for (const fp of people) {
        const k = (p.knows || []).find((x) => sameName(x.name, fp.name));
        if (k) reasons.push({ w: 0.7 + 0.25 * (k.strength ?? 0.5), kind: 'knows', text: `Knows ${fp.name} — ${k.context}` });
        for (const o of this.overlapPairs(p, fp)) reasons.push({ w: o.w, kind: 'overlap', text: o.text });
      }
      const ex = (p.expertise || []).filter((e) => themeTags.includes(e.toLowerCase()) || eventTags.includes(e.toLowerCase()));
      if (ex.length) reasons.push({ w: 0.45 + 0.05 * ex.length, kind: 'expertise', text: `Go-to on ${ex.slice(0, 3).join(', ')}` });
      if (!reasons.length) continue;
      reasons.sort((a, b) => b.w - a.w);
      const warm = this.warmth(p);
      // relevance leads; tie strength and recency only modulate who you'd actually ring first
      const score = combine(reasons) * tie(p) * (warm.cold ? 0.95 : 1);
      res.push({ person: p, score, reasons: dedupeReasons(reasons).slice(0, 3), warm });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** contacts relevant to a filing (used for ranking + the card's people line) */
  forItem(item, { limit = 3 } = {}) {
    if (item.category === 'unclassified' || item.category === 'investor_meetings') return [];
    const r = this.whoToCall({ symbol: item.symbol, tags: item.eventTags || [], orgs: item.orgs || [], people: item.people || [], limit: 8 });
    // for the badge, only count strong, specific links (not mere theme expertise)
    return r.filter((x) => x.reasons[0].kind !== 'expertise' || x.score > 0.5).slice(0, limit);
  }

  // ------------------------------------------------------------ diligence on a person from a filing
  overlapPairs(contact, target) {
    const out = [];
    const T = (target.career || []).map((c) => ({ ...c, canon: this.canon(c.org) }));
    for (const s of this.stints(contact)) {
      for (const t of T) {
        if (!s.canon || s.canon !== t.canon) continue;
        const a0 = s.from ?? -Infinity, a1 = s.to ?? 9999, b0 = t.from ?? -Infinity, b1 = t.to ?? 9999;
        const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
        if (t.from == null && t.to == null) {
          out.push({ w: 0.55, org: s.canon, link: `you were at ${short(s.canon)} too`, text: `Both at ${short(s.canon)} — ${first(contact.name)} ${s.from ?? ''}–${s.to ?? 'now'}; ${target.name}'s dates aren't in the filing` });
        } else if (hi >= lo && Number.isFinite(lo)) {
          const yrs = Math.min(hi, new Date(this.now).getFullYear()) - lo;
          const span = `${lo}–${hi >= 9999 ? 'now' : hi}`;
          out.push({ w: Math.min(0.92, 0.66 + 0.06 * Math.max(1, yrs)), org: s.canon, link: `you overlapped at ${short(s.canon)}, ${span}`, text: `Overlapped with ${target.name} at ${short(s.canon)}, ${span}${t.title && !/^(joined|moved|served|was)\b/i.test(t.title) ? ` — ${first(target.name)} was ${t.title}` : ''}` });
        }
      }
    }
    for (const e of contact.education || []) {
      for (const te of target.education || []) {
        if (normOrg(e.institution) !== normOrg(te.institution)) continue;
        const close = te.year == null || e.to == null || Math.abs((te.year || e.to) - e.to) <= 3;
        out.push({ w: close && te.year != null ? 0.6 : 0.42, org: e.institution, link: `you're both ${e.institution} alumni`, text: te.year != null && close ? `Studied at ${e.institution} at the same time` : `Fellow ${e.institution} alum (${e.from ?? ''}–${e.to ?? ''})` });
      }
    }
    return out;
  }

  /** Everything the investor's network says about one person (e.g. an incoming CEO). */
  diligence(target, symbol) {
    const direct = [];
    for (const p of this.people) {
      const reasons = [];
      const k = (p.knows || []).find((x) => sameName(x.name, target.name));
      if (k) reasons.push({ w: 0.75 + 0.25 * (k.strength ?? 0.5), kind: 'knows', link: `you know ${first(target.name)} personally`, text: `Knows ${first(target.name)} personally — ${k.context}` });
      reasons.push(...this.overlapPairs(p, target));
      if (!reasons.length) continue;
      reasons.sort((a, b) => b.w - a.w);
      direct.push({ person: p, score: combine(reasons) * tie(p), reasons: dedupeReasons(reasons).slice(0, 2), link: reasons[0].link, warm: this.warmth(p) });
    }
    direct.sort((a, b) => b.score - a.score);
    // you, yourself
    const you = [];
    for (const e of this.me.education || []) for (const te of target.education || []) if (normOrg(e.institution) === normOrg(te.institution)) you.push(`You're both ${e.institution} alumni`);
    for (const c of this.me.career || []) for (const t of target.career || []) if (this.canon(c.org) === this.canon(t.org)) you.push(`You were both at ${short(this.canon(c.org))}`);
    // second degree: contacts who know someone who overlapped with the target
    const hops = [];
    for (const p of this.people) {
      for (const k of p.knows || []) {
        if (sameName(k.name, target.name)) continue;
        const via = { name: k.name, career: k.org ? [{ org: k.org, from: null, to: null }] : [], education: [] };
        const yearNow = new Date(this.now).getFullYear();
        const older = { ...target, career: (target.career || []).filter((c) => !(c.to == null && (c.from ?? 0) >= yearNow - 1)) };
        const ov = this.overlapPairs(via, older);
        if (ov.length && !direct.some((d) => d.person.id === p.id)) hops.push({ person: p, via: k, org: ov[0].org, score: (p.relationship?.strength ?? 0.5) * (k.strength ?? 0.5) });
      }
    }
    // one line per introducer target: "Rohan, Karthik and Arvind know Anup Bagchi (HDFC Bank), a colleague of Sanjay's"
    const byVia = {};
    for (const h of hops.sort((a, b) => b.score - a.score)) (byVia[h.via.name] ||= []).push(h);
    const grouped = Object.values(byVia).map((hs) => {
      const names = hs.map((h) => first(h.person.name));
      const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
      return { person: hs[0].person, via: hs[0].via, score: hs[0].score, text: `${who} ${names.length === 1 ? 'knows' : 'know'} ${hs[0].via.name} (${short(hs[0].org)}), a colleague of ${first(target.name)}'s` };
    });
    return { direct: direct.slice(0, 5), you: [...new Set(you)], hops: grouped.slice(0, 3) };
  }

  // ------------------------------------------------------------ second-degree reach
  pathTo(name) {
    const paths = [];
    for (const p of this.people) {
      const s1 = p.relationship?.strength ?? 0.5;
      if (sameName(p.name, name)) paths.push({ hops: [p], strength: s1, text: 'Direct contact' });
      for (const k of p.knows || []) if (sameName(k.name, name)) paths.push({ hops: [p, { name: k.name, org: k.org }], strength: s1 * (k.strength ?? 0.5), text: k.context });
    }
    return paths.sort((a, b) => b.strength - a.strength).slice(0, 4);
  }

  // ------------------------------------------------------------ expertise map
  themes() {
    const m = {};
    for (const p of this.people) for (const e of p.expertise || []) (m[e.toLowerCase()] ||= []).push(p);
    return Object.entries(m).map(([theme, ps]) => ({ theme, people: ps.sort((a, b) => (b.relationship?.strength ?? 0) - (a.relationship?.strength ?? 0)) })).sort((a, b) => b.people.length - a.people.length);
  }
  expertise(q) {
    const t = q.toLowerCase().trim();
    const words = t.split(/\s+/).filter((w) => w.length > 2);
    const res = [];
    for (const p of this.people) {
      const reasons = [];
      for (const e of p.expertise || []) if (e.toLowerCase().includes(t) || words.every((w) => e.toLowerCase().includes(w))) reasons.push({ w: 1, text: `Go-to on ${e}` });
      for (const lt of p.livedThrough || []) if ((lt.tags || []).some((x) => x.toLowerCase().includes(t)) || lt.event.toLowerCase().includes(t)) reasons.push({ w: 0.85, text: `Lived through: ${lt.event}${lt.year ? ` (${lt.year})` : ''}` });
      for (const s of this.stints(p)) {
        const tags = this.orgs[s.canon]?.tags || [];
        if (tags.some((x) => x.toLowerCase().includes(t)) || normOrg(s.canon).includes(normOrg(t))) reasons.push({ w: 0.7, text: `${s.to == null ? 'At' : 'Was at'} ${short(s.canon)} (${s.from ?? '?'}–${s.to ?? 'now'}) — ${s.title}` });
      }
      if (reasons.length) {
        reasons.sort((a, b) => b.w - a.w);
        res.push({ person: p, score: combine(reasons) * tie(p), reasons: dedupeReasons(reasons).slice(0, 2), warm: this.warmth(p) });
      }
    }
    return res.sort((a, b) => b.score - a.score);
  }

  // ------------------------------------------------------------ keep the network warm
  keepWarm(stories, { limit = 4, describe = (st) => st.lead.line || st.lead.subject || '' } = {}) {
    const cands = [];
    for (const st of stories) {
      if (st.score < 30) continue;
      const home = this.orgOf(st.symbol);
      for (const p of this.people) {
        const w = this.warmth(p);
        if (w.months < 5) continue;
        const stint = this.stints(p).find((s) => s.canon === home);
        const rel = !stint && this.related(st.symbol).find((r) => this.stints(p).some((s) => s.canon === r.org));
        if (!stint && !rel) continue;
        cands.push({
          person: p,
          story: st,
          warm: w,
          relOrg: stint ? null : short(rel.org),
          why: stint
            ? `${short(home)}, where ${first(p.name)} ${stint.to == null ? 'works' : `worked ${stint.from ?? ''}–${stint.to}`}, just filed: ${clip(describe(st), 90)}`
            : `${first(p.name)} was at ${short(rel.org)}, ${REL_TXT[rel.type] ? REL_TXT[rel.type] + ' of' : 'related to'} ${st.symbol}, which just filed: ${clip(describe(st), 80)}`,
          score: (p.relationship?.strength ?? 0.5) * (st.score / 100) * Math.min(2, w.months / 6) * (stint ? 1 : 0.6),
        });
      }
    }
    // best first; one nudge per company and per person so the list stays varied
    const out = [], usedP = new Set(), usedS = new Set();
    for (const c of cands.sort((a, b) => b.score - a.score)) {
      if (usedP.has(c.person.id) || usedS.has(c.story.symbol)) continue;
      usedP.add(c.person.id);
      usedS.add(c.story.symbol);
      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  }

  opener(p, ctx = {}) {
    const f = first(p.name);
    if (ctx.kind === 'reconnect') return `Hi ${f} — it's been a while! Saw ${ctx.company} in the filings this week (${ctx.what}). Made me think of your time there — would love 15 minutes on how you'd read it. Coffee soon?`;
    if (ctx.target) {
      const t = first(ctx.target);
      ctx = { ...ctx, what: ctx.what.replace(/\s+(Ltd\.?|Limited)\b/i, '') };
      return ctx.leaving
        ? `Hi ${f}, quick one — ${ctx.target} has ${ctx.what}. You know that team well (${ctx.link}). Was this coming, and who really runs the business now?`
        : `Hi ${f}, quick one — ${ctx.target} has ${ctx.what}. You've crossed paths (${ctx.link}). How does ${t} operate, and what would you watch for in the first year?`;
    }
    if (ctx.kind === 'reconnect-adjacent') return `Hi ${f} — it's been a while! ${ctx.company} is in the filings this week (${ctx.what}) and it's right next door to ${ctx.org}. Would love your read over coffee soon?`;
    const co = (ctx.company || '').replace(/\s+(Ltd\.?|Limited)$/i, '');
    return `Hi ${f}, hope you're well. ${co ? `${co} just ${ctx.what || 'filed something material'}` : 'Something came up'}. Given your ${ctx.angle || 'background'}, could I borrow 15 minutes this week for your read?`;
  }
}

/** several independent reasons compound with diminishing returns (sorted desc) */
const combine = (rs) => {
  const seen = new Set();
  const best = rs.filter((r) => (seen.has(r.kind) ? false : (seen.add(r.kind), true)));
  return best.slice(0, 3).reduce((acc, r, i) => acc + (1 - acc) * r.w * [1, 0.5, 0.25][i], 0);
};
const GENERIC_TAGS = new Set(['capex', 'plant commissioning', 'capacity ramp', 'launch', 'project execution', 'board', 'governance', 'acquisition', 'merger integration', 'strategy reset', 'transformation', 'network rollout', 'diversification', 'leadership exit']);
const tie = (p) => 0.7 + 0.3 * (p.relationship?.strength ?? 0.5);
const short = (o = '') => o.replace(/ (Limited|Ltd\.?|Private|Pvt\.?)$/i, '').replace(/([^&]) Company$/, '$1');
export const clip = (t = '', n = 80) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1) > n * 0.6 ? t.lastIndexOf(' ', n - 1) : n - 1).replace(/[,;:—-]\s*$/, '') + '…');
function dedupeReasons(rs) {
  const seen = new Set();
  return rs.filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)));
}

// ------------------------------------------------------------ local store (device only)
export async function loadNetwork() {
  const local = store.get('network', null);
  const [orgs, demo] = await Promise.all([fetch('/demo/orgs.json').then((r) => r.json()), local ? null : fetch('/demo/network.json').then((r) => r.json())]);
  return { net: local || demo, orgs, source: local ? 'device' : 'demo' };
}

/** LinkedIn "Connections.csv" export -> people (the realistic, consented way to seed FINN). */
export function importLinkedInCsv(text) {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /first name/i.test(l) && /company/i.test(l));
  if (hi < 0) throw new Error('Not a LinkedIn Connections export (no header row found)');
  const head = splitCsv(lines[hi]).map((h) => h.toLowerCase().trim());
  const col = (n) => head.findIndex((h) => h === n);
  const out = [];
  for (const l of lines.slice(hi + 1)) {
    if (!l.trim()) continue;
    const c = splitCsv(l);
    const name = `${c[col('first name')] || ''} ${c[col('last name')] || ''}`.trim();
    if (!name) continue;
    const org = c[col('company')] || '';
    const title = c[col('position')] || '';
    const on = c[col('connected on')] || '';
    out.push({ id: 'li' + out.length, name, headline: [title, org].filter(Boolean).join(', '), current: org ? { org, title, from: null } : null, career: org ? [{ org, title, from: null, to: null }] : [], education: [], expertise: [], livedThrough: [], knows: [], relationship: { how: 'LinkedIn connection', since: on ? new Date(on).getFullYear() : null, strength: 0.4, lastContact: on ? new Date(on).toISOString().slice(0, 10) : null }, source: 'linkedin-export' });
  }
  return out;
}
function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
