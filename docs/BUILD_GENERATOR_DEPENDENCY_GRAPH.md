# Build generator dependency graph

This did not exist before 2026-09-03. Its absence is why the build brute-forces
convergence instead of running incrementally: nobody had written down what feeds
what, so no script could safely skip work it could not prove was unaffected.
This document is that map, written from direct inspection of `scripts/build_site.js`
and the four scripts that run around it, not from the generator's own comments
(several of which describe intent rather than the current write order).

It exists to answer two questions honestly:

1. What does `npm run build` actually depend on, so a result-level cache
   (`scripts/lib/build_cache.js`) can be keyed correctly?
2. Is the graph complete enough to rebuild only the pages that changed,
   instead of all ~2,070, on every run?

The answer to (2) is **no, not yet** - see "Why incremental is not safe yet"
below. The cache in this PR stops at result-level caching (skip the whole
build when nothing hashed input changed) plus this document. It does not
attempt per-page incremental rebuilding.

## The five-stage pipeline (`npm run build`)

```
1. apply_medicaid_dental_fee_data.js
2. build_site.js                      <- the generator; ~2,070 pages, sitemaps, feeds, robots.txt, llms*.txt
3. scripts/feeds/build_promotion_candidates_feed.js
4. build_pages_dist.js                <- copies the public tree into dist/ for deploy
5. install_clarity.js                 <- mutates every already-written HTML page, last
```

Each stage runs unconditionally and depends on the file state the previous
stage left on disk - `ALLOW_CANONICAL_DATA_REGEN=1` and `SOURCE_DATE` are the
only inputs threaded through explicitly; everything else is read fresh from
the working tree each stage.

| Stage | Reads | Writes | Notes |
|---|---|---|---|
| 1. `apply_medicaid_dental_fee_data.js` | `data/medicaid/**` (public fee schedules), `content/_shared/canonical_map.json` | up to ~100 rendered dentistry routes directly, canonical data under `data/medicaid/**` | Runs BEFORE build_site.js so those routes carry the applied figures when generated, not as a later patch. |
| 2. `build_site.js` | `content/_live/**` (or `_staged` when `VELOCITY_CONTENT_SOURCE=staged`), `content/_shared/**`, `templates/layout.html`, ~2,600 files under `data/**`, `_redirects`, `data/release/frozen_page_registry.json` + `data/release/frozen_html_cache/**` | every rendered route, `sitemaps/*.xml`, `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, `feed.xml`, `feed.json`, `.well-known/security.txt`, `content/_shared/content_state.json` | See internal stage order below - this is the generator. |
| 3. `build_promotion_candidates_feed.js` | `data/queries/measured_demand_candidates.json`, `data/signals/query_class_occupancy.json` | `feeds/promotion-candidates.json` | Independent of the page set; safe to run any time after stage 2 starts, in practice runs after. |
| 4. `build_pages_dist.js` | the public tree stage 2 just wrote | `dist/**` | A copy/selection step, not a generator - depends on stage 2's output existing on disk, not on any specific route's content. |
| 5. `install_clarity.js` | every `.html` file under the public tree | rewrites those same files in place, injecting one `<script>` tag | Runs last on purpose: any earlier stage that touches HTML after this would either duplicate or strip the tag. Idempotent - a second run reports "0 upgraded, N already correct". |

## Inside `build_site.js` - the part that makes incremental unsafe

`main()` (scripts/build_site.js:2017-3007) runs these sub-stages in this
fixed order, each one operating over the WHOLE route set, not one page:

1. **Fan-out manifest** (line ~1755) - plans every route the build will
   produce, including answer-shape heading decisions (question-form H1s) that
   later stages read back.
2. **Route disposition accounting** (line ~1531) - classifies every rendered
   route as advertised / retired-via-redirect / backlog, written to
   `artifacts/validation/rendered_route_disposition.json`.
3. **Per-page generation** - renders each route's HTML from its content
   source, template, and any citation-velocity artifacts merged in from
   `data/release/accepted_page_artifacts.json` and
   `data/release/historic_recovered_artifacts.json` (`scripts/lib/accepted_artifacts.js`).
4. **Network identity injection** (line ~2983) - walks the FULL route list a
   second time after generation and injects a JSON-LD `@graph` node into every
   page's `</head>`. A page not yet in this pass has no network identity;
   this cannot be scoped to "the pages that changed" without also tracking
   which pages already carry the current graph shape.
5. **Dentistry report-fix contract** (line ~2997,
   `apply_dentistry_report_fix_contract.js`) - a POST-PROCESS pass that can
   rewrite dentistry pages the generator already produced, applying named
   report markers and href repairs. Explicitly documented in its own source
   as running `AFTER_BUILD`.
6. **Frozen accepted-output guard** (line ~3004,
   `scripts/lib/frozen_pages.js:restoreFrozenPages()`) - the FINAL step, and
   the one that makes per-page incremental generation unsound on its own.
   For every route the frozen-page registry marks `FROZEN` and outside the
   current release's mutation scope, this OVERWRITES whatever stages 3-5 just
   produced with the byte-for-byte accepted bytes from
   `data/release/frozen_html_cache/**`, keyed by content hash. In the current
   steady state this is ~1,950-1,955 of ~2,070 routes on every run. A route's
   FINAL bytes are therefore a function of this stage, which runs once for
   the whole site and reads a registry that is itself global state - not a
   function of that one page's own inputs.

## Why incremental (level 3) is not safe yet

The task that produced this document allows incremental rebuilding only if
the graph is "provably complete" for it, and is explicit that a wrong graph
shipping stale pages is worse than a slow build. It is not provably complete
here, for three concrete reasons, not a hedge:

1. **Global post-processors, not per-page transforms.** Steps 4-6 above each
   read and can rewrite the ENTIRE route set as a single pass. To rebuild
   "only page X" correctly, each of these would need a proven, narrow
   per-route predicate ("does X's frozen state depend on anything that
   changed?", "does X's network-identity graph need updating?"), and none of
   the three currently exposes one. Guessing wrong in the frozen-restore step
   specifically reproduces the exact defect `rendered-output-shrink-guard`
   exists to catch: a page silently re-accepted thinner than its accepted
   baseline.
2. **Sitewide artifacts with no natural page boundary.** `sitemaps/*.xml`,
   `feed.xml`/`feed.json`, `robots.txt`, and `feeds/promotion-candidates.json`
   are each a function of the FULL admitted route list. There is no
   "unaffected" case for these when even one route's admission status
   changes; they would need to be rebuilt on every miss regardless of how
   many pages actually changed, which limits how much an incremental scheme
   could win even if per-page generation were provably safe.
3. **Content-addressed merges with no back-reference.** `accepted_page_artifacts.json`
   and `historic_recovered_artifacts.json` (consumed in sub-stage 3) are
   keyed by route, but nothing in this repo currently maps "which generator
   inputs, if changed, would change route X's merged artifact set" back to
   X specifically - the two recovery scripts (`recover_accepted_page_artifacts.js`,
   `recover_historic_artifact_loss.js`) recompute their FULL output every
   time they run, over every frozen route, not incrementally per route.

**Conclusion: stop at level 2 (this document) plus level 1 (the result-level
cache).** A future incremental attempt has concrete, scoped work to do first:
prove a narrow per-route predicate for steps 4 and 6 above, and give the two
recovery scripts a route-level "did this route's inputs change" check. Until
then, any cache miss triggers a full, safe, unconditional rebuild through all
five stages - "correct but slow," never "incorrect but fast."

## What the result-level cache (level 1) actually keys on

See `scripts/lib/build_cache.js` for the implementation. Summary: SHA-256 over
every file under `scripts/`, `templates/`, `content/`, `data/`,
`package.json`, `package-lock.json`, `_redirects`, plus the env vars that
change generator behaviour (`ALLOW_CANONICAL_DATA_REGEN`,
`VELOCITY_CONTENT_SOURCE`, `SOURCE_DATE`). `content/_shared/content_state.json`
is excluded from the hash - it is written by stage 2 as a generation ledger,
not read as independent input in any way that survives the frozen-output
guard, and hashing it as an input would make the key change on every run
(see the comment in build_cache.js for the full reasoning and the concrete
non-idempotence this was found from).

A cache hit restores the tracked delta (files stage 2-5 modified relative to
`git HEAD`, mirrored exactly) plus the gitignored `.build/` and `dist/`
directories wholesale, and skips all five stages entirely. A miss runs all
five stages unconditionally, exactly as `npm run build` always has.
