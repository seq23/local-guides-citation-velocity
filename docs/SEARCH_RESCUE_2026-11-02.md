# Search rescue — reviewed publication set

The live sitemap had 2,137 URLs on 2 November. The latest committed GSC export
(3–30 October) reports zero clicks and 13 impressions. The inspection snapshot
has 83 indexed URLs out of 2,127: 905 crawled but not indexed and 910 discovered
but not indexed. Ten TRT state pages average 61.2% shared five-word shingles;
ten evenly spaced pages average 14.4%. Repetition is confirmed; its causal role
in Google's decisions remains suspected. Comparable stored rolling windows
already show near-zero visibility in September; an exact drop date is unknown.

`config/search_rescue.json` is the reviewed source, not a generated inventory.
Its 68 survivors retain measured impressions, distinct sourced
introductions, and navigation/trust/tool pages. Its 2,082 retirements consolidate
other admitted routes to the nearest surviving vertical hub. Existing historical
retirements remain and destinations are flattened. Archived HTML is retained for
historical evidence and existing shrink protections; it is excluded from deployment.

`scripts/lib/search_rescue.js` enforces the set at admission and deployment and
writes the existing retirement contract before generation. Release candidates
outside the reviewed set are held. The search-loop job is paused; its config
and discovery evidence remain intact. Resuming expansion requires a reviewed
policy change, not deleting redirect records or regenerating the old inventory.

`scripts/lib/rescue_page_shape.js` places each content page's H1, definition and
quick answer first, adds a publisher/date line and speakable metadata, resolves
retired links and presents one provider CTA as the primary box. Reviewed page and vertical
openings are reviewed source in `config/search_rescue_openings.json`; other
facts, decision artifacts and FAQ answers remain from existing page evidence.
`scripts/apply_search_rescue.js` preflights every survivor before any content
write and refreshes the existing accepted cache. It runs after frozen restoration
so the next build cannot revert the editorial change. The substantive edit date
is fixed to this review, not advanced on a timer.

The deployment compiler retains a bounded set of exact static redirects. Pages middleware reads the full
retirement ledger and returns HTTP 301 for every retired path, its slashless
alias and clean insight URL, preserving query parameters. This avoids unsupported
mid-segment splats and the static redirect limit. No paid service, model call or provider-repository edit.

Rebuild: `npm run build`. Final authority: `npm run guardrails:all`.
Behaviour proof: `node scripts/tests/test_search_rescue.js` (also CI shard 1).
No existing validator or behaviour test was removed or weakened.

The interrupted proposal kept 186 pages, including indexed-only template pages.
Review reduced this to 68: 22 have recorded impressions, 31 are distinct sourced
comparisons/regional guides, and 15 support navigation, identity or tools.
No indexing-only placeholder survives. Historical retirement records remain;
2,082 routes are newly consolidated. The full ledger also preserves older aliases.
Middleware uses the existing Pages Functions deployment; no external service,
model or paid feature is introduced. Public assets exclude functions and config.

The empty Medium and question archives consolidate to /insights/. The remaining
archives list survivors from reviewed admission. JSON-LD navigation follows the
same final targets as visible links. Existing anti-truncation guards keep their
historical floors and additionally require every admitted file and an exact 301
for each counted retirement; editorial intake coverage is checked per route.
The existing shrink contract records removal of redundant answer/FAQ scaffolding
and the old bulk directory listings. Frozen retired evidence stays archived.
