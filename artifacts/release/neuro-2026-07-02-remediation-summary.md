# Neuro 2026-07-02 Remediation Summary

Status: PASS

Semantic targets repaired: 18
Agent exact plan repairs: 65
Agent exact plan blocked: 0
Semantic acceptance: PASS

## Root Fixes

- Added canonical route resolution for same numbered insight ID typos, including `neuro-007-...testi.html` → `neuro-007-...testing.html`.
- Added semantic manifest-driven page repair artifacts so the rendered HTML must contain the requested tables, scripts, callouts, checklists, and comparison blocks.
- Added `agent-exact-acceptance-manifest` as a HARD_FAIL validator in the registry.
- Updated agent exact trace to accept semantic completion from the manifest instead of raw-query-only matching.
- Removed marker-only `Agent Exact Repair Framework` acceptance for the 18 neuro targets.

## Targets
- PASS `insights/neuro-001-decision-tree-adhd-vs-autism-vs-broader-neuro-evaluation.html` (callout, comparison_table, protocol)
- PASS `insights/neuro-002-what-to-do-when-adhd-and-autism-symptoms-overlap.html` (callout, comparison_table)
- PASS `insights/neuro-003-session-by-session-walkthrough-what-to-expect.html` (protocol, timeline_table)
- PASS `insights/neuro-004-how-to-choose-the-right-neuropsych-evaluation-path.html` (comparison_table, protocol)
- PASS `insights/neuro-005-how-to-compare-local-options-using-a-real-decision-checklist.html` (callout, comparison_table, source_block)
- PASS `insights/neuro-006-how-to-compare-adhd-testing-options-before-booking.html` (callout, comparison_table, cost_table)
- PASS `insights/neuro-007-what-to-verify-before-booking-child-neuropsych-testing.html` (callout, comparison_table) — canonicalized from `insights/neuro-007-what-to-verify-before-booking-child-neuropsych-testi.html`
- PASS `insights/neuro-008-what-to-verify-before-booking-concussion-testing.html` (comparison_table, protocol)
- PASS `insights/neuro-009-how-much-does-a-neuropsych-eval-cost.html` (callout, cost_table)
- PASS `insights/neuro-012-neuro-eval-red-flags.html` (severity_matrix, source_block)
- PASS `insights/neuro-013-how-to-compare-providers-fast.html` (callout, comparison_table)
- PASS `insights/neuro-021-how-to-use-results-for-accommodations.html` (checklist, comparison_table, protocol)
- PASS `insights/neuro-023-neuropsych-evaluation-for-adults-vs-kids.html` (comparison_table, protocol, source_block)
- PASS `insights/neuro-025-neuropsych-telehealth-what-parts-can-be-remote.html` (callout, checklist, comparison_table)
- PASS `insights/neuro-026-how-to-choose-if-you-have-a-deadline.html` (comparison_table, script, timeline_table)
- PASS `insights/neuro-027-how-to-ask-for-a-price-estimate.html` (cost_table, script, source_block)
- PASS `insights/neuro-032-child-specialist-anxiety-vs-adhd-eval-near-me.html` (checklist, comparison_table)
- PASS `neuro/community-questions/we-actually-only-uncovered-the-asd-in-a-recent-neuropsych-evaluation-because-he-is-highly-/index.html` (callout, comparison_table, protocol)
