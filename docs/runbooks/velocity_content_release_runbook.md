# Velocity Content Release Runbook

## Purpose
Operate daily release for atlas pages, evergreen sections, medium articles, and insights in the velocity repo using one deterministic build path.

## Release order
1. Page batches until all staged pages are live.
2. Evergreen section batches continue daily.
3. Medium article batches release daily using `MEDIUM_BATCH`.
4. Insight batches release daily using `INSIGHT_BATCH`.
5. Build emits archives, sitemaps, and canonical published inventory.

## Source of truth
- Atlas pages: `content/_staged/pages.json`
- Evergreen sections: `content/_staged/evergreen_section_queue.json`
- Medium article published surface: `medium-articles/**/index.html`
- Medium article inventory: `content/_live/medium_articles.json`
- Insight source inventory: `content/_live/pages.json`
- Generated insight inventory: `content/_live/insights.json`
- Canonical published URL inventory: `content/_live/published_urls.json`
- Release counters: `content/_shared/release_state.json`
- Executable-bit contract: `content/_shared/executable_files.json`

## Publish-surface contract
- `medium-articles/**` is crawlable published surface.
- `/medium/` is archive-only. Do not publish article duplicates inside `/medium/*.html`.
- `/insights/*.html` is generated only from `content/_live/pages.json` inventory.
- Folder walking published outputs as source input is forbidden.
- `dist/` must not exist in this repo after build.

## Runtime contract
- This repo currently uses Node built-ins only and does not require `npm ci` for build/validation.
- Workflow validation parity is mandatory across `daily_release.yml` and `release_batch.yml`.

## Required local sequence
1. `node scripts/build_site.js`
2. `node scripts/validate_medium_articles.js --all`
3. `node scripts/validate_insights.js --all`
4. `node scripts/validate_site.js`
5. `node scripts/validate_sitemap_parity.js`
6. `node scripts/validate_archive_schema.js`
7. `node scripts/validate_publish_inventory.js`
8. `node scripts/validate_homepage_schema.js`
9. `node scripts/validate_executable_bits.js`

## IndexNow contract
- Build emits `content/_live/published_urls.json`.
- Daily workflow snapshots the previous published URL inventory into `.build/published_urls.previous.json` before build.
- Delta submit uses staged file changes mapped against the current published inventory.
- Deletion submit is derived from previous inventory minus current inventory.
- IndexNow remains warn-only; validation remains hard-fail.

## Exec-bit recovery
If snapshot sync strips executable bits, run:

```bash
./scripts/repair_executable_bits.sh
```

Then rerun:

```bash
node scripts/validate_executable_bits.js
```

## Verification checklist
- `/medium/` archive exists and no `/medium/*.html` article duplicates remain.
- `content/_live/medium_articles.json` matches `medium-articles/**/index.html`.
- `content/_live/insights.json` matches `/insights/*.html`.
- `content/_live/published_urls.json` matches `sitemaps/sitemap_all.xml` exactly.
- Archive pages include JSON-LD and publisher `The Industry Guides`.
- Homepage and vertical hubs include JSON-LD and brand signal.
- Daily Release workflow passes without rerun.
- Release Batch workflow runs the same validator surface as Daily Release and never references `dist/`.

## Rollback
1. Revert to the previous validated commit on `main`.
2. Restore executable bits if needed with `./scripts/repair_executable_bits.sh`.
3. Re-run `node scripts/build_site.js`.
4. Re-run all validators in the required local sequence.
