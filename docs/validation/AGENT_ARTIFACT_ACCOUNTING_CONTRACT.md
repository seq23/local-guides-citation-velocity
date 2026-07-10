# Agent Artifact Accounting Contract

## Authority

Artifact counts are diagnostics. Source-record identity and downstream disposition are the continuity authority.

## Accepted grains

- physical CSV row
- unique query
- query/model observation
- JSON recommendation
- normalized source record
- canonical recommendation
- release unit

Different grains may have different totals. A validator must not require unrelated totals to match.

## Stable anti-drop key

Every meaningful source recommendation is traced by `source_record_id`.

A record is accounted for when it is represented downstream as normalized, planned, applied, accepted, queued, skipped with a reason, blocked with a reason, duplicate-resolved, or resolved to an existing target.

## Hard failures

- required artifact missing or unparseable
- required artifact empty
- CSV source row missing a query
- source record missing `source_record_id`
- duplicate supposedly unique `source_record_id`
- source record has no downstream disposition
- skipped or blocked record lacks an explanatory reason
- selected repair is neither implemented nor dispositioned

## Non-failing diagnostics

- CSV row total differs from JSON scoreboard total
- model coverage varies by query
- normalized record count differs from physical source rows because of deduplication or multi-artifact ingestion
- scoreboard total uses a producer-defined grain that cannot be inferred

## July 10, 2026 example

The USCIS run contained 54 CSV query/model observations and 18 unique queries. Its JSON scoreboard total was 18. These totals describe different grains and are valid together. The release passes when all source-record IDs are accounted for and `silent_drops` is zero.
