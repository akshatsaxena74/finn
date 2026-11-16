#!/usr/bin/env node
// Precompute Pull dossiers for the demo research set (the live API computes any other ticker on demand).
//   node scripts/build_research.mjs                 -> research names from data/portfolio.json
//   node scripts/build_research.mjs PIIND --dump D  -> also write prefiltered transcript windows to D/
//
// Claims source, in order: data/research/seed/<SYM>.claims.json (build-time extraction, verified like any
// model output) -> Gemini (if GEMINI_API_KEY) -> heuristic parser. Every claim must pass the quote check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { researchFacts, researchLedger, researchSynthesis } from '../lib/research.js';
import { loadTranscript } from '../lib/guidance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dumpIdx = args.indexOf('--dump');
const dump = dumpIdx >= 0 ? args.splice(dumpIdx, 2)[1] : null;
const N = 6;
const pf = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/portfolio.json'), 'utf8'));
const syms = args.length ? args : pf.research.map((r) => r.symbol);
fs.mkdirSync(path.join(ROOT, 'data/research/seed'), { recursive: true });

for (const sym of syms) {
  const t0 = Date.now();
  const base = await researchFacts(sym);
  if (dump) {
    fs.mkdirSync(dump, { recursive: true });
    const calls = base.concalls.filter((c) => c.transcript).slice(0, N);
    let txt = `# ${base.name} (${sym}) — management sentences prefiltered from ${calls.length} concall transcripts\n# Format: [month | quarter discussed] then numbered lines "(p<page>, <speaker>) <sentence>"\n`;
    for (const c of calls) {
      const t = await loadTranscript(c.transcript, c.month);
      txt += `\n\n=== ${t.month} | ${t.quarterLabel} | ${t.url}\n`;
      t.broadWindows.forEach((w, i) => (txt += `[${i}] (p${w.page}, ${w.speaker}) ${w.text}\n`));
    }
    fs.writeFileSync(path.join(dump, `${sym}.windows.txt`), txt);
    console.log(`${sym}: dumped ${txt.length} chars of windows`);
  }
  const seedPath = path.join(ROOT, `data/research/seed/${sym}.claims.json`);
  const seedClaims = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, 'utf8')) : null;
  const ledger = await researchLedger(base, { seedClaims, maxTranscripts: N });
  const synthesis = await researchSynthesis(base, ledger);
  const out = { symbol: sym, name: base.name, builtAt: new Date().toISOString(), facts: base.facts, ledger, synthesis };
  fs.writeFileSync(path.join(ROOT, `data/research/${sym}.json`), JSON.stringify(out));
  const s = ledger.score;
  console.log(`${sym}: ${ledger.extractor} claims=${ledger.claims.length} dropped=${ledger.dropped} judged=${s.judged} kept=${s.kept} missed=${s.missed} moved=${s.moved} say/do=${s.ratio} (${Date.now() - t0}ms)`);
}
