#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const runsRoot = path.join(ROOT, 'data/report_fixes/agent_runs');
const POLICY_REL = 'data/report_fixes/agent_exact_implementation_policy.json';
// One question, one threshold. agent-artifact-stranding owns how long a landed run
// may sit READY_FOR_ABSORPTION with no normalized artifact beside it; that window is
// read out of the cron of the lane that dispatches the absorption, not hardcoded here.
const { absorptionWindow, daysBetween } = require('./validate_agent_artifact_stranding');

// Run directories are named by the raw vertical token ("personal-injury"), but the
// intake normalizer writes its output under the canonical vertical ("personal_injury").
// The continuity check must resolve the same way the normalizer does, or every
// personal-injury run looks unabsorbed.
const verticalMap = {
  pi: 'personal_injury',
  'personal injury': 'personal_injury',
  personal_injury: 'personal_injury',
  'personal-injury': 'personal_injury',
  dentistry: 'dentistry',
  dental: 'dentistry',
  trt: 'trt',
  testosterone: 'trt',
  neuro: 'neuro',
  neuropsych: 'neuro',
  uscis: 'uscis-medical',
  'uscis medical': 'uscis-medical',
  'uscis-medical': 'uscis-medical',
  hair: 'trt',
  'hair-loss': 'trt',
  peptides: 'trt'
};
function normalizeVertical(value) {
  const key = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  return verticalMap[key] || verticalMap[key.replace(/-/g, ' ')] || key;
}
// A run whose manifest sits at one of these statuses is claimed by the pipeline and
// MUST have produced a normalized artifact. Anything else (QUARANTINED, drafts) is
// legitimately absent and is reported as a warning rather than an error.
const policy = read(POLICY_REL, {});
const ABSORBABLE_STATUSES = new Set(
  [...(policy.process_manifest_statuses || ['READY_FOR_ABSORPTION']), 'ABSORBED']
    .map((s) => String(s).toUpperCase())
);


/**
 * The one decision this validator makes about a run whose normalized artifact is not
 * (yet) on disk. Pure, so absorption-window-agreement can exercise every case -
 * including the ones that must stay HARD_ERROR - without manufacturing directories.
 *
 *   PENDING_NAMED - a handoff in flight, inside the window agent-artifact-stranding
 *                   derives from the dispatch cron. Reported by name, never silent.
 *   HARD_ERROR    - everything else: past the window, an unreadable or future run
 *                   date, an unreadable window, or a run already marked ABSORBED,
 *                   which gets no window because nothing about it is pending.
 */
function classifyPendingAbsorption({ status, ageDays, window }) {
  if (String(status || '').toUpperCase() === 'ABSORBED') return 'HARD_ERROR';
  if (!window || window.error) return 'HARD_ERROR';
  if (!Number.isInteger(window.allowedDays)) return 'HARD_ERROR';
  if (ageDays === null || ageDays === undefined || !Number.isFinite(ageDays)) return 'HARD_ERROR';
  if (ageDays < 0) return 'HARD_ERROR';
  return ageDays <= window.allowedDays ? 'PENDING_NAMED' : 'HARD_ERROR';
}

function main() {
  const errors = [];
  const warnings = [];
  const checked = [];
  const pendingAbsorption = [];
  const WINDOW = absorptionWindow();
  const TODAY = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
  for (const date of fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot).sort() : []) {
    const dateDir = path.join(runsRoot, date);
    if (!fs.statSync(dateDir).isDirectory()) continue;
    for (const vertical of fs.readdirSync(dateDir).sort()) {
      const dir = path.join(dateDir, vertical);
      if (!fs.statSync(dir).isDirectory()) continue;
      const relDir = `data/report_fixes/agent_runs/${date}/${vertical}`;
      const manifestRel = `${relDir}/agent_run_manifest.json`;
      if (!exists(manifestRel)) { warnings.push(`legacy_or_missing_manifest:${relDir}`); continue; }
      const manifest = read(manifestRel, {});
      const required = ['csv_path', 'html_path'];
      if (manifest.json_path) required.push('json_path');
      else warnings.push(`legacy_agent_run_without_json_artifact:${relDir}`);
      if (String(manifest.vertical || '') !== vertical) errors.push(`manifest_vertical_mismatch:${relDir}:${manifest.vertical}:${vertical}`);
      for (const key of required) {
        const rel = manifest[key];
        if (!rel) errors.push(`manifest_${key}_missing:${relDir}`);
        else if (!exists(rel)) errors.push(`manifest_path_missing:${key}:${rel}`);
      }
      const status = String(manifest.status || '').toUpperCase();
      // Accept any of the paths the normalizer could legitimately have written, then
      // assert one of them is actually on disk. Naming the expected path without
      // checking for it is what let the 2026-08-26 TRT run vanish behind a green PASS.
      const normalizedCandidates = [...new Set([
        manifest.normalized_path,
        `data/report_fixes/normalized_agent_runs/${date}_${normalizeVertical(manifest.vertical || vertical)}.json`,
        `data/report_fixes/normalized_agent_runs/${date}_${vertical}.json`
      ].filter(Boolean))];
      const normalizedFound = normalizedCandidates.find((candidate) => exists(candidate)) || '';
      const normalized = normalizedFound || normalizedCandidates[0];
      if (ABSORBABLE_STATUSES.has(status) && !normalizedFound) {
        // A run that has been ABSORBED must already have its normalized artifact: there
        // is nothing pending about it, so that is a hard error with no window.
        //
        // A run still marked READY_FOR_ABSORPTION is a handoff in flight. The twin agent
        // pushes the raw quartet, and the absorption commit that normalizes it is written
        // minutes later by Velocity Content Release. Validate Repo fires on the raw push,
        // so a zero-tolerance error here reported a violation of a contract the pipeline
        // had not yet had a turn to satisfy - red on 2026-09-01, 09-02, 09-03 and 09-04,
        // including days the release lane then succeeded. That is a designed handoff, and
        // it is named here rather than silenced: the run appears in `pending_absorption`
        // with its age and its deadline.
        //
        // The deadline is NOT relaxed. It is the same allowance agent-artifact-stranding
        // enforces, imported from it so the two cannot drift, and past it this is a hard
        // error again - proved by the negative case in absorption-window-agreement.
        const pendingStatus = status !== 'ABSORBED';
        const ageDays = pendingStatus ? daysBetween(manifest.run_date || date, TODAY) : null;
        const withinWindow = classifyPendingAbsorption({ status, ageDays, window: WINDOW }) === 'PENDING_NAMED';
        if (withinWindow) {
          pendingAbsorption.push({ run: relDir, status, run_date: manifest.run_date || date, age_days: ageDays, allowed_days: WINDOW.allowedDays, window_source: WINDOW.source });
          warnings.push(`normalized_output_pending_within_absorption_window:${status}:${relDir}:age_days=${ageDays}:allowed_days=${WINDOW.allowedDays}:window_source=${WINDOW.source}`);
        } else {
          errors.push(`normalized_output_missing:${status}:${relDir}:expected_one_of:${normalizedCandidates.join(',')}${pendingStatus ? `:age_days=${ageDays === null ? 'UNREADABLE' : ageDays}:allowed_days=${WINDOW.error ? `UNREADABLE(${WINDOW.error})` : WINDOW.allowedDays}` : ''}`);
        }
      } else if (!normalizedFound) {
        warnings.push(`normalized_output_absent_non_absorbable_status:${status || 'UNKNOWN'}:${relDir}`);
      }
      if (!exists(manifest.exact_implementation_policy || POLICY_REL)) errors.push(`exact_policy_missing:${relDir}`);
      checked.push({ date, vertical, manifest: manifestRel, manifest_status: status, normalized, normalized_exists: Boolean(normalizedFound), required_artifacts: required.map((key) => manifest[key]).filter(Boolean) });
    }
  }
  const report = { schema_version: '1.0', validator: 'agent-artifact-continuity', status: errors.length ? 'FAIL' : 'PASS', checked_count: checked.length, checked_at: TODAY, absorption_window: WINDOW, pending_absorption: pendingAbsorption, checked, errors, warnings };
  out('artifacts/validation/agent-artifact-continuity.json', report);
  if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
  if (!checked.length) { console.error('agent-artifact-continuity FAIL: examined zero run groups. Continuity is UNKNOWN, not proven.'); process.exit(1); }
  for (const row of pendingAbsorption) console.log(`agent-artifact-continuity NAMED PENDING: ${row.run} is ${row.status} with no normalized artifact yet, day ${row.age_days} of the ${row.allowed_days}-day absorption window derived from ${row.window_source}. Past that it is a hard failure here and in agent-artifact-stranding.`);
  console.log(`agent-artifact-continuity PASS (${checked.length} run group(s); ${pendingAbsorption.length} awaiting absorption inside the window)`);
}

if (require.main === module) main();

module.exports = { classifyPendingAbsorption, normalizeVertical };
