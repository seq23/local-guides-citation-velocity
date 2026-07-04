# Repository Update Runbook

## Identity

- Repository: `local-guides-citation-velocity`
- Class: generated static publishing and citation-velocity
- Source truth: latest full baseline ZIP
- Required runtime: Node 24, npm lockfile install
- Delivery: complete snapshot ZIP, not a patch

## Update procedure

1. Extract the incoming ZIP into a clean directory and confirm the wrapper/repository identity.
2. Run `npm ci --ignore-scripts` under Node 24.
3. Read `REPO_IDENTITY.md`, `_repo_update_contract.json`, `_repo_lifecycle_profile.json`, and the relevant source ownership records.
4. Modify authoritative source only. Do not hand-edit generated HTML as the sole implementation.
5. Run `npm run release:prepush:container`.
6. Confirm all `artifacts/validation/*.json` reports have `ok: true` and the attestation status is `VALIDATED_ARTIFACT_READY`.
7. Package the exact repository root in one wrapper directory. Exclude `.git`, `node_modules`, active environment files, caches, logs, and ephemeral `dist`/`reports` output.
8. Reopen the ZIP, test integrity, verify required files, and compare release-critical hashes.
9. Deliver the ZIP and SHA-256 sidecar with status `STRUCTURALLY CHECKED — LOCAL VALIDATION REQUIRED` until the local updater completes.

## Local updater

Canonical active updater target: `$HOME/repo-tools/active/update_repo_from_zip_generic_v3_1.sh`.  
Do not infer a different path from memory. If the active tool is relocated, discover and inspect it before use.

Arguments, in order:

1. `ZIP_PATH`
2. `REPO_PATH`
3. `MODE`
4. `REPO_NAME`

The updater owns local validation, commit, and push. A failed local validator returns the exact failure for a narrow source correction and a new full baseline ZIP.


## Quick apply command template

Replace `<ZIP_FILENAME>` with the exact downloaded baseline ZIP filename.

```bash
ALLOW_LARGE_DELETE=1 \
POSTDEPLOY_BASE_URL="https://local-guides-citation-velocity.pages.dev" \
PLAYWRIGHT_BASE_URL="https://local-guides-citation-velocity.pages.dev" \
bash "$HOME/repo-tools/active/update_repo_from_zip_generic_v3_1.sh" \
"$HOME/Downloads/<ZIP_FILENAME>" \
"$HOME/Documents/GitHub/local-guides-citation-velocity" \
snapshot \
local-guides-citation-velocity
```

Current repair example:

```bash
ALLOW_LARGE_DELETE=1 \
POSTDEPLOY_BASE_URL="https://local-guides-citation-velocity.pages.dev" \
PLAYWRIGHT_BASE_URL="https://local-guides-citation-velocity.pages.dev" \
bash "$HOME/repo-tools/active/update_repo_from_zip_generic_v3_1.sh" \
"$HOME/Downloads/local-guides-citation-velocity-main_BASELINE_07-04-26_ae24f7c2bbbd.zip" \
"$HOME/Documents/GitHub/local-guides-citation-velocity" \
snapshot \
local-guides-citation-velocity
```

## Prohibited shortcuts

- Trusting an existing working folder over the ZIP
- Applying a partial patch as the baseline
- Editing only rendered HTML
- Running signal ingestion from validation
- Rebuilding inside distribution deployment
- Ignoring rebase, validation, or push failures
- Claiming Velocity work is complete before Velocity merges and validates it
