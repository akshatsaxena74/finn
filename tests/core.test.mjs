// node --test tests/   (zero dependencies; exercises the deterministic core: code decides, models only read)
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/classify.js';
import { parseTarget, verifyQuote, metricOf } from '../lib/guidance.js';
import { judge } from '../lib/ledger.js';
import { Network, importLinkedInCsv } from '../public/js/network.js';
import { cluster, fitBudget } from '../public/js/score.js';

test('classifier: material events rank above routine compliance', () => {
  const ceo = classify({ title: 'Resignation of Mr. Gaurav Gupta, Chief Executive Officer' });
  const res = classify({ title: 'Outcome of Board Meeting - Financial Results for the quarter ended September 30, 2026' });
  const meet = classify({ title: 'Intimation of Schedule of Analyst / Institutional Investor Meeting' });
  const cert = classify({ title: 'Certificate under Regulation 74(5) of SEBI (DP) Regulations, 2018' });
  assert.equal(ceo.category, 'management_change');
  assert.equal(res.category, 'results');
  assert.equal(meet.category, 'investor_meetings');
  assert.ok(ceo.score > res.score && res.score > meet.score && meet.score >= cert.score);
});

test('classifier: a reappointment matters less than a new CEO', () => {
  const fresh = classify({ title: 'Appointment of Managing Director and Chief Executive Officer' });
  const re = classify({ title: 'Re-appointment of Whole-time Director' });
  assert.ok(fresh.score > re.score);
});

test('guidance: targets parse into numbers the ledger can check', () => {
  assert.deepEqual(parseTarget('we expect revenue growth of 20 to 25% in FY27', 'revenue_growth'), { low: 20, high: 25, unit: '%' });
  assert.deepEqual(parseTarget('we should do about Rs 4,500 crore of revenue this year', 'revenue_abs'), { low: 4500, high: 4500, unit: 'cr' });
  assert.equal(metricOf('EBITDA margin should be around 16%'), 'ebitda_margin');
});

test('guidance: quotes must exist in the transcript', () => {
  const src = 'Sir, we expect revenue growth of 20 to 25% in FY27, thank you';
  assert.equal(verifyQuote('revenue growth of 20 to 25%', src).ok, true);
  assert.equal(verifyQuote('revenue growth of 40%', src).ok, false);
});

test('ledger: a target cut before it fell due is "moved", the miss is "missed"', () => {
  const claims = [
    { id: 'C1', metric: 'revenue_abs', target: { low: 4500, high: null, unit: 'cr' }, horizon: 'FY26', madeOn: '2025-08-01', quote: 'x' },
    { id: 'C2', metric: 'revenue_abs', target: { low: 4000, high: 4000, unit: 'cr' }, horizon: 'FY26', madeOn: '2026-02-01', quote: 'y' },
    { id: 'C3', metric: 'ebitda_margin', target: { low: 15.5, high: 16, unit: '%' }, horizon: 'FY26', madeOn: '2025-08-01', quote: 'z' },
    { id: 'C4', metric: 'revenue_growth', target: { low: 30, high: null, unit: '%' }, horizon: null, madeOn: '2025-08-01', quote: 'w' },
  ];
  const actuals = { fy: { FY26: { revenue: 3626, revenueGrowth: 32, ebitdaMargin: 15.9, ebitda: 576, pat: 300 } }, quarters: [] };
  const { claims: out, threads, score } = judge(claims, actuals, new Date('2026-11-15'));
  const v = Object.fromEntries(out.map((c) => [c.id, c.verdict]));
  assert.equal(v.C1, 'moved');
  assert.equal(v.C2, 'missed');
  assert.equal(v.C3, 'kept');
  assert.equal(v.C4, 'undated');
  assert.equal(out.find((c) => c.id === 'C1').revisedTo.low, 4000);
  assert.ok(threads.some((t) => t.claimIds.join() === 'C1,C2'));
  assert.equal(score.judged, 3);
});

const net = {
  me: { name: 'You', education: [{ institution: 'IIT Kanpur', from: 1990, to: 1994 }], career: [{ org: 'Kotak Mahindra Bank', from: 2005, to: 2015 }] },
  people: [
    { id: 'p1', name: 'Asha Rao', headline: 'CFO', career: [{ org: 'ICICI Securities Ltd', title: 'VP', from: 2012, to: 2016 }], education: [], expertise: ['retail broking'], livedThrough: [], knows: [], relationship: { strength: 0.8, lastContact: '2026-10-01' } },
    { id: 'p2', name: 'Vikram Shah', headline: 'Plant head', career: [{ org: 'CG Power and Industrial Solutions', title: 'Plant head, Waluj', from: 2015, to: 2021 }], education: [], expertise: ['transformers'], livedThrough: [{ event: 'Pollution board closure order', year: 2019, tags: ['plant shutdown', 'pollution control'] }], knows: [], relationship: { strength: 0.5, lastContact: '2025-11-01' } },
    { id: 'p3', name: 'Neel Iyer', headline: 'Lawyer', career: [{ org: 'Trilegal', title: 'Partner', from: 2010, to: null }], education: [], expertise: ['environmental law'], livedThrough: [{ event: 'Argued an MPCB closure stay', year: 2022, tags: ['pollution control', 'litigation'] }], knows: [{ name: 'Raghu Panicker', org: 'Kaynes', context: 'college friends', strength: 0.7 }], relationship: { strength: 0.6, lastContact: '2026-09-01' } },
  ],
};
const orgs = { orgs: { 'ICICI Securities': { aliases: ['ICICI Securities Ltd'] }, 'CG Power and Industrial Solutions': { symbol: 'CGPOWER', aliases: ['CG Power'] }, Kaynes: { symbol: 'KAYNES', aliases: ['Kaynes Technology India'] } } };
const N = new Network(net, orgs, { now: new Date('2026-11-15').getTime(), holdings: [{ symbol: 'CGPOWER', theme: ['capital goods'] }] });

test('network: the ex-plant-head outranks the lawyer on a plant closure; both are found', () => {
  const r = N.whoToCall({ symbol: 'CGPOWER', tags: ['plant shutdown', 'pollution control'] });
  assert.equal(r[0].person.id, 'p2');
  assert.ok(r.some((x) => x.person.id === 'p3'));
  assert.equal(r[0].warm.cold, true); // a year since they spoke
});

test('network: diligence finds career overlap with a person named in a filing', () => {
  const ceo = { name: 'Anup Bagchi', career: [{ org: 'ICICI Securities', title: 'MD & CEO', from: 2011, to: 2017 }], education: [{ institution: 'IIT Kanpur' }] };
  const d = N.diligence(ceo, 'HDFCBANK');
  assert.equal(d.direct[0].person.id, 'p1');
  assert.match(d.direct[0].reasons[0].text, /Overlapped with Anup Bagchi at ICICI Securities, 2012–2016/);
  assert.ok(d.you.some((t) => /IIT Kanpur/.test(t)));
});

test('network: second-degree path via who-knows-whom', () => {
  const p = N.pathTo('Raghu Panicker');
  assert.equal(p[0].hops[0].id, 'p3');
});

test('network: LinkedIn export parses locally', () => {
  const csv = 'Notes:\n"When exporting..."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nPriya,Menon,https://x,,"Asian Paints, Ltd",Head of Sales,12 Mar 2021\n';
  const ps = importLinkedInCsv(csv);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].current.org, 'Asian Paints, Ltd');
});

test('brief: stories cluster, and the budget never splits a story', () => {
  const mk = (id, cat, score, date, cost = 20) => ({ id, symbol: 'X', category: cat, score, date, at: `${date}T10:00:00Z`, readCost: cost, why: [], net: [] });
  const items = [mk('a', 'results', 80, '2026-11-10'), mk('b', 'results', 50, '2026-11-10'), mk('c', 'litigation', 70, '2026-11-01'), mk('d', 'investor_meetings', 5, '2026-11-02')];
  const st = cluster(items);
  assert.equal(st.find((s) => s.lead.id === 'a').items.length, 2);
  const fit = fitBudget(st, 30);
  assert.equal(fit.fold.length, 1); // first story always shown, even if over budget
  assert.equal(fit.over.length, 1);
  assert.equal(fit.floor.length, 1);
});
