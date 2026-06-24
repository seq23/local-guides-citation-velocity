# ZIP Apply Cheat Guide

Fast path for applying a full baseline snapshot ZIP to `local-guides-citation-velocity`.

## Repo values

```bash
REPO_PATH="$HOME/Documents/GitHub/local-guides-citation-velocity"
REPO_NAME="local-guides-citation-velocity"
MODE="snapshot"
UPDATER="$HOME/update_repo_from_zip_generic_v3_1.sh"
POSTDEPLOY_BASE_URL="https://local-guides-citation-velocity.pages.dev"
```

## Before running

From the repo root:

```bash
git status --short
```

Expected: blank output.

```bash
node -v
```

Expected: Node 24.x.

```bash
npm ci --ignore-scripts
```

For this repo, browser proof is required. Confirm local Playwright resolves:

```bash
node -e "try{console.log(require.resolve('playwright'))}catch(e){console.error('NO_LOCAL_PLAYWRIGHT')}"
```

Expected: a local `node_modules/playwright/...` path. If it prints `NO_LOCAL_PLAYWRIGHT`, do not run the updater; the ZIP/dependency contract is not ready.

## Apply command

Replace `ZIP_PATH` with the downloaded baseline ZIP path.

```bash
NODE_OPTIONS="--max-old-space-size=3072" ALLOW_LARGE_DELETE=1 POSTDEPLOY_BASE_URL="https://local-guides-citation-velocity.pages.dev" COMMIT_MSG="Velocity citation update 2026-06-23" "$HOME/update_repo_from_zip_generic_v3_1.sh" "ZIP_PATH" "$HOME/Documents/GitHub/local-guides-citation-velocity" snapshot local-guides-citation-velocity
```

Example:

```bash
NODE_OPTIONS="--max-old-space-size=3072" ALLOW_LARGE_DELETE=1 POSTDEPLOY_BASE_URL="https://local-guides-citation-velocity.pages.dev" COMMIT_MSG="Velocity citation update 2026-06-23" "$HOME/update_repo_from_zip_generic_v3_1.sh" "$HOME/Downloads/local-guides-citation-velocity-main_BASELINE_06-23-26_<sha>.zip" "$HOME/Documents/GitHub/local-guides-citation-velocity" snapshot local-guides-citation-velocity
```

## Safe delete pattern

Expected updater deletes are generated/runtime output only:

- `logs/`
- `.build/`
- `artifacts/validation/runtime/`
- release-pipeline checkpoint/report files

Stop if dry-run deletes include source directories such as:

- `scripts/`
- `templates/`
- `content/`
- `data/citation_velocity/`
- `data/page_families/`
- repo contract files

## Success criteria

Do not call the update complete until the updater shows validation, commit, and push success.

Key pass lines:

- `STAGED RELEASE PIPELINE PASS`
- `PUBLIC CLICK AUDIT PASS`
- commit created
- push completed

If the updater fails, restore using the printed `repo_pre_update_*` safety tag, then rerun only after the exact blocker is fixed.
