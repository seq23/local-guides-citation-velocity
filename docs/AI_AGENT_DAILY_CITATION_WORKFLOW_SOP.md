# AI Agent Daily Citation Workflow SOP

This SOP applies to both Velocity and Canonical LKG repos.

## Purpose

Turn a daily AI-agent PDF/CSV into one clean, validated implementation:

1. inspect repo shape
2. inspect validators
3. extract fixes
4. generate ONE master script
5. patch rendered + data layers
6. run preflight
7. run page-quality validation
8. run validate:all
9. print git status
10. commit only after green

## Canonical Prompt (USE THIS EVERY TIME)

Today is [DATE]. Target repo is [REPO NAME]. Target vertical is [VERTICAL]. Scope is [Velocity only / Canonical LKG only].

Attached:
- PDF report
- CSV file
- repo context

Requirements:
1. Read PDF/CSV
2. Extract ALL recommendations for this repo + vertical
3. Inspect package.json + validate:all
4. Inspect ALL validators
5. Identify ALL source-of-truth files
6. Explain JSON shapes BEFORE mutation
7. Identify cascade failures BEFORE patch
8. Produce ONE master script
9. Patch rendered + data layers ONLY (no refactor)
10. Install validators if missing
11. Run preflight + validate:all
12. Print git status
13. DO NOT ask to commit until green
14. DO NOT include debug files
15. Treat all report suggestions seriously

## Fail-Fast Checklist

- package.json inspected
- validate:all inspected
- validators inspected
- JSON shapes known
- rendered pages known
- inventories known
- sitemaps known
- llms.txt known
- atlas/cluster contracts known
- linking contracts known
- word-count rules known
- canonical markers known

## Page Requirements

INSIGHTS:
- title
- meta description
- h1
- top marker
- bottom marker
- canonical domain mention
- >=120 words
- cluster link
- atlas link

CLUSTER PAGES:
- atlas backlink
- list of ALL insight links

ATLAS:
- total_clusters correct
- total_queries correct
- full link coverage

## Commit Rules

DO NOT COMMIT:
- temp scripts
- debug scripts
- logs

COMMIT:
- rendered pages
- data changes
- inventories
- sitemaps
- validators
- docs

## Done Definition

- preflight passes
- page-quality passes
- validate:all passes
- no junk files in git status
