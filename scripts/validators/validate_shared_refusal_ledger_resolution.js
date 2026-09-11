#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * TWO TRACES, ONE STEP APART, WITH TWO DIFFERENT LISTS OF WHAT THE LANE MAY REFUSE.
 *
 * Velocity Content Release runs `trace:agent-exact` and then `trace:citation-agent-fixes`
 * over the same ledger rows. On 2026-09-10 (runs 34471600371, 34486150617) and
 * 2026-09-11 (run 34604751262) the first printed
 *
 *   AGENT EXACT IMPLEMENTATION TRACE PASS: ... REFUSED_TO_PROTECT_DELIVERED_CONTENT=1
 *
 * because acceptMutationScope() had rejected the rebuild of /trt/best-top-near-me/
 * (it lost a marker three landed rows depend on), restored the accepted bytes and
 * recorded why in artifacts/validation/mutation-scope-acceptance.json. The second
 * trace had never heard of that file. It demanded, on the restored page, the marker
 * the lane had just declined to render, and failed the publish:
 *
 *   agent_aa7bdf139c78544b:rendered_missing_marker:trt/best-top-near-me/index.html:...
 *
 * The citation trace also kept private copies of three holds the exact trace honours
 * (daily ceiling, measured demand, release queue) and knew nothing of the planner's
 * BLOCKED specs or the acceptance compiler's refusals. Five holds, two readers, two
 * lists, no link. scripts/lib/recommendation_refusal_ledger.js now owns the list and
 * both traces read it. This validator makes that structural, in the same shape as
 * validate_shared_proof_path_resolution.js:
 *
 *   1. every consumer the module DECLARES requires it and carries no private copy of
 *      a hold source;
 *   2. the module distinguishes EVERY kind it declares from an unexplained miss, on
 *      constructed fixtures - so a new kind added to REFUSAL_KINDS is under the guard
 *      by construction - and excuses nothing when the artifacts are absent;
 *   3. the two producer defects found behind the same failure stay fixed:
 *      a. a page that exists only in content/_staged/pages.json is NOT "built" - the
 *         reconciler used to delete its backlog entry on that basis, the queue rebuild
 *         then forgot the route, and the promoter (which reads the queue) could never
 *         move it to live: 37 routes sat STAGED with no governance record at all, and
 *         agent_ab25835732c76390:live_missing_route was the only thing that noticed;
 *      b. a merged spec that carries more queries than recommendations puts EVERY
 *         query on the page verbatim, so a rebuild cannot drop the marker a landed row
 *         depends on and get refused for it, release after release.
 *
 * It hard-fails when it examines zero consumers or zero kinds: a guard that loops over
 * an empty list and prints PASS is the "runs but inert" defect this repo keeps finding.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_REL = 'scripts/lib/recommendation_refusal_ledger.js';
const errors = [];
const examined = { consumers: [], kinds: [], probes: [] };

let ledgerModule = null;
try { ledgerModule = require(path.join(ROOT, MODULE_REL)); } catch (err) {
  console.error(`SHARED REFUSAL LEDGER RESOLUTION FAIL: cannot load ${MODULE_REL}: ${err.message}`);
  process.exit(1);
}

for (const name of ['REFUSAL_KINDS', 'REFUSAL_LEDGER_CONSUMERS', 'EXACT_TRACE_HOLD_STATUSES', 'SOURCES', 'loadRefusalLedger', 'normalizeRenderedPath', 'normalizeRoute']) {
  if (ledgerModule[name] === undefined) errors.push(`${MODULE_REL}:missing_export:${name}`);
}

// ------------------------------------------------------------------ 1. consumers
/**
 * Each pattern is a private read of a hold source that was ACTUALLY in one of the two
 * traces and that produced, or would have produced, a second list. They name the act
 * of reading a refusal artifact locally, not a general ban on readJson.
 */
const FORKED_HOLD_PATTERNS = [
  { id: 'private_mutation_scope_read', pattern: /readJson\(\s*['"]artifacts\/validation\/mutation-scope-acceptance\.json['"]/, detail: 'reads mutation-scope-acceptance.json itself instead of taking mutationRejectedByPath from the shared ledger' },
  { id: 'private_compiler_refusal_read', pattern: /readJson\(\s*['"]artifacts\/validation\/semantic-acceptance-refusals\.json['"]/, detail: 'reads semantic-acceptance-refusals.json itself instead of taking compilerRefusalFor from the shared ledger' },
  { id: 'private_daily_ceiling_reason', pattern: /['"]daily_new_url_ceiling_reached['"]/, detail: 'spells the daily-ceiling skip reason out locally instead of taking ceilingDeferredById from the shared ledger' },
  { id: 'private_demand_gate_reason', pattern: /['"]no_measured_demand_match['"]/, detail: 'spells the demand-gate skip reason out locally instead of taking demandHeldById from the shared ledger' },
  { id: 'private_release_queue_refusal', pattern: /lifecycle_state\s*\|\|\s*''\)\s*===\s*'NOT_ADMITTED'/, detail: 'filters the release queue for NOT_ADMITTED itself instead of taking queueRefusedById from the shared ledger' }
];
const IMPORT_PATTERN = /require\(\s*['"][^'"]*lib\/recommendation_refusal_ledger['"]\s*\)/;

const consumers = Array.isArray(ledgerModule.REFUSAL_LEDGER_CONSUMERS) ? ledgerModule.REFUSAL_LEDGER_CONSUMERS : [];
for (const rel of consumers) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { errors.push(`${rel}:declared_consumer_missing_from_tree`); continue; }
  const source = fs.readFileSync(abs, 'utf8');
  examined.consumers.push(rel);
  if (!IMPORT_PATTERN.test(source)) errors.push(`${rel}:does_not_require_${MODULE_REL} - every consumer must resolve refusals through the shared module`);
  for (const rule of FORKED_HOLD_PATTERNS) {
    if (rule.pattern.test(source)) errors.push(`${rel}:forked_hold_source:${rule.id} - ${rule.detail}`);
  }
}
// The citation trace specifically must ROUTE a failure through the ledger, not merely
// import it: a require with no call is the "exists but nothing invokes it" shape.
const citationTraceRel = 'scripts/validators/trace_citation_agent_fixes.js';
if (fs.existsSync(path.join(ROOT, citationTraceRel))) {
  const source = fs.readFileSync(path.join(ROOT, citationTraceRel), 'utf8');
  if (!/namedStopFor\(/.test(source)) errors.push(`${citationTraceRel}:imports_the_ledger_but_never_asks_it - namedStopFor() is not called, so no refusal can reach a failure`);
  if (!/named_stop_count/.test(source)) errors.push(`${citationTraceRel}:named_stops_not_reported - the trace report must carry named_stop_count so a held row stays visible`);
}

// --------------------------------------------------------- 2. every kind, on fixtures
function writeJson(root, rel, value) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2));
}

const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-ledger-'));
try {
  // 2a. Absent artifacts excuse nothing.
  const empty = ledgerModule.loadRefusalLedger(probeRoot);
  const nothing = empty.namedStopFor({ id: 'agent_x', route: '/trt/x/', operation: 'REPAIR_INTENDED_WINNER_PAGE' });
  examined.probes.push('absent_artifacts_excuse_nothing');
  if (nothing !== null) errors.push(`${MODULE_REL}:with_no_artifacts_present_a_row_was_excused_as_${nothing && nothing.kind} - a missing ledger must never be a pass`);

  // 2b. Fixtures naming exactly one row per kind.
  writeJson(probeRoot, 'data/report_fixes/agent_exact_implementation_plan.json', { specs: [
    { record_id: 'agent_blocked', status: 'BLOCKED', blocked_reason: 'BLOCKED_NO_MEASURED_DEMAND_FOR_ROUTE', target_route: '/neuro/community-questions/blocked/' },
    { record_id: 'agent_blocked_without_reason', status: 'BLOCKED', blocked_reason: '', target_route: '/neuro/community-questions/unreasoned/' }
  ] });
  writeJson(probeRoot, 'artifacts/validation/mutation-scope-acceptance.json', { rejected: [
    { route: '/trt/best-top-near-me/', rendered_file: 'trt/best-top-near-me/index.html', reason: 'ledgered_markers_lost', lost_markers: [{ marker: 'symptoms of low t in men over 40' }] }
  ] });
  writeJson(probeRoot, 'artifacts/validation/semantic-acceptance-refusals.json', { refused: [
    { implementation_path: 'uscis-medical/exam-day-documents/index.html', record_ids: ['agent_compiler_named'], reason: 'no_authority_grounded_entry' }
  ] });
  writeJson(probeRoot, 'data/release/page_release_queue.json', { records: [
    { id: 'agent_queue_refused', eligible: false, lifecycle_state: 'NOT_ADMITTED', decision: 'SKIP_UNSUPPORTED', target_route: '/trt/guides/queue-refused/' },
    { id: 'agent_queue_admitted', eligible: true, lifecycle_state: 'ADMITTED_FOR_BUILD', decision: 'SAFE_AUTOPUBLISH', target_route: '/trt/guides/admitted/' }
  ] });
  writeJson(probeRoot, 'artifacts/validation/velocity-content-release.json', { created: [], skipped: [
    { id: 'agent_ceiling', reason: 'daily_new_url_ceiling_reached:2' },
    { id: 'agent_demand', reason: 'no_measured_demand_match' }
  ] });
  writeJson(probeRoot, 'data/content/unbuilt_rich_page_backlog.json', { routes: [
    { route: '/uscis-medical/guides/retired-route/', disposition: 'RETIRED', retirement_reason_code: 'RETIRED_MODEL_NAME_IN_ROUTE' },
    { route: '/uscis-medical/guides/awaiting-route/', disposition: 'AWAITING_RELEASE_LANE' }
  ] });
  writeJson(probeRoot, 'artifacts/validation/agent-exact-implementation-trace.json', { traces: [
    { record_id: 'agent_exact_pass', trace_status: 'PASS' },
    { record_id: 'agent_exact_fail', trace_status: 'FAIL' }
  ] });

  const ledger = ledgerModule.loadRefusalLedger(probeRoot, { demandBackedRoute: Object.assign((route) => route !== '/trt/guides/no-demand/', { slugCount: 1 }) });
  const expectations = {
    BLOCKED: { id: 'agent_blocked', route: '/neuro/community-questions/blocked/', operation: 'CREATE_NEW_TARGET_PAGE' },
    REFUSED_TO_PROTECT_DELIVERED_CONTENT: { id: 'agent_any', route: '/trt/best-top-near-me/index.html', renderedPath: 'trt/best-top-near-me/index.html', operation: 'REPAIR_INTENDED_WINNER_PAGE' },
    REFUSED_BY_ACCEPTANCE_COMPILER: { id: 'agent_compiler_named', route: '/uscis-medical/exam-day-documents/', operation: 'REPAIR_INTENDED_WINNER_PAGE' },
    REFUSED_BY_RELEASE_QUEUE: { id: 'agent_queue_refused', route: '/trt/guides/queue-refused/', operation: 'CREATE_NEW_TARGET_PAGE' },
    DEFERRED_BY_DAILY_CEILING: { id: 'agent_ceiling', route: '/trt/guides/ceiling/', operation: 'CREATE_NEW_TARGET_PAGE' },
    HELD_BY_MEASURED_DEMAND_GATE: { id: 'agent_demand', route: '/trt/guides/demand/', operation: 'CREATE_NEW_TARGET_PAGE' },
    RETIRED_ROUTE: { id: 'agent_retired', route: '/uscis-medical/guides/retired-route/', operation: 'CREATE_NEW_TARGET_PAGE' }
  };
  for (const kind of Object.keys(ledgerModule.REFUSAL_KINDS || {})) {
    examined.kinds.push(kind);
    const key = expectations[kind];
    if (!key) { errors.push(`${MODULE_REL}:kind_${kind}_declared_but_this_validator_has_no_fixture_for_it - add one; a kind nothing can prove is a kind nothing guards`); continue; }
    const hold = ledger.namedStopFor(key);
    if (!hold || hold.kind !== kind) errors.push(`${MODULE_REL}:kind_${kind}_not_distinguished (got ${hold ? hold.kind : 'null'})`);
    else if (!hold.reason || !hold.source) errors.push(`${MODULE_REL}:kind_${kind}_reported_without_reason_or_source - a named stop must name its reason`);
  }
  // The route-level demand hold, with no skipped row naming the id.
  const demandByRoute = ledger.namedStopFor({ id: 'agent_unlisted', route: '/trt/guides/no-demand/', operation: 'CREATE_NEW_TARGET_PAGE' });
  examined.probes.push('demand_gate_by_route');
  if (!demandByRoute || demandByRoute.kind !== 'HELD_BY_MEASURED_DEMAND_GATE') errors.push(`${MODULE_REL}:route_with_no_measured_demand_not_held (got ${demandByRoute && demandByRoute.kind})`);

  // 2c. NEVER an excuse for a real miss.
  const negatives = [
    ['blocked_spec_without_reason', { id: 'agent_blocked_without_reason', route: '/neuro/community-questions/unreasoned/', operation: 'CREATE_NEW_TARGET_PAGE' }],
    ['admitted_queue_row', { id: 'agent_queue_admitted', route: '/trt/guides/admitted/', operation: 'CREATE_NEW_TARGET_PAGE' }],
    ['compiler_refusal_naming_other_ids', { id: 'agent_compiler_other', route: '/uscis-medical/exam-day-documents/', operation: 'REPAIR_INTENDED_WINNER_PAGE' }],
    ['route_still_awaiting_lane', { id: 'agent_awaiting', route: '/uscis-medical/guides/awaiting-route/', operation: 'CREATE_NEW_TARGET_PAGE' }],
    ['exact_trace_fail', { id: 'agent_exact_fail', route: '/trt/guides/exact-fail/', operation: 'CREATE_NEW_TARGET_PAGE' }],
    ['exact_trace_pass_missing_page', { id: 'agent_exact_pass', route: '/trt/guides/exact-pass/', operation: 'CREATE_NEW_TARGET_PAGE' }],
    ['create_hold_does_not_reach_a_repair', { id: 'agent_ceiling', route: '/trt/guides/ceiling/', operation: 'REPAIR_INTENDED_WINNER_PAGE' }],
    ['unrelated_page', { id: 'agent_nobody', route: '/trt/guides/nobody/', operation: 'REPAIR_INTENDED_WINNER_PAGE' }]
  ];
  for (const [label, key] of negatives) {
    examined.probes.push(`negative:${label}`);
    const hold = ledger.namedStopFor(key);
    if (hold) errors.push(`${MODULE_REL}:${label}_was_excused_as_${hold.kind} - this guard must never excuse an unexplained miss`);
  }
} finally {
  fs.rmSync(probeRoot, { recursive: true, force: true });
}

// ------------------------------------------------ 3a. staged is in flight, not built
const richRoutesRel = 'scripts/lib/rich_admitted_routes.js';
const builtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-predicate-'));
try {
  const { builtPredicate } = require(path.join(ROOT, richRoutesRel));
  writeJson(builtRoot, 'content/_live/pages.json', { pages: [{ slug: '/trt/guides/live/', path: '/trt/guides/live/' }] });
  writeJson(builtRoot, 'content/_staged/pages.json', { pages: [{ slug: '/trt/guides/staged-only/', path: '/trt/guides/staged-only/', publication_status: 'STAGED' }, { slug: '/trt/guides/live/', path: '/trt/guides/live/' }] });
  fs.mkdirSync(path.join(builtRoot, 'trt/guides/on-disk'), { recursive: true });
  fs.writeFileSync(path.join(builtRoot, 'trt/guides/on-disk/index.html'), '<html></html>');
  const isBuilt = builtPredicate(builtRoot);
  examined.probes.push('built_predicate');
  if (isBuilt('/trt/guides/staged-only/')) errors.push(`${richRoutesRel}:a_page_that_exists_only_in_staged_reads_as_built - the reconciler would delete its backlog entry, the queue would forget it, and the promoter could never move it to live`);
  if (typeof isBuilt.stagedOnly !== 'function' || !isBuilt.stagedOnly('/trt/guides/staged-only/')) errors.push(`${richRoutesRel}:stagedOnly_does_not_name_the_in_flight_state`);
  if (!isBuilt('/trt/guides/live/')) errors.push(`${richRoutesRel}:a_live_page_reads_as_unbuilt`);
  if (!isBuilt('/trt/guides/on-disk/')) errors.push(`${richRoutesRel}:rendered_html_on_disk_reads_as_unbuilt`);
  if (isBuilt('/trt/guides/never/')) errors.push(`${richRoutesRel}:a_route_with_nothing_behind_it_reads_as_built`);
} catch (err) {
  errors.push(`${richRoutesRel}:built_predicate_probe_threw:${err.message}`);
} finally {
  fs.rmSync(builtRoot, { recursive: true, force: true });
}

// --------------------------------- 3b. every query a merged spec carries reaches the page
const parserRel = 'scripts/lib/html_fix_acceptance_parser.js';
try {
  const { compileEntryFromSpec } = require(path.join(ROOT, parserRel));
  const queries = ['checklist of symptoms for hypogonadism vs chronic fatigue syndrome', "symptoms of low t in men over 40 that aren't just low libido"];
  const entry = compileEntryFromSpec({
    implementation_path: 'trt/best-top-near-me/index.html',
    target_route: '/trt/best-top-near-me/index.html',
    record_ids: ['agent_one', 'agent_two'],
    queries,
    fix_recommendations: ["FILEPATH: trt/best-top-near-me/index.html || CURRENT: General descriptions || MISSING: Step-by-step scoring checklist || EDIT: Add H2 'TRT Clinic Selection Checklist' with specific factors for monitoring and clinician continuity"]
  });
  examined.probes.push('surplus_queries_reach_the_page');
  const text = JSON.stringify(entry.artifacts || []).toLowerCase();
  for (const query of queries) {
    if (!text.includes(query.toLowerCase())) errors.push(`${parserRel}:merged_spec_dropped_query_"${query}" - a rebuild would lose the marker a landed row depends on and be refused for it on every release`);
  }
  if (!(entry.artifacts || []).length) errors.push(`${parserRel}:fixture_spec_compiled_to_zero_artifacts - the probe examined nothing`);
} catch (err) {
  errors.push(`${parserRel}:compile_probe_threw:${err.message}`);
}

// RULE 0: no stage may exit 0 having done nothing.
if (!examined.consumers.length || !examined.kinds.length) {
  console.error('SHARED REFUSAL LEDGER RESOLUTION FAIL: examined zero consumers or zero refusal kinds.');
  console.error(`  REFUSAL_LEDGER_CONSUMERS / REFUSAL_KINDS in ${MODULE_REL} are empty or unreadable, so this guard governs nothing.`);
  console.error('  A guard that cannot reach what it governs has not passed.');
  process.exit(1);
}

const report = {
  schema_version: '1.0',
  validator: 'shared-refusal-ledger-resolution',
  status: errors.length ? 'FAIL' : 'PASS',
  shared_module: MODULE_REL,
  consumers_examined: examined.consumers,
  consumer_count: examined.consumers.length,
  kinds_examined: examined.kinds,
  kind_count: examined.kinds.length,
  probes: examined.probes,
  forked_hold_patterns: FORKED_HOLD_PATTERNS.map((rule) => rule.id),
  errors,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10)
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/shared-refusal-ledger-resolution.json'), JSON.stringify(report, null, 2) + '\n');

if (errors.length) {
  console.error('SHARED REFUSAL LEDGER RESOLUTION FAIL');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(`SHARED REFUSAL LEDGER RESOLUTION PASS: ${examined.consumers.length} consumer(s) resolve through ${MODULE_REL}; ${examined.kinds.length} refusal kind(s) each distinguished from an unexplained miss; ${examined.probes.length} probe(s); staged-only is not built; every query a merged spec carries reaches the page.`);
