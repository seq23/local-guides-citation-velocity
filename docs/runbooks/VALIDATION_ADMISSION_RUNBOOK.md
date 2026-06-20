# Validation Admission Runbook

## Authority

- Executable source of truth: `_validation_registry.json`
- Generated human/machine matrix: `_repo_validation_matrix.json`
- Runner: `scripts/validation/run_validation_registry.js`
- Admission validator: `scripts/validation/validate_validation_registry.js`

The matrix must never be hand-edited. Change the registry, run `npm run validation:matrix`, then run `npm run validate:registry`.

## Required admission fields

Every validator record must define:

- stable ID and exact script path;
- status: `ACTIVE`, `ON_DEMAND`, or `RETIRED`;
- severity: `HARD_FAIL`, `STRONG_WARNING`, `SOFT_WARNING`, or `INFO`;
- execution scope: `CONTAINER` or `LOCAL_ONLY`;
- tier and profiles;
- production risk prevented;
- why another validator does not already cover that risk;
- timeout, evidence path, and failure action;
- warning-detection patterns when the script exits zero while reporting degradation.

A retired record also requires replacement IDs and a retirement reason.

## Severity law

- `HARD_FAIL`: stops the selected profile when the check exits nonzero.
- `STRONG_WARNING`: records and continues in normal release; blocks under `strict`.
- `SOFT_WARNING`: records and continues in every profile.
- `INFO`: records only.
- `LOCAL_ONLY`: execution scope; deferred unless the local profile or `--include-local` is used.

## Admission procedure

1. State the exact production or delivery risk.
2. Prove no existing validator already owns the invariant.
3. Implement a read-only validator. Evidence-report writes are allowed; business/source mutation is not.
4. Add the registry record and appropriate profiles.
5. Run `npm run validation:matrix`.
6. Run `npm run validate:registry`.
7. Run the narrow selector with `node scripts/validation/run_validation_registry.js --id <id>`.
8. Run `npm run validate:all` and, for release-critical changes, `npm run validate:release`.
9. Confirm package aliases and workflows still consume the centralized runner.

## Removal procedure

1. Register the replacement validator.
2. Change the old record to `RETIRED`.
3. Add replacement IDs and a concrete retirement reason.
4. Remove direct package/workflow invocation.
5. Regenerate the matrix and pass registry admission.

Validator files may remain for historical diagnostics, but the runner blocks direct invocation of retired IDs.

## Commands

```bash
npm run validation:list
npm run validation:dry-run
npm run validate:all
npm run validate:release
npm run validate:strict
npm run validate:warnings
npm run audit:all
npm run validate:local
```
