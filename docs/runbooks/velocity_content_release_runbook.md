
# Velocity Content Release Runbook

## Purpose
Operate daily release for atlas pages, evergreen sections, medium articles, and insights in the velocity repo.

## Release order
1. Page batches until all staged pages are live.
2. Evergreen section batches continue daily.
3. Medium article batches release daily using `MEDIUM_BATCH`.
4. Insight batches release daily using `INSIGHT_BATCH`.

## Source of truth
- Atlas pages: `content/_staged/pages.json`
- Evergreen sections: `content/_staged/evergreen_section_queue.json`
- Medium articles: `medium-articles/**/index.html`
- Insights: `insights/**/index.html`
- Release counters: `content/_shared/release_state.json`

## Validation
- `node scripts/validate_medium_articles.js --all`
- `node scripts/validate_insights.js --all`
- `node scripts/validate_site.js`

## Verification checklist
- Homepage shows latest released medium articles.
- `/medium/` archive lists released medium articles.
- Vertical atlas pages show related reads for the same vertical.
- `sitemap.xml` and `sitemaps/sitemap_all.xml` include released article URLs.
- `feed.xml` and `feed.json` include released article URLs.
- Daily Release workflow passes without rerun.

## Rollback
- Revert to the previous commit on `main`.
- Re-run `node scripts/build_site.js`.
- Re-run all validators.
