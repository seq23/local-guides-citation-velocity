# Velocity Content Workflow Operator Guide

Status: ACTIVE RUNBOOK  
Repo: local-guides-citation-velocity  
Updated: 2026-07-04

## Purpose

This guide lets a new operator understand the governed Velocity content workflow without reading chat history.

The repository is a generated static publishing and citation-velocity system. It ingests public demand signals and approved agent-run artifacts, converts them into source-backed release units, validates source lineage, rebuilds the static site, and commits only after the governed checks pass.

## What the workflow does

The `Velocity Content Release` GitHub workflow is a controlled release/admission gate.

It does not mean "create exactly N new pages." The manual `batch_size` input means:

```text
select up to N staged/eligible release units
→ run the governed Velocity intake lane
→ apply source-backed agent repairs or eligible staged pages
→ rebuild and validate the generated site
→ commit and push only if all gates pass
```

Release units can be:

- agent-backed repairs to existing pages;
- eligible new staged pages;
- social/public-signal fallback units;
- supporting source-backed content updates.

## Manual workflow input

Workflow file:

```text
.github/workflows/velocity-content-release.yml
```

Manual input:

```text
batch_size
```

Runtime environment variable:

```text
VELOCITY_RELEASE_TARGET
```

Default value:

```text
5
```

Hard cap unless explicitly overridden:

```text
150
```

Use values this way:

| Input | Meaning |
|---:|---|
| `1` | conservative proof run after a repair |
| `5` | small controlled release |
| `10` | medium controlled release |
| `150` | release every eligible staged unit up to the repo cap |


## Social fallback release rule

The governed workflow has two different pools:

```text
agent-backed units = source-backed repairs/new-page decisions from approved agent artifacts
social fallback units = public/social backlog candidates used only when explicitly enabled
```

A normal manual workflow run does **not** release social fallback candidates unless the environment variable below is explicitly enabled by the workflow/runtime owner:

```text
ALLOW_SOCIAL_FALLBACK_RELEASE=1
```

Therefore, a `batch_size=150` run means:

```text
release all currently eligible agent-backed units up to the cap
suppress social fallback candidates unless explicit social fallback release is enabled
record the suppressed fallback count in the release plan
```

This prevents broad public-signal backlog pages from being admitted accidentally just because a large batch size was selected.

## Canonical local command

```bash
npm run release:velocity-intake
```

This command is the full local equivalent of the core workflow lane.

## Runtime sequence

`release:velocity-intake` runs the following governed path:

```text
validate agent artifact intake
→ collect public/social signals
→ normalize, map, cluster, score, and index signals
→ prepare the Velocity intake release plan
→ apply the HTML report contract
→ validate HTML report contract
→ validate agent source coverage
→ validate duplicate/canonical route resolution
→ validate dynamic page-family contract
→ validate route-resolution self-test
→ build exact agent implementation plan
→ compile HTML fix acceptance manifest
→ release eligible Velocity content
→ apply exact agent implementation plan
→ finalize content with self-heal/build/render validation
→ validate recommendation-driven output
→ trace exact agent implementation
→ validate exact agent implementation
→ trace cumulative citation-agent fixes
→ validate cumulative citation-agent fixes
→ validate workflow contract
→ trace agent artifact data flow
```

## Source lineage rule

Every agent-derived output must carry source authority through the whole lane:

```text
agent artifact
→ parsed source record
→ durable source ledger
→ normalized recommendation
→ implementation plan row
→ page-family/admission record
→ rendered output / repair ledger
→ trace and validation artifact
```

A page, repair, or release unit is invalid if it loses the source record, source artifact, route authority, or admission basis before validation.

## Durable source ledgers

The source-to-output proof layer reads from:

```text
data/report_fixes/source_record_ledgers/*.json
```

If those ledgers are unavailable, the trace layer may fall back to parsed agent manifests and normalized agent-run artifacts. The ledger is preferred because it preserves source records after CSV, HTML, and JSON agent artifacts are normalized into one intake model.

## Important validators and traces

| Command | Purpose |
|---|---|
| `npm run validate:agent-run-intake` | proves agent manifests and artifact intake shape |
| `npm run validate:velocity-agent-source-coverage` | proves source records are accounted for with no silent drops |
| `npm run validate:velocity-agent-duplicate-resolution` | proves duplicate source records map safely to canonical public routes |
| `npm run validate:page-family-contract` | proves admitted routes have supported families/shapes/source authority |
| `npm run citation:plan-agent-exact` | builds exact implementation plan from source artifacts |
| `npm run citation:apply-agent-exact` | applies the exact source-backed repair plan |
| `npm run validate:velocity-agent-recommendation-driven-output` | proves output was driven by recommendations, not query titles alone |
| `npm run trace:agent-artifact-data-flow` | emits final source-to-output data-flow trace |

## Common failure meanings

| Failure | Meaning | Correct repair surface |
|---|---|---|
| `missing_source_artifact` | route/admission record lost source authority | implementation plan or page-family authority adapter |
| `BLOCKED_AMBIGUOUS_FUZZY_ROUTE` | target route cannot be resolved safely | route resolver / source artifact target data |
| `sourceRecords is not defined` | trace script bug; source records were not loaded before summary | `scripts/validators/trace_agent_artifact_data_flow.js` |
| recommendation-driven output failure | rendered/ledgered output cannot prove it came from the recommendation | implementation planner, acceptance compiler, or rendered marker application |
| duplicate-resolution failure | duplicate source records were not preserved or were collapsed unsafely | duplicate/canonical mapping layer |

## What not to do

- Do not hand-edit rendered HTML as the primary repair.
- Do not rerun an old failed workflow as proof of a fixed commit.
- Do not lower validators to make a run green.
- Do not treat CSV as the only normalized truth; agent input may be CSV, HTML, JSON, and manifest data.
- Do not publish pages without source record coverage and page-family authority.
- Do not assume `batch_size` means new-page count.

## Fresh workflow proof after a repair

After a repaired baseline ZIP is applied and pushed, trigger a fresh workflow run on `main`:

```bash
gh workflow run velocity-content-release.yml   --repo seq23/local-guides-citation-velocity   --ref main   -f batch_size=1
```

For a full eligible release after the proof run passes:

```bash
gh workflow run velocity-content-release.yml   --repo seq23/local-guides-citation-velocity   --ref main   -f batch_size=150
```

Then inspect:

```bash
gh run list --repo seq23/local-guides-citation-velocity --branch main --limit 10
```

And watch the new run:

```bash
gh run watch
```

## Completion standard

The workflow is proven only when the fresh run on the fixed commit passes. A local updater pass proves local validation, commit, push, and public click audit. It does not retroactively turn an old failed workflow green.
