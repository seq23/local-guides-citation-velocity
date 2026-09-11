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
  const failures = [];
  const holdKey = { id, ids: row && row.record_ids || [], route, renderedPath: renderedPath || proof.targetPath || routeToRenderedPath(route), operation: row && row.operation || 'REPAIR_INTENDED_WINNER_PAGE' };
  if (!renderedPath || !exists(renderedPath)) {
    failures.push(`${id}:rendered_missing_route:${proof.targetPath || routeToRenderedPath(route) || route}`);
    failOrNamedStop(id, failures, holdKey);
    return;
  }
  const text = read(renderedPath);
  for (const marker of markers) if (!markerIn(text, marker)) failures.push(`${id}:rendered_missing_marker:${renderedPath}:${marker}`);
  if (requireInsightManifest) {
    const insights = readJson('content/_live/insights.json', { items: [] });
    if (!insightItemExists(insights, route)) failures.push(`${id}:live_insight_missing_route:${route}`);
  }
  failOrNamedStop(id, failures, holdKey);
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
// EVERY named hold the lane can emit, from ONE module - the same one the exact
// implementation trace reads. This validator used to keep its own copies of three of
// them (daily ceiling, measured demand, release queue) and had never heard of the
// other two (a route the freeze transaction REFUSED_TO_PROTECT_DELIVERED_CONTENT, a
// route the acceptance compiler refused to author) or of the planner's BLOCKED specs.
// So on 2026-09-10/11 the exact trace printed REFUSED_TO_PROTECT_DELIVERED_CONTENT=1
// for /trt/best-top-near-me/ and PASSED, and this trace, one command later in the same
// step, failed the publish demanding the marker that refusal had declined to render.
// See scripts/lib/recommendation_refusal_ledger.js for the whole account.
//
// An unreadable demand corpus holds nothing open: demandBackingPredicate throws, the
// predicate is null, and the ledger treats "cannot answer" as "not held".
const { loadRefusalLedger } = require('../lib/recommendation_refusal_ledger');
let demandBackedRoute = null;
try { demandBackedRoute = require('../lib/demand_backing').demandBackingPredicate(ROOT); } catch { demandBackedRoute = null; }
const refusalLedger = loadRefusalLedger(ROOT, { demandBackedRoute });
const namedStops = [];
/**
 * A failure on a row the lane has REFUSED with a recorded reason is a named stop, not
 * an error: it is printed with its kind and reason, counted, and left selectable. A
 * failure on a row with no named hold is exactly as fatal as it always was.
 */
function failOrNamedStop(id, failures, holdKey) {
  if (!failures.length) return;
  const hold = refusalLedger.namedStopFor(holdKey);
  if (!hold) { errors.push(...failures); return; }
  warnings.push(`${id}:named_stop:${hold.kind}:${hold.reason}:${holdKey.renderedPath || holdKey.route}`);
  namedStops.push({ id, kind: hold.kind, reason: hold.reason, source: hold.source, matched_by: hold.matched_by, would_have_failed: failures });
}

// A row is traced ONCE. The ledger's selected rows and the intake plan's selected
// units overlap - the plan is built FROM those rows - and grading the same record in
// both loops printed every failure twice (agent_aa7bdf139c78544b appeared twice in
// run 34604751262). The plan loop skips a unit already graded from the ledger.
const tracedFromLedger = new Set();

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
  tracedFromLedger.add(`${id}|${routeToRenderedPath(route)}`);
  if (isRenderedRepair(fix)) {
    traceRenderedTarget(id, route, markers, String(fix.liveManifestPath || '').includes('insights.json') && String(markerRoute || '').startsWith('/insights/'), fix);
    continue;
  }
  const failures = [];
  for (const [label, payload] of [['staged', stagedPages], ['live', livePages]]) {
    if (!pageExists(payload, route)) { failures.push(`${id}:${label}_missing_route:${route}`); continue; }
    for (const marker of markers) if (!pageHasMarker(payload, route, marker)) failures.push(`${id}:${label}_missing_marker:${marker}`);
  }
  if (fix.renderedPath) {
    if (!exists(fix.renderedPath)) warnings.push(`${id}:rendered_path_not_present_yet:${fix.renderedPath}`);
    else {
      const text = read(fix.renderedPath);
      for (const marker of markers) if (!markerIn(text, marker)) failures.push(`${id}:rendered_missing_marker:${fix.renderedPath}:${marker}`);
    }
  }
  failOrNamedStop(id, failures, { id, route, renderedPath: fix.renderedPath || routeToRenderedPath(route), operation: fix.operation });
}

function isSocialFallbackUnit(unit) {
  return String(unit && unit.source || '') === 'social_public_backlog' || String(unit && unit.admission_basis || '').includes('SOCIAL_BACKLOG_APPROVED_FALLBACK');
}
if (plan && plan.selected_count > 0) {
  for (const unit of plan.selected_units || []) {
    const id = unit.id || unit.query;
    const unitRoute = unit.target_route || unit.intended_winner_path;
    if (tracedFromLedger.has(`${id}|${routeToRenderedPath(unitRoute)}`)) continue;
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
    const failures = [];
    if (!liveExists) failures.push(`${id}:live_missing_route:${unit.target_route}`);
    else if (!pageHasMarker(livePages, unit.target_route, readerFacingMarker(unit.query))) failures.push(`${id}:live_missing_query`);
    if (!stagedExists) failures.push(`${id}:staged_missing_route:${unit.target_route}`);
    else if (!pageHasMarker(stagedPages, unit.target_route, readerFacingMarker(unit.query))) failures.push(`${id}:staged_missing_query`);
    failOrNamedStop(id, failures, { id, route: unit.target_route, renderedPath: unit.renderedPath || routeToRenderedPath(unit.target_route), operation: unit.operation || 'CREATE_NEW_TARGET_PAGE' });
  }
}
if (!plan) warnings.push('velocity_intake_release_plan_missing; no current intake release to trace');
const report = { schema_version: '1.4', validator: 'citation-agent-fix-trace', status: errors.length ? 'FAIL' : 'PASS', selected_trace_count: selected.length, release_plan_count: plan && plan.selected_count || 0, named_stop_count: namedStops.length, named_stops: namedStops, refusal_sources_readable: refusalLedger.readable, errors, warnings, checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/citation-agent-fix-trace.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error('CITATION AGENT FIX TRACE FAIL'); errors.forEach((e) => console.error(`- ${e}`)); process.exit(1); }
const stopCensus = namedStops.reduce((acc, stop) => { acc[stop.kind] = (acc[stop.kind] || 0) + 1; return acc; }, {});
const stopSummary = Object.entries(stopCensus).sort().map(([kind, count]) => `${kind}=${count}`).join('; ');
console.log(`CITATION AGENT FIX TRACE PASS: ${selected.length} selected fix(es), ${report.release_plan_count} release unit(s)${namedStops.length ? `; named stops: ${stopSummary}` : ''}.`);
for (const stop of namedStops) console.log(`  NAMED STOP ${stop.kind} (${stop.reason}) ${stop.id} - ${stop.would_have_failed.length} check(s) held, not proven, still selectable`);
