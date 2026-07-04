# REPO IDENTITY — LOCAL GUIDES CITATION VELOCITY

## CLASSIFICATION
Level 2 generated static publishing and citation-velocity repository.

## SOURCE OF TRUTH
The latest supplied baseline ZIP is the starting source of truth. Inside the repository, durable authority is split by layer:

1. Locked external Listings governance.
2. `content/_shared`, `content/_staged`, approved report-fix inputs, and Citation Velocity registries.
3. `scripts`, `templates`, schemas, and lifecycle contracts.
4. `content/_live` and rendered public files, which are generated and must not be hand-edited.
5. Velocity-only overhaul registries, page-family data, routing, evidence, and release controls.
6. Rendered public files, which are generated and must not be hand-edited.

## CANONICAL UPDATER
`$HOME/repo-tools/active/update_repo_from_zip_generic_v3_1.sh`

## SNAPSHOT ZIP PATTERN
`local-guides-citation-velocity-main_BASELINE_MM-DD-YY_<sha>.zip`

## CORE RULES
- Edit durable source and generator layers, never rendered HTML as the primary repair surface.
- `validate:all` is pure and does not ingest, publish, commit, push, or mutate external repositories.
- Builds are deterministic and freshness dates change only for substantive page changes or explicit editorial review.
- Velocity owns and publishes all guides, state pages, question pages, and disambiguators. Canonical sites are outbound Find a Provider destinations only.
- Full baseline snapshots are packaged from the true repository root and locally validated by the updater.

## VELOCITY-ONLY FULL-SCOPE OVERHAUL

The approved June 19 program is Velocity-only. The repository renders 20 disambiguators, 200 literal-question pages, and 412 state/support pages. Releases mutate and deploy this repository only. Canonical sites are outbound provider destinations and do not participate in the release lifecycle.
