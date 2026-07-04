# Structural Graph Live Policy

Status: ACTIVE RUNBOOK
Repo: local-guides-citation-velocity

## Policy

All staged structural pages remain live when needed to preserve atlas, cluster, route, sitemap, and internal-link graph integrity.

Daily cadence controls priority, proof, and promotion. It must not artificially hide graph-critical pages merely to simulate a drip-release.

## Required checks

The structural graph validator must verify:

1. staged and live structural route counts are visible to the repo;
2. atlas and cluster support pages are not removed by a daily release;
3. sitemap and llms exports are not degraded by cadence control;
4. content release units may choose repairs, atoms, links, or blocks instead of new pages;
5. any lower daily new-page count is recorded as a planning decision, not a hidden-route policy.

## Runtime mutation boundary

Scheduled workflows may mutate generated state only. They may not mutate governance files, package files, scripts, docs, validation matrices, workflow contracts, or strategy contracts.

Allowed generated state must be explicit in `_content_release_contract.json`.
