#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Two guards asking one question must hold one threshold.
 *
 * agent-artifact-continuity and agent-artifact-stranding both ask: is there a landed
 * agent run marked READY_FOR_ABSORPTION with no normalized artifact beside it?
 * agent-artifact-stranding answers it against a window derived from the cron of the
 * lane that dispatches the absorption. agent-artifact-continuity used to answer it with
 * zero tolerance, which made the raw agent drop a HARD FAILURE the instant it landed -
 * before the workflow that normalizes it had run at all. Validate Repo therefore went
 * red on the drop commit on 2026-09-01, 09-02, 09-03 and 09-04, including on days the
 * release lane then succeeded and repaired the state minutes later. One red per day,
 * for a contract nothing had yet had a turn to satisfy.
 *
 * This guard holds the repaired arrangement in place. It proves, against a table of
 * constructed cases rather than against whatever happens to be on disk today:
 *
 *   1. continuity imports its window from stranding rather than restating a number,
 *      so shortening the dispatch cron tightens both at once;
 *   2. inside the window a pending run is a NAMED, reported state, not silence;
 *   3. at the boundary and beyond it is a HARD ERROR again, in continuity as well as
 *      in stranding - the tolerance is a handoff window, not an amnesty;
 *   4. a run that is already ABSORBED gets no window at all.
 *
 * Rule 0: examining zero cases, or a window this cannot read, is a FAILURE.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT_REL = 'artifacts/validation/absorption-window-agreement.json';
const CONTINUITY_REL = 'scripts/validators/validate_agent_artifact_continuity.js';
const STRANDING_REL = 'scripts/validators/validate_agent_artifact_stranding.js';

const stranding = require('./validate_agent_artifact_stranding');
const { classifyPendingAbsorption } = require('./validate_agent_artifact_continuity');

const errors = [];
const cases = [];

// 1. The window is imported, not restated. A literal day count in the continuity
//    validator would survive every behavioural check below and still drift the moment
//    the dispatch cron changed, so the source linkage is asserted on the text.
const continuitySrc = fs.readFileSync(path.join(ROOT, CONTINUITY_REL), 'utf8');
if (!/require\(['"]\.\/validate_agent_artifact_stranding['"]\)/.test(continuitySrc)) {
  errors.push(`${CONTINUITY_REL}:does_not_import_the_window_from:${STRANDING_REL} - a second copy of the threshold is a second threshold`);
}
if (typeof stranding.absorptionWindow !== 'function') {
  errors.push(`${STRANDING_REL}:absorptionWindow_not_exported - continuity has nothing to import`);
}
if (typeof classifyPendingAbsorption !== 'function') {
  errors.push(`${CONTINUITY_REL}:classifyPendingAbsorption_not_exported - this guard cannot exercise the decision it governs`);
}

const window = typeof stranding.absorptionWindow === 'function' ? stranding.absorptionWindow() : { error: 'absorptionWindow unavailable' };
if (window.error) {
  console.error(`ABSORPTION WINDOW AGREEMENT FAIL: the window is unreadable (${window.error}). An unreadable threshold is not a permissive one.`);
  process.exit(1);
}
if (!Number.isInteger(window.allowedDays) || window.allowedDays < 0) {
  errors.push(`window_not_a_day_count:${JSON.stringify(window)}`);
}

// 2/3/4. Behaviour, over a constructed table. Each case names the verdict the pipeline
// depends on, so a future edit that turns a boundary failure back into a warning fails
// here rather than in production three weeks later.
const allowed = window.allowedDays;
const table = [
  { name: 'fresh_drop_same_day', status: 'READY_FOR_ABSORPTION', ageDays: 0, expect: 'PENDING_NAMED' },
  { name: 'inside_window', status: 'READY_FOR_ABSORPTION', ageDays: Math.max(0, allowed - 1), expect: 'PENDING_NAMED' },
  { name: 'at_the_boundary', status: 'READY_FOR_ABSORPTION', ageDays: allowed, expect: 'PENDING_NAMED' },
  { name: 'one_day_past_the_boundary', status: 'READY_FOR_ABSORPTION', ageDays: allowed + 1, expect: 'HARD_ERROR' },
  { name: 'long_stranded', status: 'READY_FOR_ABSORPTION', ageDays: allowed + 30, expect: 'HARD_ERROR' },
  { name: 'unreadable_run_date', status: 'READY_FOR_ABSORPTION', ageDays: null, expect: 'HARD_ERROR' },
  { name: 'negative_age_future_dated', status: 'READY_FOR_ABSORPTION', ageDays: -1, expect: 'HARD_ERROR' },
  { name: 'already_absorbed_gets_no_window', status: 'ABSORBED', ageDays: 0, expect: 'HARD_ERROR' },
];

for (const row of table) {
  const verdict = typeof classifyPendingAbsorption === 'function'
    ? classifyPendingAbsorption({ status: row.status, ageDays: row.ageDays, window })
    : 'UNAVAILABLE';
  cases.push({ ...row, allowed_days: allowed, actual: verdict, ok: verdict === row.expect });
  if (verdict !== row.expect) {
    errors.push(`case:${row.name}:status=${row.status}:age_days=${row.ageDays}:allowed_days=${allowed}:expected=${row.expect}:actual=${verdict}`);
  }
}

// The same boundary must bind the guard that owns it. A window continuity honours and
// stranding does not is still two thresholds.
const strandingSrc = fs.readFileSync(path.join(ROOT, STRANDING_REL), 'utf8');
if (!strandingSrc.includes('allowedDays') && !strandingSrc.includes('allowed_pending_days')) {
  errors.push(`${STRANDING_REL}:no_longer_enforces_a_pending_day_allowance`);
}

if (!cases.length) {
  console.error('ABSORPTION WINDOW AGREEMENT FAIL: examined zero cases. Refusing to pass on an empty loop.');
  process.exit(1);
}

const report = {
  schema_version: '1.0',
  validator: 'absorption-window-agreement',
  status: errors.length ? 'FAIL' : 'PASS',
  window,
  cases_examined: cases.length,
  cases,
  errors,
};
fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  for (const e of errors) console.error(`ABSORPTION WINDOW AGREEMENT FAIL: ${e}`);
  console.error(`ABSORPTION WINDOW AGREEMENT: FAIL - ${cases.length} case(s) examined. Report: ${OUT_REL}`);
  process.exit(1);
}
console.log(`ABSORPTION WINDOW AGREEMENT PASS: ${cases.length} case(s) examined against the ${window.allowedDays}-day window derived from ${window.source}; continuity names a pending run inside it and hard-fails at ${window.allowedDays + 1} day(s).`);
