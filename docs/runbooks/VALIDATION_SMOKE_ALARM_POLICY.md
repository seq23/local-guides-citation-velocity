# Validation Smoke Alarm Policy

Validation is a smoke alarm, not an execution lane.

## Validate

`validate:*` commands may inspect repo state, required contracts, raw artifact placement, unsafe public claims, packaging shape, and source integrity.

They must not build, publish, promote, absorb, apply, deploy, bootstrap runtimes, mutate providers, normalize raw drops, or self-heal generated state.

## Execute

Build, generate, normalize, repair, absorb, apply, publish, distribute, and self-heal work belongs in explicit `build:*`, `execute:*`, `release:*`, `workflow:*`, `citation:*`, `apply:*`, or `repair:*` commands.

## Blocking Rules

Hard failure is reserved for release-threatening problems:

- exposed secrets or unsafe provider configuration;
- broken package integrity or wrong repo root;
- corrupt required source contracts;
- protected raw external agent artifact mutation unless explicitly quarantined;
- broken runtime or build contract for the actual app;
- unsafe public-surface claims or routing that can harm users.

## Non-Blocking Noise

These are information only unless accompanied by a real integrity failure:

- `generated_at`, `checked_at`, `updated_at`, `started_at`, or `finished_at` churn;
- validation receipts;
- logs;
- diagnostics;
- cache files;
- empty optional queues;
- missing live ranking, indexing, or external citation proof.

Raw external agent artifacts remain protected. Downstream normalized, semantic, acceptance, and validation artifacts are repo-owned execution outputs.
