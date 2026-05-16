# Velocity Release Batch Workflow Data Trace — 2026-05-16

## Purpose

This trace documents the release-batch workflow path and the guardrail added after the citation-agent source-to-published fixes.

## Trigger

`.github/workflows/release_batch.yml` runs on:

- push to `main`
- manual `workflow_dispatch` with `batch_size` input

## Data path

1. Checkout repository.
2. Set up Node 24.
3. Install dependencies with `npm ci`.
4. Compile staged Reddit query clusters with `node scripts/compile_reddit_queries.js`.
5. Release staged pages into live state with `node scripts/release_batch.js "$BATCH_SIZE"`.
6. Clean generated build state: `.build`, `dist`, `reports`, `data/answer_surface_monitoring`.
7. Rebuild the published surface with `npm run build`.
8. Validate the rebuilt public surface with `npm run guardrails:all`.
9. Remove generated build output before commit.
10. Commit and push only durable release/source state.

## Issue found

The workflow set up Node but did not install dependencies before running compile/build/validation steps. That could make GitHub Actions fail or behave differently from local pre-commit validation if a future script starts requiring installed packages.

## Fix applied

Added an explicit `Install dependencies` step before the release-batch compile step:

```yaml
- name: Install dependencies
  run: npm ci
```

## New guardrail

Added `scripts/validators/validate_release_batch_workflow.js` and wired it into `validate:all` through `npm run validate:release-batch-workflow`.

The validator checks that release-batch workflow wiring includes:

- checkout
- Node 24 setup
- `npm ci` before compile/build/validation
- staged query compilation
- release batch execution
- build
- `guardrails:all` before commit
- commit and push
- no direct `secrets.*` usage inside workflow `if:` expressions

## Expected proof commands

```bash
npm run validate:release-batch-workflow
npm run build
npm run trace:citation-agent-fixes
npm run validate:citation-agent-fixes
npm run guardrails:all
```

## Second-pass release-batch trace finding

A full release-batch simulation exposed a deeper issue: `compile_reddit_queries.js` regenerated `content/_staged/pages.json` from query inputs before `release_batch.js` copied staged pages into live pages. That compile step could wipe the citation-agent markers from the staged manifest even when the committed staged/live files already contained them.

## Second-pass fix applied

Added `scripts/apply_citation_agent_fixes_2026_05.js` and wired it into `scripts/compile_reddit_queries.js` immediately after staged query pages are regenerated.

This makes the citation-agent fix lane durable across release-batch runs:

1. `compile_reddit_queries.js` regenerates query pages.
2. `apply_citation_agent_fixes_2026_05.js` reapplies trace-required marker sections to `content/_staged/pages.json`.
3. `release_batch.js` copies the patched staged pages into `content/_live/pages.json`.
4. `build_site.js` renders the patched live pages.
5. `trace:citation-agent-fixes` proves source, live manifest, staged manifest, and rendered HTML all contain the required markers.

## Additional proof command

```bash
node scripts/compile_reddit_queries.js
node scripts/release_batch.js 5
npm run build
npm run trace:citation-agent-fixes
npm run guardrails:all
```
