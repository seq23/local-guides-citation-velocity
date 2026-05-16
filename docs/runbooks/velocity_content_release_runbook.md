# Velocity Content Release + IndexNow Distribution Runbook

## Authority

`deploy-distribution.yml` is the single automatic IndexNow authority after pushes to `main`.

Daily release may build, validate, commit, and push content. It must not submit IndexNow before the commit/push because that can ping URLs before the deployed surface exists.

## Data trace

```text
push to main / manual workflow dispatch
→ .github/workflows/deploy-distribution.yml
→ npm ci
→ npm run distribution:prepare
→ scripts/build_site.js
→ writes .build/indexnow-priority.txt
→ writes .build/indexnow-batch.txt
→ writes .build/distribution-priority-urls.txt
→ npm run validate:indexnow-workflow
→ distribution_scripts/deploy_distribution.sh
→ distribution_scripts/indexnow_submit.sh for priority URLs
→ distribution_scripts/indexnow_submit.sh for batch URLs
→ writes reports/indexnow-priority-submit-report.json
→ writes reports/indexnow-batch-submit-report.json
→ writes reports/indexnow-submit-report.json
→ optional GSC sitemap submission if credentials are present
→ optional GSC URL inspection if credentials are present
→ uploads .build and reports artifacts
```

## Required GitHub secret

```text
INDEXNOW_KEY
```

Use the committed Velocity key unless intentionally rotating it:

```text
9a4e1c2d7f6b8a0c5d3e2f1a9b7c6d5e4f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c
```

## Optional GitHub secrets

```text
GSC_SERVICE_ACCOUNT_JSON
GSC_SITE_URL
```

GSC must never block IndexNow. Missing GSC credentials should skip sitemap/inspection while IndexNow still runs.

## Local dry run

```bash
npm run distribution:prepare
npm run validate:indexnow-workflow
INDEXNOW_DRY_RUN=1 npm run distribution:deploy -- --artifact-dir .build
```

## Reports

```text
reports/indexnow-submit-report.json
reports/indexnow-priority-submit-report.json
reports/indexnow-batch-submit-report.json
reports/validate_indexnow_workflow.json
```
