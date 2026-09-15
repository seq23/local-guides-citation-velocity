#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Every JSON under data/report_fixes must BE JSON, and every Twin Agent drop must be
 * a drop or be named as not one.
 *
 * 2026-09-15: Twin Agent committed data/report_fixes/agent_runs/2026-09-15/dentistry
 * with four 15-byte non-UTF-8 files, one of them named agent_run_manifest.json.
 * Nothing between the commit and JSON.parse asked whether the file was a manifest.
 * The normalizer threw and Velocity Content Release went red; agent-artifact-continuity
 * read the file as `{}` and reported "vertical mismatch: undefined"; agent-artifact-
 * stranding `continue`d past it in silence; count_unabsorbed_agent_runs.mjs did not
 * count it, so no catch-up dispatch would ever have retried it. 2026-07-20 was the
 * same writer defect (byte-corrupted keys, unresolved fetch pointers) and was repaired
 * by hand three days later.
 *
 * This validator holds four things, and fails if it examines nothing:
 *
 *  1. WRITE-TIME GUARD WORKS. scripts/lib/agent_run_drop_integrity.writeJsonVerified
 *     is exercised in a scratch directory: a good value round-trips; a value that
 *     cannot serialize throws AND leaves no file behind; a pre-existing file survives
 *     a failed write untouched. The normalizer and the HTML report applier are then
 *     checked to route their JSON writes through it - a guard nothing invokes is not a
 *     guard.
 *  2. QUARANTINE WORKS. A scratch run folder holding the exact 15-byte blob from
 *     2026-09-15 is quarantined; the result must parse, be status QUARANTINED with a
 *     defective_drop reason, and the delivered bytes must be preserved verbatim at
 *     agent_run_manifest.json.rejected.
 *  3. EVERY LANDED DROP IS CLASSIFIED. A defective drop inside the absorption window
 *     is a NAMED pending handoff (the release lane quarantines it on its next pass).
 *     Past the window it is a hard failure naming the file and its defects. A
 *     QUARANTINED manifest that points at rejected bytes must still have them.
 *  4. EVERY REPO-WRITTEN JSON UNDER data/report_fixes PARSES. Normalized runs, source
 *     ledgers, fix and disposition ledgers - everything outside agent_runs/ is written
 *     by this repo, and a truncated or corrupted one fails here by name.
 *
 * Rule 0: zero run folders, or zero repo-written JSON files, is a FAILURE - nothing
 * examined is nothing proven. AGENT_RUN_DROP_ROOT and REPORT_FIXES_ROOT exist so that
 * claim can be demonstrated against an empty directory.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const integrity = require('../lib/agent_run_drop_integrity');
const { absorptionWindow, daysBetween, wallClockToday } = require('./validate_agent_artifact_stranding');
const { classifyPendingAbsorption } = require('./validate_agent_artifact_continuity');

const ROOT = path.resolve(__dirname, '../..');
const RUNS_REL = process.env.AGENT_RUN_DROP_ROOT || integrity.RUNS_REL;
const REPORT_FIXES_REL = process.env.REPORT_FIXES_ROOT || 'data/report_fixes';
const OUT_REL = 'artifacts/validation/agent-run-drop-integrity.json';
// The writers that land JSON into data/report_fixes and must go through the verified path.
const GUARDED_WRITERS = [
  'scripts/citation_velocity/prepare_velocity_intake_release.js',
  'scripts/citation_velocity/apply_html_report_contract.js'
];
// The exact bytes Twin Agent delivered on 2026-09-15 as agent_run_manifest.json.
const BLOB_2026_09_15 = Buffer.from('6e5a1ba5aca5a1a76cddca27b5e9ed', 'hex');

const errors = [];
const warnings = [];
const named_pending = [];
const cases = [];

function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'drop-integrity-')); }
function record(name, ok, detail) { cases.push({ name, ok, detail }); if (!ok) errors.push(`self_test:${name}:${detail}`); }

// 1. Write-time guard, exercised.
{
  const dir = scratch();
  const target = path.join(dir, 'out.json');
  try {
    integrity.writeJsonVerified(target, { a: 1, b: [1, 2], c: 'x' });
    const back = integrity.readJsonStrict(target);
    record('verified_write_round_trips', back.ok && back.value.a === 1 && back.value.b.length === 2, back.ok ? 'ok' : back.defect);
  } catch (err) { record('verified_write_round_trips', false, err.message); }
  let threw = false;
  try { integrity.writeJsonVerified(target, { big: 10n }); } catch (err) { threw = /writeJsonVerified/.test(err.message) && err.message.includes(target); }
  const survived = integrity.readJsonStrict(target);
  record('unserializable_value_throws_naming_path', threw, threw ? 'ok' : 'a value that cannot serialize was written or the error did not name the file');
  record('failed_write_leaves_previous_file_intact', survived.ok && survived.value.a === 1, survived.ok ? 'ok' : survived.defect);
  record('failed_write_leaves_no_temp_file', fs.readdirSync(dir).length === 1, fs.readdirSync(dir).join(','));
  let undefThrew = false;
  try { integrity.writeJsonVerified(path.join(dir, 'undef.json'), undefined); } catch { undefThrew = true; }
  record('undefined_value_throws', undefThrew && !fs.existsSync(path.join(dir, 'undef.json')), undefThrew ? 'ok' : 'undefined was written as a file');
  fs.rmSync(dir, { recursive: true, force: true });
}
for (const writerRel of GUARDED_WRITERS) {
  const abs = path.join(ROOT, writerRel);
  if (!fs.existsSync(abs)) { errors.push(`guarded_writer_missing:${writerRel}`); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const routed = /agent_run_drop_integrity/.test(src) && /writeJsonVerified/.test(src);
  const rawWrite = /function writeJson\([^)]*\)\s*\{[^}]*fs\.writeFileSync/.test(src);
  record(`writer_routes_through_verified_write:${writerRel}`, routed && !rawWrite, routed && !rawWrite ? 'ok' : `routed=${routed} raw_writeFileSync_in_writeJson=${rawWrite}`);
}

// 2. Quarantine, exercised on the real 2026-09-15 bytes.
{
  const dir = scratch();
  const runRel = 'data/report_fixes/agent_runs/2026-09-15/dentistry';
  const runAbs = path.join(dir, runRel);
  fs.mkdirSync(runAbs, { recursive: true });
  for (const name of ['agent_run_manifest.json', 'dentistry.csv', 'dentistry.html', 'dentistry.json']) fs.writeFileSync(path.join(runAbs, name), BLOB_2026_09_15);
  const manifestRel = `${runRel}/agent_run_manifest.json`;
  const before = integrity.inspectRunDrop(dir, manifestRel);
  record('blob_manifest_is_classified_defective', before.state === 'DEFECTIVE' && /manifest:unparseable/.test(before.defects[0] || ''), before.state === 'DEFECTIVE' ? 'ok' : before.state);
  try {
    const result = integrity.quarantineRunDrop(dir, before, { quarantinedBy: 'self-test', today: '2026-09-15' });
    const after = integrity.inspectRunDrop(dir, manifestRel);
    const rejected = fs.readFileSync(path.join(dir, result.rejectedRel));
    record('quarantine_produces_parseable_named_manifest', after.state === 'PARSED' && after.manifest.status === 'QUARANTINED' && String(after.manifest.quarantine_reason).startsWith(integrity.QUARANTINE_REASON_PREFIX) && Boolean(after.manifest.quarantine_action), after.state === 'PARSED' ? JSON.stringify({ status: after.manifest.status }) : after.defects.join('; '));
    record('quarantine_preserves_delivered_bytes', rejected.equals(BLOB_2026_09_15), rejected.equals(BLOB_2026_09_15) ? 'ok' : 'rejected bytes differ from the delivered manifest');
    record('quarantine_keeps_artifacts_untouched', fs.readFileSync(path.join(runAbs, 'dentistry.csv')).equals(BLOB_2026_09_15), 'artifacts are audit material and are never rewritten');
  } catch (err) { record('quarantine_produces_parseable_named_manifest', false, err.message); }
  // A parsed manifest whose artifacts are unresolved local-fetch pointers (the 2026-07-20 shape) must also be DEFECTIVE.
  const run2Rel = 'data/report_fixes/agent_runs/2026-07-20/personal-injury';
  fs.mkdirSync(path.join(dir, run2Rel), { recursive: true });
  for (const ext of ['csv', 'html', 'json']) fs.writeFileSync(path.join(dir, run2Rel, `personal-injury.${ext}`), `{"_fetchBase64":"local:/agent/current/generated/personal-injury.${ext}"}`);
  fs.writeFileSync(path.join(dir, run2Rel, 'agent_run_manifest.json'), JSON.stringify({ source: 'twin_agent', run_date: '2026-07-20', vertical: 'personal-injury', csv_path: `${run2Rel}/personal-injury.csv`, html_path: `${run2Rel}/personal-injury.html`, json_path: `${run2Rel}/personal-injury.json`, status: 'READY_FOR_ABSORPTION' }));
  const pointer = integrity.inspectRunDrop(dir, `${run2Rel}/agent_run_manifest.json`);
  record('local_fetch_pointer_artifacts_are_defective', pointer.state === 'DEFECTIVE' && pointer.defects.some((d) => d.includes('unresolved_local_fetch_artifact')), pointer.state === 'DEFECTIVE' ? 'ok' : 'the 2026-07-20 shape passed as a real drop');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 3. Every landed drop.
const WINDOW = absorptionWindow();
const TODAY = wallClockToday();
const folders = integrity.walkRunFolders(ROOT, RUNS_REL);
let dropsExamined = 0;
for (const folder of folders) {
  if (!folder.manifestExists) { warnings.push(`legacy_or_missing_manifest:${folder.dirRel}`); continue; }
  dropsExamined += 1;
  const inspection = integrity.inspectRunDrop(ROOT, folder.manifestRel);
  if (inspection.state === 'DEFECTIVE') {
    const ageDays = daysBetween(folder.date, TODAY);
    const verdict = classifyPendingAbsorption({ status: 'DEFECTIVE', ageDays, window: WINDOW });
    if (verdict === 'PENDING_NAMED') {
      named_pending.push({ manifest: folder.manifestRel, age_days: ageDays, allowed_days: WINDOW.allowedDays, defects: inspection.defects });
      console.log(`NAMED PENDING: ${folder.manifestRel} is a defective drop (day ${ageDays} of ${WINDOW.allowedDays}); Velocity Content Release quarantines it on its next pass. Defects: ${inspection.defects.join('; ')}`);
    } else {
      errors.push(`defective_drop_unquarantined:${folder.manifestRel}:age_days=${ageDays}:allowed_days=${WINDOW.error || WINDOW.allowedDays}:${inspection.defects.join('; ')}`);
    }
    continue;
  }
  const m = inspection.manifest;
  if (String(m.status).toUpperCase() === 'QUARANTINED' && m.rejected_manifest_path && !fs.existsSync(path.join(ROOT, m.rejected_manifest_path))) {
    errors.push(`quarantine_lost_rejected_bytes:${folder.manifestRel}:${m.rejected_manifest_path}`);
  }
}
if (!dropsExamined) errors.push(`examined_zero_drops:${RUNS_REL}:a validator that examines nothing has not passed`);

// 4. Every repo-written JSON under data/report_fixes outside agent_runs/.
let repoJsonExamined = 0;
(function walk(abs) {
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, ent.name);
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (ent.isDirectory()) { if (rel.startsWith(`${REPORT_FIXES_REL}/agent_runs`)) continue; walk(p); continue; }
    if (!ent.name.endsWith('.json')) continue;
    repoJsonExamined += 1;
    const read = integrity.readJsonStrict(p);
    if (!read.ok) errors.push(`repo_written_json_does_not_parse:${rel}:${read.defect}:${read.detail}`);
  }
})(path.resolve(ROOT, REPORT_FIXES_REL));
if (!repoJsonExamined) errors.push(`examined_zero_repo_written_json:${REPORT_FIXES_REL}:a validator that examines nothing has not passed`);

const report = { schema_version: '1.0', validator: 'agent-run-drop-integrity', status: errors.length ? 'FAIL' : 'PASS', checked_at: TODAY, drops_examined: dropsExamined, repo_written_json_examined: repoJsonExamined, absorption_window: WINDOW, self_test_cases: cases, named_pending, errors, warnings };
fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (errors.length) {
  console.error('AGENT RUN DROP INTEGRITY FAIL');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`AGENT RUN DROP INTEGRITY PASS: ${cases.length} guard self-test(s), ${dropsExamined} drop(s), ${repoJsonExamined} repo-written JSON file(s); ${named_pending.length} defective drop(s) named pending quarantine.`);
