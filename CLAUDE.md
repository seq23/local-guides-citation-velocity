# local-guides-citation-velocity — rules for anyone working in this repo

This is the velocity and umbrella property for The Industry Guides
(theindustryguides.com). The canonical guides live in `local-guides-generator`;
this repo carries the vertical hubs, the insight pieces and the atlas that route
readers to them.

`AGENTS.md` is the long operating manual: read it before changing the build, the
validation registry or the release lanes. This file holds the rules that code
reads.

## Nothing paid

Owner policy, 11 October 2026: **nothing paid.** No model call, probe, search API
or enrichment in this repo may cost money.

- Every model call goes through `scripts/lib/free_llm_router.mjs`, on the $0
  models listed in `config/llm_routing.json` (`policy.max_cost_usd: 0`,
  `paid_fallback: false`, `web_plugin_allowed: false`).
- The paid probes are off every schedule. They are dispatch-only, behind a
  `confirm_paid` boolean input that defaults to false; without it the workflow
  prints a NAMED STOP and nothing runs.
- No script outside the router may call a model endpoint, and no SerpAPI,
  Semrush, Ahrefs or Apify call is made from this repo.

What was paid before, what replaced it and what it now costs is written out in
[`docs/cost/zero-paid-llm.md`](docs/cost/zero-paid-llm.md).

**A test reads this section.** `scripts/lib/zero_paid_llm_check.js` (registered as
`zero_paid_llm` in `data/seo/site_hygiene_registry.json`, run by the
`site-hygiene` blocker on every validation) fails if this file loses the
"nothing paid" line or its pointer to `docs/cost/zero-paid-llm.md`, if the doc
goes missing, or if the routing config, the scheduled workflows or the probe
gates drift from the policy above. It replays hostile fixtures every run, so the
rule cannot pass by being absent.

## The merge gate

`.github/workflows/validate-repo.yml` is the merge gate and it stays under five
minutes (Search Readiness h5). It runs the `release` profile as `SHARD_COUNT`
balanced shards plus one aggregate job that proves every validator was assigned
exactly once and passed. Shard weights come from measured durations in
`_validation_registry.json` (`estimated_runtime_seconds`); refresh them with
`npm run ci:refresh-shard-weights -- <run-id>` after a run whose timings moved,
or the balancer packs one shard twice as heavy as the rest.

**The gate builds the site once per commit, not once per job.** The release lane's
`site-build` stage runs `npm run build:cached`
([`scripts/lib/build_cache.js`](scripts/lib/build_cache.js)), shard 2 saves the
resulting `.build-cache` entry, and the aggregate job — which runs after every
shard, on the critical path — restores it instead of regenerating all ~2,400 pages
a second time in series. Two rules hold this up, and a test reads each:

- Nothing wall-clock-stamped may enter the cache's hashed input surface. The gate
  runs `release:daily-citation-intelligence:preview` in every job first, and that
  rewrites `data/signals/**` with a real `generated_at`, so those paths are in
  `INPUT_EXCLUDE_PREFIXES`. Hash a generated ledger as input and every job gets a
  different key for the same commit, which is a cache that can never hit.
- `build-result-cache-integrity` is in the `release` profile, not just `audit`,
  because the gate now depends on the cache. It refuses to pass without an entry
  for the current input hash and hashes every git-tracked file plus the build dirs
  against an isolated, cache-disabled ground-truth build.
