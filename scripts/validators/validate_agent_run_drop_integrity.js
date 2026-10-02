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
 *     Every drop that is NOT defective must also go through the release lane's own
 *     parser (parseManifestBundle) without throwing, and a QUARANTINED one must yield
 *     zero records with none of its artifacts read. On 2 Oct 2026 the strict reader
 *     landed green here and Velocity Content Release then threw on the quarantined
 *     2026-09-15 dentistry.csv (run 37018057649): Validate Repo never ran the parser
 *     over the landed drops, so the first thing to say so was the release.
 *  4. EVERY REPO-WRITTEN JSON UNDER data/report_fixes PARSES AND IS ENCODED ONCE.
 *     Normalized runs, source ledgers, fix and disposition ledgers - everything
 *     outside agent_runs/ is written by this repo, and a truncated or corrupted one
 *     fails here by name. So does one carrying double-encoded UTF-8: the ledgers
 *     copied 2026-09-30 trt.csv's mojibake and the first thing to say so was a
 *     rendered page at release (repair: npm run citation:repair-run-encoding).
 *  5. DOUBLE-ENCODED UTF-8 IS REPAIRED EXACTLY OR REFUSED BY NAME. 2026-09-30 trt.csv
 *     arrived with 427 em dashes and arrows stored as c3 a2 c2 80 c2 94 (UTF-8 read as
 *     Latin-1 and encoded again) beside 282 correctly encoded characters. Intake
 *     copied the bytes into every derived ledger and into trt/index.html, where
 *     search-quality-basics refused `trt/index.html:mojibake` and blocked every
 *     release from 30 Sep. A scratch drop in that exact shape must read back as the
 *     intended text through readArtifactText and classify PARSED; a drop whose
 *     mojibake cannot be decoded exactly must classify DEFECTIVE with a
 *     double_encoded_utf8_unrepairable defect naming the artifact, and the reader
 *     must throw the same name. The three raw-artifact readers are then checked to
 *     route through readArtifactText - a repair nothing invokes is not a repair.
 *
 * Rule 0: zero run folders, or zero repo-written JSON files, is a FAILURE - nothing
 * examined is nothing proven. AGENT_RUN_DROP_ROOT and REPORT_FIXES_ROOT exist so that
 * claim can be demonstrated against an empty directory.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const integrity = require('../lib/agent_run_drop_integrity');
const sourceParser = require('../lib/agent_artifact_source_parser');
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
    // The release parser must not READ a quarantined run's artifacts (2 Oct 2026, run 37018057649).
    let bundle = null; let bundleErr = '';
    try { bundle = sourceParser.parseManifestBundle({ manifestPath: manifestRel, root: dir }); } catch (err) { bundleErr = err.message; }
    record('quarantined_run_parses_to_zero_records_without_reading_its_artifacts', Boolean(bundle) && bundle.quarantined === true && bundle.records.length === 0 && String(bundle.quarantine_reason).startsWith(integrity.QUARANTINE_REASON_PREFIX), bundle ? `quarantined=${bundle.quarantined} records=${bundle.records.length}` : `the parser threw on a QUARANTINED run: ${bundleErr}`);
    // ...and the door is the STATUS, not leniency: the same blobs under a manifest that claims to be ready are still refused by name.
    const liveManifest = { ...JSON.parse(fs.readFileSync(path.join(dir, manifestRel), 'utf8')), status: 'READY_FOR_ABSORPTION' };
    let liveErr = '';
    try { sourceParser.parseAgentRunBundle({ root: dir, manifest: liveManifest, manifestPath: manifestRel }); } catch (err) { liveErr = err.message; }
    record('blob_artifacts_under_a_ready_manifest_are_still_refused_by_name', /^readArtifactText:.*dentistry\.csv:not_utf8_text/.test(liveErr), liveErr || 'blob artifacts were read as source records');
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

// 5. Double-encoded UTF-8, exercised in the exact 2026-09-30 trt shape.
{
  const dir = scratch();
  const manifestFor = (runRel, vertical) => JSON.stringify({ source: 'twin_agent', run_date: '2026-09-30', vertical, csv_path: `${runRel}/${vertical}.csv`, html_path: `${runRel}/${vertical}.html`, json_path: `${runRel}/${vertical}.json`, status: 'READY_FOR_ABSORPTION' });
  const header = 'Query,Patch Needed (Y/N),Fix Recommendation\n';
  // The intended text, with characters that were already correct in the delivered file
  // ("→", "“fine”") so a whole-file re-decode would corrupt them and be caught here.
  const intended = `${header}"TRT injections vs gel — how to decide",Y,"Lead with a ≥ 300 ng/dL threshold … then dose → “fine”"\n`;
  // Encode once, read as Latin-1, encode again - ONLY the first row's "—", "≥", "…"
  // are doubled, exactly as 2026-09-30 trt.csv mixed doubled and correct characters.
  const doubled = (s) => Buffer.from(s, 'utf8').toString('latin1');
  const delivered = `${header}"TRT injections vs gel ${doubled('—')} how to decide",Y,"Lead with a ${doubled('≥')} 300 ng/dL threshold ${doubled('…')} then dose → “fine”"\n`;
  const runRel = 'data/report_fixes/agent_runs/2026-09-30/trt';
  fs.mkdirSync(path.join(dir, runRel), { recursive: true });
  fs.writeFileSync(path.join(dir, `${runRel}/trt.csv`), delivered, 'utf8');
  fs.writeFileSync(path.join(dir, `${runRel}/trt.html`), '<html><body><p>TRT injections vs gel — how to decide</p></body></html>', 'utf8');
  fs.writeFileSync(path.join(dir, `${runRel}/trt.json`), JSON.stringify({ page_fixes: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, `${runRel}/agent_run_manifest.json`), manifestFor(runRel, 'trt'));
  const deliveredBytes = fs.readFileSync(path.join(dir, `${runRel}/trt.csv`));
  record('double_encoded_fixture_is_mojibake_before_repair', /â/.test(delivered) && delivered !== intended, 'the fixture must reproduce the delivered shape or the test proves nothing');
  const repairable = integrity.inspectRunDrop(dir, `${runRel}/agent_run_manifest.json`);
  record('double_encoded_drop_is_not_refused', repairable.state === 'PARSED', repairable.state === 'PARSED' ? 'ok' : repairable.defects.join('; '));
  let repaired = { repaired: 0 };
  let text = '';
  try { text = integrity.readArtifactText(path.join(dir, `${runRel}/trt.csv`), { label: `${runRel}/trt.csv`, onRepair: (v) => { repaired = v; } }); } catch (err) { text = `THREW:${err.message}`; }
  record('double_encoded_csv_reads_back_as_intended_text', text === intended, text === intended ? 'ok' : `read ${JSON.stringify(text)} expected ${JSON.stringify(intended)}`);
  record('repair_count_is_exact', repaired.repaired === 3, `repaired=${repaired.repaired} expected 3 ("—", "≥", "…"); correct "→" and quotes untouched`);
  record('repair_leaves_delivered_bytes_untouched', fs.readFileSync(path.join(dir, `${runRel}/trt.csv`)).equals(deliveredBytes), 'readArtifactText must never rewrite the artifact it reads');
  // Unrepairable: an em dash whose continuation bytes were lost ("â€" + space) cannot
  // decode to any code point. It must be a NAMED defect at intake, not a page failure.
  const run2Rel = 'data/report_fixes/agent_runs/2026-09-30/neuro';
  const broken = `${header}"ADHD evaluation â€ what to expect",Y,"fix"\n`;
  fs.mkdirSync(path.join(dir, run2Rel), { recursive: true });
  fs.writeFileSync(path.join(dir, `${run2Rel}/neuro.csv`), broken, 'utf8');
  fs.writeFileSync(path.join(dir, `${run2Rel}/neuro.html`), '<html><body><p>ok</p></body></html>', 'utf8');
  fs.writeFileSync(path.join(dir, `${run2Rel}/neuro.json`), JSON.stringify({ page_fixes: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, `${run2Rel}/agent_run_manifest.json`), manifestFor(run2Rel, 'neuro'));
  const unrepairable = integrity.inspectRunDrop(dir, `${run2Rel}/agent_run_manifest.json`);
  const namedDefect = unrepairable.state === 'DEFECTIVE' && unrepairable.defects.some((d) => d.startsWith('csv_path:double_encoded_utf8_unrepairable:') && d.includes('neuro.csv'));
  record('unrepairable_mojibake_drop_is_refused_by_name', namedDefect, namedDefect ? 'ok' : `state=${unrepairable.state} defects=${(unrepairable.defects || []).join('; ')}`);
  let readerThrew = '';
  try { integrity.readArtifactText(path.join(dir, `${run2Rel}/neuro.csv`), { label: `${run2Rel}/neuro.csv` }); } catch (err) { readerThrew = err.message; }
  const readerNamed = /double_encoded_utf8_unrepairable/.test(readerThrew) && readerThrew.includes('neuro.csv');
  record('unrepairable_mojibake_read_throws_by_name', readerNamed, readerNamed ? 'ok' : (readerThrew || 'readArtifactText returned mojibake instead of throwing'));
  fs.rmSync(dir, { recursive: true, force: true });
}
// The readers of raw run artifacts must go through the repairing reader - a repair nothing invokes is not a repair.
for (const readerRel of ['scripts/lib/agent_artifact_source_parser.js', 'scripts/citation_velocity/prepare_velocity_intake_release.js', 'scripts/citation_velocity/apply_html_report_contract.js']) {
  const abs = path.join(ROOT, readerRel);
  if (!fs.existsSync(abs)) { errors.push(`artifact_reader_missing:${readerRel}`); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const routed = /readArtifactText\s*\(/.test(src);
  record(`reader_routes_through_repairing_reader:${readerRel}`, routed, routed ? 'ok' : 'raw artifact text is read without readArtifactText');
}
// The release-side mojibake definition and the intake-side one must be the same object.
{
  const sqb = fs.readFileSync(path.join(ROOT, 'scripts/validators/validate_search_quality_basics.js'), 'utf8');
  const shared = /badEncoding\s*=\s*require\((["'])\.\.\/lib\/text_encoding_repair\1\)\.MOJIBAKE_RE/.test(sqb);
  record('release_mojibake_definition_is_the_intake_definition', shared, shared ? 'ok' : 'validate_search_quality_basics.js keeps its own mojibake regex; intake and release could disagree');
}

// 3. Every landed drop.
const WINDOW = absorptionWindow();
const TODAY = wallClockToday();
const folders = integrity.walkRunFolders(ROOT, RUNS_REL);
let dropsExamined = 0;
let dropsParsed = 0;
let quarantinedDrops = 0;
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
  // The release lane parses this drop with parseManifestBundle; so does this, here, before merge.
  dropsParsed += 1;
  try {
    const bundle = sourceParser.parseManifestBundle({ manifestPath: folder.manifestRel, root: ROOT });
    if (String(m.status).toUpperCase() === 'QUARANTINED') {
      quarantinedDrops += 1;
      if (!bundle.quarantined || bundle.records.length) errors.push(`quarantined_drop_yields_source_records:${folder.manifestRel}:quarantined=${bundle.quarantined}:records=${bundle.records.length}`);
    }
  } catch (err) {
    errors.push(`landed_drop_unreadable_by_the_release_parser:${folder.manifestRel}:${err.message}`);
  }
}
if (!dropsExamined) errors.push(`examined_zero_drops:${RUNS_REL}:a validator that examines nothing has not passed`);
if (dropsExamined && !dropsParsed) errors.push(`parsed_zero_drops:${RUNS_REL}:no landed drop reached the release parser, so its readability is unproven`);

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
    if (!read.ok) { errors.push(`repo_written_json_does_not_parse:${rel}:${read.defect}:${read.detail}`); continue; }
    // A ledger this repo wrote must carry text encoded ONCE. On 2026-09-30 the
    // normalized run, the source ledger, the fix ledger, the implementation ledger
    // and the acceptance manifest all copied trt.csv's double-encoded em dashes and
    // the first thing to say so was a rendered page at release. This is the lock at
    // the absorption checkpoint: repair at source (citation:repair-run-encoding) and
    // re-run intake; never patch the ledger by hand.
    const mojibake = integrity.encodingVerdict(fs.readFileSync(p, 'utf8'));
    if (mojibake.repaired || mojibake.residual) errors.push(`repo_written_json_carries_mojibake:${rel}:double_encoded=${mojibake.repaired}:unrepairable=${mojibake.residual_count}:samples=${Object.keys(mojibake.samples).slice(0, 3).concat(mojibake.residual_samples).join('|')}`);
  }
})(path.resolve(ROOT, REPORT_FIXES_REL));
if (!repoJsonExamined) errors.push(`examined_zero_repo_written_json:${REPORT_FIXES_REL}:a validator that examines nothing has not passed`);

const report = { schema_version: '1.0', validator: 'agent-run-drop-integrity', status: errors.length ? 'FAIL' : 'PASS', checked_at: TODAY, drops_examined: dropsExamined, drops_read_through_release_parser: dropsParsed, quarantined_drops: quarantinedDrops, repo_written_json_examined: repoJsonExamined, absorption_window: WINDOW, self_test_cases: cases, named_pending, errors, warnings };
fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (errors.length) {
  console.error('AGENT RUN DROP INTEGRITY FAIL');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`AGENT RUN DROP INTEGRITY PASS: ${cases.length} guard self-test(s), ${dropsExamined} drop(s) (${dropsParsed} read through the release parser, ${quarantinedDrops} quarantined and unread), ${repoJsonExamined} repo-written JSON file(s); ${named_pending.length} defective drop(s) named pending quarantine.`);
