# SNAPSHOT ARTIFACT GOVERNANCE ADDENDUM

Artifact is source of truth.

ZIP must:
- include root files
- include dist (if generator output)
- pass validation after extraction

Snapshot:
- full replace
- rsync --delete

Patch:
- restricted

Never override deletes on incomplete artifact.

ZIP must validate before touching repo.
