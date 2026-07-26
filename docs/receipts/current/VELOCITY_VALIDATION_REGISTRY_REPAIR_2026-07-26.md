# Velocity Validation Registry Repair — 2026-07-26

## Repository

- Repo: `local-guides-citation-velocity`
- Source snapshot: `local-guides-citation-velocity-main_BASELINE_07-24-26_6fae29a32822.zip`
- Repair scope: validation control-plane integration only

## Root cause

The local updater completed archive transfer, dependency installation, the site build, route/inventory regeneration, and the first 21 release validators. It then stopped at `validation-registry` because `package.json` defined `validate:release` as the canonical registry command plus a second direct validator command:

```text
node scripts/validation/run_validation_registry.js --profile release && npm run authority:yield:validate
```

The validation registry contract requires every validation alias to route through the registry and requires `validate:release` to equal the canonical release-profile command exactly. The citation-yield validator existed outside the registry, so the registry correctly rejected the package alias.

## Repair

1. Restored `validate:release` to:

```text
node scripts/validation/run_validation_registry.js --profile release
```

2. Added the active `citation-yield-feedback` validator to `_validation_registry.json`.
3. Assigned it to the `release`, `strict`, `audit`, and `local` profiles.
4. Declared its five authority-scale input files, KPI dependency, evidence output, mutation boundary, severity, and timeout.
5. Routed `authority:yield:validate` through the registry:

```text
node scripts/validation/run_validation_registry.js --id citation-yield-feedback
```

6. Added a small registry adapter that runs the existing authority-scale validator and writes `artifacts/validation/citation-yield-feedback.json`.
7. Regenerated `_repo_validation_matrix.json` from the canonical registry.

## Validation performed

- `validate:registry`: PASS
- `authority:yield:validate`: PASS
- Full release profile: PASS, 88 of 88 registered validators
- Advisory profile: PASS, 15 passes and one truthful non-blocking ingestion warning
- Site build: PASS, 2,330 pages built
- Public inventory: 2,325 admitted routes
- Deterministic clean rebuild: PASS, 2,305 files compared
- Browser contract: PASS, 36 cases and 432 assertions
- Browserless backup: PASS, 36 cases
- Distribution inputs: PASS, priority 35 and batch 100
- Workflow contract and Velocity intake workflow: PASS
- Validation registry: 118 registered validators, 90 active

## Environment boundary

The repository declares Node 24.x. The execution container used Node 22.16.0. Package installation for Playwright timed out at the external package gateway, so the real Chromium click audit was attempted but could not start. The repository's browserless backup, browser contract, route parity, and UI-test parity all passed. The local updater remains responsible for the Node 24/installed-Playwright proof.

## Scope truth

No site content, public route, publication ceiling, provider integration, distribution behavior, or authority-scale decision was changed. The velocity decision remains `HOLD`, with zero fabricated external citation events.
