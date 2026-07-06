# Validation Severity Matrix

Authority: `_validation_registry.json`  
Generated projection: `_repo_validation_matrix.json`  
Execution engine: `scripts/validation/run_validation_registry.js`

## Severity behavior

| Severity | Default release | Strict profile | Intended use |
|---|---:|---:|---|
| `HARD_FAIL` | Blocks | Blocks | Source corruption, unsafe content, broken routing/rendering, workflow bypass, nondeterminism, or invalid delivery state |
| `STRONG_WARNING` | Records and continues | Blocks | Material discoverability, ingestion, indexing, or quality degradation |
| `SOFT_WARNING` | Records and continues | Records and continues | Low-risk schema, documentation, style, or maintainability concern |
| `INFO` | Records only | Records only | Historical evidence, metrics, optimization notes, and retired checks |

`LOCAL_ONLY` is an execution scope, not a severity. A local-only hard fail is deferred in the container and must pass when the required deployed URL, browser, credentials, or operator environment exists.

## Current admitted totals

- 115 registered validator/preflight/audit executables
- 89 active
- 11 on-demand
- 15 retired with explicit replacements
- 87 hard-fail registrations
- 11 strong-warning registrations
- 2 soft-warning registrations
- 15 info/retired registrations
- 1 local-only browser proof

Regenerate `_repo_validation_matrix.json` from `_validation_registry.json` after editing the registry. Do not hand-edit the matrix counts.

## Profiles

| Profile | Purpose | Warning behavior |
|---|---|---|
| `core` | Pure default structural release gate | Warnings recorded, not blocking |
| `release` | Core plus source immutability, hygiene, and determinism | Warnings recorded, not blocking |
| `strict` | Release plus advisory checks | Strong warnings promoted to failure |
| `advisory` | Ingestion, fanout, and indexing diagnostics | Never blocks |
| `local` | Full release proof plus deployed Playwright audit | Local browser failure blocks |
| `audit` | Collect-all active and on-demand checks | Reports all findings before exit |
| `distribution` | Artifact-distribution and IndexNow readiness | Hard failures block; IndexNow remains a strong warning |
| `query` | Query compilation and release-batch mutation checks | Hard failures block |
| `social` | Public-signal processing and Velocity source-page admission loop | Hard failures block; ingestion/fanout warn |
| `llm` | LLM exports, answer blocks, entity graph, citation targets | Hard failures block |

## Simplification law

1. `_validation_registry.json` is the only editable admission source.
2. `_repo_validation_matrix.json` is generated; hand edits are invalid.
3. Every `validate:*`, `validate`, `audit:all`, and `preflight:integrity` package alias routes through the registry runner.
4. Retired validators cannot be invoked by ID; the runner returns their replacement IDs.
5. `validate:all` is pure and runs the `core` profile.
6. `validate:release` is the full container release profile.
7. `validate:strict` promotes strong warnings to blocking failures.
8. Mutation, deployment, commit, push, and signal collection are not validation operations.

## Non-petty blocking policy

Hard failures are reserved for real release threats:

- unsafe or unsupported content;
- missing source provenance;
- silent source-record drops;
- broken route, canonical, sitemap, or rendered file integrity;
- scaffold/instruction text leaking into public HTML;
- invalid ZIP/package/update state;
- workflow bypass or nondeterministic release behavior.

Warnings remain visible but do not block the default release profile:

- duplicate or weak meta descriptions;
- minor metadata uniqueness advisories;
- optional internal-link opportunities;
- non-critical crawl/discoverability improvements;
- advisory public-signal ingestion degradation.

Duplicate `<title>` and duplicate H1 findings may still block when they indicate route/template collapse. Duplicate meta descriptions alone are metadata hygiene and must not block default release.
