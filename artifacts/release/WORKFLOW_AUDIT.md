# Workflow Audit

Evidence date: 2026-06-19  
Result: **PASS**

## Enforced lifecycle

- checkout and setup-node use v4
- all Node workflows declare Node 24
- locked install uses `npm ci --ignore-scripts`
- Validate invokes the central `release:ci-validate` command
- distribution downloads the exact validated artifact and does not rebuild
- release mutation is scheduled/manual, not push-triggered
- rebased release commits are rebuilt and revalidated before push
- public signal processing produces evidence/candidates only
- LKG PR push consumes an existing candidate artifact

## Workflow fingerprints

- daily_release.yml: `5a5f7eb69a5b5f19a0d175b11864f17db45aaf87681491661ca5e19053f89bb5`
- deploy-distribution.yml: `a237a743c41650b9edbf6876b98dd8bc984deb9abd9b25fc1b58e7e025b7f5d5`
- insights_gate.yml: `10da9e4ef32335159de342e5da4f2ac791ee432ab2d9925ba37416332ea911d5`
- lkg_pr_push.yml: `bc308784855f847e00bc04a08aae31ab30df648ad3124522213be3ba261f5941`
- medium_articles_gate.yml: `f877a8ece6749ee4d11c70bf5335b489507a3852f2362bad44406ccfbfa92907`
- public-signal-processing.yml: `dd94e999fc28fe63ab97440b3c55344480bfbe5792edc238f2794c24885e45eb`
- release_batch.yml: `5f61b694251334dd3ae79308e16a177acb96cdcb16b1164bafc8e089efba328f`
- validate.yml: `acb24eb09b84dc42c8b87d6356bd6e59f7734cd23c8d8cc6699b49f76bc0df61`
