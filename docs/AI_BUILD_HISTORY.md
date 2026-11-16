**You**

read both the pdfs in the workspace (ENAM_Founding AI Engineer Build Challenge_Main.pdf and ENAM_Build_Challenge_Reference.pdf). i dont want to build another "chat with your filings" dashboard, every investor already has way too much data. my thesis is different: an investor's scarcest resource is attention, and their real edge is the people they know. so build an end to end deployable prototype around 3 things

1. Brief (push) – treat attention like a knapsack budget. user says "i have 3 min" and we pack only the most material stories, routine compliance stuff gets buried
2. Dig (pull) – a promise ledger. pull every quantified guidance claim from earnings calls, verify the quote word for word against the transcript, and flag when management quietly moves the goalposts
3. People (network) – map exchange filings to the investor's own network. career overlaps, who went through a similar crisis, warm intro paths. and none of the contact data should leave the phone

before you lock the stack, check which live indian market/filing sources actually work

**Claude**

I've read both PDFs. Before writing any app code, I tested the public Indian sources to see what works without auth:

- yfinance works for NSE end-of-day prices and volume.
- screener.in company pages, the NSE announcements RSS feed and public BSE filing/transcript PDFs all work without a login.
- Direct Yahoo JSON returned 429, BSE's private API sits behind an Akamai bot wall, and NSE's JSON API needs session cookies. I'm leaving those out so everything stays on public endpoints.

Next I'll scaffold the project and test PDF text extraction on a real BSE concall transcript.

```
Read   1. ENAM_Founding AI Engineer Build Challenge_Main.pdf
Read   2. ENAM_Build_Challenge_Reference.pdf
Bash   probe yfinance, screener.in, NSE RSS, BSE PDF endpoints
Bash   test unpdf extraction on a BSE earnings call transcript
```

---

**You**

ok two things before you install anything heavy
- keep it light. no next.js, no webpack/vite, no huge node_modules. just vendor preact + htm directly so it runs as a no-build PWA on mobile
- it should work fully without any API key, using deterministic rules, pre-verified seed extractions and on-device grammar. then add a GEMINI_API_KEY router on top with tiers: flash-lite for bulk extraction, flash for filing summaries, flash with thinking for synthesis. anyone should be able to turn it on later from .env.local or vercel env vars

**Claude**

Done. The frontend is under 16 KB with no build step. The numbers come from code, not the LLM, so the app works the same with or without a key. The key only changes how things are worded.

- Cut the scratch Python env from 222 MB to 30 MB.
- Vendored preact, hooks and htm as ES modules.
- Only two npm deps: unpdf and node-html-parser (4.4 MB total).
- lib/llm.js routes gemini-2.5-flash-lite → gemini-2.5-flash → gemini-2.5-flash with a thinking budget. It caches responses and enforces a JSON schema.

```
Bash   vendor preact + htm, npm install unpdf node-html-parser
Write  lib/http.js, lib/screener.js, lib/nse_rss.js, lib/pdf.js
Write  lib/llm.js
```

---

**You**

for the brief, raw exchange subjects are basically useless, half of them just say "Announcement under Regulation 30 (LODR)". so dont classify only on subject. if the subject is boilerplate, open the BSE PDF, jump to "Sub:" and read the actual body. also handle container filings, like if a postal ballot notice is approving a new MD & CEO that should become a management_change event, and related board meeting filings should merge into one story card

**Claude**

I surveyed 35 NSE companies first. About 40% of material disclosures sit behind generic Regulation 30 subjects, and routine items like trading window closures and analyst meet schedules make up most of the feed.

lib/classify.js is an ordered rule engine. When the subject is boilerplate, it reads the PDF body from "Sub:" onward. It also promotes container filings, as in the postal ballot case.

- 55 of the last 90 filings across the 18-stock portfolio go to "The Floor". They stay one tap away and nothing is deleted.
- The survey turned up two bugs, both fixed. "disclosure" was matching the "closure" rule as a substring, and a commercial paper repayment was being tagged as an equity fund raise. I tightened the word boundaries and added guards on the capital-raise patterns.
- public/js/score.js groups filings from the same board window, so results + press release + JV announcement become one card. The knapsack then fills the chosen time budget, ranking stories by filing type × position weight × move vs Nifty × network proximity.

```
Write  lib/classify.js, scripts/ingest_filings.mjs
Bash   survey 35 NSE companies, tune regex, ingest filings + 130 days EOD (scripts/ingest_market.py)
```

---

**You**

now Dig and the promise ledger. main rule here is models read, code decides. LLMs are bad at maths and they make up quotes, so
1. remove analyst questions and backward looking stuff in code first, so the model only sees forward looking management sentences. try for more than 90% token reduction
2. every extracted guidance claim has to pass an exact substring check against the raw transcript PDF. if the quote doesnt match, drop it
3. verdicts (kept / nearly / missed / goalposts moved) should be computed only in code against reported actuals. and specifically catch cases where management lowers guidance mid year before reporting

**Claude**

This is in lib/guidance.js, lib/fundamentals.js and lib/ledger.js. Here's how it did on real calls:

- Speaker segmentation keeps only management turns, then filters down to forward-looking sentences with numbers in them. That cuts 95–97% before any model call. Kaynes' last 6 calls go from 332,000 chars to 12,900.
- verifyQuote checks each extracted quote against the parsed PDF text and attaches the page number. Anything that doesn't match exactly is dropped.
- Claims are linked across calls by (metric, fiscal horizon). Kaynes Technology guided ₹4,500 cr+ FY26 revenue in Aug 2025, cut it to ₹4,000 cr in Feb 2026, and reported ₹3,626 cr. The ledger flags this as goalposts moved + missed, with a Say/Do score of 33.

```
Write  lib/fundamentals.js, lib/guidance.js, lib/ledger.js, lib/research.js, scripts/build_research.mjs
Bash   segmentation + prefilter on KAYNES, AARTIIND, PIIND, JUBLFOOD
```

---

**You**

for the people layer i want it actually different and fully private
- contact graph should never leave the browser. even Ask FINN (text or voice, like "who knows rural lending?" or "path to Raghu Panicker") should run on a local intent grammar, not a cloud LLM, so questions about people stay private
- dont just match current company names. match career overlaps with newly appointed execs (eg who was at ICICI Securities with Anup Bagchi in 2012–2016), lived through events (eg for CG Power's Waluj pollution board closure order, an ex plant head who went through an earlier closure order should rank above a generic lawyer), one hop warm paths, and keep warm nudges when a stale contact's old company is in the news
- run parallel subagents to extract the verified seed claims and build a synthetic demo network (38 contacts, 120 orgs) while you build the UI. and verify everything they give back

**Claude**

The Ask FINN grammar runs in public/js/views/ask.js, and the career-overlap and lived-through matching runs in public/js/network.js. Both run in the browser. The server only ever sees public NSE tickers.

While I built the views (Brief, Dig, People, Tripwires with a 30-session backtest, and the slide-up sheets), two subagents ran in the background:

1. Seed guidance extraction found 40 claims: KAYNES (11), JUBLFOOD (15), AARTIIND (8) and PIIND (6). All 40 quotes matched the PDFs and none were dropped.
2. Synthetic network: public/demo/network.json has 38 fictional contacts, 23 of them stale for 6–20 months to trigger Keep Warm nudges, plus LinkedIn CSV import. public/demo/orgs.json has 120 orgs with aliases, tickers and competitor / jv-partner / regulator links. Every reference in both files resolves.

I also wrote data/enrichment.json. It has public-record career timelines for the real people named in filings, with source links.

```
Agent  seed guidance extraction (24 transcripts)
Agent  synthetic network + org graph
Write  data/enrichment.json
Write  public/js/score.js, public/js/network.js, public/js/views/*.js, api/*.js, dev-server.mjs
```

---

**You**

dont trust the first pass. write unit tests for the ranking and ledger maths, and render every screen at 390px in a headless browser to catch stale data, clipping or ranking issues

**Claude**

Unit tests are in tests/core.test.mjs. tools/phone.mjs drives headless Chrome at 390px width. Between them they found four issues, all fixed:

1. Ranking weights (found by a unit test): how close a contact is outweighed how relevant their experience was. So a close corporate lawyer ranked above the ex-Waluj plant head on the CG Power MPCB order. I rebalanced network.js so relevant and lived-through experience counts most. Several overlap reasons still add up, but each extra one counts for less.
2. Stale quarter (found in the phone render): Kaynes' new Sep-quarter filing was showing June-quarter numbers because screener.in hadn't updated yet. lib/fundamentals.js now attaches numbers only when filingPeriod matches the filing's quarter. Otherwise it shows "numbers filed, awaiting standardization".
3. Layout: I widened the People constellation viewBox and spread contacts over three rings so labels like KAYNES and TITAN don't clip. I also added a soft score ceiling so strong stories don't all sit at 100.
4. Outreach copy: the drafted WhatsApp openers no longer assume pronouns for real people named in filings, and the template grammar is fixed.

npm test passes 10/10. Light and dark sweeps at 390px showed no console errors and no horizontal overflow.

```
Write  tests/core.test.mjs, tools/phone.mjs
Bash   npm test
Bash   390px screenshot sweep, light + dark
```

---

**You**

ok last thing. remove any personal machine paths or identifiers, write a proper README.md covering architecture and privacy with setup steps so anyone can run it on a fresh mac/windows/linux machine in under 2 min. also add HANDOFF.md and docs/COVER_EMAIL.md, then package the final submission zip

**Claude**

Done.

- README.md covers the thesis, what's real vs synthetic, a Mermaid architecture diagram, the on-device privacy model, the Gemini tiers, and setup (`npm install && npm run dev`) for Mac, Windows and Linux.
- HANDOFF.md has the deployment checklist, and docs/COVER_EMAIL.md has the submission summary.
- Local paths and identifiers are scrubbed.
- I unzipped the archive into a fresh directory, ran `npm install` and `npm test` (10/10), and checked every API and UI route.
