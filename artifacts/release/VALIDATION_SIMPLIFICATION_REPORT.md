# Validation Simplification Report

Evidence date: 2026-06-20  
Result: **PASS**

## Central authority

- Executable registry: `_validation_registry.json`
- Generated matrix: `_repo_validation_matrix.json`
- Registry runner: `scripts/validation/run_validation_registry.js`
- Registry admission validator: `scripts/validation/validate_validation_registry.js`

## Inventory

- Registered checks: 115
- Active checks: 89
- On-demand checks: 11
- Retired checks: 15
- Hard-fail registrations: 87
- Strong-warning registrations: 11
- Soft-warning registrations: 2
- Informational registrations: 15
- Local-only checks: 1

## Release behavior

- `validate:all` runs one pure core profile.
- `validate:release` adds immutability, hygiene, and determinism.
- `validate:strict` promotes strong warnings to release blockers.
- Mutation, content generation, commit, push, deployment, and external submissions stay outside validation.
- Retired external-handoff validators remain registered with explicit Velocity-only replacements.
- Formatting-only concerns—trailing whitespace, blank lines, indentation, and exact copy—cannot block release.
- Arbitrary editorial quotas are advisory; evidence, uniqueness, safety, route integrity, determinism, and packaging remain hard gates.

## Determinism

A clean rebuild matched the current public render across 2299 fingerprinted files.
