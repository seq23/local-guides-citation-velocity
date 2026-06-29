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
function normalizeRoute(route) {
  let value = String(route || '').trim();
  if (!value) return '';
  value = value.replace(/^https?:\/\/[^/]+/, '');
  if (!value.startsWith('/')) value = `/${value}`;
  return value.replace(/\/+/g, '/');
}
function routeToRenderedPath(route) {
  let value = normalizeRoute(route).replace(/^\//, '');
  if (!value) return '';
  if (value.endsWith('.html')) return value;
  value = value.replace(/\/+$/, '');
  return value ? `${value}/index.html` : '';
}
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
function markersFor(fixOrUnit) { return Array.from(new Set(fixOrUnit.required_markers || [fixOrUnit.query].filter(Boolean))); }
function traceRenderedTarget(id, route, markers, requireInsightManifest = false) {
  const renderedPath = routeToRenderedPath(route);
  if (!renderedPath || !exists(renderedPath)) {
    errors.push(`${id}:rendered_missing_route:${renderedPath || route}`);
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

for (const fix of selected) {
  const id = fix.id || fix.query;
  const markers = markersFor(fix);
  if (!markers.length) { errors.push(`${id}:missing_required_markers`); continue; }
  const route = fix.target_route || (`/${String(fix.renderedPath || '').replace(/index\.html$/, '')}`);
  if (isRenderedRepair(fix)) {
    traceRenderedTarget(id, route, markers, String(fix.liveManifestPath || '').includes('insights.json') && String(route || '').startsWith('/insights/'));
    continue;
  }
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

const plan = readJson('artifacts/validation/velocity-intake-release-plan.json', null);
if (plan && plan.selected_count > 0) {
  for (const unit of plan.selected_units || []) {
    const id = unit.id || unit.query;
    if (isRenderedRepair(unit)) {
      traceRenderedTarget(id, unit.target_route || unit.intended_winner_path, [unit.query].filter(Boolean), String(unit.target_route || '').startsWith('/insights/'));
      continue;
    }
    const liveExists = pageExists(livePages, unit.target_route);
    const stagedExists = pageExists(stagedPages, unit.target_route);
    if (!liveExists) errors.push(`${id}:live_missing_route:${unit.target_route}`);
    else if (!pageHasMarker(livePages, unit.target_route, unit.query)) errors.push(`${id}:live_missing_query`);
    if (!stagedExists) errors.push(`${id}:staged_missing_route:${unit.target_route}`);
    else if (!pageHasMarker(stagedPages, unit.target_route, unit.query)) errors.push(`${id}:staged_missing_query`);
  }
}
if (!plan) warnings.push('velocity_intake_release_plan_missing; no current intake release to trace');
const report = { schema_version: '1.1', validator: 'citation-agent-fix-trace', status: errors.length ? 'FAIL' : 'PASS', selected_trace_count: selected.length, release_plan_count: plan && plan.selected_count || 0, errors, warnings, checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/citation-agent-fix-trace.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error('CITATION AGENT FIX TRACE FAIL'); errors.forEach((e) => console.error(`- ${e}`)); process.exit(1); }
console.log(`CITATION AGENT FIX TRACE PASS: ${selected.length} selected fix(es), ${report.release_plan_count} release unit(s).`);
