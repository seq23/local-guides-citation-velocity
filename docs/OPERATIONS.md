# Operations notes

Hard-won facts about how this repo behaves. Moved here from assistant memory on 31 Oct 2026 so they
live with the code. Strategy stays in `docs/strategy/`; this page is the "why did that go red" page.

## Where this site sits
- This repo is the **velocity site** (theindustryguides.com). New pages, AI citations and leads land
  here; the canonical guide domains (local-guides-generator) stay clean and keep the deep guides.
- A velocity page that mirrors a canonical guide is **differentiated, never copied**: it
  self-canonicals to its own URL (never `rel=canonical` to a canonical domain), answers the
  orientation / comparison question above the guide, and must score **Sørensen–Dice < 0.80 on
  `<main>`** against the canonical source. At or above → rewrite, never ship with a caveat.
  Ship fewer pages rather than near-duplicates; never raise the cadence cap to fit a backlog.
- Measured (Oct 2026): near-duplicate rate does **not** predict AI citation. Page shape
  (cost/checklist/geo/comparison over bare head terms), reachability (orphans) and real named
  entities do.

## Validators
- 22 Sep 2026: 169 HARD_FAIL validators were culled to the real harms (36 at the time).
  `validate_validation_registry.js` enforces a `hard_fail_basis` for every blocker and
  **`MAX_HARD_FAIL = 40`**. Never re-add a blocker without a basis; never make a ratchet fail when an
  entry stops reproducing.
- A well-formed agent drop arriving is never a failure (only a malformed or foreign one). New pages
  block only on search vitals (`search-quality-basics`: title, meta description, canonical, one h1,
  encoding).
- A recommendation that misses its page is retried first
  (`data/report_fixes/recommendation_retry_ledger.json`), then escalated after 3 misses as one issue
  per page (label `unapplied-recommendation`), auto-closed on landing.

## Velocity Content Release lane
- **The release lane re-authors page content.** It pushes to `main` as `github-actions[bot]` and
  re-mints semantic artifact blocks, titling them from the query string. A content fix made only to
  the page is undone by the next release run. For any content-guard failure, check whether a bot
  commit re-created the content after the human fix before concluding the fix failed; the class fix
  is making the removal an input to the generator.
- **One definition of a satisfiable acceptance entry**: `selfConsistencyErrors` in
  `scripts/lib/html_fix_rendering_contract.js`, asked by the compiler before writing and by the
  validator after. Guard `agent-run-compile-preview` compiles every landed run at drop time.
- Repro when the lane goes red on a manifest it wrote itself:
  `SOURCE_DATE=<run date> npm run citation:prepare-velocity-intake && npm run citation:plan-agent-exact && npm run citation:compile-html-fix-acceptance && node scripts/validators/validate_agent_exact_acceptance_manifest.js`
  — `compiled_artifact_*` errors are compile-consistency; `missing_*` against HTML need apply + build first.
- Sep 2026 lesson: a release run with `selected=N / created=0` was a silent skip of already-staged
  routes with no `report.skipped` row → contract STOP → rollback. Every skip must leave a row.

## Schedule-only lanes
- After a merged fix, a schedule-only lane stays red on its old run until it runs again.
  `gh workflow run query-evidence-refresh.yml --ref main` is safe to verify with (shared
  `local-guides-main-writer` concurrency group; commits only after `validate:release`).
- Frozen routes' sitemap `lastmod` advances only when bytes change; the cadence gate warns 28 days
  before the next 91-day crossing. The weekly capacity number in `data/cadence/policy.json` is a
  policy choice, not an edit to make to get green.

## Search Console
- The portfolio GSC report is the reusable workflow `.github/workflows/gsc-portfolio-report.yml`
  (modes: report, `sitemaps`, `coverage`), using the `GSC_SERVICE_ACCOUNT_JSON` secret. Read its
  artifacts; never guess from third-party rank tools.
