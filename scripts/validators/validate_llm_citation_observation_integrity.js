#!/usr/bin/env node
'use strict';
/**
 * The citation-observation file may not go stale, go null, or lose readings.
 *
 * Why this exists
 * ---------------
 * scripts/llm_citation_probe.mjs writes data/signals/llm_citation_observations.json
 * on a schedule, and each grounded run is a paid provider call. Until this
 * validator, a repo-wide grep for that filename found the WRITER and nothing else:
 * no consumer, no validator, not the atlas, not the atlas->release join. The
 * workflow step that added the probe justified itself by closing the gap that "no
 * citation observation was ever taken" - observations were then taken and went
 * nowhere. A file nothing reads is a file whose regression nobody sees.
 *
 * Two incidents shape what is asserted here:
 *
 *   1. On 2026-08-29 a scheduled occupancy run rewrote data/signals/query_class_occupancy.json
 *      without --merge. 205 readings became 36, the run exited 0, and 170 paid
 *      grounded calls were deleted with nothing in the repo knowing how many
 *      readings there were supposed to be. This file is the same shape - a rolling
 *      window whose only record of its own depth was itself - so its depth is
 *      ratcheted against a mark that lives outside it, exactly as
 *      scripts/validators/validate_occupancy_reading_ratchet.js does.
 *   2. The same probe's latest_summary was overwritten with nulls by a single
 *      provider-error run (reproduced with an invalid key): a MEASURED rate was
 *      replaced by {"answered":0,"self_cited_rate_pct":null} stamped with today's
 *      date. A failed run must be visible as a NAMED failure, never as a null
 *      presented as a measurement.
 *
 * What is asserted:
 *
 *   1. Freshness. The newest run is no older than the configured maximum age. A
 *      probe that quietly stopped running is indistinguishable from one whose
 *      readings never change.
 *   2. The newest run carries a measurement_status, and latest_summary is a
 *      MEASURED run or explicitly null - never a null wearing a measurement's shape.
 *      A run of provider errors must appear in latest_attempt, not in latest_summary.
 *   3. Readings are not lost. runs[] must hold at least the high-water depth
 *      recorded in the sidecar mark, less whatever the writer has explicitly
 *      counted as discarded by its rolling window. An uncounted disappearance is a
 *      destroyed paid measurement.
 *   4. Every retained run carries observations. A run recorded with an empty
 *      observation list is a run that measured nothing while looking like a reading.
 *
 * Rule 0: it hard-fails if it examines zero runs or has no mark to check against.
 * A ratchet that passes because there was nothing to compare is the defect it is
 * hunting.
 *
 * The mark: data/signals/llm_citation_observations_highwater.json
 *   { "high_water_runs": <int>, "runs_discarded_total": <int>, "recorded_at": "<iso>" }
 * It only ratchets upward. It is written by "npm run citation:observations:ratchet"
 * (node scripts/validators/validate_llm_citation_observation_integrity.js --record).
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SIGNAL_REL = 'data/signals/llm_citation_observations.json';
const RATCHET_REL = 'data/signals/llm_citation_observations_highwater.json';
const REPORT_REL = 'artifacts/validation/llm-citation-observation-integrity.json';
const MAX_AGE_DAYS = Number(process.env.CITATION_OBSERVATION_MAX_AGE_DAYS || 14);
const RECORD = process.argv.includes('--record');

const problems = [];
const notes = [];
const read = (rel, required = true) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { if (required) problems.push(`missing ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { problems.push(`unreadable JSON: ${rel} (${e.message})`); return null; }
};

const doc = read(SIGNAL_REL);
const mark = read(RATCHET_REL, !RECORD);

const runs = (doc && Array.isArray(doc.runs)) ? doc.runs : [];
const discardedTotal = Number((doc && doc.runs_discarded_total) || 0);

// ------------------------------------------------------------------- Rule 0
if (!runs.length) {
  problems.push(`${SIGNAL_REL} holds zero runs. This validator examined nothing and must not pass on an empty loop - an emptied measurement file is exactly the failure it exists to catch.`);
}

// --------------------------------------------------------- the --record arm
// Recording the mark is a deliberate human act, never something a failing run
// does to itself to go green. It refuses to record from a file it has just
// found broken.
if (RECORD) {
  if (problems.length) {
    console.error('CITATION OBSERVATION RATCHET: refusing to record a high-water mark from a file that does not pass:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const prior = mark || {};
  const next = {
    schema_version: '1.0',
    _law: 'This mark only ratchets upward. It records how deep data/signals/llm_citation_observations.json has ever been so a truncation cannot be silent. Never lower it to match damage - restore the readings instead.',
    high_water_runs: Math.max(Number(prior.high_water_runs || 0), runs.length),
    runs_discarded_total: Math.max(Number(prior.runs_discarded_total || 0), discardedTotal),
    recorded_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ROOT, RATCHET_REL), JSON.stringify(next, null, 2) + '\n');
  console.log(`CITATION OBSERVATION RATCHET RECORDED: high_water_runs=${next.high_water_runs}, runs_discarded_total=${next.runs_discarded_total} in ${RATCHET_REL}`);
  process.exit(0);
}

// -------------------------------------------------------------- (1) freshness
let newest = null;
let ageDays = null;
if (runs.length) {
  const stamps = runs.map((r) => Date.parse((r && r.run_at) || '')).filter((n) => Number.isFinite(n));
  if (stamps.length !== runs.length) problems.push(`${SIGNAL_REL}: ${runs.length - stamps.length} run(s) carry no parseable run_at, so the age of the measurement cannot be established.`);
  if (stamps.length) {
    newest = new Date(Math.max(...stamps)).toISOString();
    ageDays = Math.floor((Date.now() - Math.max(...stamps)) / 86400000);
    if (ageDays > MAX_AGE_DAYS) {
      problems.push(`${SIGNAL_REL}: the newest run is ${ageDays} days old (${newest}), past the ${MAX_AGE_DAYS}-day maximum. A probe that has quietly stopped running looks exactly like one whose readings never change, and every citation claim downstream is being read off a stale file.`);
    }
  }
}

// ------------------------------- (2) status of the newest run, and the summary
const latestRun = runs.length ? runs[runs.length - 1] : null;
const latestSummary = doc && doc.latest_summary;
// latest_attempt was added with the fix that stopped a failed run overwriting
// latest_summary, so a file written by the previous probe has no such field. Where
// latest_summary IS the newest run, it states the newest run's status and that is
// what this check needs; anything else is an unstated status and fails below.
const latestAttempt = (doc && doc.latest_attempt)
  || ((latestSummary && newest && latestSummary.run_at === newest) ? latestSummary : null);

if (latestRun && !(Array.isArray(latestRun.observations) && latestRun.observations.length)) {
  problems.push(`${SIGNAL_REL}: the newest run (${latestRun.run_at}) carries no observations. A run recorded with an empty observation list measured nothing while looking like a reading.`);
}
if (!latestAttempt || !latestAttempt.measurement_status) {
  problems.push(`${SIGNAL_REL} carries no latest_attempt.measurement_status. Whether the last run actually measured anything must be stated in the file, not inferred by each reader from a rate that may be null for either reason.`);
} else if (!['MEASURED', 'NOT_MEASURED_PROVIDER_ERROR', 'NOT_MEASURED_NO_QUERIES'].includes(latestAttempt.measurement_status)) {
  problems.push(`${SIGNAL_REL}: latest_attempt.measurement_status is "${latestAttempt.measurement_status}", which the probe never writes. The writer and this check have drifted apart.`);
} else if (latestAttempt.measurement_status !== 'MEASURED') {
  notes.push(`the most recent run (${latestAttempt.run_at}) did NOT measure: ${latestAttempt.measurement_status}, ${latestAttempt.errored} provider error(s). The rate below is from the last MEASURED run, not from today.`);
}

if (latestSummary === undefined) {
  problems.push(`${SIGNAL_REL} carries no latest_summary field at all.`);
} else if (latestSummary === null) {
  notes.push('latest_summary is explicitly null: nothing has ever been measured. That is a named absence, which is correct, but no citation rate may be quoted from this file.');
} else {
  if (latestSummary.measurement_status !== 'MEASURED') {
    problems.push(`${SIGNAL_REL}: latest_summary carries measurement_status "${latestSummary.measurement_status}". latest_summary must hold the last MEASURED run only. A provider-error run once overwrote it with answered:0 and a null rate stamped with that day's date, which reads as "no answer engine cites us" when nothing was ever asked - the false zero this repo keeps having to undo. A failed run belongs in latest_attempt.`);
  }
  if (!(Number(latestSummary.answered) > 0)) {
    problems.push(`${SIGNAL_REL}: latest_summary reports answered=${latestSummary.answered}. A summary with no answered observations is not a measurement.`);
  }
  if (latestSummary.self_cited_rate_pct === null || latestSummary.self_cited_rate_pct === undefined) {
    problems.push(`${SIGNAL_REL}: latest_summary carries a null self_cited_rate_pct while claiming to be a measured run. A null presented in the measurement slot is the exact failure this file's own comments warn about.`);
  }
  if (latestAttempt && latestAttempt.measurement_status === 'MEASURED' && latestSummary.run_at !== latestAttempt.run_at) {
    problems.push(`${SIGNAL_REL}: the last attempt MEASURED (${latestAttempt.run_at}) but latest_summary still points at ${latestSummary.run_at}. A successful run must advance the summary.`);
  }
}

// --------------------------------------------------- (3) the reading ratchet
if (mark && typeof mark.high_water_runs !== 'number') {
  problems.push(`${RATCHET_REL} carries no numeric high_water_runs, so there is no mark to check the measurement file against.`);
} else if (mark && mark.high_water_runs === 0) {
  problems.push(`${RATCHET_REL} records a high water of zero runs. A ratchet that expects nothing can never catch a truncation; run "npm run citation:observations:ratchet" to record the runs that exist.`);
} else if (mark) {
  const markDiscarded = Number(mark.runs_discarded_total || 0);
  if (discardedTotal < markDiscarded) {
    problems.push(`${SIGNAL_REL} reports runs_discarded_total=${discardedTotal} against a recorded ${markDiscarded}. The discard counter has gone backwards, which means the file was rewritten rather than appended to.`);
  }
  const newlyDiscarded = Math.max(0, discardedTotal - markDiscarded);
  const floor = mark.high_water_runs - newlyDiscarded;
  if (runs.length < floor) {
    problems.push(
      `${SIGNAL_REL} holds ${runs.length} run(s) against a high-water mark of ${mark.high_water_runs} (${newlyDiscarded} counted as discarded by the rolling window since the mark, so the floor is ${floor}). ` +
      `The measurement file has SHRUNK by ${floor - runs.length} run(s) that nothing accounted for. Each retained run is a set of paid grounded provider calls. ` +
      `Restore the file from a prior commit - do not advance the mark to match the damage. If the rolling window legitimately dropped them, the writer must count them in runs_discarded_total and the mark must be re-recorded deliberately.`
    );
  }
  if (newlyDiscarded) {
    notes.push(`the rolling window has discarded ${newlyDiscarded} run(s) since the mark was recorded (${discardedTotal} in total). Those readings exist only in git history now; re-record the mark once that is accepted.`);
  }
}

// ------------------------------------------------------------------- verdict
const observationsExamined = runs.reduce((n, r) => n + ((r && Array.isArray(r.observations)) ? r.observations.length : 0), 0);
if (!observationsExamined && !problems.length) {
  problems.push(`${SIGNAL_REL} holds runs but zero observations across all of them. Refusing to pass on an empty loop.`);
}

const report = {
  schema_version: '1.0',
  validator: 'llm-citation-observation-integrity',
  status: problems.length ? 'FAIL' : 'PASS',
  runs_examined: runs.length,
  observations_examined: observationsExamined,
  high_water_runs: mark ? mark.high_water_runs : null,
  runs_discarded_total: discardedTotal,
  newest_run_at: newest,
  newest_run_age_days: ageDays,
  latest_attempt_status: latestAttempt ? latestAttempt.measurement_status : null,
  latest_measured_run_at: latestSummary ? latestSummary.run_at : null,
  latest_measured_self_cited_rate_pct: latestSummary ? latestSummary.self_cited_rate_pct : null,
  problems,
  notes,
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, REPORT_REL), JSON.stringify(report, null, 2) + '\n');

if (problems.length) {
  console.error('LLM CITATION OBSERVATION INTEGRITY FAIL:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`LLM CITATION OBSERVATION INTEGRITY PASS: ${runs.length} run(s) / ${observationsExamined} observation(s) held against a high-water mark of ${mark.high_water_runs} (${discardedTotal} discarded and counted); newest run ${newest} (${ageDays}d old, max ${MAX_AGE_DAYS}d); last attempt ${latestAttempt.measurement_status}; last MEASURED rate ${latestSummary ? `${latestSummary.self_cited_rate_pct}% at ${latestSummary.run_at}` : 'none recorded'}.`);
for (const n of notes) console.log(`  NOTE: ${n}`);
