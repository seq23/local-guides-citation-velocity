# Validated Distribution Handoff

## Governing rule

Distribution deploys the exact artifact uploaded by the successful `Validate Repo` workflow. It must not run a second build.

## Validate workflow

`checkout → Node 24 → npm ci --ignore-scripts → release:ci-validate → attestation → upload exact artifact`

The artifact includes:

- rendered public tree
- `.build/indexnow-priority.txt`
- `.build/indexnow-batch.txt`
- validation reports
- `_artifact_validation_manifest.json`
- `artifacts/release/validation-attestation.json`

## Distribution workflow

`resolve successful validation run → download exact artifact → verify attestation → verify distribution files → submit → save evidence`

`prepare_distribution_from_attestation.js` hard-fails when the attestation or validated URL files are absent or invalid.

## Manual dispatch

Manual distribution requires both:

- exact validated artifact name
- source Validate workflow run ID

A manual job may not point to an arbitrary working tree or rebuild output.

## Failure behavior

- Validation failure: no deploy job.
- Missing artifact: hard fail.
- Hash/attestation mismatch: hard fail.
- Missing URL manifest: hard fail.
- Distribution endpoint failure: preserve report and hard fail according to deploy script behavior.
