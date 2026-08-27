# Publishing cadence policy

## Why this document exists

The cadence was set from research and then never revisited against outcomes.
Search Console now works, so the temptation is to retune it from telemetry. That
would be wrong right now, for two reasons worth stating before any numbers.

**The 90-day window is contaminated.** Until 2026-08-26, every unknown URL on
thirteen domains returned HTTP 200 with a copy of the homepage, sitemaps were
never submitted to Search Console, three sitemaps were addressed to a host
literally named `None`, and tens of thousands of internal links resolved through
redirects. Surfacing measured under those conditions says the site was hard to
crawl. It says nothing about whether the publishing rate is right.

**Age was mistaken for failure.** A first pass found "94% of pages earn nothing"
and would have cut cadence on it. Segmenting by age corrected that: pages older
than 90 days surface at 20.2%, pages newer than 90 days at 0.1%. Most of the
corpus was simply young.

So the cadence numbers are not being changed on telemetry. What follows is
changed on research, which does not depend on a clean crawl.

## What the research says

1. **Past ~50 published pages, improving existing pages beats adding new ones.**
   Every property here is 10-50x past that threshold: sprylabs 2,812 pages,
   local-guides 2,326, WPP-llm 3,192.

2. **Volume carries site-wide risk, not just wasted effort.** Google's helpful
   content system evaluates a site holistically, so a large body of thin or
   duplicative pages can suppress the ranking of the whole domain. Publishing
   500 pages of which 200 are thin can cost visibility on the other 300.

3. **For AI answers, depth beats breadth.** A focused site that dominates a
   narrow topic cluster earns citations against larger competitors, and smaller
   sites have the advantage because depth in one niche is easier to build than
   coverage across many.

4. **The citation lift is measurable and it is not volume.** Adding quotations
   from credible sources raises a source's share of an AI answer by about 41%,
   statistics by about 31%, citations by about 28%. Tables are extracted more
   reliably than prose. 55% of AI Overview citations come from the first 30% of
   the cited page.

5. **Zero is also wrong.** Sites that stop publishing keep climbing for a while
   on compounding, then plateau and decline. Freshness still matters for crawl
   scheduling.

## Policy

**Keep publishing, change the mix.** The lane's daily budget stays; what it
spends the budget on changes.

- **Enrichment is the default work.** Each cycle improves existing pages against
  the four elements with measured citation lift - named sources, concrete
  numbers, comparison tables, FAQ blocks - prioritising pages that already
  surface in Search Console, because lifting a page that ranks 11th is worth
  more than a new page that ranks nowhere.
- **New pages continue, but must clear demand evidence.** A new page requires a
  measured (T1) query. That gate already exists; it was starved because nothing
  wrote T1 evidence until Search Console was connected.
- **Volume holds only on clean evidence.** `scripts/cadence/publish_headroom.mjs`
  refuses to hold publishing using data from before 2026-08-26 and requires 60
  days of post-fix data before it will gate anything. Until then the declared
  cadence stands.

## What would change this

Two clean 30-day windows after 2026-08-26. If pages surfacing per month rises
while volume is flat, the enrichment shift is working. If surfacing is flat
while the corpus grows, the headroom gate holds new volume automatically and
this document should be revisited with the numbers.

## Cadence ledger entries

Every new URL is recorded here with the measurement that justified it, so the
ledger in `data/cadence/known_urls.json` can be read back against a reason
rather than a date. The gate blocks above `new_pages_per_week: 2`.

### 2026-08-26 — 1 new URL against a cap of 2

| Route | Evidence | Why it was taken |
|---|---|---|
| `/dentistry/guides/how-long-do-dental-implants-last/` | **204 Bing impressions**, 25 May – 22 Aug 2026 (US 120 · UK 50 · IN 3 · CA 2). Bing Webmaster Tools Keyword Research, `siteUrl=https://theindustryguides.com`, read 2026-08-26. | Measured demand, no owned surface, and a top-10 that is entirely editorial prose — no price data and no downloadable artifact is needed to compete. Answerable from the FDA patient page on dental implant systems. |

The second slot was **deliberately left unused**. Six dentistry seeds were
measured; the full record is `data/signals/bing_keyword_research_dentistry_2026-08-26.json`.

- `does medicare cover dental implants` — **304 impressions**, the highest measured
  in the vertical, but `/dentistry/community-questions/does-medicare-cover-dental-implants/`
  already exists. The release queue rejected it as
  `SKIP_DUPLICATE:equivalent_title_exists`, which is the gate working. It was
  refiled as a repair with the sourced Medicare.gov content attached. That page
  currently cites the ADA's consumer site as its only source for a Medicare
  coverage question, which that source cannot support.
- `dental implant cost des moines` — below Bing's reporting floor, and the top 10
  is ten sites holding per-city verified price databases. **The dentistry city
  axis is now refused on evidence rather than on judgement.** It stays closed.
- `can i use hsa for dental implants`, `does medicaid cover dental implants`,
  `how long does a dental implant take to heal` — all below the floor. A gap in
  our coverage is not an opportunity until something measures it.

Taking one page rather than two is the point. The library is 2,001 pages above
its maintainable ceiling of 325, so an unused cadence slot costs nothing and an
unearned page costs refresh capacity forever.

Reviewed: 2026-08-26.

### 2026-08-27 — 2 new URLs against a cap of 2

Both slots taken, because for the first time both were earned by a query with a
measured volume rather than by a gap in our own coverage. Five measured queries
in `data/demand/measured_demand.json` map to a canonical domain this site feeds.
Two of them — `uscis civil surgeon` (5,400/mo) and `civil surgeon near me`
(2,400/mo) — already have owned surfaces. Three did not. Two were taken.

| Route | Query and evidence | Shape, and why it was taken |
|---|---|---|
| `/uscis-medical/guides/citizenship-test-2026/` | `citizenship test 2026` — **170/mo**, KD 31, weak-incumbent 0.69, Semrush Keyword Magic, `data/demand/measured_demand.json`. Grounded AI-answer observation 2026-08-26 returned uscis.gov and nnuimmigration.com; no owned surface. | **Comparison + checklist** (64% and 76% of unbranded slots open across 65 grounded observations). The query is dated by year, but USCIS sets the test version by an N-400 filing date of Oct. 20, 2025, so the year-shaped answer everyone else gives is the wrong axis. Answerable in full from USCIS, *Study for the Test*, and Policy Manual Vol. 12 Pt. E Ch. 2. |
| `/trt/guides/hormone-replacement-therapy-near-me/` | `hormone replacement therapy near me` — **8,100/mo**, KD 22, weak-incumbent 0.78, CPC $7.90, commercial intent. Grounded observation 2026-08-26 returned five clinic sites (losangelesprimarycare.com, evexianp.com, healthcare.utah.edu, taylormedicalgroup.net, georgedelaneymd.com) and no institutional source. | **Geo-modified + comparison** (68% and 64% open). Highest measured volume mapped to this site by a factor of 47. The five incumbents are single clinics; none separates the two FDA product families the query collapses together, and the FDA statement that no approved testosterone product is approved for men with low testosterone lacking an associated medical condition appears on none of them. |

The third uncovered query, `personal injury guide` (**40/mo**), was **not taken**.
It is a bare head term, the shape that closes at 44% across the observation set,
it carries the lowest measured volume of the three, and it would land in
`/personal-injury/`, the section holding 166 of the 190 routes that render into
no public surface. A page there has to earn its way past that, and 40/mo does not.

Neither page quotes a price. The cost/price shape is the strongest available at
100% of slots open, and it was deliberately not built as a standalone page,
because no primary source publishes a price for either hormone therapy or the
naturalization test, and an invented range is worse than none. The HRT page says
so on the page and answers the cost question with the questions that produce a
real number from a clinic instead.

Reviewed: 2026-08-27.

### 2026-08-27 (second run) — 2 new URLs against a cap of 2, 12 queued

Commissioned to mirror onto this site the 15 guides added to the canonical packs
in `local-guides-generator` (`f9671a9`, merged `de7dcc9`). Fifteen pages against
a cap of two, so the cap decided the shape of the work: **two published, one
reconciled, twelve queued.** The cap was not raised.

**The duplication strategy is (a) differentiate, and the canonical stays the
canonical.** Both new pages `rel=canonical` to their own `theindustryguides.com`
URL. Neither declares a cross-domain canonical, because that would hand citation
credit back to the domain this site feeds, which is the opposite of the point.
The pages therefore had to answer a *different question* from their canonical
namesake, not the same question in other words. The rule applied was
Sørensen–Dice on `<main>` word bigrams, target < 0.80 against the canonical
source:

| Velocity route | Canonical source | Dice vs canonical | Peak Dice vs all 2,151 admitted routes |
|---|---|---|---|
| `/uscis-medical/guides/n-400-checklist/` | `guides_n-400-checklist.json` | **0.1189** | 0.3190 vs `/uscis-medical/guides/citizenship-test-2026/` |
| `/neuro/guides/hospital-vs-private-neuropsych-testing/` | `guides_hospital-vs-private-neuropsych-testing.json` | **0.1240** | 0.2894 vs `/school-iep-evaluation-vs-private-neuropsych-evaluation/` |
| `/trt/guides/hormone-replacement-therapy-near-me/` (pre-existing) | `guides_trt_hormone-replacement-therapy-near-me.json` | **0.0772** | 0.2730 vs `/trt/community-questions/how-to-naturally-raise-testosterone-before-considering-trt/` |

| Route | Evidence | The feeder angle that made it not a duplicate |
|---|---|---|
| `/uscis-medical/guides/n-400-checklist/` | `n-400 checklist` — owner-approved seed, `data/demand/measured_demand.json`, `volume: null`. The commissioning instruction states 170/mo at KD 30; no packet under `data/` reproduces that figure, and the canonical repo records that no volume, KD or CPC figure exists anywhere in its data. Carried as an owner seed per `owner_seed_policy`; **no page prints it**. | The canonical answers *what goes in the envelope*. This answers *which forms your filing is even made of* — N-400 vs N-648 vs I-693 — because readers arrive at a USCIS **medical-exam** site believing the immigration medical examination is a naturalization step. It is not. Eight-row comparison across the three forms, then it routes to the canonical for the document list itself. |
| `/neuro/guides/hospital-vs-private-neuropsych-testing/` | `hospital vs private neuropsych testing` — T1, Google Search Console, already in `data/demand/measured_demand.json`. No new demand record needed. | The canonical answers *what the price difference is*, code by code, from CMS CY2024. This answers *which setting to call first*, keyed to who requested the evaluation — and two of the five answers are not clinics at all: under IDEA the school district evaluates for educational eligibility, and SSA arranges a consultative examination when it needs evidence. It prints **no dollar figure** and points at the canonical for the published comparison. |

`/trt/guides/hormone-replacement-therapy-near-me/` was **reconciled, not
duplicated**. It already existed here, authored independently earlier the same
day, and scores 0.0772 against the canonical page of the same slug. Nothing was
created and nothing was overwritten.

Every figure on the two new pages was re-verified against the primary source
today rather than carried across on trust: `$760` paper / `$710` online / `$380`
reduced fee / `$0` with an approved I-912, and the "optional tool", "Do not send
original documents" and biometrics sentences, all read from
`https://www.uscis.gov/n-400` on 2026-08-27; the G-1055 edition `05/29/26` from
`https://www.uscis.gov/g-1055`; the N-648 certifier professions, examination
mode and "no filing fee" from `https://www.uscis.gov/n-648`; and the hospital
outpatient copayment sentence from
`https://www.medicare.gov/basics/costs/medicare-costs`. All five are registered
in `data/evidence/source_registry.json` with a retrieval date and an allowed
claim class.

**Leads.** No lead-capture surface was built here. `functions/api/request-assistance.js`
already exists in this repo and is functionally identical to the canonical one,
with `AIRTABLE_BASE_ID`, `Lead Requests`, `LEAD_TO` and `EMAIL_FROM` committed in
`wrangler.toml` — the endpoint is not missing, the **page and form** are. Three
things argued against building them in this change: `docs/PAGE_RELEASE_LAW.md` §6
requires provider-seeking intent to route *only* through the canonical Find a
Provider destination; `wrangler.toml` records that `RESEND_API_KEY` is still
absent on this Pages project, so the email fallback cannot fire; and a
zero-search-demand conversion route cannot be admitted without failing
`validate:demand-backed-pages` (HARD_FAIL) or consuming a cadence slot. Both new
pages therefore route to `https://uscisexam.com/request-assistance/` and
`https://neuroevalguides.com/request-assistance/` through the existing three
canon blocks, which is the pattern the 2026-08-27 commit `53ca85f28` established
and called "the feeder pattern working, not duplication". Standing lead capture
up on this domain is a live and worthwhile option, but it needs an owner decision
on §6 plus the missing secret, not a silent change.

#### Queued — 12 routes, cap-bound, not evidence-bound

These are the remaining canonical guides. They are **not blocked on merit**; they
are blocked on `new_pages_per_week: 2`. Each carries the differentiated feeder
angle it should be built to, so the next cycle does not have to re-derive it. Ten
of the twelve also need a demand record before they can clear
`validate:demand-backed-pages`, which is a HARD_FAIL: only
`hospital-vs-private-neuropsych-testing` (taken here) and
`what-a-personal-injury-case-costs-you` (matches the T1 record `case-costs`,
1/mo) currently match a measured query.

| Canonical guide | Velocity route to build | Feeder angle (so it is not a duplicate) | Demand status |
|---|---|---|---|
| `uscis-medical-exam-cost` | `/uscis-medical/guides/uscis-medical-exam-cost/` | Canonical separates the published $0 filing fee from the unpublished civil-surgeon fee. Feeder: *which of the two fees are you actually asking about*, and which guide answers each. | Needs record |
| `n-648-medical-waiver` | `/uscis-medical/guides/n-648-medical-waiver/` | Canonical is the form's own requirements. Feeder: *how to find and vet a clinician who may certify it* — three professions, state medical board check, in-person vs telehealth. Owner states 50/mo, KD 19. | Needs record |
| `uscis-interview-checklist` | `/uscis-medical/guides/uscis-interview-checklist/` | Canonical is the checklist. Feeder: *what the interview decides that the paperwork already settled*, routing to the civics-test and I-693 guides. Owner states 20/mo, KD 0. | Needs record |
| `hormone-therapy-cost-what-is-published` | `/trt/guides/hormone-therapy-cost-what-is-published/` | Canonical prints the CMS CY2024 lab and procedure table. Feeder: *how to compare two clinic monthly fees* when neither publishes contents — pairs with the existing HRT page, which declines to quote a price. | Needs record |
| `peptide-and-compounded-therapy-claims` | `/trt/guides/peptide-and-compounded-therapy-claims/` | Canonical declines to publish a results timeline. Feeder: *how to tell an approved product from a compounded one before you are prescribed it*. | Needs record |
| `dental-implant-and-oral-surgery-cost` | `/dentistry/guides/dental-implant-and-oral-surgery-cost/` | Canonical leads with the ADA being barred from quoting fees. Feeder: *which of the dentistry cost guides applies to the quote in your hand*. | Needs record |
| `dental-procedure-cost-comparison` | `/dentistry/guides/dental-procedure-cost-comparison/` | Canonical compares procedures on published data. Feeder: *how to make two dentists' quotes comparable at all* — line items, not totals. | Needs record |
| `upfront-dental-pricing-checklist` | `/dentistry/guides/upfront-dental-pricing-checklist/` | Canonical is the checklist. Feeder: *which practices are structurally able to quote upfront*, and what to ask when one will not. | Needs record |
| `neuropsychological-evaluation-cost` | `/neuro/guides/neuropsychological-evaluation-cost/` | Canonical prints the CMS figures. Feeder: *which evaluation you are being quoted for* — neuropsych vs psychoeducational vs ADHD-only vs autism-specific — since the label drives the number. | Needs record |
| `neuropsych-testing-cost-by-state` | `/neuro/guides/neuropsych-testing-cost-by-state/` | Canonical is the state table. Feeder: *what state actually changes and what it does not*, against this site's existing `/neuro/states/` pages. | Needs record |
| `medical-bills-behind-a-settlement` | `/personal-injury/guides/medical-bills-behind-a-settlement/` | Canonical explains liens and IRS Pub 4345. Feeder: *who is going to send you a bill, and in what order*. | Needs record |
| `what-a-personal-injury-case-costs-you` | `/personal-injury/guides/what-a-personal-injury-case-costs-you/` | Canonical prices the case, incl. 28 U.S.C. § 1914(a) filing fees. Feeder: *which costs come out of your settlement and which come out of your pocket*. | **Matches** `case-costs`, T1, 1/mo |

The queue is deliberately not a promise to build all twelve. Six of them land in
`/personal-injury/` and `/dentistry/`, and the library is already 1,826 pages
above its maintainable ceiling of 325. Each should have to earn its slot against
a measured query at the time it is taken, exactly as these two did.

Reviewed: 2026-08-27.
