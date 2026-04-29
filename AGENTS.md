# AI Agent Operating Doctrine — Defensive Repo Work

This repository must be treated as a deterministic content pipeline, not a loose collection of scripts. Agent-written changes must preserve source-of-truth boundaries, fail before writing bad output, and validate the release contract before suggesting any fix is complete.

## Mandatory workflow

1. Inspect before mutation.
   - Read the relevant files first.
   - Confirm data shape, variable names, write points, and downstream readers.
   - Prefer repo-native structure over imported patterns from another repo.

2. Never blind-patch.
   - Do not rely on brittle exact-block replacement unless the exact block has just been verified.
   - Prefer structural changes, schema-aware transforms, or anchored regex with explicit failure messages.

3. Fail before write.
   - Validate inputs and coverage before creating or overwriting generated files.
   - No script may write partial output and then discover the output is invalid.

4. Keep canonical truth separate from generated truth.
   - Canonical files live under `content/_shared`, `content/_live`, `content/_staged`, and reviewed data/config locations.
   - Generated files under `.build`, `dist`, `reports`, monitoring output, and release artifacts must not become source of truth.

5. Use defensive shell defaults.
   - Bash scripts must start with `set -euo pipefail`.
   - Node scripts must validate required files before reading and must exit non-zero on invariant failure.

6. Syntax-check before execution.
   - Run `node -c <file>` for changed Node scripts.
   - Run `bash -n <file>` for changed shell scripts.

7. One invariant per risky change.
   - Do not combine refactor, reorder, generator change, and validator change in one blind operation.
   - Make the invariant explicit and validate it.

8. Check downstream dependencies.
   - Before changing a file shape, identify who reads it.
   - Before changing execution order, identify which scripts generate reports required by later validators.

9. Dry-run or inspect mode first for risky mutation.
   - Scripts that delete, rebuild inventories, or rewrite generated maps should support inspection or write reports before mutation.

10. Validate before commit or packaging.
   - The final local authority is the repo's guardrail script, currently `npm run guardrails:all` when available, otherwise `npm run validate:all`.
   - CI must run the same full guardrail, not a partial validator subset.

## Hard prohibitions

- Do not commit nested backup ZIPs or duplicate repo copies.
- Do not commit generated reports, logs, patch bundles, or artifact output directories.
- Do not use generated clusters/scores/reports as canonical source of truth.
- Do not write a repair script that masks a generator bug while allowing the next build to recreate the same broken state.
- Do not provide a fix script before inspecting file shapes and current package scripts.

## Required pre-script due diligence

Before offering a script to fix a problem, an agent must answer:

- What generated or canonical file is failing?
- Which script creates it?
- Which validator catches it?
- Does the generator fail before write?
- Does validation run in the correct order?
- Are duplicate repo copies, nested ZIPs, generated artifacts, or stale reports being scanned?
- What exact command proves the fix?


## Velocity → LKG promotion boundary

Velocity is not a publisher. Velocity may collect non-auth public signals, normalize them, cluster them, score them, and export LKG guide candidates. It must not directly create live LKG pages, mutate LKG runtime files, or publish content.

The approved promotion flow is:

1. Velocity runs public signal ingestion from non-auth sources.
2. Velocity exports `data/lkg_candidates/YYYY-MM-DD.json` and `data/lkg_candidates/latest.json`.
3. Velocity opens a pull request against the LKG repository with the candidate payload under `data/velocity_intake/guide_candidates/`.
4. LKG validates the candidate payload, generates draft guide/page artifacts, builds, validates, and deploys preview only.
5. The user approves by merging the LKG pull request. LKG is the only repo allowed to publish.

Deprecated promotion artifacts such as `data/community/publish_queue.json` and `data/community/patch_plan.json` are not runtime authority. Any script that tries to publish queued Velocity pages directly must remain disabled or review-gated.
