#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A COMPILER REFUSAL MUST BE LEGIBLE TO EVERY STAGE THAT DEPENDS ON IT.
 *
 * WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
 *
 * compile_html_fix_acceptance_manifest.js refuses to author a semantic acceptance
 * entry for a uscis-medical route with no authority-grounded template - correctly:
 * immigration guidance may not be compiled out of an agent's free-text FIX/EDIT line,
 * and validate_html_fix_acceptance_compiler.js would reject an ungrounded entry anyway.
 *
 * That refusal was a console.warn and nothing else. Three stages carried on as though
 * the entry existed:
 *
 *   - mergeLedgerEntries re-minted the route's marker, because hash(record_ids|path)
 *     changes the moment a new record id joins the entry;
 *   - applyEntryToTarget took its no-semantic-entry branch and authored no artifact,
 *     so nothing could carry that marker into the page;
 *   - trace_agent_exact_implementation demanded the marker in the rendered HTML and
 *     hard-failed when it was absent.
 *
 * On 2026-09-09, `agent_7b5d43b6820884d4:repair_not_proven:uscis-medical/timeline-
 * validity/index.html` took Velocity Content Release run 34409865197 red on a batch of
 * 85 units. 36 live uscis routes currently carry ungrounded rows, so at large batch
 * sizes this was not a fluke but a certainty - which is exactly why batch_size=5 runs
 * passed and the backlog could not drain.
 *
 * The class defect is the missing LINK, not the refusal: two components each keeping
 * their own list. This validator is that link's guard. It proves, over every planned
 * repair spec:
 *
 *   1. every uscis repair spec the compiler cannot ground is NAMED in
 *      artifacts/validation/semantic-acceptance-refusals.json - the warn and the
 *      artifact cannot drift apart;
 *   2. every route named there genuinely has NO semantic manifest entry, so the
 *      refusal cannot become a blanket excuse for a route that was in fact compiled;
 *   3. every REFUSED_BY_ACCEPTANCE_COMPILER trace has a matching refusal row for its
 *      own record id, so the excuse can never be issued without evidence;
 *   4. no refused spec is counted as proven, and no refused spec is retired.
 *
 * It hard-fails when it examines zero specs while specs were available.
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { authorityGroundedEntryForSpec } = require('../lib/authority_grounded_repairs');
const { normalizeImplementationPath, routeToImplementationPath } = require('../lib/agent_exact_repairs');
const { zeroExaminationVerdict } = require('../lib/zero_item_examination');

const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const PLAN_PATH = 'artifacts/validation/agent-exact-implementation-plan.json';
const REFUSALS_PATH = 'artifacts/validation/semantic-acceptance-refusals.json';
const MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const TRACE_PATH = 'artifacts/validation/agent-exact-implementation-trace.json';
const REPORT_PATH = 'artifacts/validation/semantic-acceptance-refusal-legibility.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }
function writeJson(p, value) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(value, null, 2) + '\n'); }
function implPathFor(spec) {
  return normalizeImplementationPath(spec.implementation_path || spec.intended_winner_path || routeToImplementationPath(spec.target_route || ''));
}

const errors = [];
const plan = readJson(PLAN_PATH, { specs: [] });
const allSpecs = plan.specs || [];
const repairSpecs = allSpecs.filter((spec) => spec && spec.status === 'PLANNED' && spec.operation === 'REPAIR_INTENDED_WINNER_PAGE');

const refusals = readJson(REFUSALS_PATH, null);
if (!refusals) {
  errors.push(`refusal_evidence_missing:${REFUSALS_PATH} - compile_html_fix_acceptance_manifest.js must write this file on EVERY run, including with an empty refused list. Without it a refusal is invisible again and the trace cannot tell a refused route from a broken one.`);
}
const refusedRows = (refusals && refusals.refused) || [];
const refusedByPath = new Map();
for (const row of refusedRows) {
  const key = normalizeImplementationPath(row && row.implementation_path);
  if (!key) { errors.push('refusal_row_without_implementation_path'); continue; }
  refusedByPath.set(key, row);
  if (!String(row.reason || '').trim()) errors.push(`refusal_row_without_reason:${key}`);
  if (!String(row.record_id || '').trim() && !(row.record_ids || []).length) errors.push(`refusal_row_without_record_id:${key}`);
}

// 1. The compiler's decision and the artifact it writes cannot drift. Re-derive the
//    decision from the same function the compiler calls, over the same plan.
const expectedRefusals = [];
for (const spec of repairSpecs) {
  const implementationPath = implPathFor(spec);
  if (!implementationPath.startsWith('uscis-medical/')) continue;
  if (authorityGroundedEntryForSpec(spec)) continue;
  expectedRefusals.push({ implementation_path: implementationPath, record_id: spec.record_id || '' });
  const row = refusedByPath.get(implementationPath);
  if (!row) {
    errors.push(`ungrounded_uscis_spec_not_named_as_refused:${spec.record_id || 'unknown'}:${implementationPath} - the compiler cannot author a grounded entry for this route, so nothing can carry its marker; the trace will demand that marker and fail unless the refusal is recorded.`);
    continue;
  }
  const ids = new Set([row.record_id, ...(row.record_ids || [])].filter(Boolean));
  if (ids.size && spec.record_id && !ids.has(spec.record_id)) {
    errors.push(`refusal_does_not_cover_planned_record:${spec.record_id}:${implementationPath}`);
  }
}

// 2. A named refusal must be TRUE: the manifest must carry no entry for that route.
//    Otherwise the artifact becomes a blanket excuse for routes that were compiled.
const manifest = readJson(MANIFEST_PATH, { entries: [] });
const manifestPaths = new Set((manifest.entries || []).map((entry) => normalizeImplementationPath(entry && entry.implementation_path)).filter(Boolean));
for (const key of refusedByPath.keys()) {
  if (manifestPaths.has(key)) {
    errors.push(`refused_route_has_a_semantic_entry:${key} - it was compiled after all, so the refusal is not true and must not excuse it from proof.`);
  }
}

// 3+4. Every excuse the trace issued must be backed by this run's evidence, and no
//      excused spec may be counted as landed work.
const trace = readJson(TRACE_PATH, null);
const excused = ((trace && trace.traces) || []).filter((row) => row && row.trace_status === 'REFUSED_BY_ACCEPTANCE_COMPILER');
for (const row of excused) {
  const implementationPath = implPathFor(row);
  const refusal = refusedByPath.get(implementationPath);
  if (!refusal) {
    errors.push(`excused_without_evidence:${row.record_id || 'unknown'}:${implementationPath} - the trace excused this spec but no refusal row names its route.`);
    continue;
  }
  const ids = new Set([refusal.record_id, ...(refusal.record_ids || [])].filter(Boolean));
  if (ids.size && row.record_id && !ids.has(row.record_id)) {
    errors.push(`excused_without_evidence_for_record:${row.record_id}:${implementationPath}`);
  }
}
if (trace && Number(trace.acceptance_refused_count || 0) !== excused.length) {
  errors.push(`acceptance_refused_count_not_reconciled:declared=${Number(trace.acceptance_refused_count || 0)}:actual=${excused.length}`);
}
if (trace) {
  const provenExcused = ((trace.traces || []).filter((row) => row && row.trace_status === 'REFUSED_BY_ACCEPTANCE_COMPILER' && row.proven === true));
  if (provenExcused.length) errors.push(`excused_spec_counted_as_proven:${provenExcused.map((row) => row.record_id).join(',')}`);
}

const verdict = zeroExaminationVerdict({
  validator: 'semantic-acceptance-refusal-legibility',
  unit: 'planned repair spec(s)',
  examined: repairSpecs.length,
  available: allSpecs.length,
  stopReason: 'the exact-implementation plan carries no PLANNED repair spec, so no route could have been refused a semantic entry this run',
  inputs: [PLAN_PATH, REFUSALS_PATH, MANIFEST_PATH]
});
if (verdict.error) errors.push(verdict.error);

const report = {
  schema_version: '1.0',
  guard: 'semantic-acceptance-refusal-legibility',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: DATE,
  inputs: [PLAN_PATH, REFUSALS_PATH, MANIFEST_PATH, TRACE_PATH],
  plan_spec_count: allSpecs.length,
  examined_count: repairSpecs.length,
  named_stop: verdict.named_stop,
  refusal_rows: refusedRows.length,
  expected_refusal_count: expectedRefusals.length,
  expected_refusals: expectedRefusals,
  trace_excused_count: excused.length,
  errors
};
writeJson(REPORT_PATH, report);

if (errors.length) {
  console.error('SEMANTIC ACCEPTANCE REFUSAL LEGIBILITY FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`SEMANTIC ACCEPTANCE REFUSAL LEGIBILITY PASS: ${repairSpecs.length} planned repair spec(s) examined; ${refusedRows.length} refusal(s) recorded; ${expectedRefusals.length} ungrounded uscis spec(s) expected; ${excused.length} trace excuse(s) backed by evidence`);
