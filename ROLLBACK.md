# ROLLBACK

## Artifact rollback

The immutable source artifact for this upgrade is:

`local-guides-citation-velocity-main_BASELINE_07-24-26_25e1fd4b86d7.zip`

Keep it unchanged. If the new baseline fails local validation, restore/reapply that prior ZIP or fix only the failing issue in a new full-baseline artifact.

## Page rollback

Accepted pages are stored in the frozen HTML cache with SHA256-bound registry records. A failed transactional repair restores prior live source and frozen HTML, then records the failed release. Do not hand-edit rendered HTML as the repair method.

## Data rollback

The legacy 100K monolith in the source artifact was truncated and is not a trustworthy rollback source. The replacement dataset must be regenerated deterministically from repo-local generator inputs and validated shard-by-shard.
