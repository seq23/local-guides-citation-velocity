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
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', middot: '·'
};
// Rendered HTML entity-encodes characters that appear literally in the manifest's
// required_strings. Without decoding, `it&#39;s` normalizes to "it 39 s" and can never
// match "it's", so the semantic assertion silently degrades to the weaker query needle.
function decodeEntities(value) {
  let out = String(value || '');
  // Numeric entities first, then named; repeat once to catch double-encoded (&amp;#39;).
  for (let pass = 0; pass < 2; pass += 1) {
    out = out
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => {
        const key = String(name).toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
      });
  }
  return out;
}
function normalize(v) { return decodeEntities(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
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
// The third named hold, alongside the ceiling above and the queue refusal below.
//
// velocity_content_release.js applies a measured-demand gate: a route matching no
// query in data/demand/measured_demand.json is recorded as skipped with reason
// no_measured_demand_match and is never staged. That is an EVIDENCE refusal, and a
// deliberate one - the lane will not publish against absent demand.
//
// This trace did not know about it, so those rows arrived here as
// new_page_not_proven and read as a broken pipeline. They are the opposite: the
// gate did its job and said so in the artifact. Held is not the same as dropped,
// and neither is the same as failed. Recorded with the gate's own reason so a
// genuinely unproven create still fails loudly.
const demandHeldNewPageIds = new Set((velocityContentRelease.skipped || []).filter((row) => String(row.reason || '') === 'no_measured_demand_match').map((row) => row.id).filter(Boolean));
// A create the release queue REFUSED is not unproven work - it is work the
// governance layer forbade, and demanding proof of it makes a correctly-refused
// release indistinguishable from a broken one.
//
// The planner cannot filter these itself: citation:plan-agent-exact runs BEFORE
// strategy:release-queue builds the queue, so at plan time the decision does not
// exist yet. The queue does exist by the time this trace runs, which is why the
// reconciliation belongs here - exactly as ceiling-deferral above already reads a
// downstream artifact to excuse pages the run was never permitted to publish.
//
// This narrows nothing that was being enforced: proof is still required for every
// create the pipeline actually admitted. Only records the queue marked ineligible
// and NOT_ADMITTED are excused, and they are recorded with the queue's own reason
// rather than passing silently.
const releaseQueueRecords = readJson('data/release/page_release_queue.json', { records: [] }).records || [];
const queueRefusedNewPages = new Map(
  releaseQueueRecords
    .filter((row) => row && row.id && row.eligible === false && String(row.lifecycle_state || '') === 'NOT_ADMITTED')
    .map((row) => [row.id, String(row.decision || 'NOT_ADMITTED')])
);
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
  if (spec.status === 'CARRIED') {
    // Recorded but deliberately unworked (outside the processing budget). Not proven,
    // not a failure — it must simply never be invisible again.
    traces.push({ ...spec, trace_status: 'CARRIED', proven: false });
    continue;
  }

  if (spec.status === 'BLOCKED') {
    // Blocked work is carried, not landed. Policy keeps it from failing the build, but
    // it must never be counted as PASS: a blocked spec proves nothing shipped.
    const ok = Boolean(spec.blocked_reason);
    traces.push({ ...spec, trace_status: ok ? 'BLOCKED' : 'FAIL', proven: false });
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
    const heldByMeasuredDemand = !exists && !deferredByDailyCeiling && demandHeldNewPageIds.has(spec.record_id);
    const refusedByReleaseQueue = !exists && !deferredByDailyCeiling && !heldByMeasuredDemand && queueRefusedNewPages.has(spec.record_id);
    const traceStatus = exists ? 'PASS'
      : deferredByDailyCeiling ? 'DEFERRED_BY_DAILY_CEILING'
      : heldByMeasuredDemand ? 'HELD_BY_MEASURED_DEMAND_GATE'
      : refusedByReleaseQueue ? 'REFUSED_BY_RELEASE_QUEUE'
      : 'FAIL';
    traces.push({ ...spec, trace_status: traceStatus, rendered_path: implementationPath, page_exists: exists, deferred_by_daily_ceiling: deferredByDailyCeiling, held_by_measured_demand_gate: heldByMeasuredDemand, refused_by_release_queue: refusedByReleaseQueue, release_queue_decision: queueRefusedNewPages.get(spec.record_id) || '' });
    if (!exists && !deferredByDailyCeiling && !heldByMeasuredDemand && !refusedByReleaseQueue) errors.push(`${spec.record_id}:new_page_not_proven:${spec.target_route}`);
  }
}

const countBy = (status) => traces.filter((t) => t.trace_status === status).length;
const provenCount = countBy('PASS');
const blockedCount = countBy('BLOCKED');
const deferredCount = countBy('DEFERRED_BY_DAILY_CEILING');
const demandHeldCount = countBy('HELD_BY_MEASURED_DEMAND_GATE');
const carriedCount = countBy('CARRIED');
const failedCount = countBy('FAIL');

const report = {
  schema_version: '1.2',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: DATE,
  ledger_path: LEDGER_PATH,
  ledger_count: (ledger.entries || []).length,
  plan_count: (plan.specs || []).length,
  // Distinct outcomes. `proven_count` is the only figure that means work landed;
  // blocked and deferred specs are carried, not shipped.
  proven_count: provenCount,
  blocked_count: blockedCount,
  deferred_count: deferredCount,
  demand_held_count: demandHeldCount,
  carried_count: carriedCount,
  failed_count: failedCount,
  blocked_policy: 'BLOCKED and CARRIED specs do not fail the build, and are never counted as proven',
  traces,
  errors
};
writeJson('artifacts/validation/agent-exact-implementation-trace.json', report);
if (errors.length) {
  console.error('AGENT EXACT IMPLEMENTATION TRACE FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`AGENT EXACT IMPLEMENTATION TRACE PASS: ${traces.length} spec(s); proven=${provenCount}; blocked=${blockedCount}; carried=${carriedCount}; deferred=${deferredCount}; demand_held=${demandHeldCount}`);
