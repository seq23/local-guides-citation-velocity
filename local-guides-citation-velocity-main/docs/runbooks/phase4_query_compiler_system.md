# Phase 4 Query Compiler System

Status: ACTIVE

## Purpose

This runbook governs the Reddit-style query compiler in the velocity repo. The system turns staged consumer-style questions into structured atlas pages that later produce insight pages and canonical routing surfaces.

## Inputs

- `content/_staged/reddit_queries_*.json`
- `content/_shared/query_cluster_registry.json`

## Output

- generated cluster atlas pages written into `content/_staged/pages.json`
- promotion export written to `content/_shared/promotion_candidates.json`

## Flow

1. Update staged query files.
2. Run `npm run compile:queries`.
3. Run `npm run export:promotion`.
4. Validate with `npm run validate:queries`.
5. Release via the existing release workflows.

## Constraints

- no new rendering system
- no parallel content store for live pages
- cluster registry is authoritative
- duplicate normalized queries are forbidden

## Recovery

If compile output looks wrong:

1. revert `content/_staged/pages.json`
2. correct the staged query source file
3. rerun `npm run compile:queries`
4. rerun validation


## Routing rule (locked)

Query-compiler pages are intentionally discoverable through sitemap and internal linking, but they are not a browsing destination.

Required behavior:
- do not place query-compiler pages in primary navigation
- keep them crawlable and internally linked
- render aggressive outbound canonical routing blocks above the fold, mid-page, and at the bottom
- route the human to the canonical domain quickly instead of trying to keep them on the velocity site
