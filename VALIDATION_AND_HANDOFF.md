# VALIDATION AND HANDOFF

## Proof boundary

Assistant-side default proof for this artifact is structural/package integrity only. Full runtime validation is performed locally by the repo updater/validation workflow after applying the ZIP.

## Structural checks before delivery

- ZIP archive opens and has exactly one repo root.
- Required updater files and `dist/` are present.
- Release-critical files inside the reopened ZIP match the artifact manifest size and SHA256.
- 100K shard index and every shard parse, hash, count, ID range, and aggregate count are valid.
- Old monolithic 100K file is absent.
- Every admitted route has a frozen record/cache blob and rendered HTML hash matching the accepted hash.
- Internal data/docs/cache do not leak into `dist/`.

## Local validation after applying

Use the updater for this generic/Velocity repo. The updater is responsible for install/build/full validation/commit/push behavior under the local workflow. A freshly generated local release result—not the historical PASS:88 receipt—is the authority for the updated repo.

Recommended repo checks include `npm run validate:release`, page-release law, determinism, tree/shard hygiene, agent-run integrity, rendered content gates, and local/browser proof where the environment supports it.

## Success boundary

Do not call the repo fully validated merely because the ZIP is structurally correct. Final artifact status remains **STRUCTURALLY CHECKED — LOCAL VALIDATION REQUIRED** until local validation passes.
