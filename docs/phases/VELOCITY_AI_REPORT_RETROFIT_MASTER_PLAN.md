# Velocity AI Report Retrofit Master Plan

## Repo
`local-guides-citation-velocity`

## Objective
Build a repo-native recommendation retrofit lane for Velocity, then use it to apply only the report fixes that belong in this repo.

## Phase 0 findings

### Existing lanes already in repo
- public signal ingestion
- build / validate / release
- Velocity → LKG promotion

### Missing lane
A normalized recommendation retrofit lane that can:
- ingest PDF/CSV recommendations
- classify them
- separate Velocity vs LKG work
- build an actionable queue
- validate the queue
- apply source-layer changes only

### Direct Velocity work from current reports
1. USCIS red-flags surface
2. USCIS vaccination lead table

### Already done / no new Velocity action
- Neuro hub cost-table win
- USCIS correction-mistakes
- USCIS document-checklist
- USCIS hub decision framework
- USCIS timeline-validity
- Neuro velocity run says no new fixes this cycle

### Wrong repo
- Neuro city/template changes
- Neuro canonical guide changes
- USCIS city/template changes
- USCIS canonical guide changes

## Phase 1 lane definition

### New scripts
- `scripts/recommendations/build_report_fix_queue.js`
- `scripts/recommendations/apply_report_fixes.js`
- `scripts/validators/validate_report_fix_queue.js`

### New artifacts
- `reports/velocity_ai_report_inventory.json`
- `reports/velocity_ai_report_gap_map.json`
- `reports/report_fix_queue.json`

## Phase 2 execution targets

### Source files
- `content/_staged/pages.json`
- `content/_shared/query_cluster_registry.json`
- `content/_staged/reddit_queries_uscis.json`
- `scripts/lib/page_shape_config.js`

### Required outcomes
- create `/uscis-medical/red-flags/`
- add exact trigger phrasing for I-693 red-flag queries
- add a lead USCIS-required vaccine table for the USCIS vaccination page
- preserve source-only editing
- avoid rendered HTML patching

## Validation plan
- queue build
- queue validation
- inspect-first apply
- site build
- answer-shape validation
- page-generation validation
- full `validate:all` when feasible
