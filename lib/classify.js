// Announcement classifier + base materiality.
//
// Exchange subjects are semi-structured ("Announcement under Regulation 30 (LODR)-Change in Management"),
// so ordered rules resolve ~90% of filings for free and in microseconds. Only items that land in
// `unclassified` with an unfamiliar subject are worth sending to a model (see lib/llm.js).
//
// Each rule: [category, regex, baseScore, kind]. First match wins, so order = precedence.
// baseScore is 0-100 "how likely this moves my view of the company", before company/market/network modifiers.

const R = (category, re, score, kind = null) => ({ category, re, score, kind });

export const RULES = [
  // ---- noise first: these subjects often *contain* material words ("results") but are pure compliance
  R('unclassified', /newspaper\s*(publication|advertisement)|copy of newspaper/i, 4, 'newspaper'),
  R('unclassified', /(registrar|RTA|kfin|share transfer agent).*(address|office)|change in (the )?corporate office/i, 2, 'rta'),
  R('unclassified', /dematerial|loss of shares|duplicate share|transfer of physical|special window/i, 2, 'shareholder-admin'),
  R('unclassified', /allotment of (equity shares under )?ESOP|ESOS|ESPS|stock option|employee stock/i, 3, 'esop'),
  R('unclassified', /trading window|compliance certificate|reg(ulation)?\.?\s*(74|40|7)\b|74\s*\(5\)|investor complaint|secretarial|ESG|BRSR|sustainability report|monitoring agency/i, 3, 'compliance'),
  R('unclassified', /repayment of commercial paper|redemption of (commercial|NCD)|payment of interest/i, 4, 'debt-servicing'),

  // ---- earnings call plumbing (useful for Pull, rarely news on its own)
  R('earnings_call', /transcript/i, 22, 'transcript'),
  R('earnings_call', /audio|video recording|recording of/i, 6, 'recording'),
  R('earnings_call', /(schedule|intimation).*(earnings|conference) call|earnings call.*(schedule|intimation)/i, 10, 'call-notice'),

  // ---- people
  R('management_change', /(appoint|cessation|resign|superannuat|re-?appoint|change in management|change in directorate|key managerial|KMP|retire|step(s|ped)? down|demise|\bas (the )?(new )?(director and )?(md|ceo|cfo|chairman|chairperson|managing director|whole[- ]time director)\b)/i, 55, 'people'),

  R('press_release', /bagging|receiving of order|order (win|inflow|received)|wins? .*order|letter of (award|intent)/i, 46, 'order-win'),

  // ---- deals
  R('M&A', /scheme of arrangement|amalgamation|merger|demerger|acquisition|acquire|joint venture|\bJV\b|term sheet|strategic (investment|partnership)|stake (sale|purchase)|divest|slump sale|share swap|restructuring/i, 72, 'deal'),

  // ---- capital
  R('fund_raise', /\bQIP\b|qualified institution|preferential|rights issue|warrant|buy-?back|fund rais|capital rais|raising of funds|issue of (equity|securities)/i, 62, 'equity-raise'),
  R('fund_raise', /commercial paper|\bNCDs?\b|non-convertible|debentures|bonds?\b/i, 22, 'debt-raise'),

  // ---- legal / regulatory
  R('litigation', /clarification sought|rumou?r verification|data (leak|breach)|cyber/i, 58, 'clarification'),
  R('litigation', /insolvency|CIRP|NCLT|NCLAT|IBC/i, 56, 'insolvency'),
  R('litigation', /(show cause|penalt|\bfines?\b|adjudicat|\bclosure\b|search under|survey|raid|GST (department|authorit)|demand order|tax demand|income tax|\bCCI\b|USFDA|warning letter|import alert|form 483|litigation|lawsuit|high court|supreme court|tribunal|arbitration|stay(ed)? (the|an)? ?order|enforcement directorate|\bED\b|CBI|pollution control)/i, 50, 'regulatory'),

  // ---- the core of the push product
  R('results', /investor presentation|results presentation|earnings presentation|shareholders? letter|letter to shareholders|press release.*results|media statement/i, 42, 'results-deck'),
  R('results', /financial results?|results? for the (quarter|half|year)|(un)?audited .*results/i, 78, 'results'),
  R('results', /board meeting intimation|intimation of board meeting|prior intimation/i, 14, 'results-notice'),

  R('credit_rating', /credit rating|rating (update|action|reaffirm|upgrade|downgrade)|\b(CRISIL|ICRA|CARE|India Ratings|S&P|Moody|Fitch)\b/i, 26, 'rating'),
  R('dividend', /dividend|record date/i, 24, 'dividend'),
  R('bonus_split', /bonus|split|sub-?division/i, 48, 'bonus'),
  R('capex', /capex|capacity|commission|commercial (operation|production)|new (plant|facility|unit)|expansion|greenfield|brownfield|commercialization|commercialisation/i, 60, 'capex'),
  R('pledging', /pledge|encumbrance/i, 55, 'pledge'),
  R('insider_trading', /SAST|reg(ulation)?\.?\s*29|insider trading|PIT|\bacquisition of shares\b|disclosure.*(promoter|shareholding)/i, 18, 'insider'),
  R('investor_meetings', /analyst|investor meet|institutional investor|investor conference|one-on-one|con\.? call|conference/i, 6, 'meeting'),
  R('postal_ballot', /postal ballot|scrutini[sz]er/i, 12, 'ballot'),
  R('agm_egm', /\bAGM\b|\bEGM\b|annual general meeting|extra-?ordinary general meeting/i, 12, 'meeting'),
  R('press_release', /order|contract|bagging|wins?|launch|press release|media release|partnership|MoU|agreement|sales (volume|number)|production volume|business update/i, 34, 'press'),
];

// Sharpen within-category scores with the specifics an analyst would react to.
function adjust(category, text, score) {
  const t = text.toLowerCase();
  if (category === 'management_change') {
    if (/\b(ceo|managing director|\bmd\b|chief executive|cfo|chief financial|chairman|chairperson|whole[- ]time director|president)\b/.test(t)) score += 30;
    else if (/\b(executive director|business head|group head|chief [a-z]+ officer)\b/.test(t)) score += 12;
    if (/resign|step(s|ped)? down|cessation|demise/.test(t)) score += 8;
    if (/re-?appoint|continu/.test(t)) score -= 22;
    if (/company secretary|compliance officer/.test(t)) score -= 28;
    if (/independent director/.test(t) && !/chair/.test(t)) score -= 12;
  }
  if (category === 'M&A') {
    if (/cessation|strike[- ]off|wholly[- ]owned subsidiar.*(merg|amalgam)|internal restructuring/.test(t)) score -= 22;
    if (/binding|definitive|term sheet|joint venture|acquisition of/.test(t)) score += 10;
  }
  if (category === 'litigation') {
    if (/lakh/.test(t) && !/crore/.test(t)) score -= 25; // small-ticket penalties
    if (/closure|data leak|breach|search|import alert|warning letter|stayed?/.test(t)) score += 15;
  }
  if (category === 'credit_rating') {
    if (/upgrade|downgrade|watch|negative|positive/.test(t)) score += 30;
  }
  if (category === 'fund_raise' && /(\d[\d,]*)\s*(crore|cr)/.test(t)) score += 6;
  if (category === 'press_release') {
    if (/significant|large|mega|ultra-mega|highest[- ]ever|record/.test(t)) score += 14;
    if (/launch|store|showroom/.test(t)) score -= 10;
  }
  if (category === 'capex' && /commenc|commission|commercial operation/.test(t)) score += 4;
  return Math.max(0, Math.min(100, score));
}

/**
 * Classify one filing.
 * @param {{title:string, summary?:string}} a
 * @returns {{category:string, kind:string|null, score:number, rule:string, confidence:number}}
 */
// Regulatory boilerplate that prefixes most subjects and carries no signal.
const BOILERPLATE = [
  /announcement\s+under\s+regulation\s*30\s*(of\s*)?(the\s*)?(sebi)?\s*\(?(lodr|listing obligations? and disclosure requirements?)\)?\s*(regulations?,?\s*(2015)?)?\s*-?/gi,
  /(disclosure|intimation|compliance)\s+under\s+regulation\s*30\s*(of\s*)?(the\s*)?sebi\s*\(?(lodr|listing obligations? and disclosure requirements?)\)?\s*(regulations?,?\s*(2015)?)?\s*-?/gi,
  /under\s+regulation\s*30\s*(\(11\))?/gi,
  /regulations?,?\s*2015/gi,
  /\bsebi\s*\((lodr|listing[^)]*)\)/gi,
];
export function stripBoilerplate(s = '') {
  let t = s;
  for (const re of BOILERPLATE) t = t.replace(re, ' ');
  return t.replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '').replace(/\s+/g, ' ').trim();
}

const GENERIC_SUBJECT = /^(update|updates|disclosure|intimation|general|outcome|meeting updates?|others?|clarification|-)?$/i;
// Categories whose subject is a container: the body decides if something material is inside.
const CONTAINERS = new Set(['postal_ballot', 'agm_egm', 'investor_meetings', 'earnings_call']);

function firstMatch(hay) {
  for (const r of RULES) if (r.re.test(hay)) return r;
  return null;
}

/** Strongest *material* reading of free text (noise rules never fire on bodies: letterheads are full of "Registrar"). */
function bestMaterial(hay) {
  let best = null;
  for (const r of RULES) {
    if (r.category === 'unclassified') continue;
    if (r.re.test(hay)) {
      const sc = adjust(r.category, hay, r.score);
      if (!best || sc > best.sc) best = { r, sc };
    }
  }
  return best?.r || null;
}

/** Drop letterhead/addressee lines: the substance starts at "Sub:", "Dear Sir", "we wish to inform"... */
export function bodyCore(body = '') {
  const m = body.match(/\b(sub(ject)?\s*[:\-–]|dear (sir|madam|sirs)|we (wish|would like) to (inform|intimate)|this is to (inform|intimate)|pursuant to regulation|in terms of regulation)/i);
  return (m ? body.slice(m.index) : body).slice(0, 1400);
}

/**
 * Classify one filing. Passes: exchange subject (stripped of boilerplate) -> body text
 * (first page of the PDF when the pipeline fetched it, else a provided note).
 * A container subject ("Postal ballot outcome", "Investor meet outcome") is upgraded when the
 * body reveals something material, e.g. a ballot that appoints a new MD & CEO.
 * @param {{title:string, body?:string, note?:string}} a
 */
export function classify(a) {
  const subject = stripBoilerplate(a.title || '');
  // the concise note (when present) is the cleanest body signal; else the PDF text after the letterhead
  const body = a.note ? `${a.note} ${bodyCore(a.body || '').slice(0, 600)}` : bodyCore(a.body || '');
  const all = `${subject} ${body}`;

  const s = !GENERIC_SUBJECT.test(subject) ? firstMatch(subject) : null;
  const b = body.trim() ? bestMaterial(body) : null;

  let pick = s || b;
  let pass = s ? 'subject' : b ? 'body' : 'none';
  // judge specifics on the most concise text available (a note beats a 4-page PDF full of cross-references)
  const focus = a.note ? `${subject} ${a.note}` : all;
  if (s && b && CONTAINERS.has(s.category) && !CONTAINERS.has(b.category) && b.category !== 'results' && s.kind !== 'transcript') {
    const sb = adjust(b.category, focus, b.score);
    if (sb > adjust(s.category, focus, s.score)) {
      pick = b;
      pass = 'body-upgrade';
    }
  }
  if (!pick) return { category: 'unclassified', kind: null, score: 8, rule: 'none', confidence: 0.3, subject };
  let score = adjust(pick.category, focus, pick.score);
  // A result of someone else (parent co., JV partner) is context, not news about this company.
  if (pick.category === 'results' && /reference to|issued by|parent company|holding company/i.test(subject)) score -= 45;
  return {
    category: pick.category,
    kind: pick.kind,
    score: Math.max(0, Math.min(100, score)),
    rule: `${pass}:${pick.re.source.slice(0, 32)}`,
    confidence: pass === 'subject' ? 0.9 : pass === 'body-upgrade' ? 0.75 : 0.65,
    subject,
  };
}

/** Estimated seconds of investor attention an item costs to absorb, by how FINN renders it. */
export function readCost(category, score) {
  if (score < 15) return 3;
  return (
    {
      results: 28,
      management_change: 30,
      'M&A': 26,
      litigation: 22,
      fund_raise: 18,
      capex: 16,
      credit_rating: 10,
      press_release: 10,
      earnings_call: 8,
    }[category] || 8
  );
}

export const CATEGORY_LABEL = {
  results: 'Results',
  'M&A': 'M&A',
  fund_raise: 'Fund raise',
  management_change: 'Management',
  litigation: 'Legal / regulatory',
  insider_trading: 'Insider / SAST',
  earnings_call: 'Earnings call',
  investor_meetings: 'Investor meet',
  credit_rating: 'Credit rating',
  dividend: 'Dividend',
  bonus_split: 'Bonus / split',
  capex: 'Capex',
  press_release: 'Press release',
  postal_ballot: 'Postal ballot',
  agm_egm: 'AGM / EGM',
  pledging: 'Pledging',
  unclassified: 'Routine',
};
