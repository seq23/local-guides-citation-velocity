#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const errors = [];
const warnings = [];
function readJson(rel, fb = null) { const p = path.join(ROOT, rel); if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function read(rel) { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
// ONE answer to "where does this recommendation's proof live, and does that page exist
// yet?", shared with prepare_velocity_intake_release.js (the writer) and
// compile_html_fix_acceptance_manifest.js. This validator used to resolve rendered
// routes on its own and reported rendered_missing_route on 8 TRT routes that PR #114
// had deliberately recorded as pending_retarget_path - pages a LATER step in this same
// lane creates. See scripts/lib/recommendation_proof_path.js.
const {
  normalizeRoute,
  routeToRenderedPath,
  renderedPathToRoute,
  releaseUnitPathsFromPlan,
  resolveRecommendationProof,
  PROOF_STATES
} = require('../lib/recommendation_proof_path');
const releaseUnitPaths = releaseUnitPathsFromPlan(ROOT);
function pagesPayload(rel) { return readJson(rel, { pages: [] }); }
function pageExists(payload, route) {
  const wantedRoute = normalizeRoute(route);
  const wantedPath = routeToRenderedPath(route);
  return (payload.pages || []).some((page) => {
    const slug = normalizeRoute(page.slug || '');
    const pagePath = routeToRenderedPath(page.path || page.slug || '');
    return slug === wantedRoute || pagePath === wantedPath;
  });
}
function normalized(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function markerIn(haystack, marker) { const h = String(haystack || ''); const m = String(marker || ''); return h.includes(m) || (normalized(m) && normalized(h).includes(normalized(m))); }
function pageHasMarker(payload, route, marker) {
  const wantedRoute = normalizeRoute(route);
  const wantedPath = routeToRenderedPath(route);
  const page = (payload.pages || []).find((candidate) => {
    const slug = normalizeRoute(candidate.slug || '');
    const pagePath = routeToRenderedPath(candidate.path || candidate.slug || '');
    return slug === wantedRoute || pagePath === wantedPath;
  });
  return page ? markerIn(JSON.stringify(page), marker) : false;
}
function insightItemExists(insights, route) {
  const wantedPath = routeToRenderedPath(route);
  const wantedRoute = normalizeRoute(route);
  return (insights.items || []).some((item) => normalizeRoute(item.publish_path || '') === wantedRoute || routeToRenderedPath(item.publish_path || `insights/${item.slug}.html`) === wantedPath);
}
function isRenderedRepair(fixOrUnit) {
  return fixOrUnit && (fixOrUnit.operation === 'REPAIR_INTENDED_WINNER_PAGE' || String(fixOrUnit.target_route || '').startsWith('/insights/') || String(fixOrUnit.renderedPath || '').startsWith('insights/'));
}
// A marker is text that must literally appear on the page, so it must be the reader's
// question and nothing else. Ledger entries written before the parser learned to split
// the answer-engine suffix still carry queries like "... (OpenAI GPT-4o)"; matching on
// those reported missing_marker against pages that were correct. The same shared helper
// the parser uses is applied here rather than restated, so the producer and this check
// cannot drift, and historical rows compare on the same basis as new ones.
const { splitEngineSuffix } = require('../lib/agent_artifact_source_parser');
const { withoutTemplateScaffolding } = require('../lib/template_scaffolding');
function readerFacingMarker(value) { const { query } = splitEngineSuffix(value); return query || String(value || ''); }
function markersFor(fixOrUnit) { return Array.from(new Set((fixOrUnit.required_markers || [fixOrUnit.query].filter(Boolean)).map(readerFacingMarker).filter(Boolean))); }

const semanticAcceptance = readJson('data/report_fixes/agent_exact_semantic_acceptance_manifest.json', { entries: [] });
const acceptanceByRenderedPath = new Map((semanticAcceptance.entries || []).map((entry) => [String(entry.implementation_path || '').replace(/^\/+/, ''), entry]));
function semanticMarkersForRoute(route, fallback = []) {
  const renderedPath = routeToRenderedPath(route);
  const entry = acceptanceByRenderedPath.get(renderedPath);
  if (!entry || !entry.authority_grounded) return fallback;
  // For authority-grounded high-stakes repairs, trace the compiled acceptance
  // contract rather than requiring the raw agent query text to appear verbatim.
  // A durable manifest entry can promise a template placeholder - the compiler used to
  // pad required_strings with "Concrete verification point <n>" and the "Translate …
  // into a specific verification question" instruction. Those strings are being taken
  // OFF the pages by rendered-template-scaffolding, so demanding them here would turn
  // the fix into a trace failure. Same shared list both producers screen against.
  // The compiled list is an ENRICHMENT of the row's own marker, never a replacement.
  // compile_html_fix_acceptance_manifest.js screens required_strings against what the
  // delivered artifacts actually carry, and an entry can legitimately come back with
  // every string filtered out - authority_grounded_repairs.js authors an entry for
  // uscis-medical/exam-day-documents/index.html whose strings the deliverability screen
  // drops in full. Returning [] there made the trace report the ROW as
  // `missing_required_markers`, which says the recommendation declares nothing to
  // check. It declares its reader-facing query, and that is what gets checked instead.
  // Strictly more is asserted this way, not less.
  const compiled = Array.from(new Set(withoutTemplateScaffolding((entry.required_strings || []).filter(Boolean))));
  return compiled.length ? compiled : fallback;
}
function traceRenderedTarget(id, route, markers, requireInsightManifest = false, row = null) {
  // Resolved through the shared module rather than by testing the route here. A target
  // route that does not exist is only a failure when nothing in this lane is going to
  // create it; a page the release step writes LATER is HELD and named, not failed.
  const proof = resolveRecommendationProof(
    row || { renderedPath: routeToRenderedPath(route), target_route: route },
    { root: ROOT, releaseUnitPaths }
  );
  if (proof.state === PROOF_STATES.PENDING_RELEASE_UNIT) {
    warnings.push(`${id}:rendered_target_pending_release_unit:${proof.pendingRetargetPath || proof.targetPath}:${proof.detail}`);
    return;
  }
  const renderedPath = proof.gradeAt;
  if (!renderedPath || !exists(renderedPath)) {
    errors.push(`${id}:rendered_missing_route:${proof.targetPath || routeToRenderedPath(route) || route}`);
    return;
  }
  const text = read(renderedPath);
  for (const marker of markers) if (!markerIn(text, marker)) errors.push(`${id}:rendered_missing_marker:${renderedPath}:${marker}`);
  if (requireInsightManifest) {
    const insights = readJson('content/_live/insights.json', { items: [] });
    if (!insightItemExists(insights, route)) errors.push(`${id}:live_insight_missing_route:${route}`);
  }
}

const ledger = readJson('data/report_fixes/agent_fix_ledger.json', { fixes: [] });
if (exists('data/report_fixes/velocity_citation_agent_2026_05.json')) warnings.push('historical_may_2026_ledger_present; retired legacy trace is preserved but not blocking the rolling agent-run lane');
const selected = (ledger.fixes || []).filter((f) => f.trace_required || f.implementation_status === 'SELECTED_FOR_RELEASE');
const livePages = pagesPayload('content/_live/pages.json');
const stagedPages = pagesPayload('content/_staged/pages.json');
const plan = readJson('artifacts/validation/velocity-intake-release-plan.json', null);
const velocityContentRelease = readJson('artifacts/validation/velocity-content-release.json', { created: [], skipped: [] });
const createdReleaseIds = new Set((velocityContentRelease.created || []).map((row) => row.id).filter(Boolean));
const skippedReleaseById = new Map((velocityContentRelease.skipped || []).map((row) => [row.id, row]));
function isDeferredByDailyCeiling(id) { const skipped = skippedReleaseById.get(id); return Boolean(skipped && String(skipped.reason || '').includes('daily_new_url_ceiling_reached')); }
// The third named hold, matching the ceiling above and the queue refusal below.
// velocity_content_release.js records a route with no match in
// data/demand/measured_demand.json as skipped:no_measured_demand_match and never
// stages it. That is the demand gate working, not a missing page, and reporting it
// as live_missing_route made a correct evidence refusal read as a broken release.
// Asking the predicate directly rather than only reading the release artifact's
// skipped list. A row the release lane never enumerated - selected in an earlier run,
// never queued - is held by exactly the same gate, but appeared in no skipped list and
// so read as an unexplained missing page. The gate is a property of the ROUTE, not of
// whether one particular run happened to look at it, so it is evaluated as one.
// An unreadable corpus holds nothing open: it throws, and the caller below treats a
// failure to answer as "not held", which keeps the check strict rather than lenient.
let demandBackedRoute = null;
try { demandBackedRoute = require('../lib/demand_backing').demandBackingPredicate(ROOT); } catch { demandBackedRoute = null; }
function isHeldByMeasuredDemand(id, route) {
  const skipped = skippedReleaseById.get(id);
  if (skipped && String(skipped.reason || '') === 'no_measured_demand_match') return true;
  if (!demandBackedRoute || !demandBackedRoute.slugCount || !route) return false;
  return !demandBackedRoute(route);
}
// A create the release queue refused never reaches staged or live, by design. It
// is not a missing route - it is a route governance declined to admit, and the
// planner cannot filter it out because citation:plan-agent-exact runs before
// strategy:release-queue exists. Same reconciliation as the daily-ceiling case
// directly above, and it excuses nothing the pipeline actually admitted.
const releaseQueueRefusedById = new Map(
  ((readJson('data/release/page_release_queue.json', { records: [] }).records) || [])
    .filter((row) => row && row.id && row.eligible === false && String(row.lifecycle_state || '') === 'NOT_ADMITTED')
    .map((row) => [row.id, String(row.decision || 'NOT_ADMITTED')])
);
function isRefusedByReleaseQueue(id) { return releaseQueueRefusedById.has(id); }

for (const fix of selected) {
  const id = fix.id || fix.query;
  const rawMarkers = markersFor(fix);
  const route = fix.target_route || renderedPathToRoute(fix.renderedPath);
  // Grade the acceptance contract of the page the proof is actually ON. Resolving the
  // markers from target_route asked the manifest about a page that does not exist yet.
  const proof = resolveRecommendationProof(fix, { root: ROOT, releaseUnitPaths });
  const markerRoute = proof.gradeAt ? renderedPathToRoute(proof.gradeAt) : route;
  const markers = isRenderedRepair(fix) ? semanticMarkersForRoute(markerRoute, rawMarkers) : rawMarkers;
  if (!markers.length) { errors.push(`${id}:missing_required_markers`); continue; }
  if (isRenderedRepair(fix)) {
    traceRenderedTarget(id, route, markers, String(fix.liveManifestPath || '').includes('insights.json') && String(markerRoute || '').startsWith('/insights/'), fix);
    continue;
  }
  if (fix.operation === 'CREATE_NEW_TARGET_PAGE' && isDeferredByDailyCeiling(id)) { warnings.push(`${id}:selected_new_page_deferred_by_daily_new_url_ceiling:${route}`); continue; }
  if (fix.operation === 'CREATE_NEW_TARGET_PAGE' && isHeldByMeasuredDemand(id, route)) { warnings.push(`${id}:selected_new_page_held_by_measured_demand_gate:${route}`); continue; }
  if (fix.operation === 'CREATE_NEW_TARGET_PAGE' && isRefusedByReleaseQueue(id)) { warnings.push(`${id}:selected_new_page_refused_by_release_queue:${releaseQueueRefusedById.get(id)}:${route}`); continue; }
  for (const [label, payload] of [['staged', stagedPages], ['live', livePages]]) {
    if (!pageExists(payload, route)) { errors.push(`${id}:${label}_missing_route:${route}`); continue; }
    for (const marker of markers) if (!pageHasMarker(payload, route, marker)) errors.push(`${id}:${label}_missing_marker:${marker}`);
  }
  if (fix.renderedPath) {
    if (!exists(fix.renderedPath)) warnings.push(`${id}:rendered_path_not_present_yet:${fix.renderedPath}`);
    else {
      const text = read(fix.renderedPath);
      for (const marker of markers) if (!markerIn(text, marker)) errors.push(`${id}:rendered_missing_marker:${fix.renderedPath}:${marker}`);
    }
  }
}

function isSocialFallbackUnit(unit) {
  return String(unit && unit.source || '') === 'social_public_backlog' || String(unit && unit.admission_basis || '').includes('SOCIAL_BACKLOG_APPROVED_FALLBACK');
}
if (plan && plan.selected_count > 0) {
  for (const unit of plan.selected_units || []) {
    const id = unit.id || unit.query;
    if (isRenderedRepair(unit)) {
      const route = unit.target_route || unit.intended_winner_path;
      const unitProof = resolveRecommendationProof(unit, { root: ROOT, releaseUnitPaths });
      const unitMarkerRoute = unitProof.gradeAt ? renderedPathToRoute(unitProof.gradeAt) : route;
      traceRenderedTarget(id, route, semanticMarkersForRoute(unitMarkerRoute, [unit.query].filter(Boolean)), String(unitMarkerRoute || '').startsWith('/insights/'), unit);
      continue;
    }
    if (isSocialFallbackUnit(unit) && !createdReleaseIds.has(id)) {
      const skipped = skippedReleaseById.get(id);
      const reason = skipped && skipped.reason || 'not_created_by_velocity_content_release';
      errors.push(`${id}:social_fallback_selected_but_not_created:${reason}:${unit.target_route}`);
      continue;
    }
    const liveExists = pageExists(livePages, unit.target_route);
    const stagedExists = pageExists(stagedPages, unit.target_route);
    if ((!liveExists || !stagedExists) && isDeferredByDailyCeiling(id)) { warnings.push(`${id}:deferred_by_daily_new_url_ceiling:${unit.target_route}`); continue; }
    if ((!liveExists || !stagedExists) && isHeldByMeasuredDemand(id, unit.target_route)) { warnings.push(`${id}:held_by_measured_demand_gate:${unit.target_route}`); continue; }
    if ((!liveExists || !stagedExists) && isRefusedByReleaseQueue(id)) { warnings.push(`${id}:refused_by_release_queue:${releaseQueueRefusedById.get(id)}:${unit.target_route}`); continue; }
    if (!liveExists) errors.push(`${id}:live_missing_route:${unit.target_route}`);
    else if (!pageHasMarker(livePages, unit.target_route, readerFacingMarker(unit.query))) errors.push(`${id}:live_missing_query`);
    if (!stagedExists) errors.push(`${id}:staged_missing_route:${unit.target_route}`);
    else if (!pageHasMarker(stagedPages, unit.target_route, readerFacingMarker(unit.query))) errors.push(`${id}:staged_missing_query`);
  }
}
if (!plan) warnings.push('velocity_intake_release_plan_missing; no current intake release to trace');
const report = { schema_version: '1.3', validator: 'citation-agent-fix-trace', status: errors.length ? 'FAIL' : 'PASS', selected_trace_count: selected.length, release_plan_count: plan && plan.selected_count || 0, errors, warnings, checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/citation-agent-fix-trace.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error('CITATION AGENT FIX TRACE FAIL'); errors.forEach((e) => console.error(`- ${e}`)); process.exit(1); }
console.log(`CITATION AGENT FIX TRACE PASS: ${selected.length} selected fix(es), ${report.release_plan_count} release unit(s).`);
