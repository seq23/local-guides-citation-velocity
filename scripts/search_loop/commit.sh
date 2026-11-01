#!/usr/bin/env bash
# Search loop (seq23/search-loop@v1) - the commit step for this repo, default branch only.
# Called by the engine's reusable workflow as commit_command, after the engine ran and
# (when it published) after scripts/search_loop/fold_in.js ran as post-build.
#
# Nothing is pushed unless the release profile passes on the exact tree being pushed,
# the same rule every other main-writer here follows (velocity-full-rebuild.yml):
#   fold-in (idempotent) -> build -> validate:release -> commit -> rebase/rebuild/
#   revalidate -> push -> request Validate Repo for main (a GITHUB_TOKEN push does not
#   trigger workflows, and deploy-distribution follows Validate Repo).
# Exit codes: 0 pushed or nothing to commit; 1 validation failed (NAMED STOP, nothing
# pushed, the next run redoes today's work); 9 push failed after 3 attempts.
set -Eeuo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required to request Validate Repo for the pushed SHA}"
export SOURCE_DATE="${SOURCE_DATE:-$(date -u +%F)}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

fold_build_validate() {
  node scripts/search_loop/fold_in.js
  npm run build
  if ! npm run validate:release; then
    echo "NAMED STOP [SEARCH_LOOP_VALIDATION_FAILED] the release profile failed on the search-loop tree; nothing pushed. The next daily run redoes today's work." >&2
    exit 1
  fi
}

node scripts/tests/test_search_loop_fold_in.js
node scripts/search_loop/fold_in.js
if [ -z "$(git status --porcelain)" ]; then echo "search-loop commit: nothing to commit"; exit 0; fi
fold_build_validate
git add -A
if git diff --cached --quiet; then echo "search-loop commit: nothing to commit after build"; exit 0; fi
git commit -q -m "search loop: daily pages, checks and ledger ($SOURCE_DATE)"

for attempt in 1 2 3; do
  git fetch -q origin main
  if ! git merge-base --is-ancestor origin/main HEAD; then
    if ! git rebase origin/main; then
      git rebase --abort || true
      echo "NAMED STOP [PUSH_CONFLICT] rebase onto main failed; nothing pushed, the next run redoes today's work" >&2
      exit 9
    fi
    fold_build_validate
    git add -A
    git diff --cached --quiet || git commit -q --amend --no-edit
  fi
  if git push origin HEAD:main; then
    node scripts/ci/dispatch_workflow.js validate-repo.yml main || echo "NAMED NOTE [VALIDATE_REPO_NOT_REQUESTED] pushed, but Validate Repo could not be requested; the next push or schedule runs it"
    echo "search-loop commit: pushed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep $((attempt * 15))
done
echo "NAMED STOP [PUSH_FAILED] three push attempts failed" >&2
exit 9
