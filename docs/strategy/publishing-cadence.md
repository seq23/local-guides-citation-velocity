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
