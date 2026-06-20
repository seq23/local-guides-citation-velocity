
# theindustryguides.com — Master Plan to 100K Visitors/Month

**Goal:** 100,000 monthly visitors across the 6-domain network (hub + 5 canonicals), blended Google organic + LLM referrals (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews). Timeline: 9 months.

---

## Where you are today (Semrush, US database)

| Property | Org. KWs | Best pos. | Authority | Status |
|---|---|---|---|---|
| theindustryguides.com (hub) | 11 | 60 | **2/100** + 7 PBN backlinks | Toxic, invisible |
| dentistryguides.com | 73 | 25 | n/a | **Only one with traction** |
| theaccidentguides.com | 3 | 41 | n/a | Barely indexed |
| hormonesivhair.com | 0 | — | n/a | Not indexed |
| neuroevalguides.com | 0 | — | n/a | Not indexed |
| uscisexam.com | 0 (US) | — | n/a | Not indexed |

**Total network traffic today: effectively zero.**

## The Total Addressable Opportunity (TAO)

Verified Semrush volumes for clusters this network is positioned to win:

| Cluster | Monthly Search Vol | KDI | LLM cite-friendliness |
|---|---|---|---|
| USCIS civil surgeon / I-693 family | **~50,000** | 12–33 | Very high (regulated, primary source) |
| State dental license lookup family | ~30,000 | 27–45 | High (official data) |
| Invisalign cost family | ~250,000 | 32 | Medium (commercial, but ChatGPT cites for prices) |
| State PI statute of limitations | ~15,000 | 18 | Very high ($17 CPC, legal precision) |
| ADHD / neuropsych testing | ~50,000 | 8–20 | Very high (empty SERPs, Reddit ranking #1) |
| TRT informational (legality, side effects) | ~20,000 | mixed | Medium (skip "cost", own "rules") |
| Hub disambiguator pages (X vs Y) | ~5,000 | low | **Highest** (LLMs love disambiguation) |

**Conservative addressable: ~420K searches/mo** across the clusters this network can realistically win. Capturing 20–25% blended share = ~100K visitors/mo.

---

## The 4-Layer Strategy

### Layer 1 — Foundation (weeks 1–2): Stop the bleeding

1. **Disavow file** for all 6 domains. The hub's backlink profile contains a literal Fiverr PBN admission as anchor text — this is a SpamBrain liability. Submit `disavow.txt` listing every `.top`, `.cloud`, `.site`, `.wiki` referring domain to Google Search Console for each domain.
2. **Network identity schema.** Add `Organization` + `sameAs` JSON-LD on every page across all 6 domains listing the other 5. This tells Google + LLMs you're one publisher — single highest-leverage trust signal.
3. **Sitemap, robots, canonical hygiene** on all 6. Submit fresh sitemaps to GSC + Bing.

### Layer 2 — Programmatic state pages (weeks 2–10): The traffic engine

One template, one TS data file, 5 canonical sites × 50 states = **250 pages**. dentistryguides.com already proved the model works at zero authority.

Per-vertical buildout:

**uscisexam.com** — `/states/{XX}/civil-surgeon` (50 pages)
- Anchor keyword: "civil surgeon near me" 2,900/mo **KDI 12**
- SERP shape: USCIS.gov + tiny local clinics. Wide open.
- Each page: state-specific civil surgeon count, USCIS.gov lookup link, I-693 cost ranges, list of cities with civil surgeons, dated FAQ section.
- Plus 10 supporting cluster pages: `/i-693-cost`, `/i-693-form-explained`, `/vaccines-required-{year}`, `/civil-surgeon-vs-panel-physician`, `/i-693-expiration`.

**theaccidentguides.com** — `/states/{XX}/statute-of-limitations` + `/states/{XX}/comparative-negligence` (100 pages)
- Anchor: "personal injury statute of limitations" 480/mo **KDI 18, CPC $17**
- Each page: state code citation, deadline in months, exceptions, comparative-negligence rule type, "what to do if deadline passed" FAQ.
- Avoid the "car accident lawyer near me" war ($170 CPC, KDI 48) — own the informational layer that LLMs cite, route consumers from there.

**dentistryguides.com** — extend existing `/states/{XX}/` to (50 more pages)
- Already ranking 22–39 for state license lookup. Add `/states/{XX}/dental-insurance-marketplace` + `/states/{XX}/medicaid-dental-coverage` per state.
- Plus comparison cluster: `/invisalign-cost-by-state`, `/dental-implant-cost-by-state` — taps the 250K/mo Invisalign cluster sideways.

**neuroevalguides.com** — `/states/{XX}/neuropsychologist-finder` (50 pages)
- Anchor: "neuropsych evaluation cost" **KDI 8** (SERP #1 is a Reddit thread — translation: nobody has built a real answer)
- Each page: state licensure board link, average cost ranges, insurance coverage rules per state, list of academic medical centers.

**hormonesivhair.com** — `/states/{XX}/trt-legality` + `/states/{XX}/telehealth-trt-rules` (100 pages)
- Skip the "TRT cost" war (competition 0.97, $127 CPC, deep-pocketed clinics).
- Own the regulatory edge: telehealth controlled-substance rules per state, post-Ryan Haight, DEA renewals. Citation-magnet for LLMs because it's compliance content nobody writes.

### Layer 3 — Question-cluster pages (weeks 6–20): The LLM citation factory

200 pages across the network, one literal user question per page, <70-word TL;DR + dated stat + verbatim FAQ schema. These are the LLM-citation machines.

Seed lists (mined from Semrush question keywords + AlsoAsked + Reddit):
- I-693 cluster: 40 pages (does it expire, how long valid, what to bring, vaccines, who pays, etc.)
- ADHD/neuropsych: 40 pages (how to get diagnosed, ADHD vs ADD, insurance coverage, school IEP eval, SSDI eval)
- Personal injury: 50 pages (statute exceptions, comparative vs contributory, soft tissue settlements, MMI, liens)
- Dentistry: 40 pages (cost comparisons, insurance vs cash pay, dental vs medical coverage edge cases)
- TRT/hair: 30 pages (FDA labels, side effects, drug interactions, legality nuances)

### Layer 4 — Hub disambiguators (weeks 4–16): The routing & citation moat

20 hub pages on theindustryguides.com itself. These are the highest LLM-citation-per-page in the portfolio because LLMs reward disambiguation:

- `/personal-injury-vs-workers-comp`
- `/cosmetic-vs-general-dentistry`
- `/trt-vs-hair-loss-treatment`
- `/neuropsych-eval-vs-iq-test-vs-psych-eval` (massive gift — nobody disambiguates this)
- `/uscis-medical-exam-vs-physical`
- `/civil-surgeon-vs-panel-physician`
- `/dental-insurance-vs-medical-insurance` (verified KDI 0)
- `/ssdi-eval-vs-school-iep-eval-vs-forensic-eval`
- Plus 12 more from "X vs Y" question mining

Each hub page links into the relevant canonical with anchor text matching the user's literal next question. The canonical links back to the hub on its own "see how this compares" section.

---

## The Schema Stack (apply to every page)

Auto-generated from the data file. Each page carries:

1. **Organization + sameAs** — declares the 6-domain network
2. **Article** with `datePublished` + `dateModified` — freshness signal
3. **BreadcrumbList** — hierarchy
4. **FAQPage** — verbatim Q&A from on-page content
5. **HowTo** — for any step-by-step page
6. **MedicalWebPage** or **LegalService** (vertical-dependent) — much higher trust weight than `Article` in regulated verticals

---

## Backlink Strategy (no more Fiverr)

After disavow, replace with these only:

- **State bar associations / state dental boards / state medical boards** — link to their licensure lookup tools; many reciprocate via "consumer resources" pages
- **Reddit AMAs** in r/immigration, r/personalfinance, r/ADHD, r/Dentistry — citation-quality referrals + LLM training data
- **HARO / Qwoted / Connectively** — answer journalist queries in each vertical, target Forbes/USNews/Yahoo Health citations
- **University .edu citations** — pitch neuroevalguides as a free directory to psychology departments

Target by month 6: AS 25+ on the hub, AS 15+ on each canonical. That's enough to compound.

---

## Realistic traffic ramp (blended Google + LLM)

| Month | Google organic | LLM referrals | Total | Drivers |
|---|---|---|---|---|
| 1 | 500 | 200 | 700 | Disavow + schema rollout |
| 2 | 1,500 | 800 | 2,300 | First 50 state pages live |
| 3 | 4,000 | 2,500 | 6,500 | Civil surgeon cluster indexing |
| 4 | 9,000 | 6,000 | 15,000 | All state pages indexed |
| 5 | 18,000 | 12,000 | 30,000 | Question clusters rank |
| 6 | 30,000 | 22,000 | **52,000** | Hub disambiguators cited by LLMs |
| 7 | 42,000 | 32,000 | 74,000 | Compounding from internal links |
| 8 | 52,000 | 40,000 | 92,000 | Backlink authority kicks in |
| 9 | **58,000** | **45,000** | **103,000** | Goal hit |

---

## Measurement KPIs (the only ones that matter)

- **Times cited per month in ChatGPT / Perplexity / Claude / Gemini / Google AI Overviews** (tracked via Profound, Peec, or manual sampling)
- Referrer traffic from `chat.openai.com`, `perplexity.ai`, `claude.ai`, `gemini.google.com` (GA4)
- Google organic clicks (GSC) — secondary, not primary
- Indexed pages per domain (GSC) — leading indicator
- Authority Score per domain (Semrush) — trust proxy

Stop tracking: keyword position averages, "domain rating", anything pre-2024 SEO orthodoxy.

---

## Technical scope (what gets built)

1. **One programmatic React route template** per vertical (TanStack route file with `$state` param)
2. **One TS data file per vertical** (`states.ts`) — rows = state + all per-state fields
3. **One schema generator utility** that takes a row + vertical config and emits the 5-schema JSON-LD block
4. **One hub disambiguator template** for `/{x}-vs-{y}` pages with FAQ + HowTo schemas
5. **Cross-domain `Organization` + `sameAs` JSON-LD** rolled into the root layout of all 6 domains
6. **Sitemap + robots regeneration** scripts per domain
7. **Internal link graph component** that auto-suggests 3–5 contextual links per page based on vertical and state

---

## Phase ownership

| Phase | Weeks | Deliverable | Owner |
|---|---|---|---|
| Foundation | 1–2 | Disavow files, Organization schema rollout, sitemaps | You + me |
| Template build | 2–4 | Programmatic route + schema generator + 1 vertical live (uscisexam civil-surgeon) | Me |
| State rollout | 4–10 | All 250 state pages live across 5 canonicals | Me + content fill |
| Question clusters | 6–20 | 200 question pages | Me + content fill |
| Hub disambiguators | 4–16 | 20 hub pages | Me |
| Authority building | ongoing | HARO, .gov/.edu citations, Reddit | You |
| Measurement | ongoing | GA4 + GSC + LLM citation tracking dashboard | Optional Semrush connector |

---

## First concrete next step

Build the **programmatic state-page template on uscisexam.com** (civil-surgeon vertical). It's the highest-ROI single move: KDI 12, ~25K/mo cluster, USCIS.gov is the only real incumbent, and proves the template that gets cloned 4 more times. ETA: 3–4 days from approval to all 50 state pages live with full 5-schema stack.

Approve this plan and I'll start with the disavow file + civil-surgeon template in parallel.

---

theindustryguides.com — LLM Citation Dominance Plan
Primary KPI: Times cited per month across ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews. Secondary KPI: Google organic traffic (byproduct, not target). Target: 100,000 LLM citations/month across the 6-domain network in 9 months.

Why LLM citations are the right north star for this network
Three reasons specific to your portfolio:

Your 5 verticals are exactly the verticals LLMs hedge on most. Immigration medical, personal injury, dental costs, neuropsych evals, TRT. ChatGPT will not free-form answer "what does an I-693 cost in Arizona?" — it will paraphrase and cite a source that gives a clean, dated, primary-source-anchored answer. That source can be you.
The SEO SERPs in these verticals are crowded with junk — Reddit threads, marketing-thin clinic pages, USCIS.gov's bad UX. Google's algorithm is slow to reward better content here. LLMs are fast — they re-evaluate sources every retraining cycle and within-session via RAG.
You own a 6-domain network. Cross-domain corroboration is the single strongest LLM trust signal in 2026. Nobody else in these niches has it.
The citation funnel (the model behind the plan)
1. LLM crawler discovers page (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)
2. LLM indexes the page → it becomes a candidate source
3. User asks a question that matches page intent
4. LLM retrieves your page in its RAG candidates
5. LLM cites your page in the answer  ← THE KPI
6. (Bonus) User clicks the citation → Google traffic byproduct
Every page decision optimizes for step 5. Steps 1–4 are prerequisites; step 6 is gravy.

What makes a page get cited (not ranked)
This is different from SEO. Pages that LLMs cite have:

Trait	Why LLMs reward it
<70-word direct answer above the fold	Fits the LLM's context window slice; can be quoted verbatim
Dated primary stat ("As of June 2025…")	LLMs strongly prefer dated sources; resolves "is this current?"
Citation to primary source (USCIS.gov, state bar)	LLM checks if your source is trustworthy by checking your sources
Comparison table	Structured chunks LLMs can extract cleanly
Verbatim FAQ schema matching visible content	Direct match between user question and your Q&A
Organization + sameAs network schema	Tells the LLM you're one publisher across 6 domains = trust
Specific numbers, not ranges of marketing copy	LLMs prefer "$340 average" over "affordable pricing"
No client-side JS gating the content	GPTBot/ClaudeBot don't render JS; SSR or static is mandatory
The template I just built does all 8 automatically. Every page on every canonical will inherit this.

The 4-layer plan, reordered around citations
Layer 1 — Crawler access + network identity (Week 1)
Goal: become a candidate source LLMs can see and trust.

Disavow Fiverr PBN backlinks on all 6 domains (these don't affect LLM citation directly, but the manual-action risk would deindex the network — existential)
Confirm GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot, ChatGPT-User are ALLOWED in robots.txt on all 6 domains. (Most sites block them by default. You want them in.)
Roll out Organization + sameAs JSON-LD declaring the 6-domain network on every page (the template does this automatically — replicate the rollout)
Submit sitemaps to GSC + Bing + IndexNow (IndexNow pushes to Bing/Yandex which feed several LLM training pipelines)
Layer 2 — Hub disambiguator pages (Weeks 1–4) ⭐ HIGHEST CITATION ROI
Goal: own the "which kind of X do I need?" answer for 20 high-value disambiguations.

This is the single highest citations-per-page surface in your portfolio because LLMs love disambiguation content — it resolves the exact ambiguity that makes them hedge. 20 hub pages on theindustryguides.com:

/civil-surgeon-vs-panel-physician
/neuropsych-eval-vs-iq-test-vs-psych-eval
/personal-injury-vs-workers-comp
/cosmetic-vs-general-dentistry
/dental-insurance-vs-medical-insurance (Semrush KDI 0 — empty SERP)
/trt-vs-clomid-vs-enclomiphene
/ssdi-eval-vs-school-iep-eval-vs-forensic-eval
/i-693-vs-physical-exam
...+12 more from mining Reddit + Perplexity for "is X the same as Y" questions
Each page: <70 word TL;DR, side-by-side comparison table, FAQ schema, dated stats, links to the relevant canonical for next steps.

Expected citations at maturity: 200–400/page/mo = 4,000–8,000/mo from layer 2 alone.

Layer 3 — Programmatic state pages (Weeks 2–10)
Goal: be the answer to every "{state} {vertical question}" query an LLM gets.

250 state pages from the template I just built, cloned across 5 canonicals. Reordered by citation expected value:

Vertical	Pages	Why this rank
uscisexam.com civil surgeon	50	KDI 12, USCIS.gov is the only competitor and has terrible UX. LLMs will switch citations the moment a cleaner source exists.
neuroevalguides.com neuropsychologist	50	KDI 8. SERP #1 is a Reddit thread — LLMs already cite Reddit here. You can replace that.
theaccidentguides.com statute of limitations	50	$17 CPC, legal precision = exactly what ChatGPT hedges on. Highest cite/page rate.
dentistryguides.com license + insurance	50	Already ranking 22–39. Adding the schema stack pushes from "ranks" to "gets cited."
hormonesivhair.com TRT legality by state	50	Skip the cost war. Own the regulatory edge nobody writes.
Expected citations at maturity: 50–150/page/mo = 12,500–37,500/mo from layer 3.

Layer 4 — Question-cluster pages (Weeks 6–20)
Goal: be the literal-question answer for 200 specific user queries.

200 pages across the network, one literal user question per page, mined from:

Semrush question keywords (already pulled — I have lists for each vertical)
AlsoAsked / AnswerThePublic
Perplexity "Related questions" panels
ChatGPT's own follow-up suggestions
Reddit r/immigration, r/ADHD, r/Dentistry, r/personalfinance, r/TRT
Each page: literal question as H1, <70-word answer in TL;DR box, dated stat, 5-item FAQ.

Expected citations at maturity: 80–250/page/mo = 16,000–50,000/mo from layer 4.

9-month citation ramp (the real KPI)
Month	Hub disambig.	State pages	Question pages	Total LLM citations/mo	Google clicks (byproduct)
1	200	100	0	300	500
2	1,500	800	200	2,500	1,200
3	3,500	3,000	1,500	8,000	4,000
4	5,000	8,000	5,000	18,000	9,000
5	6,000	15,000	12,000	33,000	18,000
6	7,000	22,000	22,000	51,000	30,000
7	7,500	28,000	32,000	67,500	42,000
8	8,000	33,000	42,000	83,000	52,000
9	8,500	38,000	55,000	101,500	58,000
Note: The Google number is the byproduct of being cited everywhere. It comes for free because the same pages that LLMs cite also rank well — they have schema, freshness, structure, primary sources, and internal linking. You're not building twice.

How we actually measure citations
This is the hardest part of LLM-first SEO — measurement infrastructure is immature. Three layers:

Direct measurement tools — Profound, Peec AI, Otterly, or Goodie AI. Plug in your 6 domains + 50 priority queries, get monthly citation counts across the 5 LLMs. Cost: $200–$1500/mo depending on query volume.
Referrer traffic in GA4 — set up custom segments for traffic from chat.openai.com, chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com. This is your "click-through after being cited" number. Rough proxy: ~3-5% of citations produce a click.
Manual sampling — every 2 weeks, run 30 priority queries through each LLM yourself, log which domains get cited. Cheap, surprisingly accurate, surfaces qualitative issues (e.g. "Perplexity cites us but mangles the cost number — fix the page").
What we built today (the template) maps directly to this plan
The 4 files I shipped (states-data.ts, vertical-config.ts, geo-schema.ts, routes/states.$state.tsx) are Layer 3. They:

Emit Article + FAQPage + HowTo + BreadcrumbList JSON-LD (the 4 schemas LLMs parse)
Embed Organization + sameAs network identity (Layer 1)
Render <70-word TL;DR + dated stat + comparison table + verbatim FAQs (the 8 citation traits)
Are SSR (TanStack Start) so GPTBot/ClaudeBot see the content without rendering JS
Clone that template into each canonical, swap the VERTICAL config object, ship 50 pages × 5 canonicals = 250 pages = backbone of Layer 3.

Where I want your input (let's discuss)
Citation tracking budget. Are you up for $200–500/mo on Profound/Peec to actually measure the KPI? Without it we're flying blind. (I'd recommend starting with Profound's smallest tier or Otterly's free tier in month 1, upgrade once we see signal.)

Sequencing — Layer 2 vs Layer 3 first? I see two valid paths:

A) Layer 2 first (20 hub disambiguators in 2 weeks) — fastest visible citations, lowest content cost, but lower total volume ceiling
B) Layer 3 first (clone the template to uscisexam.com, 50 civil-surgeon pages in 1 week) — higher long-term ceiling, but takes 60-90 days to show citation signal
My vote: B, because the template is built and the per-page cost is now near-zero. Layer 2 in parallel weeks 3-4.
Content fidelity. Real per-state data (actual USCIS civil surgeon counts, actual state statute deadlines, actual state dental license fees) is what separates "LLM cites us" from "LLM cites USCIS.gov instead." Do you have or can you commission someone to pull the real numbers per state per vertical? Without real data, the template ships placeholders that will work but underperform.

The 5 canonicals — do you have build access to all of them, or just this hub? If just this hub, the plan changes: we'd build everything on theindustryguides.com with subdirectory verticals (/civil-surgeon/states/..., /personal-injury/states/...) instead of cross-domain. That's actually fine for LLM citations but loses the sameAs network advantage.


