# Phase 4 Daily Release Operator SOP

Status: ACTIVE

## Daily behavior

The daily release workflow now compiles staged query clusters before releasing pages.

### Operator checks

1. Confirm staged query files are valid JSON.
2. Confirm cluster names exist in `content/_shared/query_cluster_registry.json`.
3. Confirm `release_state.json` is not manually corrupted.
4. Run `npm run validate:all` before shipping a manual baseline snapshot.

## Expected release pattern

- daily workflow compiles staged query clusters
- daily workflow releases up to 5 pages from `content/_staged/pages.json`
- build regenerates live insight inventory from live atlas pages

## Failure modes

- duplicate normalized query → compile/validate fail
- invalid cluster assignment → validate fail
- missing related links on generated pages → validate fail

## Rollback

Restore prior versions of:
- `content/_staged/pages.json`
- staged query source files
- `content/_shared/release_state.json`


## Routing rule (locked)

Query-compiler pages are intentionally discoverable through sitemap and internal linking, but they are not a browsing destination.

Required behavior:
- do not place query-compiler pages in primary navigation
- keep them crawlable and internally linked
- render aggressive outbound canonical routing blocks above the fold, mid-page, and at the bottom
- route the human to the canonical domain quickly instead of trying to keep them on the velocity site
