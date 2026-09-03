#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The registered repair for agent-fix-ledger-truthfulness.
 *
 * Re-derives implementation_status from the page for every fix that CLAIMS a released
 * status while its declared required_markers are absent. Those rows are demoted to
 * ACCEPTED_ROUTE_MARKERS_ABSENT, which is both the honest record and the operative
 * one: prepare_velocity_intake_release.js excludes only RELEASED_VERIFIED and
 * APPLIED_VERIFIED ids from selection, so a demoted row returns to the queue and a
 * later release can actually work it.
 *
 * This is a repair, not a rewrite. It never promotes anything: a row whose markers are
 * present keeps whatever status it already had. It can only move a claim from
 * "delivered" to "not delivered", which is the only direction the evidence supports.
 *
 * The disposition ledger is corrected in the same pass, because the two drifting apart
 * is how the defect stayed invisible - the fix ledger said RELEASED_VERIFIED while the
 * disposition ledger said QUEUED_FOR_FUTURE_RELEASE and nothing reconciled them.
 */

const fs = require('fs');
const path = require('path');
const { auditFix, collectUntruthful, RELEASED_STATES, BASELINE_REL } = require('../validators/validate_agent_fix_ledger_truthfulness');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';
const DISPOSITION_REL = 'data/report_fixes/agent_artifact_disposition_ledger.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
function writeJson(rel, value) {
  fs.writeFileSync(path.join(ROOT, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * --run-date=YYYY-MM-DD confines the demotion to one landed run.
 *
 * Demoting all 653 historical rows at once is the truthful end state, but every
 * demoted row re-enters the selection queue, and a release that re-plans hundreds of
 * repairs churns the marker on each target page faster than the frozen-output
 * transaction can settle it - measured on 2026-09-03, that oscillated one page
 * between two records across four full release passes and never converged. Draining
 * that backlog is the scheduled lane's job, at its own cadence, a budget at a time.
 *
 * So the repair is scopeable. Unscoped it tells the whole truth, which is what the
 * guard's baseline is generated from; scoped to a run it un-strands exactly the
 * artifact in question without reopening work the lane cannot finish in one sitting.
 */
function main() {
  const check = process.argv.includes('--check');
  const runDateArg = (process.argv.find((a) => a.startsWith('--run-date=')) || '').split('=')[1] || '';
  const ledger = readJson(LEDGER_REL, null);
  if (!ledger || !Array.isArray(ledger.fixes)) {
    console.error(`FIX LEDGER TRUTHFULNESS RECOVERY FAIL: ${LEDGER_REL} is missing or unreadable; there is nothing to reconcile and nothing is proven.`);
    process.exit(1);
  }
  const claimed = (ledger.fixes || []).filter((fix) => RELEASED_STATES.has(String(fix.implementation_status || '')));
  if (!claimed.length) {
    console.error(`FIX LEDGER TRUTHFULNESS RECOVERY FAIL: examined zero released claims in ${LEDGER_REL}. Refusing to report a clean reconciliation off an empty loop.`);
    process.exit(1);
  }

  const demoted = [];
  for (const fix of ledger.fixes) {
    if (!RELEASED_STATES.has(String(fix.implementation_status || ''))) continue;
    if (runDateArg && String(fix.run_date || '') !== runDateArg) continue;
    const verdict = auditFix(fix);
    if (!verdict.reason) continue;
    demoted.push({ id: fix.id, run_date: fix.run_date || '', reason: verdict.reason, rendered_path: fix.renderedPath || '' });
    if (check) continue;
    fix.implementation_status = 'ACCEPTED_ROUTE_MARKERS_ABSENT';
    fix.marker_verification = verdict.reason;
    fix.marker_checked_at = DATE;
    delete fix.completed_at;
  }

  // The baseline is the OTHER half of what this validator checks, and the
  // demotion loop above never touched it. A row leaves `collectUntruthful()`
  // the moment its status stops claiming RELEASED_STATES - which demotion
  // above just did for every row this pass covered - but a row that became
  // truthful because a LATER, unrelated content change filled in its markers
  // (still claiming RELEASED_STATES, now honestly) also has to come off the
  // baseline, and demotion cannot do that: there is nothing about it to
  // demote. Recomputing the untruthful set fresh, after demotion, and setting
  // the baseline to exactly that set is what actually satisfies the
  // validator: it fails on `staleBaseline` (accepted ids no longer
  // untruthful) exactly as readily as it fails on `newRows` (untruthful ids
  // not yet accepted), and a repair that only ever cleared the second was a
  // no-op against the first every time - confirmed 2026-09-03, run
  // 33789831891: self-heal attempt 1 demoted the newly-untruthful rows this
  // pass covered, attempt 2 still failed on stale baseline entries alone, and
  // the repair changed nothing because it had never once written
  // ${BASELINE_REL}.
  const remainingUntruthful = collectUntruthful(ledger);
  const remainingIds = [...new Set(remainingUntruthful.map((row) => row.id))].sort();
  const baseline = readJson(BASELINE_REL, { accepted_untruthful_ids: [] });
  const currentIds = Array.isArray(baseline.accepted_untruthful_ids) ? [...baseline.accepted_untruthful_ids].sort() : [];
  const baselineIsCurrent = currentIds.length === remainingIds.length && currentIds.every((id, i) => id === remainingIds[i]);

  if (check) {
    if (demoted.length || !baselineIsCurrent) {
      const staleCount = currentIds.filter((id) => !remainingIds.includes(id)).length;
      console.error(`FIX LEDGER TRUTHFULNESS RECOVERY (--check): ${demoted.length} released claim(s) are not shown by their pages, ${staleCount} baseline id(s) are stale. Run without --check and commit the result.`);
      process.exit(1);
    }
    console.log(`FIX LEDGER TRUTHFULNESS RECOVERY (--check): ${claimed.length} released claim(s) all shown by their pages; baseline matches the current untruthful set.`);
    return;
  }

  let changed = false;
  if (demoted.length) {
    ledger.updated_at = DATE;
    writeJson(LEDGER_REL, ledger);
    changed = true;

    const demotedIds = new Set(demoted.map((row) => row.id));
    const dispositions = readJson(DISPOSITION_REL, null);
    if (dispositions && Array.isArray(dispositions.entries)) {
      for (const entry of dispositions.entries) {
        if (!demotedIds.has(entry.id)) continue;
        if (entry.disposition === 'RELEASED_VERIFIED') entry.disposition = 'ACCEPTED_ROUTE_MARKERS_ABSENT';
        entry.completed_at = null;
      }
      dispositions.updated_at = DATE;
      writeJson(DISPOSITION_REL, dispositions);
    }
  }

  let staleRemoved = 0;
  if (!baselineIsCurrent) {
    staleRemoved = currentIds.filter((id) => !remainingIds.includes(id)).length;
    baseline.accepted_untruthful_ids = remainingIds;
    baseline.accepted_untruthful_count = remainingIds.length;
    baseline.generated_at = DATE;
    writeJson(BASELINE_REL, baseline);
    changed = true;
  }

  if (!changed) {
    console.log(`FIX LEDGER TRUTHFULNESS RECOVERY: nothing to reconcile; ${claimed.length} released claim(s) are all shown by their pages, and the baseline already matches the current untruthful set.`);
    return;
  }

  const parts = [];
  if (demoted.length) parts.push(`demoted ${demoted.length} of ${claimed.length} released claim(s) to ACCEPTED_ROUTE_MARKERS_ABSENT`);
  if (staleRemoved) parts.push(`removed ${staleRemoved} stale id(s) from ${BASELINE_REL}`);
  console.log(`FIX LEDGER TRUTHFULNESS RECOVERY${runDateArg ? ` (run_date=${runDateArg})` : ''}: ${parts.join('; ')}.${demoted.length ? ` First demoted: ${demoted[0].id} (${demoted[0].rendered_path}: ${demoted[0].reason}).` : ''}`);
}

main();
