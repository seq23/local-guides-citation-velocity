# Agent Artifact Data-Flow Trace Contract

Status: ACTIVE RUNBOOK  
Repo: local-guides-citation-velocity  
Updated: 2026-07-06

## Purpose

The agent artifact data-flow trace is the final receipt that proves agent artifacts did not silently disappear between intake and output.

It exists because the repo supports multiple source artifact types:

- CSV agent rows;
- HTML reports;
- JSON report data;
- agent run manifests;
- durable parsed source ledgers.

CSV is not the only source of truth after normalization.

## Authority boundary

Raw agent artifacts are never release authority by themselves. They are evidence that must be normalized into durable repo-owned records before downstream build, release, and validation code may rely on them.

The durable authority order is:

```text
data/report_fixes/agent_runs/**
→ data/report_fixes/normalized_agent_runs/**
→ data/report_fixes/source_record_ledgers/**
→ data/report_fixes/agent_artifact_disposition_ledger.json
→ artifacts/validation/agent-exact-implementation-plan.json
→ data/report_fixes/agent_exact_semantic_acceptance_manifest.json
→ data/report_fixes/agent_exact_implementation_ledger.json
→ rendered HTML / content manifests
```

Validators may inspect raw artifacts for traceability, but they must judge release completeness from normalized source records, disposition records, implementation plans, semantic manifests, rendered output, and ledgers.

## Canonical command

```bash
npm run trace:agent-artifact-data-flow
```

Underlying script:

```text
scripts/validators/trace_agent_artifact_data_flow.js
```

## Required inputs

Preferred durable input:

```text
data/report_fixes/source_record_ledgers/*.json
```

Fallback inputs may include:

```text
data/report_fixes/agent_runs/**/agent_run_manifest.json
data/report_fixes/normalized_agent_runs/**
data/report_fixes/agent_exact_implementation_plan.json
data/report_fixes/agent_exact_implementation_ledger.json
artifacts/validation/velocity-agent-source-coverage.json
artifacts/validation/velocity-agent-duplicate-resolution.json
artifacts/validation/velocity-agent-recommendation-driven-output.json
```

## Required trace logic

The trace must report, at minimum:

- source records found;
- source ledger files used;
- normalized artifact sources used;
- implementation plan rows;
- applied ledger rows;
- source coverage validation status;
- duplicate resolution validation status;
- recommendation-driven output validation status;
- any warnings where one artifact format has fewer rows than the unified normalized source model.


## Social fallback trace rule

Social fallback is part of the governed strategy gap-fill lane. If a fallback unit is selected in `artifacts/validation/velocity-intake-release-plan.json`, it must either be created by `artifacts/validation/velocity-content-release.json` and exist in both staged/live page manifests, or the workflow must fail.

A selected social fallback page is a hard live-route obligation. Do not downgrade missing social fallback routes to warnings. Repair the fallback page materialization, route authority, source records, or release trace.

## Hard-fail conditions

The trace must fail when:

- source records cannot be loaded from either durable ledgers or fallback artifacts;
- required validation artifacts are missing after the workflow claims to have run them;
- source coverage reports silent drops;
- duplicate resolution reports unsafe public-route collisions;
- recommendation-driven output cannot link outputs back to agent recommendations;
- a source record is neither implemented, merged, canonicalized, blocked, external, nor preserved;
- the trace script throws a runtime exception.

## Warning conditions

The trace may warn, but should not fail, when:

- CSV row count differs from unified normalized source-record count;
- some source records came from HTML or JSON rather than CSV;
- duplicate source rows map to the same public canonical route intentionally.
- recommendation-driven output uses active-batch scope while cumulative ledgers remain larger than the active plan.

Those conditions are expected in the current multi-artifact intake model.

## Batch scope rule

Velocity content release can run in small batches after a full baseline snapshot has already absorbed historical artifacts. In that case:

- the cumulative ledgers remain historical authority;
- the active `agent-exact-implementation-plan.json` defines the batch validation scope;
- recommendation-driven output validation must consider entries in the active plan and report skipped cumulative entries;
- a small batch must not fail merely because older cumulative ledger rows are outside the active plan.

This prevents a five-unit workflow reentry from comparing batch-scoped semantic evidence against all historical source recommendations.

## Output expectation

A passing trace should produce a machine-readable report under `artifacts/validation/` and should be uploaded by the workflow diagnostics artifact if the run fails later.

## Repair rule

If this trace fails, repair the source-to-output trace layer or the upstream data-flow layer. Do not bypass the trace. This trace is the last guard against silent source drops.
