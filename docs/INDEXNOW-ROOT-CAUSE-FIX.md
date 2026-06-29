# IndexNow Root-Cause Fix

Repo: `local-guides-citation-velocity`

Root issue: distribution artifacts were submitting very large all-URL batch files to IndexNow. Large mixed-host batch submissions can partially fail even when priority URLs succeed.

Fix applied:
- keep priority submission as the blocking proof lane;
- cap active batch submissions with `INDEXNOW_SAFE_BATCH_LIMIT` defaulting to 100 URLs;
- write overflow URLs to `indexnow-deferred-batch.txt` instead of submitting thousands at once;
- validate priority/batch file budgets before deployment;
- preserve full sitemap discovery while submitting IndexNow in safe batches.

This is a root fix because the workflow no longer creates the oversized batch condition that produced partial IndexNow results.
