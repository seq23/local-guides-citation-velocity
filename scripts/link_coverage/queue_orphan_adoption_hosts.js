#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Name the pages a release has to thaw so an orphan can actually be adopted.
 *
 * buildLinkCoveragePlan now refuses to place an orphan on a host that cannot deliver
 * the link - a route that answers 301, or a FROZEN route outside the active mutation
 * scope. That is correct and, on its own, inert: every one of the 2,067 published
 * routes is FROZEN, so with nothing thawed the plan has no eligible host at all and
 * places nobody. Refusing to write a link that would be discarded is not the same as
 * getting the link written.
 *
 * This script is the half that makes the refusal productive. It measures the SERVED
 * link graph - the same scripts/lib/link_reachability.js the validator uses, so the
 * producer and the guard cannot disagree about what "reachable" means - finds the
 * published pages nothing served links to, picks the most similar host that is
 * itself served, and queues host and orphan into data/release/pending_mutation_routes.json.
 *
 * scripts/release/finalize_content_release.js consumes that queue, thaws those exact
 * routes, rebuilds (the plan then finds them eligible and writes the anchors), and
 * refreezes with the link in the accepted bytes.
 *
 * Rule 0: this exits non-zero if it examined zero published pages. It exits 0 with
 * "nothing to queue" only when the orphan set is genuinely empty, which is a
 * measured result rather than an empty loop.
 */

const fs = require('fs');
const path = require('path');
const { buildLinkGraph, findOrphans, normalizeRoute } = require('../lib/link_reachability');
const { queueMutationRoutes } = require('../lib/frozen_pages');

const ROOT = path.resolve(__dirname, '../..');
const QUARANTINE_REL = 'data/content/offtopic_route_quarantine.json';
const OUT_REL = 'artifacts/validation/orphan-adoption-host-queue.json';
// The assignment has to be durable, not an artifact.
//
// The first run of this pass thawed 33 routes and closed 13 of the 18 orphans. The
// other 5 failed for a reason worth naming: this script ranked hosts on route tokens
// and buildLinkCoveragePlan ranked them on slug + title + description tokens, so the
// build frequently chose a host that was still frozen while the host this script had
// thawed went unused. Two components, each keeping its own list of where a page
// should go, with nothing linking them - the same shape as the defect being fixed.
//
// So the decision is written HERE, once, and the generator reads it as an explicit
// override rather than re-deriving it.
const ASSIGNMENTS_REL = 'data/release/orphan_adoption_assignments.json';
const MAX_ADOPTIONS_PER_HOST = 3;

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length > 2);
}

function verticalOf(route) {
  const parts = String(route || '').split('/').filter(Boolean);
  return parts[0] || '';
}

function main() {
  const apply = process.argv.includes('--apply');
  const graph = buildLinkGraph(ROOT);

  if (graph.published.length === 0) {
    console.error('ORPHAN ADOPTION QUEUE FAIL: zero published pages were examined, so the orphan set is UNKNOWN rather than empty. Refusing to report a clean queue off an empty loop.');
    process.exit(1);
  }

  const quarantined = new Set();
  for (const item of (readJson(QUARANTINE_REL, { items: [] }).items || [])) {
    if (item && item.route) quarantined.add(item.route);
  }

  const orphans = findOrphans(graph).filter((o) => !quarantined.has(o.route));
  if (!orphans.length) {
    console.log(`ORPHAN ADOPTION QUEUE: nothing to queue; all ${graph.published.length} published page(s) already have an inbound link from a served page.`);
    return;
  }

  // Candidate hosts: published, served, in the same vertical, ranked by token overlap.
  // Same vertical because internal authority spent across verticals is authority spent
  // on a subject that page is not trying to rank for.
  const hostTokens = new Map();
  for (const route of graph.published) hostTokens.set(route, new Set(tokenize(route)));

  const load = new Map();
  const assignments = [];
  for (const orphan of orphans) {
    const wanted = new Set(tokenize(orphan.route));
    const vertical = verticalOf(orphan.route);
    const ranked = graph.published
      .filter((route) => route !== orphan.route && verticalOf(route) === vertical)
      .map((route) => {
        let overlap = 0;
        for (const token of hostTokens.get(route)) if (wanted.has(token)) overlap += 1;
        return { route, overlap };
      })
      .filter((candidate) => candidate.overlap > 0)
      .sort((a, b) => (b.overlap - a.overlap) || a.route.localeCompare(b.route));

    let host = ranked.find((candidate) => (load.get(candidate.route) || 0) < MAX_ADOPTIONS_PER_HOST);
    if (!host) host = ranked.sort((a, b) => (load.get(a.route) || 0) - (load.get(b.route) || 0))[0];
    if (!host) {
      assignments.push({ orphan: orphan.route, host: null, reason: 'no_served_same_vertical_candidate' });
      continue;
    }
    load.set(host.route, (load.get(host.route) || 0) + 1);
    assignments.push({ orphan: orphan.route, host: host.route, overlap: host.overlap });
  }

  const placed = assignments.filter((a) => a.host);
  const unplaceable = assignments.filter((a) => !a.host);
  const routes = [...new Set([
    ...placed.map((a) => normalizeRoute(a.host)),
    ...placed.map((a) => normalizeRoute(a.orphan)),
  ])].sort();

  const report = {
    schema_version: '1.0',
    generated_by: 'scripts/link_coverage/queue_orphan_adoption_hosts.js',
    applied: apply,
    published_pages_examined: graph.published.length,
    orphan_count: orphans.length,
    placed_count: placed.length,
    unplaceable_count: unplaceable.length,
    routes_to_thaw: routes,
    assignments,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (unplaceable.length) {
    for (const item of unplaceable) console.error(`ORPHAN ADOPTION QUEUE: no served same-vertical host for ${item.orphan}`);
  }
  if (apply) {
    // Merge rather than replace: an assignment from an earlier release is what is
    // currently holding that page's only inbound link, and dropping it would make
    // the next build re-orphan a page this pass already fixed.
    const existing = readJson(ASSIGNMENTS_REL, { assignments: [] });
    const byOrphan = new Map((existing.assignments || []).map((a) => [a.orphan, a]));
    for (const item of placed) byOrphan.set(item.orphan, { orphan: item.orphan, host: item.host });
    const merged = [...byOrphan.values()].sort((a, b) => a.orphan.localeCompare(b.orphan));
    fs.mkdirSync(path.join(ROOT, path.dirname(ASSIGNMENTS_REL)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, ASSIGNMENTS_REL), `${JSON.stringify({
      schema_version: '1.0',
      authority: 'scripts/link_coverage/queue_orphan_adoption_hosts.js',
      purpose: 'Explicit orphan -> host placements. buildLinkCoveragePlan honours these instead of re-deriving a ranking of its own, so the routes this pass thaws are the routes the build writes to.',
      updated_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
      assignments: merged,
    }, null, 2)}\n`, 'utf8');
    queueMutationRoutes(routes, 'queue_orphan_adoption_hosts');
    console.log(`ORPHAN ADOPTION QUEUE: queued ${routes.length} route(s) for the next governed release (${placed.length} adoption(s) across ${new Set(placed.map((a) => a.host)).size} host(s)). Report: ${OUT_REL}`);
  } else {
    console.log(`ORPHAN ADOPTION QUEUE (dry run): ${placed.length} adoption(s) would need ${routes.length} route(s) thawed. Re-run with --apply to queue them. Report: ${OUT_REL}`);
  }
  if (unplaceable.length) process.exit(1);
}

main();
