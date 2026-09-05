#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * An artifact that landed must be claimed by SOME run, not just the one it triggered.
 *
 * Velocity Content Release fires on a push that adds an agent_run_manifest.json. That
 * is one attempt. On 2026-09-02 the TRT run landed at 13:51, the lane ran at 13:52 on
 * that exact sha, and died at validate:release on the recovery-store midnight defect.
 * Steps 13 through 17 - absorption, content release, publish - never executed. The
 * manifest stayed READY_FOR_ABSORPTION, trt/index.html was untouched, and nothing ever
 * looked at the artifact again, because the workflow only triggers on a NEW manifest
 * and that manifest had already landed. The defect was fixed and merged three hours
 * later and the artifact was still stranded: the fix had nothing to run on.
 *
 * The catch-up is a dispatch, not a schedule. This repo permits exactly one scheduled
 * committer - workflow-runtime-mutations enforces that - so query-evidence-refresh.yml
 * now also wakes the release lane when a manifest is still unabsorbed, alongside the
 * two reasons it already dispatched for. The release lane's absorption step re-walks
 * every manifest on disk, so a dispatch IS the retry.
 *
 * This validator guards that arrangement, and it deliberately does NOT hardcode a
 * number of days. It reads the cron out of the dispatching workflow and demands that no
 * manifest sit pending longer than the interval that cron declares. Shorten the
 * schedule and the guard tightens with it; delete the schedule, or delete the
 * pending-manifest condition, and the guard fails outright rather than quietly going to
 * sleep - which is what a hardcoded "3 days" would have done.
 *
 * Rule 0: examining zero manifests is a FAILURE. No agent runs on disk means stranding
 * is UNKNOWN, not absent.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const RUNS_REL = 'data/report_fixes/agent_runs';
const NORMALIZED_REL = 'data/report_fixes/normalized_agent_runs';
// The cadence comes from the lane that actually WAKES the release, not from the
// release lane itself. This repo permits exactly one scheduled committer
// (workflow-runtime-mutations enforces it), so Velocity Content Release carries no
// schedule of its own and is dispatched by query-evidence-refresh.yml. Reading the
// cron off the release lane would find nothing and fail for the wrong reason.
const WORKFLOW_REL = '.github/workflows/query-evidence-refresh.yml';
// The dispatch is only a catch-up if it fires on a pending manifest. Deleting that
// condition would leave the schedule in place and this guard satisfied while nothing
// ever claimed a stranded run again, so the guard checks the condition is wired.
const DISPATCH_SIGNAL = 'count_unabsorbed_agent_runs.mjs';
const OUT_REL = 'artifacts/validation/agent-artifact-stranding.json';
// One cycle to be claimed, plus one for the run that lands the absorption commit.
const GRACE_CYCLES = 1;

/**
 * Longest gap in days between consecutive fires of the workflow's schedule.
 *
 * Only the day-of-month and day-of-week fields change the cadence in DAYS; a cron that
 * varies only by hour or minute still fires every day. Anything this cannot read is
 * reported as unreadable and fails, because guessing a cadence would produce a guard
 * whose threshold nobody set.
 */
function cadenceDaysFromWorkflow() {
  const abs = path.join(ROOT, WORKFLOW_REL);
  if (!fs.existsSync(abs)) return { error: `${WORKFLOW_REL} does not exist` };
  const text = fs.readFileSync(abs, 'utf8');
  const crons = [...text.matchAll(/^\s*-\s*cron:\s*["']?([^"'\n#]+)["']?/gm)].map((m) => m[1].trim()).filter(Boolean);
  if (!crons.length) {
    return { error: `${WORKFLOW_REL} declares no schedule: cron. It is the only lane permitted to wake the release on a timer, so with no schedule a failed run strands an artifact forever and this guard has no cadence to enforce.` };
  }
  let days = 0;
  for (const cron of crons) {
    const fields = cron.split(/\s+/);
    if (fields.length < 5) return { error: `unparseable cron in ${WORKFLOW_REL}: ${JSON.stringify(cron)}` };
    const [, , dom, , dow] = fields;
    if (dom === '*' && dow === '*') { days = Math.max(days, 1); continue; }
    if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
      // Weekly-ish: worst case is the longest gap between the named weekdays.
      const set = [...new Set(dow.split(',').map(Number))].sort((a, b) => a - b);
      let worst = 0;
      for (let i = 0; i < set.length; i += 1) {
        const next = i + 1 < set.length ? set[i + 1] : set[0] + 7;
        worst = Math.max(worst, next - set[i]);
      }
      days = Math.max(days, worst);
      continue;
    }
    return { error: `cron in ${WORKFLOW_REL} is not a cadence this guard can read: ${JSON.stringify(cron)}. Express it as a daily or day-of-week schedule, or teach this validator the new shape - do not leave the threshold implicit.` };
  }
  return { days };
}

function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function main() {
  const workflowAbs = path.join(ROOT, WORKFLOW_REL);
  if (!fs.existsSync(workflowAbs) || !fs.readFileSync(workflowAbs, 'utf8').includes(DISPATCH_SIGNAL)) {
    console.error(`AGENT ARTIFACT STRANDING FAIL: ${WORKFLOW_REL} no longer dispatches the release lane on a pending manifest (looked for ${DISPATCH_SIGNAL}). Its schedule alone is not a catch-up: without that condition a run whose one push-triggered attempt failed is never claimed again, which is the exact 2026-09-02 defect.`);
    process.exit(1);
  }
  const cadence = cadenceDaysFromWorkflow();
  if (cadence.error) {
    console.error(`AGENT ARTIFACT STRANDING FAIL: ${cadence.error}`);
    process.exit(1);
  }
  const allowedDays = cadence.days * (1 + GRACE_CYCLES);
  const today = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

  const runsDir = path.join(ROOT, RUNS_REL);
  if (!fs.existsSync(runsDir)) {
    console.error(`AGENT ARTIFACT STRANDING FAIL: ${RUNS_REL} does not exist, so this validator examined zero manifests. Stranding is UNKNOWN, not absent.`);
    process.exit(1);
  }

  const pending = [];
  let examined = 0;
  for (const date of fs.readdirSync(runsDir).sort()) {
    const dateDir = path.join(runsDir, date);
    if (!fs.statSync(dateDir).isDirectory()) continue;
    for (const vertical of fs.readdirSync(dateDir).sort()) {
      const manifestRel = `${RUNS_REL}/${date}/${vertical}/agent_run_manifest.json`;
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestRel), 'utf8')); } catch { continue; }
      examined += 1;
      if (String(manifest.status || '') !== 'READY_FOR_ABSORPTION') continue;
      // A run whose normalized artifact exists has been absorbed; the manifest status
      // is the raw drop's own word and is never rewritten in place.
      const normalized = [
        `${NORMALIZED_REL}/${date}_${String(vertical).replace(/-/g, '_')}.json`,
        `${NORMALIZED_REL}/${date}_${vertical}.json`,
      ].some((rel) => fs.existsSync(path.join(ROOT, rel)));
      if (normalized) continue;
      const age = daysBetween(manifest.run_date || date, today);
      pending.push({ manifest: manifestRel, run_date: manifest.run_date || date, vertical, age_days: age });
    }
  }

  if (!examined) {
    console.error(`AGENT ARTIFACT STRANDING FAIL: ${RUNS_REL} contains zero readable manifests. This validator examined nothing; stranding is UNKNOWN, not absent.`);
    process.exit(1);
  }

  const stranded = pending.filter((row) => row.age_days === null || row.age_days > allowedDays);
  const report = {
    schema_version: '1.0',
    validator: 'agent-artifact-stranding',
    status: stranded.length ? 'FAIL' : 'PASS',
    checked_at: today,
    cadence_source: WORKFLOW_REL,
    cadence_days: cadence.days,
    grace_cycles: GRACE_CYCLES,
    allowed_pending_days: allowedDays,
    manifests_examined: examined,
    pending_unabsorbed: pending,
    stranded,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const row of stranded) {
    console.error(`AGENT ARTIFACT STRANDING FAIL: ${row.manifest} has been READY_FOR_ABSORPTION for ${row.age_days} day(s), past the ${allowedDays}-day allowance derived from the ${cadence.days}-day schedule in ${WORKFLOW_REL}. A landed artifact is a delivery; the lane that claims it has had at least one scheduled chance and did not.`);
  }
  if (stranded.length) {
    console.error(`AGENT ARTIFACT STRANDING: FAIL - ${examined} manifest(s) examined, ${pending.length} pending, ${stranded.length} stranded. Report: ${OUT_REL}`);
    process.exit(1);
  }
  console.log(`AGENT ARTIFACT STRANDING PASS: ${examined} manifest(s) examined; ${pending.length} pending, none beyond the ${allowedDays}-day allowance derived from ${WORKFLOW_REL}.`);
}

/**
 * The single source of truth for how long a landed run may sit unabsorbed.
 *
 * agent-artifact-continuity asks the SAME question this validator does - a
 * READY_FOR_ABSORPTION manifest with no normalized artifact next to it - and used
 * to answer it with zero tolerance. That made every raw agent drop a hard failure
 * the instant it landed, because the absorption commit that satisfies it is
 * written minutes later by a different workflow. Validate Repo went red on the
 * drop commit on 2026-09-01, 09-02, 09-03 and 09-04, including on days the
 * release lane then succeeded. Two guards asking one question must not hold two
 * different thresholds, so continuity imports this one instead of restating it.
 */
function absorptionWindow() {
  const workflowAbs = path.join(ROOT, WORKFLOW_REL);
  if (!fs.existsSync(workflowAbs) || !fs.readFileSync(workflowAbs, 'utf8').includes(DISPATCH_SIGNAL)) {
    return { error: `${WORKFLOW_REL} no longer dispatches the release lane on a pending manifest (looked for ${DISPATCH_SIGNAL}).` };
  }
  const cadence = cadenceDaysFromWorkflow();
  if (cadence.error) return { error: cadence.error };
  return { cadenceDays: cadence.days, graceCycles: GRACE_CYCLES, allowedDays: cadence.days * (1 + GRACE_CYCLES), source: WORKFLOW_REL };
}

if (require.main === module) main();

module.exports = { absorptionWindow, cadenceDaysFromWorkflow, daysBetween, GRACE_CYCLES, WORKFLOW_REL, DISPATCH_SIGNAL };
