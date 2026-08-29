# Workflow YAML Topology Runbook

Status: ACTIVE RUNBOOK
Repo: local-guides-citation-velocity

## Canonical lanes

Each workflow maps to exactly one lane:

- validate
- build
- content-release
- signal-intelligence
- deploy
- full-rebuild
- manual-maintenance
- retired

## Current canonical workflow set

- `.github/workflows/validate-repo.yml` — validate lane
- `.github/workflows/velocity-content-release.yml` — content-release lane
- `.github/workflows/daily-citation-intelligence.yml` — signal-intelligence lane
- `.github/workflows/velocity-full-rebuild.yml` — full-rebuild lane
- `.github/workflows/deploy-distribution.yml` — deploy lane

## Replaced / retired workflows

- `.github/workflows/validate-repo.yml` replaced by `.github/workflows/validate-repo.yml`
- `.github/workflows/velocity-content-release.yml` replaced by `.github/workflows/velocity-content-release.yml`
- `.github/workflows/release_batch.yml` merged into the manual input path of `.github/workflows/velocity-content-release.yml`
- `.github/workflows/velocity-full-rebuild.yml` replaced by `.github/workflows/velocity-full-rebuild.yml`
- `.github/workflows/postdeploy-public-audit.yml` deleted 2026-08-29 by owner decision; the deployed click audit is not replaced, and `npm run release:prepush:local` remains the browser proof

## Runtime mutation law

Forbidden runtime mutations:

- `.github/**`
- `package.json`
- `package-lock.json`
- `scripts/**`
- `docs/**`
- `_repo*.json`
- `_validation_registry.json`
- `_repo_validation_matrix.json`
- workflow contracts
- strategy contracts

Allowed runtime mutations:

- `data/signals/**`
- `artifacts/validation/**`
- `reports/**`
- `content/generated/**`
- `public/generated/**`
- `sitemaps/**`
- `sitemap*.xml`
- `llms*.txt`

## Validators

Workflow topology is enforced by these package commands:

- `validate:workflow-yaml-inventory`
- `validate:workflow-topology`
- `validate:workflow-runtime-mutations`
- `validate:workflow-artifacts`
