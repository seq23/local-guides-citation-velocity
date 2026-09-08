#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * An outcome nobody prints is an outcome nobody acts on.
 *
 * Velocity Content Release failed for five runs on 2026-09-06 with
 *
 *   agent-exact-implementation-trace FAIL
 *   - agent_d1649ef9efb0d9ce:repair_not_proven:uscis-medical/index.html
 *
 * The claim was true: acceptMutationScope() had REFUSED that repair to protect nine
 * landed recommendations the page was already delivering, so it genuinely did not
 * land. Naming that refusal (#83) turned the lane green - but only in the JSON. The
 * printed line still read
 *
 *   AGENT EXACT IMPLEMENTATION TRACE PASS: 196 spec(s); proven=19; blocked=0;
 *   carried=176; deferred=0; demand_held=0
 *
 * 19 + 176 = 195 of 196. The single spec missing from the arithmetic was the refusal
 * itself - the one thing an operator needed to see. REFUSED_BY_RELEASE_QUEUE, added
 * earlier, had no count anywhere at all. Both were invisible for the same reason: the
 * trace declared its counts with a hand-written list of countBy() calls, and a status
 * absent from that list is absent from the evidence and from the log, while the run
 * still reports PASS.
 *
 * A legitimate stop must be GREEN AND SAID OUT LOUD. Green and silent is how a repair
 * that can never land gets re-planned and re-refused every day forever with nobody
 * ever told.
 *
 * This validator asserts, on the trace report the release actually produced:
 *
 *   A. Every spec in the plan carries an outcome. A spec that reaches no branch
 *      leaves no trace and used to vanish between plan_count and the summary.
 *   B. Every outcome that occurred is counted, and every count corresponds to real
 *      traces - no declared bucket without traces, no traced status without a count.
 *   C. Every outcome that occurred appears in the printed summary line, built by the
 *      same traceSummaryLine() the tracer prints.
 *   D. The legacy named *_count fields agree with the derived census, so a reader of
 *      either surface gets the same numbers.
 *   E. The runtime log directory this run wrote to is named for TODAY. It used to be
 *      named from the runner's frozen stableTimestamp(), so a run on 2026-09-06
 *      printed a log path dated 2026-06-23 and triage spent its first pass chasing
 *      state staleness that did not exist.
 *
 * Rule 0: examining zero specs, or finding zero runtime directories, is a FAILURE.
 * A trace over an empty plan proves nothing and is indistinguishable from a planner
 * that stopped producing work.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { traceOutcomeCounts, traceSummaryLine, traceReconciliationErrors } = require('../lib/agent_exact_repairs');
const { runtimeDirName } = require('../validation/registry_lib');

const DEFAULT_REPORT_REL = 'artifacts/validation/agent-exact-implementation-trace.json';
const RUNTIME_REL = 'artifacts/validation/runtime';
const OUT_REL = 'artifacts/validation/trace-outcome-legibility.json';

function rel(p) { return path.isAbsolute(p) ? p : path.join(ROOT, p); }

// --report is for the negative proof only. It can point this check at a different
// report; it can never make it examine fewer things or skip an assertion.
function reportPathFromArgv(argv) {
  const i = argv.indexOf('--report');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_REPORT_REL;
}

function newestRuntimeDir() {
  let dir;
  try { dir = fs.readdirSync(rel(RUNTIME_REL), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return null; }
  if (!dir.length) return null;
  return dir
    .map((name) => ({ name, mtimeMs: fs.statSync(path.join(rel(RUNTIME_REL), name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].name;
}

function main() {
  const errors = [];
  const reportRel = reportPathFromArgv(process.argv.slice(2));
  let report = null;
  try { report = JSON.parse(fs.readFileSync(rel(reportRel), 'utf8')); } catch (err) {
    console.error('TRACE OUTCOME LEGIBILITY FAIL');
    console.error(`- trace_report_unreadable:${reportRel}: ${err.message}`);
    console.error('  The trace report is the evidence this check exists to read. Absent, it');
    console.error('  proves nothing, and a pass here would mean exactly that.');
    process.exit(1);
  }

  const traces = report.traces || [];
  const planCount = Number(report.plan_count || 0);
  const derived = traceOutcomeCounts(traces);
  const summaryLine = traceSummaryLine(report);

  // Rule 0. Zero specs examined is never a pass.
  if (!traces.length || !planCount) {
    console.error('TRACE OUTCOME LEGIBILITY FAIL');
    console.error(`- examined_zero_specs:${reportRel}:plan_count=${planCount}:traces=${traces.length}`);
    console.error('  An empty plan is not a clean run. It is indistinguishable from a planner');
    console.error('  that stopped producing work, which is the failure a trace exists to catch.');
    process.exit(1);
  }

  // A, B and C.
  for (const problem of traceReconciliationErrors(report)) errors.push(problem);

  // D. The named fields and the derived census must not disagree.
  const LEGACY = [
    ['proven_count', 'PASS'],
    ['blocked_count', 'BLOCKED'],
    ['carried_count', 'CARRIED'],
    ['deferred_count', 'DEFERRED_BY_DAILY_CEILING'],
    ['demand_held_count', 'HELD_BY_MEASURED_DEMAND_GATE'],
    ['refused_count', 'REFUSED_TO_PROTECT_DELIVERED_CONTENT'],
    ['queue_refused_count', 'REFUSED_BY_RELEASE_QUEUE'],
    ['failed_count', 'FAIL']
  ];
  for (const [field, status] of LEGACY) {
    const declared = Number(report[field] || 0);
    const actual = Number(derived[status] || 0);
    // failed_count is allowed to exceed FAIL traces: reconciliation errors are
    // failures of the report itself and carry no trace row.
    if (field === 'failed_count' ? declared < actual : declared !== actual) {
      errors.push(`named_field_disagrees_with_census:${field}=${declared}:${status}=${actual}`);
    }
  }

  // E. The runtime log directory names the run that wrote it, not a frozen dataset date.
  const today = new Date().toISOString().slice(0, 10);
  const expected = runtimeDirName();
  if (!expected.startsWith(`${today}-`)) errors.push(`runtime_dir_name_not_wall_clock_dated:${expected}`);
  const ciForm = runtimeDirName(new Date(), { GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '2' });
  if (!ciForm.includes('gh1-2')) errors.push(`runtime_dir_name_drops_ci_run_identity:${ciForm}`);
  const observed = newestRuntimeDir();
  if (!observed) {
    errors.push('no_runtime_dir_observed: this check never saw a validation run write a log directory');
  } else if (!observed.startsWith(`${today}-`)) {
    errors.push(`runtime_dir_written_today_is_misdated:${observed}:today=${today}`);
  }

  const out = {
    schema_version: '1.0',
    guard: 'trace-outcome-legibility',
    checked_at: today,
    trace_report: reportRel,
    plan_count: planCount,
    traced_count: traces.length,
    outcome_census: derived,
    summary_line: summaryLine,
    runtime_dir_expected: expected,
    runtime_dir_observed: observed,
    status: errors.length ? 'FAIL' : 'PASS',
    errors
  };
  fs.mkdirSync(path.dirname(rel(OUT_REL)), { recursive: true });
  fs.writeFileSync(rel(OUT_REL), JSON.stringify(out, null, 2) + '\n');

  if (errors.length) {
    console.error('TRACE OUTCOME LEGIBILITY FAIL');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  const outcomes = Object.keys(derived).length;
  console.log(`TRACE OUTCOME LEGIBILITY PASS: ${planCount} spec(s) planned, ${traces.length} traced, ${outcomes} distinct outcome(s) all counted and all printed; runtime log dir ${observed}`);
  console.log(`  summary under test: ${summaryLine}`);
}

main();
