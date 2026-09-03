#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Per-run delivery coverage may only improve.
 *
 * agent-fix-ledger-truthfulness proves that a row CLAIMING a released status is
 * shown by its page. It is scoped to the claim, and that scope has a hole the
 * registered repair drives straight through: `recover:fix-ledger-truthfulness`
 * demotes an untruthful row to ACCEPTED_ROUTE_MARKERS_ABSENT, which is honest and
 * necessary - but a demoted row no longer claims a released status, so it leaves
 * the truthfulness guard's field of view entirely. Drain the whole backlog and
 * that guard goes quiet without one marker reaching one page.
 *
 * This guard counts the other thing: for every run, how many of its declared
 * recommendations are actually shown by the page they named, whatever status the
 * ledger has since given them. Demoting a row cannot move this number. Only
 * putting the requested content on the page can.
 *
 * The baseline is a RATCHET, per run. A run may never have more gaps than its
 * baseline; a run whose gaps have fallen must be re-baselined down, and a run not
 * in the baseline at all must have zero gaps. It only shrinks.
 *
 * Rule 0: examining zero rows is a FAILURE. An empty ledger proves nothing.
 */

const fs = require('fs');
const path = require('path');
const { auditFix } = require('./validate_agent_fix_ledger_truthfulness');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';
const BASELINE_REL = 'data/report_fixes/agent_run_delivery_coverage_baseline.json';
const OUT_REL = 'artifacts/validation/agent-run-delivery-coverage.json';

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

/** Per-run declared / actionable / rendered / gaps, from the page as authority. */
function measure(ledger) {
  const runs = new Map();
  for (const fix of ledger.fixes || []) {
    const runDate = String(fix.run_date || '(undated)');
    if (!runs.has(runDate)) runs.set(runDate, { run_date: runDate, declared: 0, actionable: 0, rendered: 0, gaps: 0 });
    const row = runs.get(runDate);
    row.declared += 1;
    const verdict = auditFix(fix);
    const unverifiable = verdict.reason === 'no_rendered_path' || verdict.reason === 'rendered_file_missing' || verdict.reason === 'no_required_markers';
    if (!unverifiable) {
      row.actionable += 1;
      if (!verdict.reason) row.rendered += 1;
    }
    if (verdict.reason) row.gaps += 1;
  }
  const table = [...runs.values()].sort((a, b) => a.run_date.localeCompare(b.run_date));
  for (const row of table) row.coverage_pct = row.actionable ? Number(((row.rendered / row.actionable) * 100).toFixed(1)) : 0;
  return table;
}

function main() {
  const rebaseline = process.argv.includes('--rebaseline');
  const ledger = readJson(LEDGER_REL, null);
  if (!ledger || !Array.isArray(ledger.fixes) || !ledger.fixes.length) {
    console.error(`AGENT RUN DELIVERY COVERAGE FAIL: ${LEDGER_REL} is missing, unreadable or empty, so this validator examined zero recommendations. Coverage is UNKNOWN, not proven.`);
    process.exit(1);
  }
  const table = measure(ledger);
  if (!table.length) {
    console.error('AGENT RUN DELIVERY COVERAGE FAIL: examined zero runs. Refusing to pass on an empty loop.');
    process.exit(1);
  }

  const baseline = readJson(BASELINE_REL, null);
  const allowed = new Map(Object.entries((baseline && baseline.max_gaps_by_run) || {}));

  const regressions = [];
  const improved = [];
  for (const row of table) {
    const cap = allowed.has(row.run_date) ? Number(allowed.get(row.run_date)) : 0;
    if (row.gaps > cap) regressions.push({ ...row, allowed: cap, over_by: row.gaps - cap });
    else if (row.gaps < cap) improved.push({ ...row, allowed: cap, under_by: cap - row.gaps });
  }
  const totals = table.reduce((acc, row) => ({
    declared: acc.declared + row.declared,
    actionable: acc.actionable + row.actionable,
    rendered: acc.rendered + row.rendered,
    gaps: acc.gaps + row.gaps,
  }), { declared: 0, actionable: 0, rendered: 0, gaps: 0 });
  totals.runs = table.length;
  totals.coverage_of_actionable_pct = totals.actionable ? Number(((totals.rendered / totals.actionable) * 100).toFixed(1)) : 0;
  totals.coverage_of_declared_pct = Number(((totals.rendered / totals.declared) * 100).toFixed(1));

  if (rebaseline) {
    // The ratchet only tightens: a run's new cap is the lower of what it was
    // allowed and what it actually has. A rebaseline can never buy slack.
    const next = {};
    for (const row of table) {
      const cap = allowed.has(row.run_date) ? Number(allowed.get(row.run_date)) : row.gaps;
      next[row.run_date] = Math.min(cap, row.gaps);
    }
    const out = {
      schema_version: '1.0',
      note: 'Shrink-only ratchet. Each value is the maximum number of recommendations that run is permitted to leave unshown by its target page. Lower it when a repair lands; never raise it.',
      updated_at: new Date().toISOString().slice(0, 10),
      total_max_gaps: Object.values(next).reduce((a, b) => a + b, 0),
      max_gaps_by_run: next,
    };
    fs.writeFileSync(path.join(ROOT, BASELINE_REL), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    console.log(`AGENT RUN DELIVERY COVERAGE REBASELINE: ${Object.keys(next).length} run(s), total allowed gaps ${out.total_max_gaps} (was ${baseline ? baseline.total_max_gaps : 'unset'}).`);
    return;
  }

  const report = {
    schema_version: '1.0',
    validator: 'agent-run-delivery-coverage',
    status: regressions.length || improved.length ? 'FAIL' : 'PASS',
    totals,
    baseline_total_max_gaps: baseline ? baseline.total_max_gaps : null,
    regressions,
    regression_count: regressions.length,
    ratchet_not_tightened: improved,
    ratchet_not_tightened_count: improved.length,
    per_run: table,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (!baseline) {
    console.error(`AGENT RUN DELIVERY COVERAGE FAIL: ${BASELINE_REL} is missing. Without a ratchet there is nothing to regress against, so coverage is unguarded. Create it with: node scripts/validators/validate_agent_run_delivery_coverage.js --rebaseline`);
    process.exit(1);
  }
  for (const row of regressions.slice(0, 25)) {
    console.error(`AGENT RUN DELIVERY COVERAGE FAIL: run ${row.run_date} leaves ${row.gaps} recommendation(s) unshown by their pages but is only allowed ${row.allowed} (over by ${row.over_by}). Coverage ${row.rendered}/${row.actionable} = ${row.coverage_pct}%. A count is not a change: put the requested content on the page, do not restate the record.`);
  }
  for (const row of improved.slice(0, 25)) {
    console.error(`AGENT RUN DELIVERY COVERAGE FAIL: run ${row.run_date} is now down to ${row.gaps} gap(s) from an allowance of ${row.allowed}. The ratchet must be tightened to ${row.gaps} in ${BASELINE_REL}, or the same ${row.under_by} gap(s) can silently come back.`);
  }
  if (report.status === 'FAIL') {
    console.error(`AGENT RUN DELIVERY COVERAGE: FAIL - examined ${totals.declared} recommendation(s) across ${totals.runs} run(s); ${totals.rendered}/${totals.actionable} shown (${totals.coverage_of_actionable_pct}%). Tighten or repair with: node scripts/validators/validate_agent_run_delivery_coverage.js --rebaseline`);
    process.exit(1);
  }
  console.log(`AGENT RUN DELIVERY COVERAGE PASS: examined ${totals.declared} recommendation(s) across ${totals.runs} run(s); ${totals.rendered}/${totals.actionable} actionable shown by their pages (${totals.coverage_of_actionable_pct}%), ${totals.gaps} gap(s) all within the shrink-only ratchet of ${baseline.total_max_gaps}.`);
}

if (require.main === module) main();
module.exports = { measure, BASELINE_REL, LEDGER_REL };
