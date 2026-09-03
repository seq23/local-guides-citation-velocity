#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A published page that nothing links to cannot pass authority to anything.
 *
 * theindustryguides.com is the velocity feeder: it earns the citation and routes to
 * the generated packs. A page in the feeder with no inbound internal link is a page
 * that can never carry that citation onward, and it is invisible to every existing
 * check here:
 *
 *   - admission-reachability asks whether a released page is in the sitemap.
 *     All 18 orphans were.
 *   - rendered-internal-hrefs asks whether the hrefs on a page resolve.
 *     Every href on every host page resolved.
 *   - buildLinkCoveragePlan reports how many orphans it ADOPTED. It reported 125
 *     placements while 18 pages had zero inbound links, because a placement is an
 *     intention and the plan never checked whether the host could deliver.
 *
 * This validator asks the only question that settles it: for each published page,
 * does any page a crawler is actually served carry a link to it? A source counts
 * only when it is rendered, indexable, and not a source line in _redirects - the
 * third condition is what the whole defect turned on, since 15 of the 18 orphans
 * were linked exclusively from routes that answer 301.
 *
 * Rule 0: examining zero published pages is a FAILURE, not a pass on an empty loop.
 * If the sitemap cannot be read, or nothing it names is rendered, inbound coverage
 * is UNKNOWN and this exits non-zero saying so.
 *
 * A baseline of accepted orphans is supported so the gate can be introduced without
 * a flag day, but it is a ratchet: a route in the baseline that is no longer an
 * orphan is reported as stale and must be removed, and a route NOT in the baseline
 * is a hard failure. The baseline can only shrink.
 */

const fs = require('fs');
const path = require('path');
const { buildLinkGraph, findOrphans } = require('../lib/link_reachability');

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_REL = 'data/content/internal_link_inbound_baseline.json';
const OUT_REL = 'artifacts/validation/internal-link-inbound-coverage.json';

// Some routes are unreachable on purpose. retire_offtopic_routes.js quarantines
// pages whose subject does not belong to the vertical they were filed under, and
// spending internal authority on those is exactly what the quarantine is for
// preventing. Being orphaned is the correct outcome for them.
const QUARANTINE_REL = 'data/content/offtopic_route_quarantine.json';

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

function main() {
  const graph = buildLinkGraph(ROOT);

  if (graph.sitemapRoutes.size === 0) {
    console.error('INTERNAL LINK INBOUND COVERAGE FAIL: sitemaps/ named zero routes, so this validator examined zero published pages. Inbound coverage is UNKNOWN, not proven.');
    process.exit(1);
  }
  if (graph.published.length === 0) {
    console.error(`INTERNAL LINK INBOUND COVERAGE FAIL: ${graph.sitemapRoutes.size} sitemap route(s) resolved to zero rendered, indexable, non-redirected pages. This validator examined zero published pages; inbound coverage is UNKNOWN, not proven.`);
    process.exit(1);
  }

  const quarantined = new Set();
  for (const item of (readJson(QUARANTINE_REL, { items: [] }).items || [])) {
    if (item && item.route) quarantined.add(item.route);
  }

  const orphans = findOrphans(graph).filter((o) => !quarantined.has(o.route));
  const baseline = readJson(BASELINE_REL, { accepted_orphans: [] });
  const accepted = new Set(baseline.accepted_orphans || []);

  const orphanRoutes = new Set(orphans.map((o) => o.route));
  const newOrphans = orphans.filter((o) => !accepted.has(o.route));
  const staleBaseline = [...accepted].filter((route) => !orphanRoutes.has(route)).sort();

  const report = {
    schema_version: '1.0',
    validator: 'internal-link-inbound-coverage',
    status: newOrphans.length || staleBaseline.length ? 'FAIL' : 'PASS',
    sitemap_routes: graph.sitemapRoutes.size,
    rendered_pages: graph.rendered.size,
    redirect_sources: graph.redirected.size,
    published_pages_examined: graph.published.length,
    quarantined_routes: quarantined.size,
    orphan_count: orphans.length,
    accepted_baseline_count: accepted.size,
    new_orphans: newOrphans,
    stale_baseline: staleBaseline,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (staleBaseline.length) {
    console.error(`INTERNAL LINK INBOUND COVERAGE FAIL: ${staleBaseline.length} route(s) in ${BASELINE_REL} now have inbound links and must be removed from the baseline. The baseline is a ratchet; leaving a repaired route in it would let the same page silently regress. Stale: ${staleBaseline.join(', ')}`);
  }
  for (const orphan of newOrphans) {
    const dead = orphan.dead_inbound.length
      ? ` Only non-served pages link to it (${orphan.dead_inbound.length}); first: ${orphan.dead_inbound[0]} - that route answers a redirect or is not indexable, so a crawler never reads the link it carries.`
      : ' No page links to it at all.';
    console.error(`INTERNAL LINK INBOUND COVERAGE FAIL: ${orphan.route} is published and indexable but no served page links to it.${dead}`);
  }

  if (report.status === 'FAIL') {
    console.error(`INTERNAL LINK INBOUND COVERAGE: FAIL - examined ${graph.published.length} published page(s); ${newOrphans.length} unaccounted orphan(s), ${staleBaseline.length} stale baseline entr(y/ies). Report: ${OUT_REL}`);
    process.exit(1);
  }
  console.log(`INTERNAL LINK INBOUND COVERAGE PASS: examined ${graph.published.length} published page(s) against ${graph.rendered.size} rendered page(s); ${graph.redirected.size} redirect source(s) excluded as link sources; ${orphans.length} orphan(s), all in the accepted baseline.`);
}

main();
