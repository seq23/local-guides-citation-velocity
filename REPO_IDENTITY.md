# REPO IDENTITY — LOCAL GUIDES CITATION VELOCITY

## CLASSIFICATION
Level 2 generated static publishing and citation-velocity repository.

## PUBLIC DOMAIN

`theindustryguides.com` — the umbrella hub this repository builds and publishes. Declared here so
the domain maps to this repository by name rather than by inference: Danielle's Ahrefs site-audit
job resolves a flagged Ahrefs project to a repository by grepping every `REPO_IDENTITY.md` for the
domain, and until 16 Oct 2026 nothing claimed this one, so every finding against the site had to be
mapped by reading the rendered routes.

The six canonical guide sites are separate repositories and are not claimed here; this repository
publishes the hub and the Velocity pages that route into them.

## SOURCE OF TRUTH
The latest supplied baseline ZIP is the starting source of truth. Inside the repository, durable authority is split by layer:

1. Locked external Listings governance.
2. `content/_shared`, `content/_staged`, approved report-fix inputs, and Citation Velocity registries.
3. `scripts`, `templates`, schemas, and lifecycle contracts.
4. `content/_live` and rendered public files, which are generated and must not be hand-edited.
5. Velocity-only overhaul registries, page-family data, routing, evidence, and release controls.
6. Rendered public files, which are generated and must not be hand-edited.

## PUBLIC DOMAIN

`theindustryguides.com` — the velocity and umbrella property for The Industry
Guides. This repository builds and deploys it; `wrangler.toml` carries the same
value as `SITE_URL`, and `CLAUDE.md` names it in its first line.

Declared here on 26 October 2026 because it was not. A search-readiness pass
looking for the repository that owns a flagged domain starts with
`grep -ril "<domain>" ~/GitHub/*/REPO_IDENTITY.md`, and this file - the one place
that exists to answer that question - was the one place the domain did not
appear. The outbound guide domains stay out on purpose: they are
`local-guides-generator`'s, and this repository only routes to them.

## CANONICAL UPDATER
`~/update_repo_from_zip_generic_v3.sh`

## SNAPSHOT ZIP PATTERN
`local-guides-citation-velocity-main_BASELINE_MM-DD-YY_<sha>.zip`

## CORE RULES
- Edit durable source and generator layers, never rendered HTML as the primary repair surface.
- `npm run validate` is the lean core validation entry point. `validate:release` is the full container release proof. Validation never substitutes for explicit release/publish execution.
- Accepted admitted HTML is physically frozen by default; only transactionally authorized target routes may change during a governed repair/release.
- 100K fanout is sharded planning intelligence, not a public-page quota.
- Builds are deterministic and freshness dates change only for substantive page changes or explicit editorial review.
- Velocity owns and publishes all guides, state pages, question pages, and disambiguators. Canonical sites are outbound Find a Provider destinations only.
- Full baseline snapshots are packaged from the true repository root and locally validated by the updater.

## CURRENT 2026-07-24 HARDENED CONTROL PLANE

- Runtime autonomy: `FULL_SAFE_AUTONOMY`.
- Page strategy: machine Safe Harbor; no routine manual approval queue and no synthetic page quota.
- Accepted output: `data/release/frozen_page_registry.json` + content-addressed gzip cache.
- 100K+ intelligence: indexed deterministic gzip shards; legacy monolith and uncompressed shard bloat are forbidden.
- Maximum Fanout + 100K Surfacing Acceleration: no arbitrary opportunity-discovery ceiling; 100K is a minimum materialized reference runway, never a page quota or external-citation claim.
- Release lifecycle: stage → validate → promote → freeze/refreeze.
- Public deploy surface: admitted-route driven `dist/`.
- Full validation is local/updater authority after applying a baseline ZIP.

## VELOCITY-ONLY FULL-SCOPE OVERHAUL

The approved June 19 program is Velocity-only. The repository renders 20 disambiguators, 200 literal-question pages, and 412 state/support pages. Releases mutate and deploy this repository only. Canonical sites are outbound provider destinations and do not participate in the release lifecycle.
