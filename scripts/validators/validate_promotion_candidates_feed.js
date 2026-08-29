#!/usr/bin/env node
'use strict';
/**
 * The public candidate feed must be a live projection, not a souvenir.
 *
 * local-guides-generator consumes this feed over plain HTTPS. The last time this
 * repo fed that generator, it did so through content/_shared/promotion_candidates.json,
 * whose payload froze on 2026-04-13 when both of its writers were retired - and
 * nothing noticed for four months, because no validator named the file. The
 * consumer read a stale snapshot and reported success.
 *
 * So the feed is guarded on the things that actually go wrong:
 *   1. it exists, parses, and declares its contract version and source repo;
 *   2. it agrees with the live source it claims to project - same count, same
 *      generated_at - so a hand-edited or half-written feed fails;
 *   3. it carries ONLY whitelisted fields. This is a public URL; an internal
 *      scoring field must not reach it just by being added upstream;
 *   4. an EMPTY feed carries a named stop reason. An empty feed with no
 *      explanation is indistinguishable from a dead producer, and that
 *      ambiguity is the whole defect;
 *   5. it is not advertised as a page - absent from the sitemap, disallowed in
 *      robots.txt.
 *
 * Rule 0: hard-fails if it examines zero fields and zero assertions - which,
 * for a feed that may legitimately hold zero candidates, means the ENVELOPE is
 * always checked even when the candidate list is empty. "Zero candidates" is a
 * valid state; "nothing was checked" is not.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const { PUBLIC_FIELDS, SOURCE, OUT } = require(path.join(ROOT, 'scripts/feeds/build_promotion_candidates_feed.js'));

const errors = [];
let assertionsMade = 0;
const assert = (cond, msg) => { assertionsMade += 1; if (!cond) errors.push(msg); };

const readJson = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { errors.push(`missing ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { errors.push(`unreadable JSON: ${rel} (${e.message})`); return null; }
};

const feed = readJson(OUT);
const src = readJson(SOURCE);

if (feed && src) {
  assert(feed.contract_version === '1.0', `${OUT}: contract_version is ${JSON.stringify(feed.contract_version)}, expected "1.0". The consumer refuses an unsupported contract version.`);
  assert(feed.source_repo === 'seq23/local-guides-citation-velocity', `${OUT}: source_repo is ${JSON.stringify(feed.source_repo)}; the consumer requires a non-empty identifying source_repo.`);
  assert(Array.isArray(feed.candidates), `${OUT}: candidates is not an array.`);

  const srcCandidates = Array.isArray(src.candidates) ? src.candidates : [];
  assert(feed.candidate_count === (feed.candidates || []).length, `${OUT}: candidate_count ${feed.candidate_count} does not match the ${(feed.candidates || []).length} rows actually published.`);
  assert(feed.candidate_count === srcCandidates.length, `${OUT}: publishes ${feed.candidate_count} candidate(s) but ${SOURCE} holds ${srcCandidates.length}. The feed is not a projection of the file it names - it is stale or hand-edited.`);
  assert(feed.generated_at === (src.generated_at || null), `${OUT}: generated_at ${JSON.stringify(feed.generated_at)} does not match the source's ${JSON.stringify(src.generated_at || null)}. A feed that reports a different age than its source cannot be trusted as current.`);
  assert(feed.source_file === SOURCE, `${OUT}: source_file is ${JSON.stringify(feed.source_file)}, expected ${JSON.stringify(SOURCE)}.`);

  // (3) whitelist
  const allowed = new Set(PUBLIC_FIELDS);
  let leaked = 0;
  for (const row of feed.candidates || []) {
    for (const k of Object.keys(row)) if (!allowed.has(k)) { errors.push(`${OUT}: candidate field "${k}" is not on the published whitelist (${PUBLIC_FIELDS.join(', ')}). This is a public URL; fields reach it only by deliberate addition.`); leaked += 1; break; }
  }
  assert(leaked === 0, `${OUT}: ${leaked} candidate row(s) carry non-whitelisted fields.`);

  // (4) an empty feed must say why
  if ((feed.candidates || []).length === 0) {
    assert(feed.status === 'NO_CANDIDATES', `${OUT}: publishes zero candidates but status is ${JSON.stringify(feed.status)}.`);
    assert(typeof feed.stop_reason === 'string' && feed.stop_reason.length > 10 && feed.stop_reason !== 'unstated',
      `${OUT}: publishes zero candidates with no named stop reason. An empty feed that does not say why it is empty is indistinguishable from a dead producer, which is exactly how the previous cross-repo feed went unnoticed for four months.`);
  } else {
    assert(feed.status === 'CANDIDATES_AVAILABLE', `${OUT}: publishes ${feed.candidates.length} candidate(s) but status is ${JSON.stringify(feed.status)}.`);
  }
}

// (5) it is a data feed, not a page
const robots = fs.existsSync(path.join(ROOT, 'robots.txt')) ? fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8') : '';
assert(/Disallow:\s*\/feeds\//.test(robots), 'robots.txt does not Disallow /feeds/. The candidate feed is machine-readable data, not a page, and must not be offered to crawlers as content.');

const sitemapDir = path.join(ROOT, 'sitemaps');
let inSitemap = false;
if (fs.existsSync(sitemapDir)) {
  for (const f of fs.readdirSync(sitemapDir).filter((x) => x.endsWith('.xml'))) {
    if (fs.readFileSync(path.join(sitemapDir, f), 'utf8').includes('/feeds/')) { inSitemap = true; break; }
  }
}
assert(!inSitemap, 'a /feeds/ URL is advertised in a sitemap shard. The feed is data, not a citable page, and must not inflate the published route count.');

// The DEPLOYED copy is the one the generator actually fetches. dist/ is a mirror
// built by scripts/build_pages_dist.js, and the feed writer originally ran AFTER
// that mirror - so dist/ carried the previous build's feed and the public URL was
// permanently one build behind the file it claimed to project. Build order is
// fixed; this asserts it stays fixed, because an ordering bug is invisible from
// the source copy alone.
const DIST_OUT = 'dist/feeds/promotion-candidates.json';
if (feed) {
  const distAbs = path.join(ROOT, DIST_OUT);
  if (!fs.existsSync(distAbs)) {
    assert(false, `${DIST_OUT} is missing. dist/ is the deployed tree; a feed that exists only at the repo root is not published, and the generator's HTTPS GET would 404.`);
  } else {
    let distFeed = null;
    try { distFeed = JSON.parse(fs.readFileSync(distAbs, 'utf8')); } catch (e) { errors.push(`${DIST_OUT} is unreadable JSON (${e.message})`); }
    if (distFeed) {
      assert(distFeed.generated_at === feed.generated_at && distFeed.candidate_count === feed.candidate_count,
        `${DIST_OUT} does not match ${OUT} (deployed generated_at ${JSON.stringify(distFeed.generated_at)}/${distFeed.candidate_count} candidate(s) vs source ${JSON.stringify(feed.generated_at)}/${feed.candidate_count}). The deployed feed is stale relative to the tree that produced it - check that the feed is written BEFORE build_pages_dist.js mirrors it.`);
    }
  }
}

// ------------------------------------------------------------------- Rule 0
if (assertionsMade === 0) {
  errors.push('made zero assertions - refusing to pass having checked nothing. Zero CANDIDATES is a valid state; zero CHECKS is not.');
}

const report = {
  schema_version: '1.0',
  validator: 'promotion-candidates-feed',
  status: errors.length ? 'FAIL' : 'PASS',
  assertions_made: assertionsMade,
  candidate_count: feed ? feed.candidate_count : null,
  feed_status: feed ? feed.status : null,
  errors,
  checked_at: new Date().toISOString()
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/promotion-candidates-feed.json'), JSON.stringify(report, null, 2) + '\n');

if (errors.length) {
  console.error('PROMOTION CANDIDATES FEED FAIL:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`PROMOTION CANDIDATES FEED PASS: ${assertionsMade} assertion(s); ${feed.candidate_count} candidate(s) published as ${feed.status}${feed.stop_reason ? ` with a named stop` : ''}; whitelist of ${PUBLIC_FIELDS.length} field(s) enforced; not in any sitemap and disallowed in robots.txt.`);
