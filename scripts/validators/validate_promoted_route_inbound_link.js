#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A release that publishes a page must publish a link to it, in the same release.
 *
 * internal-link-inbound-coverage already fails on any published page nothing served
 * links to. That guard is correct and it is not enough on its own, because it says
 * nothing about WHEN the gap is allowed to exist. On 2026-09-11 a release promoted 32
 * staged routes, 7 of them landed with no inbound link, and the lane reported PASS at
 * every stage; the orphans surfaced in Validate two runs later, as a property of the
 * whole site rather than as a fault of the release that created them.
 *
 * The cause was ordering, not a missing mechanism. npm run link:queue-orphan-hosts is
 * stage 19 of release:velocity-intake and promotion is stage 20, inside
 * finalize_content_release.js. The adoption pass therefore measured the served link
 * graph before the routes it was meant to adopt existed, and by then
 * beginMutationScope had already fixed the mutable set, so no host could have been
 * thawed to carry the link in any case. The pass could only ever work one release
 * behind, and a lane that publishes daily mints a fresh set of orphans every time.
 *
 * This validator holds both halves of the repair:
 *
 *   PART A - THE LANE IS WIRED SO THE GAP CANNOT OPEN.
 *     finalize_content_release.js must run the adoption pass after promotion and
 *     before the freeze, thaw its hosts into the scope it already holds, and run this
 *     check after restoreFrozenPages. Asserted against the file, in order, because a
 *     step that exists but runs at the wrong point is precisely the defect: the
 *     mechanism was present and correct the whole time and still produced 7 orphans.
 *
 *   PART B - THE PAGES THAT ONLY HAVE A LINK BECAUSE THIS LANE PLACED ONE STILL HAVE IT.
 *     The subject is the union of two durable records:
 *       - artifacts/validation/staged-content-promotion.json - what the last release
 *         promoted. Live, but not durable: promotion is idempotent, so the next run
 *         promotes nothing and rewrites this to an empty list.
 *       - data/release/orphan_adoption_assignments.json - every orphan this lane has
 *         ever placed onto a host. That IS durable, and it is the exact population at
 *         risk: each of those pages has an inbound link only because the lane wrote
 *         one, so each is one rebuild, re-freeze or redirect away from being an orphan
 *         again. It is also what makes this a ratchet rather than a snapshot.
 *     Every route in that union that is published - rendered, indexable, not a source
 *     line in _redirects - must have at least one inbound link from a page a crawler is
 *     actually served. Reachability is measured with scripts/lib/link_reachability.js,
 *     the same authority the producer and internal-link-inbound-coverage use, so none
 *     of the three can drift into keeping its own definition of "linked".
 *
 * Rule 0: this exits non-zero if it examined nothing. Part A is non-empty by
 * construction - a fixed list of ordering assertions - so a run that examined zero
 * assertions means the file could not be read and the wiring is UNKNOWN, not proven.
 * Part B fails on an empty subject too: no promotion and no recorded adoption means
 * the lane's link placement has never been observed doing anything, which is UNKNOWN
 * rather than clean.
 */

const fs = require('fs');
const path = require('path');
const { buildLinkGraph, normalizeRoute } = require('../lib/link_reachability');

const ROOT = path.resolve(__dirname, '../..');
const FINALIZER_REL = 'scripts/release/finalize_content_release.js';
const PROMOTION_REL = 'artifacts/validation/staged-content-promotion.json';
const ASSIGNMENTS_REL = 'data/release/orphan_adoption_assignments.json';
const QUARANTINE_REL = 'data/content/offtopic_route_quarantine.json';
const OUT_REL = 'artifacts/validation/promoted-route-inbound-link.json';

// Ordered. Each entry must appear in the finalizer AFTER the one before it.
const REQUIRED_ORDER = [
  {
    step: 'promote_staged_content',
    fragment: 'promote_staged_content.js',
    why: 'the promotion that makes a staged route live is what creates the page needing a link',
  },
  {
    step: 'rebuild_so_promoted_routes_are_in_the_sitemap',
    fragment: 'npm run build',
    why: 'the adoption pass reads sitemaps/, so a promoted route is invisible to it until a build has written it there',
  },
  {
    step: 'orphan_adoption_pass_in_release',
    fragment: 'queue_orphan_adoption_hosts.js --in-release',
    why: 'the pass has to run after promotion, not at stage 19 of release:velocity-intake where it measured the graph before the new routes existed',
  },
  {
    step: 'thaw_adoption_hosts_into_the_open_scope',
    fragment: 'extendMutationScope(',
    why: 'a host that is FROZEN and outside the mutable set renders the anchor and is then overwritten back to its accepted bytes by the same build, so placing the link without thawing the host places nothing',
  },
  {
    step: 'freeze_new_and_accept',
    fragment: 'acceptMutationScope()',
    why: 'the links must be written before the release freezes its output, or they are not in the accepted bytes',
  },
  {
    step: 'restore_frozen_pages',
    fragment: 'restoreFrozenPages();',
    why: 'a rejected host has its accepted bytes restored, which removes the anchor again',
  },
  {
    step: 'verify_promoted_routes_are_linked',
    fragment: 'validate_promoted_route_inbound_link.js',
    why: 'the check has to read the tree as finally served, after acceptance and restoration have had their say',
  },
];

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

function checkOrder(text) {
  const errors = [];
  const positions = [];
  let cursor = -1;
  for (const required of REQUIRED_ORDER) {
    const at = required.last ? text.lastIndexOf(required.fragment) : text.indexOf(required.fragment, cursor + 1);
    if (at < 0) {
      errors.push({
        step: required.step,
        error: 'step_absent',
        fragment: required.fragment,
        detail: `${FINALIZER_REL} does not contain ${required.fragment}. ${required.why}.`,
      });
      continue;
    }
    if (at < cursor) {
      errors.push({
        step: required.step,
        error: 'step_out_of_order',
        fragment: required.fragment,
        detail: `${required.fragment} appears before the step that must precede it. ${required.why}.`,
      });
      continue;
    }
    positions.push({ step: required.step, at });
    cursor = at;
  }
  return { errors, positions };
}

function main() {
  const finalizerAbs = path.join(ROOT, FINALIZER_REL);
  if (!fs.existsSync(finalizerAbs)) {
    console.error(`PROMOTED ROUTE INBOUND LINK FAIL: ${FINALIZER_REL} is missing, so the release lane's link-placement wiring is UNKNOWN rather than proven. Refusing to pass on an unreadable file.`);
    process.exit(1);
  }
  const finalizer = fs.readFileSync(finalizerAbs, 'utf8');
  const { errors: orderErrors, positions } = checkOrder(finalizer);

  if (positions.length + orderErrors.length === 0) {
    console.error('PROMOTED ROUTE INBOUND LINK FAIL: zero ordering assertions were examined. This validator cannot pass on an empty loop.');
    process.exit(1);
  }

  // PART B.
  const promotion = readJson(PROMOTION_REL, null);
  const graph = buildLinkGraph(ROOT);
  if (graph.sitemapRoutes.size === 0) {
    console.error('PROMOTED ROUTE INBOUND LINK FAIL: sitemaps/ named zero routes, so inbound coverage for the promoted set is UNKNOWN, not proven.');
    process.exit(1);
  }

  const quarantined = new Set();
  for (const item of (readJson(QUARANTINE_REL, { items: [] }).items || [])) {
    if (item && item.route) quarantined.add(item.route);
  }

  const publishedSet = new Set(graph.published);
  const promotedRoutes = promotion
    ? [...new Set((promotion.promoted_routes || []).map(normalizeRoute).filter(Boolean))].sort()
    : [];
  const adoptedRoutes = [...new Set(((readJson(ASSIGNMENTS_REL, { assignments: [] }).assignments) || [])
    .filter((a) => a && a.orphan && a.host)
    .map((a) => normalizeRoute(a.orphan))
    .filter(Boolean))].sort();
  const subject = [...new Set([...promotedRoutes, ...adoptedRoutes])].sort();

  if (subject.length === 0) {
    console.error('PROMOTED ROUTE INBOUND LINK FAIL: the last release promoted nothing AND no orphan adoption has ever been recorded, so this validator has no route to examine. Whether the lane places inbound links for the pages it publishes is UNKNOWN, not proven. Refusing to pass on an empty subject.');
    process.exit(1);
  }

  const unlinked = [];
  const examined = [];
  const notPublished = [];
  for (const route of subject) {
    if (quarantined.has(route)) continue;
    if (!publishedSet.has(route)) { notPublished.push(route); continue; }
    examined.push(route);
    const live = graph.inboundLive.get(route) || new Set();
    if (live.size > 0) continue;
    unlinked.push({
      route,
      dead_inbound: [...(graph.inboundDead.get(route) || new Set())].sort(),
    });
  }

  const promotionMissing = promotion === null;
  if (promotionMissing) {
    orderErrors.push({
      step: 'promotion_evidence',
      error: 'promotion_artifact_missing',
      fragment: PROMOTION_REL,
      detail: `${PROMOTION_REL} is absent, so which routes the last release promoted is UNKNOWN. Inbound coverage for them cannot be proven.`,
    });
  }

  const status = (orderErrors.length || unlinked.length) ? 'FAIL' : 'PASS';
  const report = {
    schema_version: '1.0',
    validator: 'promoted-route-inbound-link',
    status,
    finalizer_checked: FINALIZER_REL,
    ordering_assertions_examined: REQUIRED_ORDER.length,
    ordering_errors: orderErrors,
    promotion_artifact: PROMOTION_REL,
    adoption_assignments: ASSIGNMENTS_REL,
    promoted_route_count: promotedRoutes.length,
    adopted_route_count: adoptedRoutes.length,
    subject_route_count: subject.length,
    promoted_routes_examined: examined.length,
    promoted_routes_not_published: notPublished,
    published_pages_in_graph: graph.published.length,
    unlinked_promoted_routes: unlinked,
    subject_note: `Part B examined the ${examined.length} published route(s) of a ${subject.length}-route subject: ${promotedRoutes.length} promoted by the last release and ${adoptedRoutes.length} whose only inbound link was placed by the orphan-adoption pass.`,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const item of orderErrors) {
    console.error(`PROMOTED ROUTE INBOUND LINK FAIL [${item.error}] ${item.step}: ${item.detail}`);
  }
  for (const item of unlinked) {
    console.error(`PROMOTED ROUTE INBOUND LINK FAIL: ${item.route} is published and indexable and no served page links to it. The lane either promoted it without placing a link, or placed one that no longer survives.${item.dead_inbound.length ? ` Linked only from ${item.dead_inbound.length} route(s) that do not serve: ${item.dead_inbound.slice(0, 3).join(', ')}.` : ''}`);
  }
  if (status === 'FAIL') {
    console.error(`Report: ${OUT_REL}`);
    process.exit(1);
  }
  console.log(`PROMOTED ROUTE INBOUND LINK PASS: ${REQUIRED_ORDER.length} ordering assertion(s) held and ${examined.length} promoted published route(s) each have an inbound link from a served page (of ${graph.published.length} published pages).`);
}

main();
