# 100K / 180-Day Citation Velocity Runbook

## Scope

This repo targets 100,000 citation-ready opportunities or owned surfaces in 180 days or less. This is not a claim that the site has earned 100,000 external citations, rankings, indexed URLs, AI Overview placements, LLM mentions, or visits.

## What Runs

- `npm run citation:100k-runway` builds the deterministic query/fanout opportunity universe and proof ledgers.
- `npm run release:daily-citation-intelligence:preview` refreshes the strategy gate, signal trace, workflow inventory, and citation-intelligence validators.
- `npm run validate:phase-tree-hygiene` verifies generated artifacts are not dumped into the repo root.

## Where Files Belong

| Surface | Folder |
|---|---|
| Strategy contract | `data/strategy/` |
| 100K fanout opportunity universe | `data/queries/` |
| Scoreboards and `$0` ledgers | `data/measurement/` |
| Validation receipts | `artifacts/validation/` |
| Human-readable reports | `reports/` |
| Executable citation intelligence | `scripts/citation_intelligence/` |
| Validators | `scripts/validators/` |

## Proof Boundary

The scoreboard separates:

- target opportunities;
- generated fanout records;
- owned surfaces;
- submitted URLs;
- indexed URLs;
- observed wins;
- external citations.

Owned pages and fanout opportunities are not external citations. IndexNow receipt is not indexing. Historical monitor wins are preserved as evidence records, but this artifact does not create new live external citation proof.

## Safe Self-Healing

The free-win/self-heal queue may safely recommend:

- direct-answer improvements;
- internal-link improvements;
- refresh candidates;
- source/claim boundary repairs;
- sitemap, canonical, or LLM-surface checks.

It must not invent provider rosters, rankings, live telemetry, legal/medical advice, credentials, availability, fees, or competitor displacement.

## Tree Hygiene

Generated phase data must not be added to repo root. The tree-hygiene validator fails if phase fanout, scoreboard, runway, or self-heal files appear at root, if root HTML expands beyond the core public pages, or if `node_modules` is present in the source snapshot.
