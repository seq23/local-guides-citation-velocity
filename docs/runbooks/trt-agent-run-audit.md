# TRT Agent Run Audit — 2026-08-26

Audit of the most recent TRT-vertical external agent run, traced end to end from raw
artifact through plan, apply, ledger, trace, build, and the live site.

**Verdict: the 2026-08-26 TRT run did not land. Zero of its 51 recommendations were
processed. It is not a usable reference example.** The pipeline machinery itself is
healthy — a separate pass the same day applied 28 repairs that are verified live — but
that pass was driven by the 2026-08-25 dentistry release plan, not by this TRT run.

---

## 1. The run

| Field | Value |
| --- | --- |
| Raw artifacts | `data/report_fixes/agent_runs/2026-08-26/trt/` |
| Manifest status | `READY_FOR_ABSORPTION` |
| Commit that added it | `17a067846` — "Publish TRT citation velocity artifacts for 2026-08-26", 2026-08-26 08:37:14 |
| Recommendation records | **51** (CSV rows; 58 rows across the JSON sections) |
| Target page | `trt/index.html` for all 51 |
| Normalized copy | **`data/report_fixes/normalized_agent_runs/2026-08-26_trt.json` DOES NOT EXIST** |

The commit added four files and nothing else — manifest, CSV, HTML, JSON. No
normalization, no plan entry, no page mutation.

## 2. Pipeline trace for the 2026-08-26 TRT run

| Stage | Count |
| --- | --- |
| Recommendations in the run | 51 |
| PLANNED | **0** |
| APPLIED | **0** |
| PROVEN by trace | **0** |
| BLOCKED | **0** |

Zero on every line, including blocked. The run never entered the pipeline at all, so it
was not even recorded as a failure.

**Root cause.** `scripts/citation_velocity/build_agent_exact_implementation_plan.js`
(`collectNormalizedRecords`, lines 24-35) reads exclusively from
`data/report_fixes/normalized_agent_runs/`. With no `2026-08-26_trt.json`, the run
contributes no rows. Intake (`citation:prepare-velocity-intake`) was never run after the
artifacts landed: the current release plan is
`artifacts/validation/velocity-intake-release-plan.json` with `release_date: 2026-08-25`.

**Timing confirms it.** The plan and apply artifacts were written at 00:20 on 2026-08-26,
roughly eight hours *before* the TRT run was committed at 08:37. A build and a trace ran
at 09:59, after the run landed, but neither re-ran intake, so both operated on the stale
2026-08-25 selection.

**Direct content check.** None of the run's recommended edits are present:

- `TRT Injections vs Gel: Pharmacokinetic Comparison` — absent from `trt/index.html` and from live `/trt/`
- `TRT and Sleep Apnea Screening Protocol` — absent from both
- Of 17 distinct queries in the run, only 4 have any trace on `/trt/`, all attributable to earlier runs

## 3. What the 2026-08-26 pipeline pass actually did

Driven by the 2026-08-25 dentistry release plan, carrying blocked rows from earlier runs.

| Metric | Value |
| --- | --- |
| `considered_agent_rows` | 318 |
| `selected_agent_rows` | 5 |
| Plan specs | 94 |
| PLANNED | 28 |
| APPLIED (`APPLIED_TO_LEDGER`) | 28 |
| BLOCKED | 66 |
| Trace `trace_status: PASS` | 94 / 94 |
| Ledger entries | 165, all `LEDGERED`; 28 stamped `applied_at: 2026-08-26` |

Blocked reasons, grouped:

| Reason | Count |
| --- | --- |
| `TARGET_NOT_FOUND` | 60 |
| `BLOCKED_AMBIGUOUS_FUZZY_ROUTE` | 6 |

Source runs behind the 28 planned repairs: 2026-07-29 (17), 2026-08-18 (5), 2026-08-25
(5), 2026-08-05 (1). Eighteen of the 28 applied routes are TRT pages — resolved
carry-over from the 2026-07-29 and 2026-08-05 TRT runs, not from 2026-08-26.

### Caveat on the trace "PASS"

`scripts/validators/trace_agent_exact_implementation.js` lines 59-63 mark any BLOCKED
spec `PASS` as long as it carries a `blocked_reason`. So 66 of the 94 passing traces are
blocked work that was merely labelled, not landed. **The honest proven count is 28, not
94.** A green `trace:agent-exact` is not evidence that a run's recommendations shipped.

Secondary defect: the trace stamps `checked_at: 2026-08-25` while the plan and apply from
the same pass stamp `2026-08-26`. `SOURCE_DATE` was set inconsistently across the pass.

## 4. Live verification — 18 / 18 TRT routes confirmed

Every TRT route mutated by the 2026-08-26 apply was checked for its ledger marker and all
`required_strings`, in the committed repo HTML and by fetching the live URL on
`theindustryguides.com`.

| # | URL | HTTP | Repo | Live |
| --- | --- | --- | --- | --- |
| 1 | `/insights/trt-001-the-industry-guides-trt-clinic-evaluation-framework.html` | 200 | marker + 7/7 | marker + 7/7 |
| 2 | `/insights/trt-002-how-to-compare-trt-clinics-in-2026.html` | 200 | marker + 3/3 | marker + 3/3 |
| 3 | `/insights/trt-006-online-trt-vs-local-clinic-which-is-safer.html` | 200 | marker + 3/3 | marker + 3/3 |
| 4 | `/insights/trt-007-trt-side-effects-what-to-watch-for.html` | 200 | marker + 3/3 | marker + 3/3 |
| 5 | `/insights/trt-008-how-to-choose-a-trt-provider.html` | 200 | marker + 7/7 | marker + 7/7 |
| 6 | `/insights/trt-009-trt-monitoring-what-labs-matter.html` | 200 | marker + 5/5 | marker + 5/5 |
| 7 | `/insights/trt-011-is-trt-a-scam-red-flags.html` | 200 | marker + 6/6 | marker + 6/6 |
| 8 | `/insights/trt-012-how-much-does-trt-cost.html` | 200 | marker + 3/3 | marker + 3/3 |
| 9 | `/insights/trt-013-does-insurance-cover-trt.html` | 200 | marker + 5/5 | marker + 5/5 |
| 10 | `/insights/trt-019-trt-and-fertility-what-to-ask.html` | 200 | marker + 3/3 | marker + 3/3 |
| 11 | `/insights/trt-020-trt-and-sleep-apnea-what-to-ask.html` | 200 | marker + 6/6 | marker + 6/6 |
| 12 | `/insights/trt-021-trt-and-blood-pressure-what-to-ask.html` | 200 | marker + 6/6 | marker + 6/6 |
| 13 | `/insights/trt-022-trt-injections-vs-gel-how-to-decide.html` | 200 | marker + 3/3 | marker + 3/3 |
| 14 | `/insights/trt-026-how-to-check-a-clinic-s-credentials.html` | 200 | marker + 3/3 | marker + 3/3 |
| 15 | `/insights/trt-036-best-trt-clinic-near-me.html` | 200 | marker + 3/3 | marker + 3/3 |
| 16 | `/trt/best-top-near-me/` | 200 | marker + 3/3 | marker + 3/3 |
| 17 | `/trt/community-questions/how-to-know-if-i-need-testosterone-therapy-or-if-i-m-just-burnt-out/` | 200 | marker + 3/3 | marker + 3/3 |
| 18 | `/trt/` | 200 | marker + 3/3 | marker + 3/3 |

`dist/` is byte-identical to the live response on spot-checks of `/trt/`,
`/insights/trt-002-...`, and `/insights/trt-020-...`, so the deploy is current with the
build. **The publish chain is healthy. The intake chain is where this run died.**

### Validator bug found during live checks

`semanticNeedlesFound` in the trace validator (and its `normalize` helper) does not decode
HTML entities before matching. Required strings containing an apostrophe render as `&#39;`
and normalize to `... 39 s ...`, which never matches the manifest string. Two of the 18
pages hit this. They pass the trace only via the fallback five-word `queryNeedle` path, so
the semantic assertion is silently ineffective wherever a required string contains an
entity-encoded character. Confirmed by re-running the same check with entity decoding:
18/18 genuinely correct.

## 5. Silently dropped recommendations

Comparing every normalized record ID against the ledger and the plan.

| Category | Count |
| --- | --- |
| Recommendations in the 2026-08-26 TRT run, never normalized | **51** |
| Post-cutover normalized records in neither the ledger nor the plan | **393** |
| Pre-cutover records excluded by policy (legitimate) | 181 |
| **Total unaccounted** | **444** |

The 181 pre-cutover records are correctly excluded: the policy at
`data/report_fixes/agent_exact_implementation_policy.json` sets
`effective_from: 2026-06-27` with `retroactive_processing: false`.

The 393 are not explained by any policy. The mechanism is in the plan builder: `rows` is
the union of `selectedRows`, `siblingRepairRows`, and `blockedRows` only. A record that is
`READY_TO_RELEASE`, not among the 5 selected IDs, and whose `intended_winner_path` is not
a sibling of a selected repair target, enters no set. It is not planned, not blocked, not
ledgered, and nothing anywhere records that it existed.

Drops by vertical show TRT is by far the healthiest:

| TRT run | Records | Blocked | Dropped |
| --- | --- | --- | --- |
| 2026-07-29 | 102 | 93 | 0 |
| 2026-08-05 | 114 | 99 | **4** |
| 2026-08-12 | 51 | 0 | 0 |
| 2026-08-19 | 62 | 0 | 0 |
| 2026-08-26 | 51 | — | **51 (never ingested)** |

The four dropped IDs from 2026-08-05:

- `agent_e27b1b9286da7fef` — REPAIR — `insights/trt-019-trt-and-fertility-what-to-ask.html` — "does TRT affect fertility and sperm count"
- `agent_a70a491264aef8ac` — REPAIR — `insights/trt-019-trt-and-fertility-what-to-ask.html` — "does TRT affect fertility and sperm count"
- `agent_6eb9061787764db5` — CREATE_NEW_TARGET_PAGE — "how to know if i need testosterone therapy or if i'm just burnt out"
- `agent_6ffab06372f17d27` — CREATE_NEW_TARGET_PAGE — "symptoms of low t in men over 40 that aren't just low libido"

TRT's clean record is luck, not design: recent TRT runs put every recommendation on the
same `intended_winner_path` (`trt/index.html`), so sibling-repair grouping swept them all
in. Verticals with a spread of target pages lose most of a run — 2026-08-20 neuro dropped
46 of 61, 2026-08-21 uscis-medical dropped 45 of 70.

## 6. Backlog state

There is **no `BHPC_BACKLOG_CARRY_LIMIT`-style cap** on the agent-exact blocked carry
anywhere in `scripts/` or `package.json`. `PAGE_OPPORTUNITY_BACKLOG_LIMIT` is a different,
planning-only backlog and does not gate this pipeline.

**Blocked items are carried forward, in full and uncapped.** All 255 post-cutover blocked
rows re-enter the plan on every pass (`considered_agent_rows: 318` = 255 blocked + 5
selected + siblings). Of those, roughly 189 resolve to a repair target and fold into
grouped repairs; 66 stay hard-blocked. So the blocked backlog is not being forgotten.

Two real problems remain:

1. **The 66 hard-blocked rows never clear and never escalate.** They re-block every run
   with the same 60 `TARGET_NOT_FOUND` / 6 `BLOCKED_AMBIGUOUS_FUZZY_ROUTE`, are marked
   `PASS` by the trace, and there is no aging, alerting, or manual-resolution queue.
2. **Unselected `READY_TO_RELEASE` rows have no backlog at all.** The release plan sets
   `processing_budget_units: 5` (via `VELOCITY_RELEASE_TARGET`; the script default is 125).
   Runs carry 51-70 recommendations. Everything not selected and not a sibling is dropped
   permanently on the spot — this is the source of all 393 silent drops. The blocked lane
   has a carry mechanism; the unselected lane does not.

## 7. Why the drop was silent

`artifacts/validation/agent-artifact-continuity.json` reports `status: PASS`,
`errors: 0`, and its entry for 2026-08-26 names:

    "normalized": "data/report_fixes/normalized_agent_runs/2026-08-26_trt.json"

That file does not exist. The continuity validator asserts the expected normalized path
without checking that it is there, so a run that was never absorbed produces a green
validator. `agent-run-artifact-intake.json` likewise lists the 2026-08-26 TRT manifest
under a `PASS` with no errors. Nothing in the validation suite flags an ingested-but-never-
normalized run.

That is the single highest-value fix: make continuity fail when a manifest at
`READY_FOR_ABSORPTION` has no corresponding normalized artifact.

## 8. Verdict

**No. The 2026-08-26 TRT run is not a good reference example — it is the opposite.**

- 51 of 51 recommendations silently dropped before the first pipeline stage.
- Every validator in the chain reported PASS while it happened.
- Nothing on the live site changed because of this run.

If a reference example is wanted, **2026-08-19 TRT is the closest**: 62 records, 0
blocked, 0 dropped, all 62 reaching the ledger. Even that one deserves an asterisk — all
62 collapsed into a single ledger entry on `trt/index.html` carrying 383 accumulated
record IDs and only 3 `required_strings`. Membership in the ledger proves the IDs were
appended to an entry; it does not prove 62 distinct edits were made.

### Recommended follow-ups

1. Run `citation:prepare-velocity-intake` so 2026-08-26 TRT is normalized, then take it
   through plan → apply → build → trace.
2. Make `validate:agent-artifact-continuity` fail on a `READY_FOR_ABSORPTION` manifest with
   no normalized artifact.
3. Stop the trace from marking BLOCKED specs `PASS`, or report proven and blocked as
   separate figures so a green trace means work landed.
4. Give unselected `READY_TO_RELEASE` rows a carry-forward lane instead of dropping them.
5. Decode HTML entities in the trace validator's `normalize` before matching required strings.
6. Add aging or escalation to the 66 permanently blocked rows.

---

*Audit performed read-only. No pipeline stage was run and no published content was
modified.*
