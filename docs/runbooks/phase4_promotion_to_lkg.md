# Phase 4 Promotion To LKG

Status: ACTIVE

## Purpose

The velocity repo discovers and tests query demand. LKG remains the curated authority / conversion system. This runbook defines the handoff.

## Promotion candidate source

`content/_shared/promotion_candidates.json`

## Candidate signals

- high-priority staged query
- repeated consumer confusion
- strong conversion adjacency
- clear fit for canonical main-domain treatment

## Rule

Velocity content is not auto-promoted into LKG.

Promotion requires a separate approved LKG execution pass.

## Minimum handoff data

- vertical
- cluster
- original query
- normalized query
- source bucket
- promotion status


## Routing rule (locked)

Query-compiler pages are intentionally discoverable through sitemap and internal linking, but they are not a browsing destination.

Required behavior:
- do not place query-compiler pages in primary navigation
- keep them crawlable and internally linked
- render aggressive outbound canonical routing blocks above the fold, mid-page, and at the bottom
- route the human to the canonical domain quickly instead of trying to keep them on the velocity site
