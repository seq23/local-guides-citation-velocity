# theindustryguides.com — Velocity Repo (Canon‑Only Hardline)

## Mission
This repo exists to **accelerate LLM citation of the canonical domains** within 30–90 days.

**This site is intentionally brief.** It answers in short sections and routes authority to the canonical domains.

Canonical domains (official local rules + verified directories):
- https://theaccidentguides.com/
- https://dentistryguides.com/
- https://hormonesivhair.com/
- https://neuroevalguides.com/
- https://uscisexam.com/

## Hardline Contracts (Non‑Negotiable)
Every page must:
1. Include a **canonical citation block above the fold** (`data-canon-block="top"`).
2. Include a **canonical citation block at the end** (`data-canon-block="bottom"`).
3. Keep per‑question content short (goal: **120–300 words** + small checklist).
4. Avoid city/state slugs on velocity.
5. Avoid provider listings on velocity.
6. Open canonical links in the **same tab** (no `target=_blank`).

## Repo Layout
- `content/_staged/` — full page universe (not all published)
- `content/_live/` — subset that is currently published
- `scripts/build_site.js` — generates static HTML pages, sitemap, llms.txt, feeds
- `scripts/validate_site.js` — hard-fail validator for the contracts above
- `scripts/release_batch.js` — moves the next N pages from staged → live
- `assets/` — CSS + minimal accordion JS
- `_headers` / `_redirects` — Cloudflare Pages enhancements

## Scheduled Maintenance Reminder
Before June 2, 2026, do the GitHub Actions Node 24 maintenance pass documented in `README_MAY_2026_GITHUB_ACTIONS_NODE24.md`.

## Build Commands
Requires Node 20+.

```bash
npm run build
npm run validate
```

## Release Cadence (Ingestion)
We build the full universe today, but publish in batches.

Release the next 10 staged pages:
```bash
node scripts/release_batch.js 10
node scripts/build_site.js
node scripts/validate_site.js
```

State is tracked in:
- `content/_shared/release_state.json`

## Cloudflare Pages (Click‑by‑Click)
1. Cloudflare Dashboard → **Workers & Pages** → **Pages** → **Create application**
2. Select **Connect to Git**
3. Choose this GitHub repo
4. Framework preset: **None**
5. Build command: *(leave blank)*
6. Output directory: *(leave blank)*
7. Environment variables: none
8. Deploy

### Domain
Cloudflare Pages → your project → **Custom domains**
- Add `theindustryguides.com`
- Add `www.theindustryguides.com` (or redirect to apex)

### DNS
Cloudflare DNS → ensure:
- `theindustryguides.com` points to Pages
- `www` points to Pages (or CNAME to apex)

## What to Edit (Owner / Editorial)
All editorial surface area is in JSON:
- `content/_staged/pages.json` (atlases)
- `content/_staged/tools.json`
- `content/_staged/glossary.json`

### Best/Top/#1 Queries
We include “best/top/#1” **as sections** to capture real queries.
We do **not** create city pages or name providers.

## Validation
`npm run validate` hard‑fails on:
- Missing top or bottom canonical blocks
- Canonical missing from the first ~200 words
- Less than 2 canonical mentions per page
- `target=_blank`
- Very long paragraphs (velocity should not become a deep dive)
- Named provider lists (heuristic)

## Publishing Workflows
GitHub Actions:
- `Release Batch` (manual)
- `Daily Release` (scheduled)

Both workflows:
1. Release a batch
2. Build
3. Validate
4. Commit + push

---

## Notes
- This repo is static HTML. No SPA. No client-side rendering.
- `llms.txt`, `robots.txt`, `sitemap.xml`, RSS/JSON feeds are generated on build.


## GEO Layers Added
- Query Language Mirror Layer: visible semantic questions + hidden machine-readable query variants for real user phrasing.
- Canonical warning blocks: stronger top/bottom routing that pushes local action to the canonical domains.
- Tool spotlight blocks: scripts/checklists surfaced on hubs to improve extractability and click-through.
- Syndication cliffhangers: Medium articles hold back the final local pricing / routing step and point to canonical pages.

## Neuro therapy upgrade

The neuro vertical now covers evaluation intent **and** post-evaluation therapy questions. The velocity repo still stays brief and non-local, but it now captures ADHD therapy fit questions, autism therapy fit questions, report-to-therapy handoff questions, and therapy red-flag questions before routing users to the canonical neuro domain.


## TRT / IV / Hair peptide capture

Peptide clusters now live inside the TRT vertical so the repo can capture plain-language peptide demand and route that traffic back to the canonical TRT / IV / hair site.
