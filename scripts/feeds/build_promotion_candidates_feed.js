#!/usr/bin/env node
'use strict';
/**
 * Publish the machine-readable candidate feed that local-guides-generator reads.
 *
 * Why this exists, and why it is NOT the old promotion_candidates.json
 * -------------------------------------------------------------------
 * The generator used to consume content/_shared/promotion_candidates.json. That
 * file's payload was frozen at 2026-04-13 and its last commit was 2026-04-26,
 * because BOTH scripts that wrote it were retired and are now forbidden surfaces
 * asserted by validate_velocity_only_overhaul.js and
 * validate_citation_velocity_master_plan.js. It had no writer at all. Serving it
 * over HTTP would have returned 200 with four-and-a-half-month-old data forever -
 * the exact "feed that stops updating while still returning 200" defect this
 * repo has spent the day removing. A cross-repo PAT would have had the identical
 * problem: the transport was never the blocker, the missing producer was.
 *
 * data/queries/measured_demand_candidates.json IS the live successor. It is
 * rebuilt and committed every day by .github/workflows/query-evidence-refresh.yml
 * (scripts/queries/join_atlas_to_release_queue.mjs), which is the one workflow
 * allowed to commit on a timer. Publishing a projection of THAT file gives the
 * generator a feed that cannot go stale without the lane that feeds it going
 * red, and needs no credential: this repo already serves its own root publicly,
 * so an HTTPS GET is enough.
 *
 * Honesty over emptiness
 * ----------------------
 * The feed is frequently EMPTY, and that is currently correct: citation
 * occupancy is a named stop (the control pair does not separate), so the join
 * admits no candidate. An empty feed with no explanation is indistinguishable
 * from a broken one, so the stop reason travels WITH the feed. A consumer can
 * tell "nothing qualified today, here is why" apart from "the producer died".
 *
 * Whitelist
 * ---------
 * Only the fields a consumer needs are published. This is a public URL, so the
 * projection is explicit rather than a spread of whatever the source happens to
 * carry - a new internal scoring field must never reach the public feed just by
 * being added upstream.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SOURCE = 'data/queries/measured_demand_candidates.json';
const OUT = 'feeds/promotion-candidates.json';

// The published surface. Adding to this list is a deliberate act.
//
// These names are taken from what scripts/queries/join_atlas_to_release_queue.mjs
// ACTUALLY emits (verified against the 5 real candidates in commit 93315682a),
// not from the shape of the retired promotion_candidates.json. The first draft of
// this whitelist was written from the old fossil and named `cluster`,
// `canonical_domain`, `canonical_target_url`, `route` and `page_family` - none of
// which exist on a real row - while OMITTING `status`, `source` and
// `target_route`, which the consumer requires. It would have published rows
// carrying four fields and no route, and the generator would have dropped every
// one of them while both sides reported success. That is the same silent no-op
// this seam died of the first time.
const PUBLIC_FIELDS = ['id', 'status', 'source', 'vertical', 'query', 'normalized_query', 'target_route', 'operation', 'route_family', 'admission_basis', 'evidence_tier'];

// Fields without which a candidate is useless to the consumer. Publishing a row
// missing one of these is worse than publishing nothing, because it looks like a
// working feed. Deliberately EXCLUDED as internal scoring: rank_score,
// rank_band, citation_occupancy, winnability_basis, source_records,
// source_signal_ids, source_run_id, status_reason, route_reason, route_authority,
// renderedPath, llm_bait_phrase, citation_velocity.
const REQUIRED_FIELDS = ['id', 'status', 'source', 'vertical', 'query', 'target_route'];

function build() {
  const abs = path.join(ROOT, SOURCE);
  if (!fs.existsSync(abs)) {
    throw new Error(`promotion candidates feed: ${SOURCE} is missing. The feed is a projection of a live file; refusing to publish a feed with no source behind it.`);
  }
  const src = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const candidates = Array.isArray(src.candidates) ? src.candidates : [];

  const missingRequired = [];
  const projected = candidates.map((c) => {
    const row = {};
    for (const f of PUBLIC_FIELDS) if (c[f] !== undefined && c[f] !== null) row[f] = c[f];
    const absent = REQUIRED_FIELDS.filter((f) => row[f] === undefined);
    if (absent.length) missingRequired.push(`${c.id || c.query || '(unidentified row)'}: ${absent.join(', ')}`);
    return row;
  });
  if (missingRequired.length) {
    throw new Error(
      `promotion candidates feed: ${missingRequired.length} candidate row(s) are missing required consumer field(s). ` +
      'The upstream row shape has changed and this projection no longer carries what the consumer needs; publishing them would be a feed that looks alive and delivers nothing. ' +
      `First: ${missingRequired.slice(0, 3).join(' | ')}`
    );
  }

  const feed = {
    contract_version: '1.0',
    source_repo: 'seq23/local-guides-citation-velocity',
    generated_at: src.generated_at || null,
    source_file: SOURCE,
    candidate_count: projected.length,
    // An empty feed is a statement, not a silence.
    status: projected.length ? 'CANDIDATES_AVAILABLE' : 'NO_CANDIDATES',
    stop_reason: projected.length ? null : (src.stop_reason || 'unstated'),
    published_fields: PUBLIC_FIELDS,
    required_fields: REQUIRED_FIELDS,
    note: 'Machine-readable feed. Projection of a file rebuilt daily by query-evidence-refresh.yml; if generated_at stops advancing, the producing lane has stopped and this feed must not be trusted as current. Not a page: excluded from the sitemap and disallowed in robots.txt.',
    candidates: projected
  };

  const outAbs = path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(feed, null, 2) + '\n');
  return feed;
}

module.exports = { build, PUBLIC_FIELDS, REQUIRED_FIELDS, SOURCE, OUT };

if (require.main === module) {
  const feed = build();
  console.log(`promotion candidates feed: ${OUT} <- ${SOURCE}; ${feed.candidate_count} candidate(s), status ${feed.status}${feed.stop_reason ? ` (${String(feed.stop_reason).slice(0, 120)}...)` : ''}`);
}
