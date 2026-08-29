# Search Intelligence Operator Guide

## Purpose

This repo now has a Search Intelligence lane that is separate from Agent Runs. It observes admitted query owners, optional provider evidence, and read-only Agent signals; diagnoses SEO/AEO/GEO/content quality; builds bounded repair candidates; supports safe source mutations; schedules delayed retests; records verified external citation evidence; and feeds only verified outcomes back into priority.

## Normal commands

- `npm run search:intelligence:closed-loop` — regenerate the 240-query truth layer, diagnoses, candidates, retests, feedback, and scorecard without source mutation.
- `npm run search:intelligence:self-heal` — run the same loop and apply only `READY_AUTO_REPAIR` candidates that contain an explicit safe patch. Current healthy baseline has zero repair candidates.
- `npm run validate:search-intelligence` — run the registered Search Intelligence contract, Agent separation, truth, safety, and workflow validators.
- `npm run test:validator-materiality` — run the 15-case anti-petty-blocker hostile test pack.
- `npm run test:search-intelligence` — run the 9-case self-healing/truth/separation hostile test pack.
- `npm run deep:phase-0-16` — run the deep Phase 0-16 container validation chain.

## Truth states

Provider absence is recorded as `NOT_CONFIGURED` or `INCONCLUSIVE`. It is never converted to PASS. A delayed retest may be only `IMPROVED`, `UNCHANGED`, `REGRESSED`, or `INCONCLUSIVE`. `IMPROVED` requires real before/after external evidence.

Verified external citations live in `data/search_intelligence/verified_external_citations.json`. A citation counts only when provider, observation timestamp, query/prompt, surfaced URL, cited URL, and evidence reference are present.

## Agent separation

Search Intelligence may read Agent outputs from the normalized Agent lane. It may not write under:

- `data/report_fixes/agent_runs/**`
- `data/report_fixes/normalized_agent_runs/**`
- `data/report_fixes/source_record_ledgers/**`
- `data/report_fixes/agent_exact_semantic_manifests/**`

`data/search_intelligence/protected_agent_tree_manifest.json` freezes the current protected Agent bytes for validation.

## Repair boundary

Search Intelligence has no independent page-admission authority and no publishing-cadence authority. Existing admitted pages are repaired before a new URL is considered. Auto-repair is limited to explicit low-risk patches against allowed canonical source roots. Regulated factual additions, new statistics, immigration interpretation, guarantees, speculative claims, and unsupported legal/medical claims are review-only.

Every applied repair must record a before hash, after hash, actual byte change, rollback snapshot, cooldown, and delayed retest date. Default cooldown is 14 days. No broad reset is allowed.

## Workflows

- `search-intelligence-loop.yml` — scheduled + manual observation/diagnosis/retest lane; does not commit source changes.
- `postdeploy-public-audit.yml` — removed 2026-08-29 by owner decision; the deployed click audit no longer runs.
- `ci-health-recovery.yml` — observes Validate Repo exact-SHA conclusion and opens/updates/closes the governed automation-health issue.

The repo has eight workflows total. Search Intelligence does not add a third push-triggered repo-mutation lane.
