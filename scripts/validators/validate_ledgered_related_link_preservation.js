#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * A delivered internal link the generator can no longer reproduce.
 *
 * WHAT HAPPENED. /uscis-medical/ was delivering "what are the requirements for the
 * I-693 medical exam" from its related-questions list, and nine landed
 * recommendations across the 2026-07-24, 2026-07-31 and 2026-08-07 runs depended on
 * that text being on the page. The list is ranked by similarity and capped at six.
 * As newer sibling pages were published they outranked that item, it fell out of the
 * ten-candidate pool entirely, and every rebuild came back without it.
 *
 * acceptMutationScope() caught the loss and refused the mutation - correctly - but a
 * refusal repeats. The generator produced the same thinner page on every release, so
 * the repair could never be proven, the trace reported repair_not_proven, and
 * Velocity Content Release failed on it day after day. A guard that refuses forever
 * is a guard that has stopped being a guard; the generator has to be able to
 * reproduce what the page already ships.
 *
 * WHAT THIS CHECKS. scripts/build_site.js records, per route and BEFORE the frozen
 * restore puts accepted bytes back, the ledgered markers the accepted copy delivers
 * from its related-questions list and whether the list it just rendered still carries
 * them. This validator fails if any is missing.
 *
 * It does not trust that artifact to be complete. The expected route set is
 * recomputed here from data/report_fixes/agent_fix_ledger.json and the frozen page
 * registry, so a build that stops examining a route - or an artifact left behind by
 * an older build - fails as loudly as a marker that actually went missing. An
 * examination of zero routes is a FAIL, never a pass on an empty loop.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT_REL = 'artifacts/validation/ledgered-related-link-preservation.json';
const EVIDENCE_REL = 'artifacts/validation/ledgered-related-link-preservation-result.json';
const { normalizeRoute, implementationPathToRoute, acceptedHtmlForRoute, loadRegistry } = require('../lib/frozen_pages');
const { ledgerMarkersByRoute, shows } = require('../lib/route_marker_preservation');

const RELATED_LIST_RE = /<section[^>]*class="[^"]*related-links[^"]*"[^>]*>[\s\S]*?<\/section>/i;

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
function writeJson(rel, value) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Routes whose ACCEPTED copy delivers a ledgered marker from its related list. */
function expectedRoutes() {
  const markersByRoute = ledgerMarkersByRoute({ normalizeRoute, implementationPathToRoute });
  const registry = loadRegistry();
  const expected = new Map();
  for (const [route, rows] of markersByRoute) {
    const accepted = acceptedHtmlForRoute(route, registry);
    if (!accepted) continue;
    const block = (accepted.match(RELATED_LIST_RE) || [''])[0];
    if (!block) continue;
    const delivered = [...new Set(rows.map((row) => row.marker))].filter((marker) => shows(block, block, marker)).sort();
    if (delivered.length) expected.set(route, delivered);
  }
  return expected;
}

const audit = readJson(AUDIT_REL, null);
const errors = [];

if (!audit) {
  errors.push(`missing_build_evidence:${AUDIT_REL} - run \`npm run build\` before this validator`);
}

const expected = expectedRoutes();
const examinedByRoute = new Map(((audit && audit.routes) || []).map((row) => [normalizeRoute(row.route), row]));

for (const [route, delivered] of expected) {
  const row = examinedByRoute.get(route);
  if (!row) { errors.push(`${route}:not_examined_by_build - the accepted page delivers ${delivered.length} ledgered marker(s) from its related list and the build recorded none`); continue; }
  for (const marker of delivered) {
    if (!(row.delivered_markers || []).includes(marker)) errors.push(`${route}:marker_not_examined:${marker}`);
  }
  for (const marker of row.missing_from_rebuilt_list || []) {
    errors.push(`${route}:regenerated_list_lost_delivered_marker:${marker}`);
  }
}
for (const [route, row] of examinedByRoute) {
  for (const marker of row.missing_from_rebuilt_list || []) {
    if (!expected.has(route)) errors.push(`${route}:regenerated_list_lost_delivered_marker:${marker}`);
  }
}

// Zero examined routes is a FAIL. Every marker this guard protects is one a landed
// recommendation depends on; if the sweep finds none, the inputs are wrong (an empty
// or unreadable ledger, an unseeded frozen registry) and a green PASS here would say
// "nothing can be lost" when what is true is "nothing was looked at".
if (!errors.length && expected.size === 0) {
  errors.push('examined_zero_routes - no accepted page was found delivering a ledgered marker from its related list; with 366 ledger routes on disk that means the ledger or the frozen registry was not readable, not that there is nothing to protect');
}

const report = {
  schema_version: '1.0',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: (audit && audit.generated_at) || new Date().toISOString().slice(0, 10),
  build_evidence: AUDIT_REL,
  expected_route_count: expected.size,
  examined_route_count: examinedByRoute.size,
  routes: [...expected].map(([route, delivered]) => ({ route, delivered_markers: delivered, examined: examinedByRoute.has(route) })),
  errors
};
writeJson(EVIDENCE_REL, report);

if (errors.length) {
  console.error('LEDGERED RELATED LINK PRESERVATION FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
const markerCount = [...expected.values()].reduce((n, list) => n + list.length, 0);
console.log(`LEDGERED RELATED LINK PRESERVATION PASS: ${expected.size} route(s) delivering ${markerCount} ledgered marker(s) from their related-questions list; every one reproduced by this build's generator.`);
