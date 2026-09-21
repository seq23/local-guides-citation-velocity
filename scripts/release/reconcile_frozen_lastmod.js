#!/usr/bin/env node
'use strict';
/**
 * Bring every frozen route's sitemap date up to what the page itself declares.
 *
 * WHY THIS EXISTS. From the first freeze until 2026-09-21, accepted_lastmod in
 * data/release/frozen_page_registry.json was copied from the admission registry
 * on every refreeze, and the admission registry copies it back from the sitemap
 * the freeze had just written. Nothing in that loop could ever move the date, so
 * 1,918 of 2,118 accepted routes advertised a <lastmod> older than the
 * "Last reviewed" stamp and JSON-LD dateModified printed on the page - most of
 * them 2026-06-19 against an on-page 2026-08-26. The cadence gate reads the
 * sitemap, and 91 days after the admission date it declared 54% of the library
 * stale and turned Validate Repo red on every push. scripts/lib/frozen_pages.js
 * now decides the date correctly at freeze time; this script repairs the records
 * that were frozen under the old rule.
 *
 * WHAT IT DOES. For each FROZEN record: read the ACCEPTED bytes from the frozen
 * cache (not the working tree, so a drifted file cannot leak a date in), take
 * the dates the page declares, and set accepted_lastmod to the newest of
 * {current accepted_lastmod, declared dates}. The bytes are not touched and the
 * hash is unchanged, so no freeze date is introduced: this is the unchanged-bytes
 * branch of acceptedLastmodFor(), applied retroactively. A record whose date is
 * already current is left byte-for-byte alone. Idempotent; safe to re-run.
 *
 * WHAT IT REFUSES. A record whose accepted bytes are missing from the cache is
 * reported and skipped, never guessed. It exits non-zero with nothing written if
 * the registry holds no FROZEN records at all, because "reconciled 0 routes" is
 * not a result.
 *
 * Usage: node scripts/release/reconcile_frozen_lastmod.js [--dry-run]
 */
const path = require('path');
const { loadRegistry, saveRegistry, acceptedHtmlForRoute, declaredDatesInHtml, acceptedLastmodFor, REGISTRY_REL } = require('../lib/frozen_pages');

const DRY = process.argv.includes('--dry-run');
const registry = loadRegistry();
const frozen = (registry.pages || []).filter((p) => p.state === 'FROZEN');
if (!frozen.length) {
  console.error(`RECONCILE FROZEN LASTMOD FAIL: ${REGISTRY_REL} holds no FROZEN records, so there is nothing this could have reconciled`);
  process.exit(1);
}

const changed = [];
const unreadable = [];
const byOldNew = {};
for (const record of frozen) {
  const html = acceptedHtmlForRoute(record.route, registry);
  if (html === null) { unreadable.push(record.route); continue; }
  const next = acceptedLastmodFor({
    previousLastmod: record.accepted_lastmod,
    previousHash: record.accepted_html_sha256,
    nextHash: record.accepted_html_sha256,
    declaredDates: declaredDatesInHtml(html)
  });
  if (next && next !== record.accepted_lastmod) {
    const key = `${record.accepted_lastmod || '(none)'} -> ${next}`;
    byOldNew[key] = (byOldNew[key] || 0) + 1;
    changed.push({ route: record.route, from: record.accepted_lastmod, to: next });
    if (!DRY) record.accepted_lastmod = next;
  }
}

if (!DRY && changed.length) saveRegistry(registry);

console.log(`RECONCILE FROZEN LASTMOD ${DRY ? 'DRY-RUN' : 'DONE'}: ${frozen.length} frozen route(s) examined; ${changed.length} advanced to the date the page declares; ${frozen.length - changed.length - unreadable.length} already current; ${unreadable.length} unreadable`);
for (const [k, n] of Object.entries(byOldNew).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
for (const r of unreadable.slice(0, 20)) console.log(`  UNREADABLE (accepted bytes missing from cache): ${r}`);
if (unreadable.length) process.exit(1);
