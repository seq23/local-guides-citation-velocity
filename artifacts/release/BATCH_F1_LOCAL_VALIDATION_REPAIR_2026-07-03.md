# Batch F.1 Local Validation Repair — Velocity

## Scope
- Repairs the Batch F Velocity ZIP after local updater failure at `programmatic-source-quality`.
- Keeps the USCIS 2026-07-03 four-artifact run admitted.
- Repairs the seven new USCIS guide/cluster pages so they satisfy programmatic source-quality, rendered programmatic substance, content atom, and rich new-page validators.

## Changes
- Added `source_urls` to the seven generated USCIS pages.
- Added `self_healing.status=REPAIRED_AND_RESCORED` and `stage=SOURCE_READY` to those pages.
- Replaced thin/duplicated rich-page sections with source-ready, page-specific sections.
- Regenerated valid `content_atom` values through the repo content atom derivation contract.
- Patched `scripts/lib/rich_new_page_blocks.js` and `scripts/velocity_content_release.js` so future agent-created pages keep the same source-ready shape.

## Container Validation
- `node scripts/content/validate_programmatic_substance.js` — PASS
- `npm run validate:programmatic-substance` — PASS
- `npm run validate:rich-new-page-contract` — PASS
- `npm run validate:batch-f-continuity` — PASS
- `npm run validate:rendered-programmatic` — PASS
- `npm run validate:page-family-contract` — PASS
- `npm run validate:registry` — PASS
- `npm run release:prepush:local` — advanced past the original failing stage and site-build; sandbox timed out during the long release validator suite, with all displayed validators passing before timeout.

## Status
STRUCTURALLY CHECKED — LOCAL VALIDATION REQUIRED
