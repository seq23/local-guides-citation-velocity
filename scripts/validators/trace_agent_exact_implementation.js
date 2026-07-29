#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const {
  LEDGER_PATH,
  normalizeImplementationPath,
  routeToImplementationPath,
  slugFromInsightPath,
  targetTypeForImplementationPath,
  semanticEntryForImplementationPath
} = require('../lib/agent_exact_repairs');

function rel(p) { return path.join(ROOT, p); }
function readJson(p, f = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return f; } }
function writeJson(p, v) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(v, null, 2) + '\n'); }
function readTextIfExists(p) { try { return fs.readFileSync(rel(p), 'utf8'); } catch { return ''; } }
function normalize(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function queryNeedle(spec) { return normalize((spec.queries || [spec.query])[0]).split(' ').slice(0, 5).join(' '); }
function semanticNeedlesFound(implementationPath, html) {
  const semantic = semanticEntryForImplementationPath(implementationPath);
  if (!semantic) return false;
  const rendered = normalize(html);
  const needles = semantic.required_strings || [];
  return needles.length > 0 && needles.every((needle) => rendered.includes(normalize(needle)));
}
function routeKeysForPage(page) {
  return new Set([
    normalizeImplementationPath(page.slug || ''),
    normalizeImplementationPath(page.path || ''),
    routeToImplementationPath(page.slug || ''),
    routeToImplementationPath(page.path || '')
  ].filter(Boolean));
}

const plan = readJson('artifacts/validation/agent-exact-implementation-plan.json', { specs: [] });
const apply = readJson('artifacts/validation/agent-exact-implementation-apply.json', { results: [] });
const velocityContentRelease = readJson('artifacts/validation/velocity-content-release.json', { created: [], skipped: [] });
const ceilingDeferredNewPageIds = new Set((velocityContentRelease.skipped || []).filter((row) => String(row.reason || '').includes('daily_new_url_ceiling_reached')).map((row) => row.id).filter(Boolean));
const ledger = readJson(LEDGER_PATH, { entries: [] });
const insights = readJson('content/_live/insights.json', { items: [] });
const livePages = readJson('content/_live/pages.json', { pages: [] });
const ledgerByPath = new Map((ledger.entries || []).map((entry) => [normalizeImplementationPath(entry.implementation_path), entry]));
const appliedByPath = new Map((apply.results || []).map((result) => [normalizeImplementationPath(result.implementation_path), result]));
const insightByPath = new Map((insights.items || []).map((item) => [normalizeImplementationPath(item.publish_path || `insights/${item.slug}.html`), item]));
const livePageByPath = new Map();
for (const page of livePages.pages || []) {
  for (const key of routeKeysForPage(page)) livePageByPath.set(key, page);
}

const traces = [];
const errors = [];

for (const spec of plan.specs || []) {
  if (spec.status === 'BLOCKED') {
    const ok = Boolean(spec.blocked_reason);
    traces.push({ ...spec, trace_status: ok ? 'PASS' : 'FAIL' });
    if (!ok) errors.push(`${spec.record_id}:blocked row missing blocked_reason`);
    continue;
  }

  if (spec.operation === 'REPAIR_INTENDED_WINNER_PAGE') {
    const implementationPath = normalizeImplementationPath(spec.implementation_path || spec.intended_winner_path || routeToImplementationPath(spec.target_route));
    const targetType = spec.target_type || targetTypeForImplementationPath(implementationPath);
    const entry = ledgerByPath.get(implementationPath);
    const applied = appliedByPath.get(implementationPath);
    const marker = entry && entry.marker;
    const needle = queryNeedle(spec);

    if (targetType === 'generated_insight') {
      const item = insightByPath.get(implementationPath) || insightByPath.get(normalizeImplementationPath(`insights/${slugFromInsightPath(implementationPath)}.html`));
      const renderedPath = implementationPath;
      const renderedRaw = readTextIfExists(renderedPath);
      const renderedHtml = normalize(renderedRaw);
      const itemText = normalize(JSON.stringify(item || {}));
      const hasLedger = Boolean(entry && marker);
      const hasApply = Boolean(applied && ['APPLIED_TO_LEDGER', 'APPLIED'].includes(applied.status));
      const hasItemMarker = Boolean(item && item.agent_exact_repair && item.agent_exact_repair.marker === marker);
      const hasRenderedMarker = Boolean(marker && renderedHtml.includes(normalize(marker)));
      const hasQuery = Boolean((needle && (itemText.includes(needle) || renderedHtml.includes(needle))) || semanticNeedlesFound(implementationPath, renderedHtml));
      const pass = Boolean(hasLedger && hasApply && item && hasItemMarker && hasRenderedMarker && hasQuery);
      traces.push({ ...spec, target_type: targetType, trace_status: pass ? 'PASS' : 'FAIL', ledger_marker: marker || '', rendered_path: renderedPath, item_exists: Boolean(item), applied_status: applied?.status || '', has_ledger: hasLedger, has_item_marker: hasItemMarker, has_rendered_marker: hasRenderedMarker, query_marker_found: hasQuery });
      if (!pass) errors.push(`${spec.record_id}:repair_not_proven:${implementationPath}`);
      continue;
    }

    if (targetType === 'live_page') {
      const page = livePageByPath.get(implementationPath);
      const renderedPath = implementationPath;
      const renderedRaw = readTextIfExists(renderedPath);
      const renderedHtml = normalize(renderedRaw);
      const hasLedger = Boolean(entry && marker);
      const hasApply = Boolean(applied && ['APPLIED_TO_LEDGER', 'APPLIED'].includes(applied.status));
      const hasRenderedMarker = Boolean(marker && renderedHtml.includes(normalize(marker)));
      const hasQuery = Boolean((needle && renderedHtml.includes(needle)) || semanticNeedlesFound(implementationPath, renderedHtml));
      const pass = Boolean(hasLedger && hasApply && page && hasRenderedMarker && hasQuery);
      traces.push({ ...spec, target_type: targetType, trace_status: pass ? 'PASS' : 'FAIL', ledger_marker: marker || '', rendered_path: renderedPath, page_exists: Boolean(page), applied_status: applied?.status || '', has_ledger: hasLedger, has_rendered_marker: hasRenderedMarker, query_marker_found: hasQuery });
      if (!pass) errors.push(`${spec.record_id}:repair_not_proven:${implementationPath}`);
      continue;
    }

    traces.push({ ...spec, target_type: targetType, trace_status: 'FAIL', implementation_path: implementationPath });
    errors.push(`${spec.record_id}:unsupported_repair_target:${implementationPath}`);
  } else if (spec.operation === 'CREATE_NEW_TARGET_PAGE') {
    const implementationPath = normalizeImplementationPath(spec.implementation_path || routeToImplementationPath(spec.target_route));
    const exists = Boolean(livePageByPath.get(implementationPath) || fs.existsSync(rel(implementationPath)));
    const deferredByDailyCeiling = !exists && ceilingDeferredNewPageIds.has(spec.record_id);
    traces.push({ ...spec, trace_status: exists ? 'PASS' : (deferredByDailyCeiling ? 'DEFERRED_BY_DAILY_CEILING' : 'FAIL'), rendered_path: implementationPath, page_exists: exists, deferred_by_daily_ceiling: deferredByDailyCeiling });
    if (!exists && !deferredByDailyCeiling) errors.push(`${spec.record_id}:new_page_not_proven:${spec.target_route}`);
  }
}

const report = {
  schema_version: '1.1',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: DATE,
  ledger_path: LEDGER_PATH,
  ledger_count: (ledger.entries || []).length,
  plan_count: (plan.specs || []).length,
  traces,
  errors
};
writeJson('artifacts/validation/agent-exact-implementation-trace.json', report);
if (errors.length) {
  console.error('AGENT EXACT IMPLEMENTATION TRACE FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`AGENT EXACT IMPLEMENTATION TRACE PASS: ${traces.length} spec(s)`);
