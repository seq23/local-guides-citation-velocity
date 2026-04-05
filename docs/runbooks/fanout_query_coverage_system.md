# Fan-out Query Coverage System

## Purpose
This runbook defines the fan-out query coverage contract for the velocity repo. Every required page must render a visible fan-out block plus a hidden JSON payload so adjacent search phrasing is captured consistently.

## Required surfaces
- homepage
- vertical homepages
- tools
- glossary
- cluster/detail pages
- insights
- medium article pages
- archives

## Build contract
1. Run `npm run build`
2. Confirm `.build/fanout_manifest.json` exists
3. Confirm `.build/fanout_missing.json` exists
4. Confirm `.build/fanout_duplicates.json` exists
5. Confirm `releases/fanout_query_clusters.<vertical>.json` files exist

## Validation contract
Run:
- `npm run validate:all`
- `npm run validate:fanout`

The fan-out validator is warning-only in this phase. It must not block deploy, but warnings must be reviewed before shipping a baseline.

## Manual QA
Open a sample page from each family and verify:
- visible “Common ways people search this” block exists
- JSON payload exists in page source
- links route to tools / glossary / hub / canonical domain appropriately
- no broken styling

## Failure recovery
If fan-out is missing or malformed:
1. fix the source renderer in `scripts/build_site.js` or `scripts/lib/fanout.js`
2. rebuild
3. rerun validation
4. re-open the packaged ZIP and verify the built pages again
