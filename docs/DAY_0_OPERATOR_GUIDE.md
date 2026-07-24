# DAY-0 OPERATOR GUIDE — VELOCITY / LISTINGS

## What this repo is

This is the Listings business static publishing and Citation Velocity engine for `theindustryguides.com`. It generates educational decision-support pages and routes provider-seeking intent to the appropriate canonical Listings destination. It does not rank providers or sell editorial placement.

## What not to touch

- Do not hand-edit generated admitted HTML as the primary fix.
- Do not edit raw Twin Agent artifacts under `data/report_fixes/agent_runs/**`.
- Do not delete or casually regenerate `data/release/frozen_html_cache/**` or `frozen_page_registry.json`.
- Do not turn 100K fanout opportunities into a page-count quota.
- Do not copy unrelated product systems into this repo.

## Normal commands

```bash
npm run validate
npm run intelligence:build
npm run agent:intake
npm run release:apply
npm run freeze:status
npm run validate:release
```

`release:apply` is the canonical governed content-release command. Safe work proceeds autonomously; duplicate/unsupported/prohibited/ambiguous work is skipped or quarantined rather than waiting in a routine owner approval queue.

## New pages

New pages must pass the machine Safe Harbor strategy contract. A daily processing budget is a maximum processing allowance, not a requirement to publish pages.

## Existing-page repairs

Agent-exact repairs identify one intended route, queue that route for transactional thaw, rebuild/validate it, and refreeze it. Non-target accepted pages are restored from frozen cache.

## 100K intelligence

The 100K opportunity universe lives in indexed shards under `data/queries/citation_fanout_opportunities_100k/`. The old giant JSON file is forbidden. The dataset is planning intelligence, not 100K public pages or 100K proven citations.

## When validation fails

Read the failing validator and fix the durable source/control-plane cause. Do not weaken a material safety/integrity gate merely to turn the result green. Do not rerun unrelated repair waves. Fix the exact failure, regenerate the full baseline snapshot, and validate locally again.

## Snapshot handoff

Final ZIPs use:

`local-guides-citation-velocity-main_BASELINE_MM-DD-YY_<sha>.zip`

The snapshot must reopen successfully and verify its own release-critical hashes, 100K shards, frozen cache, root, and updater-required files before delivery.
