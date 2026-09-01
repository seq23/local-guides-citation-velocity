#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// A row that was not worked has to say why it was not worked - accurately.
//
// Every unselected ready row used to be stamped
// UNSELECTED_READY_ROW_OUTSIDE_PROCESSING_BUDGET, whether or not the budget had
// anything to do with it. On 2026-09-01 the processing budget was 125 and twelve rows
// were selected: it never bound once. Eight rows across the 2026-08-13 neuro and
// 2026-08-14 USCIS runs still carried that reason, and the absorption report repeated
// it as the cause of the shortfall. The intake had already written the truth to
// data/report_fixes/agent_artifact_disposition_ledger.json -
// `exact_title_already_exists_in_pages`. The pages were there.
//
// This is worse than a missing reason. A wrong one is load-bearing: it sends the next
// reader to raise a cap that was never the problem, and it hides the fact that the work
// was already done. That is the same class of defect as a validator that asserts
// client-facing prose instead of behaviour - it exits 0 having proven nothing.
//
// So two things are checked, on every carried spec:
//
//   1. A spec may not blame the processing budget unless the budget actually bound -
//      selected_count >= processing_budget_units in the release plan for that run.
//   2. Where the intake recorded a disposition for that row, the spec's carried_reason
//      must be that disposition's reason and not a substitute.
//
// Rule 0: a plan with zero specs is a FAILURE, not a pass on an empty loop.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PLAN = 'data/report_fixes/agent_exact_implementation_plan.json';
const RELEASE_PLAN = 'artifacts/validation/velocity-intake-release-plan.json';
const DISPOSITIONS = 'data/report_fixes/agent_artifact_disposition_ledger.json';
const OUT = 'artifacts/validation/carried-reason-truthfulness.json';
const BUDGET_REASON = 'UNSELECTED_READY_ROW_OUTSIDE_PROCESSING_BUDGET';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function main() {
  const plan = readJson(PLAN, null);
  if (!plan || !Array.isArray(plan.specs)) {
    console.error(`CARRIED REASON TRUTHFULNESS FAIL: ${PLAN} is missing or carries no specs. With no plan there is nothing to check, which is not the same as nothing being wrong.`);
    process.exit(1);
  }
  if (!plan.specs.length) {
    console.error(`CARRIED REASON TRUTHFULNESS FAIL: ${PLAN} has zero specs. An empty plan and a clean plan are indistinguishable from the outside.`);
    process.exit(1);
  }

  const release = readJson(RELEASE_PLAN, {});
  const budget = Number(release.processing_budget_units || 0);
  const selected = Number(release.selected_count || 0);
  // The budget BOUND only if selection actually ran into it. A budget of 125 with
  // twelve rows selected did not stop anything.
  const budgetBound = Boolean(budget) && selected >= budget;

  const dispositionById = new Map();
  for (const entry of readJson(DISPOSITIONS, { entries: [] }).entries || []) {
    if (entry && entry.id) dispositionById.set(String(entry.id), entry);
  }

  const carried = plan.specs.filter((spec) => String(spec.status || '') === 'CARRIED');
  const errors = [];
  const rows = [];

  for (const spec of carried) {
    const reason = String(spec.carried_reason || '').trim();
    const recorded = dispositionById.get(String(spec.record_id || ''));
    const recordedReason = String(recorded?.status_reason || '').trim();
    const recordedDisposition = String(recorded?.disposition || '').trim();
    rows.push({ record_id: spec.record_id, run_date: spec.run_date, target_route: spec.target_route || '', carried_reason: reason, recorded_disposition: recordedDisposition, recorded_reason: recordedReason });

    if (!reason) {
      errors.push(`${spec.record_id}:carried_without_reason`);
      continue;
    }
    if (reason === BUDGET_REASON && !budgetBound) {
      errors.push(`${spec.record_id}:blames_budget_that_did_not_bind:selected=${selected}/budget=${budget}${recordedReason ? `:recorded=${recordedReason}` : ''}`);
      continue;
    }
    if (recordedDisposition === 'SKIPPED' && recordedReason && reason !== recordedReason) {
      errors.push(`${spec.record_id}:carried_reason_contradicts_intake:${reason}!=${recordedReason}`);
    }
  }

  const report = {
    schema_version: '1.0',
    validator: 'carried-reason-truthfulness',
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: new Date().toISOString(),
    specs_examined: plan.specs.length,
    carried_examined: carried.length,
    processing_budget_units: budget,
    selected_count: selected,
    budget_bound: budgetBound,
    errors,
    rows: rows.slice(0, 200)
  };
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify(report, null, 2)}\n`);

  if (errors.length) {
    console.error(`CARRIED REASON TRUTHFULNESS FAIL: ${errors.length} carried row(s) state a reason the record does not support.`);
    for (const e of errors.slice(0, 30)) console.error(`- ${e}`);
    if (errors.length > 30) console.error(`- ... and ${errors.length - 30} more; see ${OUT}`);
    process.exit(1);
  }
  console.log(`CARRIED REASON TRUTHFULNESS PASS: ${plan.specs.length} spec(s); ${carried.length} carried; budget ${selected}/${budget} (${budgetBound ? 'bound' : 'did not bind'}); every carried reason matches the record.`);
}

main();
