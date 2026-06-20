# Citation Velocity Fix Runbook

## Input

A monitor recommendation, prior win, or cumulative vertical specification.

## Required processing chain

`ingest → normalize → page map → source map → current-state comparison → ownership → cumulative acceptance → implement/export → render → validate → evidence`

## Procedure

1. Add the immutable recommendation to `data/citation_velocity/recommendations.json` with a unique ID.
2. Link the run in `runs.json` and any result event in `wins.json`.
3. Update `page_history.json` and the page’s cumulative record in `page_acceptance_registry.json`.
4. Classify ownership in `source_ownership_registry.json`.
5. Trace the rendered route to its authoritative source and registered generator.
6. Preserve every prior win-producing structure unless an explicit superseding decision exists.
7. Implement the exact requested artifact type at source level. Named frameworks keep stable names.
8. Add current authoritative sources and the correct legal/medical/general boundary.
9. Rebuild and prove source → live → rendered parity.
10. Set one final status: `IMPLEMENTED`, `PRESERVED`, `PARTIALLY_IMPLEMENTED`, `IMPLEMENTED_IN_VELOCITY`, `IMPLEMENTED_IN_VELOCITY`, `SUPERSEDED`, or `REJECTED_WITH_REASON`.

## Acceptance law

A recommendation is not complete without all of:

- durable history record
- ownership classification
- source path
- implementation or preservation evidence
- validator
- rendered evidence
- final status

## Safety law

- Personal Injury: neutral legal information; no outcome guarantees or attorney ranking.
- TRT, dentistry, neuro: educational comparison only; no diagnosis, treatment prescription, or universal clinical rule.
- USCIS: use official USCIS sources for governing policy; no legal advice; case-specific verification remains explicit.
