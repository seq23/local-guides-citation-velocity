#!/usr/bin/env node
'use strict';
// ci-failure-legibility
//
// Guards the SECOND defect behind the 2026-09-04 daily reds: not that the lanes
// failed, but that their failures were unreadable. Run 33879505846's log ended in
// a bare `##[error]Process completed with exit code 1.`; the actual cause
// (`normalized_output_missing:...:2026-09-04/uscis-medical`) was on line 1188 of
// 1265, under ~750 lines of pretty-printed JSON, and the only comfortable route to
// it was downloading velocity-validation-diagnostics-33879505846. That is what let
// the same failure recur on 09-01, 09-02, 09-03 and 09-04.
//
// This asserts, by EXECUTING the emitter rather than reading the source for
// reassuring words, that a blocking validation run surfaces its cause on all
// three cheap surfaces: a GitHub `::error::` annotation, a $GITHUB_STEP_SUMMARY
// entry, and a plain block emitted last so the log TAIL is the diagnosis. It also
// asserts the runner actually calls it, because an emitter nothing invokes is the
// "exists but nothing invokes it" defect this repo keeps producing.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(ROOT, 'scripts/validation/run_validation_registry.js');
const EMITTER = path.join(ROOT, 'scripts/validation/failure_legibility.js');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/ci-failure-legibility.json');

const errors = [];
const cases = [];

function record(name, ok, detail) {
  cases.push({ case: name, ok, detail });
  if (!ok) errors.push(`${name}:${detail}`);
}

// ---- 1. the emitter is wired into the runner -------------------------------
// Comments are stripped first: prose describing a fix must not be able to stand
// in for the fix, the same rule release-lane-heals-before-push enforces.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

let runnerSrc = '';
try {
  runnerSrc = stripComments(fs.readFileSync(RUNNER, 'utf8'));
} catch (err) {
  record('runner_readable', false, `cannot read ${path.relative(ROOT, RUNNER)}: ${err.message}`);
}
if (runnerSrc) {
  record('runner_readable', true, 'ok');
  record('runner_requires_emitter', /require\(['"]\.\/failure_legibility['"]\)/.test(runnerSrc),
    'run_validation_registry.js must require ./failure_legibility');
  record('runner_calls_emitter', /emitFailureLegibility\s*\(/.test(runnerSrc),
    'run_validation_registry.js must call emitFailureLegibility()');
  // It must be called on the blocking path, before the non-zero exit - not in
  // some branch that only a passing run reaches.
  const blockedTail = runnerSrc.slice(runnerSrc.indexOf('VALIDATION SUMMARY:'));
  const callAt = blockedTail.indexOf('emitFailureLegibility(');
  const exitAt = blockedTail.indexOf('process.exit(1)');
  record('emitter_precedes_failing_exit', callAt !== -1 && exitAt !== -1 && callAt < exitAt,
    'emitFailureLegibility() must run on the blocking path before process.exit(1)');
}

// ---- 2. the emitter actually emits, on a constructed failing report ---------
let emitter = null;
try {
  emitter = require(EMITTER);
} catch (err) {
  record('emitter_loadable', false, `cannot load ${path.relative(ROOT, EMITTER)}: ${err.message}`);
}

if (emitter) {
  record('emitter_loadable', true, 'ok');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-legibility-'));
  const evidenceRel = 'evidence.json';
  // Modelled on the real 2026-09-04 failure so a regression is recognisable.
  fs.writeFileSync(path.join(tmp, evidenceRel), JSON.stringify({
    validator: 'agent-artifact-continuity',
    status: 'FAIL',
    errors: ['normalized_output_missing:READY_FOR_ABSORPTION:data/report_fixes/agent_runs/2026-09-04/uscis-medical'],
  }));

  function run(report, opts = {}) {
    const chunks = [];
    const summaryPath = opts.withSummary === false ? undefined : path.join(tmp, `summary-${Math.random().toString(36).slice(2)}.md`);
    const result = emitter.emitFailureLegibility(report, {
      root: tmp,
      write: s => chunks.push(s),
      env: summaryPath ? { GITHUB_STEP_SUMMARY: summaryPath } : {},
    });
    return {
      stdout: chunks.join(''),
      summary: summaryPath && fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '',
      result,
    };
  }

  const failing = {
    status: 'FAIL',
    profiles: ['release'],
    counts: { PASS: 1, FAIL: 1, NOT_RUN_AFTER_BLOCK: 146 },
    results: [
      { id: 'something-fine', status: 'PASS', blocks_release: false },
      {
        id: 'agent-artifact-continuity', status: 'FAIL', severity: 'HARD_FAIL',
        title: 'Landed agent runs keep their normalized artifact',
        blocks_release: true, evidence_file: evidenceRel,
      },
    ],
  };

  const out = run(failing);
  const cause = 'normalized_output_missing:READY_FOR_ABSORPTION:data/report_fixes/agent_runs/2026-09-04/uscis-medical';

  record('emits_annotation',
    /^::error title=agent-artifact-continuity => FAIL::/m.test(out.stdout) && out.stdout.includes(cause),
    'a blocking failure must emit a ::error:: annotation carrying the cause');

  record('emits_step_summary', out.summary.includes('agent-artifact-continuity') && out.summary.includes(cause),
    'a blocking failure must append the cause to $GITHUB_STEP_SUMMARY');

  // The tail test is the point of the whole guard: line 1188 of 1265 is not
  // legible, so the cause has to be inside the last few lines of output.
  const tail = out.stdout.trimEnd().split('\n').slice(-25).join('\n');
  record('cause_is_in_the_log_tail', tail.includes(cause),
    'the cause must appear within the last 25 lines of runner output');
  record('names_the_blocking_validator', tail.includes('BLOCKING VALIDATION FAILURES'),
    'the tail block must be labelled so it is findable');

  // A validator that dies before writing evidence falls back to its captured log,
  // and the runner frames that log with `$ <command>` / STDOUT / STDERR. Letting
  // those through headlines the failure with the command name instead of the cause.
  const logDir = path.join(tmp, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'x.log'),
    '$ node scripts/validators/validate_agent_artifact_continuity.js\n\nSTDOUT\n\nSTDERR\nagent-artifact-continuity FAIL: examined zero run groups.\n');
  const fromLog = run({
    status: 'FAIL', profiles: ['release'], counts: { FAIL: 1 },
    results: [{ id: 'log-only', status: 'FAIL', blocks_release: true, log: 'logs/x.log' }],
  });
  const headline = (fromLog.result.rows[0] || { details: [] }).details[0] || '';
  record('log_fallback_strips_runner_scaffolding',
    !/^\$ /.test(headline) && !['STDOUT', 'STDERR'].includes(headline.trim())
      && headline.includes('examined zero run groups'),
    `the first detail line from a log fallback must be the cause, saw: ${headline}`);

  // Rule 0: a reporter that runs and says nothing is the defect, not the fix.
  const inert = run({ status: 'FAIL', profiles: ['release'], counts: { FAIL: 1 }, results: [] });
  record('never_silent_on_an_empty_blocking_set',
    inert.stdout.includes('BLOCKING VALIDATION FAILURES') && /runner defect/i.test(inert.stdout),
    'a FAIL report with zero blocking validators must still say so loudly');

  // A missing/unreadable evidence file must not silence the annotation.
  const noEvidence = run({
    status: 'FAIL', profiles: ['release'], counts: { FAIL: 1 },
    results: [{ id: 'ghost', status: 'FAIL', blocks_release: true, evidence_file: 'does-not-exist.json' }],
  });
  record('degrades_without_evidence',
    noEvidence.stdout.includes('::error title=ghost') && noEvidence.stdout.includes('ghost'),
    'an unreadable evidence file must still produce a named annotation');

  // Annotations are single-line; an unencoded newline truncates the message.
  const annotationLines = out.stdout.split('\n').filter(l => l.startsWith('::error'));
  record('annotation_is_single_line',
    annotationLines.length === 1 && !annotationLines[0].includes('\n'),
    `one blocking validator must produce exactly one single-line annotation, saw ${annotationLines.length}`);
  record('encodes_newlines', emitter.encodeAnnotation('a\nb') === 'a%0Ab',
    'newlines in annotation bodies must be percent-encoded');

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- 3. hard-fail when this validator examined nothing ----------------------
if (cases.length === 0) {
  errors.push('zero_cases_examined:this validator proves nothing and must not pass');
}

const status = errors.length ? 'FAIL' : 'PASS';
const report = {
  schema_version: '1.0',
  validator: 'ci-failure-legibility',
  status,
  cases_examined: cases.length,
  cases,
  errors,
};
fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, JSON.stringify(report, null, 2) + '\n');

if (status === 'FAIL') {
  console.error(JSON.stringify(report, null, 2));
  console.error(`\nBLOCKING RESULT: ci-failure-legibility => FAIL (${errors.length} of ${cases.length} case(s))`);
  process.exit(1);
}
console.log(`ci-failure-legibility PASS (${cases.length} case(s): runner wiring, annotation, step summary, log tail, empty-set loudness, evidence degradation, annotation encoding)`);
