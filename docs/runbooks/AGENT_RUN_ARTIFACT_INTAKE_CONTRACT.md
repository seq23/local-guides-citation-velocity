# Agent Run Artifact Intake Contract

## Purpose

Twin Agent citation measurement artifacts are first-class repo inputs. The repo absorbs them without chat, creates or upgrades Velocity content, self-heals, validates, commits, and pushes through the consolidated Velocity Content Release workflow.

## Canonical Intake Path

Twin Agent may write only to:

```text
data/report_fixes/agent_runs/**
```

Twin Agent must not directly edit:

```text
content/_live/**
content/_staged/**
generated_never_hand_edit/**
data/citation_velocity/**
data/page_families/**
```

Those layers are mutated by repo automation only.

## Required Folder Shape

```text
data/report_fixes/agent_runs/YYYY-MM-DD/<vertical>/
  <vertical>.csv
  <vertical>.html
  agent_run_manifest.json
```

Example:

```text
data/report_fixes/agent_runs/2026-06-23/dentistry/
  dentistry.csv
  dentistry.html
  agent_run_manifest.json
```

## Manifest Shape

```json
{
  "source": "twin_agent",
  "run_date": "2026-06-23",
  "vertical": "dentistry",
  "csv_path": "data/report_fixes/agent_runs/2026-06-23/dentistry/dentistry.csv",
  "html_path": "data/report_fixes/agent_runs/2026-06-23/dentistry/dentistry.html",
  "status": "READY_FOR_ABSORPTION"
}
```

Valid statuses:

- `READY_FOR_ABSORPTION`
- `IMPORTED`
- `ABSORBED`
- `QUARANTINED`

## Required CSV Columns

The importer accepts the current Twin Agent CSV shape and requires at least:

- query field: `Query`, `query`, `Target Query`, or `Question`
- fix signal field: `Patch Needed (Y/N)`, `Gap Found`, `Action Tier`, or `Fix Recommendation`

Preferred columns:

- `Query`
- `Intended Winner Page`
- `Surface`
- `Model`
- `Date`
- `Cited Sources`
- `Answer Shape`
- `Gap Found`
- `Patch Needed (Y/N)`
- `Fix Recommendation`
- `Progress Level (1-4)`
- `Gap Type`
- `Primary Fix Type`
- `Action Tier`

## Absorption Rule

The consolidated Velocity Content Release workflow runs when Twin pushes `agent_run_manifest.json` under `data/report_fixes/agent_runs/**/agent_run_manifest.json` or on the scheduled weekday fallback after noon Central. CSV and HTML files should be committed atomically with the manifest, but the manifest path is the ready signal that triggers absorption.

Order:

```text
validate agent artifacts
→ collect/process social signals
→ prepare Velocity intake release
→ release Velocity content
→ apply/trace/validate citation agent fixes
→ self-heal/rebuild/validate
→ commit
→ rebase
→ self-heal/revalidate
→ push
```

## Fallback Rule

Agent artifacts are priority input. If no Twin artifacts arrive, or if the agent run produces fewer than the target number of release units, the repo fills the batch from the existing social/public backlog.

Default target: `125` publish units.
Maximum without explicit override: `150` publish units.

## Evidence

The workflow writes:

```text
artifacts/validation/agent-run-artifact-intake.json
artifacts/validation/velocity-intake-release-plan.json
artifacts/validation/velocity-intake-release-plan.md
artifacts/validation/citation-agent-fix-trace.json
artifacts/validation/citation-agent-fixes.json
data/report_fixes/normalized_agent_runs/**
data/report_fixes/agent_fix_ledger.json
```
