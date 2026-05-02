# GitHub Actions Workflow Trace — 2026-05-02

Repo: `local-guides-citation-velocity`
Source ZIP: `local-guides-citation-velocity-main_BASELINE_05-02-26_9be9348.zip`

## Outcome
This pass traced every workflow YAML against the latest attached baseline and fixed concrete Actions failure risks found in the repo.

## Fixes applied
- Upgraded `validate.yml` from checkout/setup-node v4 + Node 20 to v6 + Node 24.
- Added explicit `npm ci` to workflows that were relying on implicit no-dependency behavior.
- Replaced `npm run guardrails:all` with `npm run validate:all` in `release_batch.yml`.
- Added secret-aware skip behavior to `deploy-distribution.yml` when GSC secrets are absent.
- Fixed `scripts/compile_reddit_queries.js` so `notes` text no longer becomes `canonical_target_url`.
- Added explicit canonical target URL for USCIS report-retrofit red-flags staged queries.
- Rebuilt deterministic canonical shared files so canonical-data immutability passes after build.

## Workflow trace summary
### daily_release.yml
Expected to pass.
- checkout v6
- setup-node v6 / Node 24
- npm ci
- compile query clusters
- daily release
- build
- validate all

### deploy-distribution.yml
Expected to skip cleanly when secrets are absent, or pass when secrets are present.

### insights_gate.yml
Expected to pass.

### lkg_pr_push.yml
Structurally safe; existing secret guards retained.

### medium_articles_gate.yml
Expected to pass.

### public-signal-processing.yml
Expected to pass under current repo logic; degraded public Reddit intake remains warning-tolerant by policy.

### release_batch.yml
Expected to pass with simplified validation path.

### validate.yml
Expected to pass after Node/action upgrade and explicit npm ci.

## Local command equivalents checked
- `npm run audit:all`
- `node scripts/compile_reddit_queries.js`
- `node scripts/release_batch.js 5`
- `node scripts/daily_release.js`
- `npm run build`
- `npm run validate:all`
- `node scripts/validate_insights.js --all`
- `node scripts/validate_medium_articles.js --all`

## Residual external failure classes
Outside repo control:
- GitHub runner outage
- missing required cross-repo secrets
- upstream network/API instability
- GitHub permissions misconfiguration
