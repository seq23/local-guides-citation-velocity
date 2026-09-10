#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * ISOLATION MUST NEVER BECOME SUPPRESSION.
 *
 * scripts/release/hold_failing_units.mjs charges a blocking-validator failure to the
 * unit that caused it: that unit is HELD and named, and every other unit publishes.
 * That is the change that ends one bad row rejecting 649 good ones. It is also the one
 * change in this lane that could go wrong quietly, because a bug in it looks exactly
 * like success - a green run that published while something real was swept into a
 * "held" list nobody reads.
 *
 * Two properties keep it honest, and this validator proves both against CONSTRUCTED
 * inputs on every run, while the real lane is green. A capability that is only
 * exercised when production needs it is a capability nobody knows is dead.
 *
 *   1. A FAILURE OUTSIDE THE MUTATION SCOPE MAY NOT BE HELD. The rule comes from a
 *      measured property: rendered-output-shrink-guard is TREE-LEVEL in what it scans -
 *      all 2,067 accepted floors, whether or not the release touched them - and
 *      per-route only in what it reports. So "the evidence names a route" is not
 *      enough; the route must be one this release actually thawed. A page nobody
 *      touched that shrank is a build fault, and a build fault recorded as a held row
 *      is the exact defect this validator exists to prevent.
 *
 *   2. A RUN THAT PUBLISHES NOTHING MAY NOT EXIT 0. "0 published, 85 held" reporting
 *      success is the runs-but-inert defect this repository names by name.
 *
 * Also asserted: a blocking validator that declares no unit_attribution is systemic by
 * default, so an unmapped validator can never be silently routed around; and every
 * unit_attribution pointer that IS declared resolves against its validator's real
 * evidence file, so a mapping cannot rot into one that charges nothing.
 *
 * Rule 0: hard-fails if zero cases are examined.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ISOLATOR = path.join(ROOT, 'scripts/release/hold_failing_units.mjs');
const EVIDENCE = 'artifacts/validation/release-isolation-contract.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } };

// A throwaway repo root carrying only the files the isolator reads, so a case is a
// statement about the isolator's logic and nothing else.
function fixtureRoot(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-isolation-'));
  const write = (rel, value) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
  };
  write('_validation_registry.json', { validators: spec.validators });
  write('artifacts/validation/validation-summary-release.json', { results: spec.results });
  write('artifacts/validation/mutation-scope-acceptance.json', { accepted_routes: spec.accepted_routes || [], rejected: [] });
  for (const [rel, value] of Object.entries(spec.evidence || {})) write(rel, value);
  return dir;
}

function runIsolator(dir) {
  const r = spawnSync(process.execPath, [ISOLATOR, '--profile', 'release', '--dry-run'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ISOLATION_ROOT: dir, SOURCE_DATE: DATE }
  });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const SHRINK = {
  id: 'rendered-output-shrink-guard',
  status: 'ACTIVE',
  severity: 'HARD_FAIL',
  evidence_file: 'artifacts/validation/rendered-output-shrink-guard.json',
  unit_attribution: ['unjustified_shrinks[].implementation_path']
};
const shrinkEvidence = (paths) => ({
  'artifacts/validation/rendered-output-shrink-guard.json': {
    unjustified_shrinks: paths.map((p) => ({ implementation_path: p, lost_bytes: 78 }))
  }
});
const failResult = (id) => ({ id, status: 'FAIL', severity: 'HARD_FAIL' });

const cases = [
  {
    name: 'in_scope_failure_is_held_and_the_rest_publishes',
    expect_code: 0,
    expect_out: /HELD \/a\/ - rendered-output-shrink-guard/,
    why: 'A route the release thawed, failing a validator that names it, is charged to its own unit; the other two units publish.',
    spec: {
      validators: [SHRINK],
      results: [failResult('rendered-output-shrink-guard')],
      accepted_routes: ['/a/', '/b/', '/c/'],
      evidence: shrinkEvidence(['a/index.html'])
    }
  },
  {
    name: 'failure_outside_the_mutation_scope_is_systemic',
    expect_code: 1,
    expect_out: /never touched|build fault/,
    why: 'The release thawed /b/ and /c/ only. A shrink on /a/ cannot have been caused by a unit in this batch, so it must fail the whole run rather than be held.',
    spec: {
      validators: [SHRINK],
      results: [failResult('rendered-output-shrink-guard')],
      accepted_routes: ['/b/', '/c/'],
      evidence: shrinkEvidence(['a/index.html'])
    }
  },
  {
    name: 'zero_published_fails_loudly',
    expect_code: 1,
    expect_out: /0 unit\(s\) publishable/,
    why: 'Every unit in scope is held, so nothing would publish. A lane that ships nothing must not report success.',
    spec: {
      validators: [SHRINK],
      results: [failResult('rendered-output-shrink-guard')],
      accepted_routes: ['/a/'],
      evidence: shrinkEvidence(['a/index.html'])
    }
  },
  {
    name: 'unmapped_blocking_validator_is_systemic',
    expect_code: 1,
    expect_out: /declares no unit_attribution/,
    why: 'A blocking validator with no declared attribution can never be routed around. Unknown must mean whole-run failure, not a silent hold.',
    spec: {
      validators: [{ id: 'some-blocking-validator', status: 'ACTIVE', severity: 'HARD_FAIL', evidence_file: 'artifacts/validation/x.json' }],
      results: [failResult('some-blocking-validator')],
      accepted_routes: ['/a/'],
      evidence: { 'artifacts/validation/x.json': { anything: true } }
    }
  },
  {
    name: 'mapped_validator_naming_no_route_is_systemic',
    expect_code: 1,
    expect_out: /named no route/,
    why: 'The pointer resolved to nothing, so the evidence never said which unit is at fault. Charging one anyway would be a guess.',
    spec: {
      validators: [SHRINK],
      results: [failResult('rendered-output-shrink-guard')],
      accepted_routes: ['/a/'],
      evidence: { 'artifacts/validation/rendered-output-shrink-guard.json': { unjustified_shrinks: [] } }
    }
  },
  {
    name: 'unreadable_evidence_is_systemic',
    expect_code: 1,
    expect_out: /could not be read/,
    why: 'A validator that failed without leaving readable evidence has not told anyone which unit to charge.',
    spec: {
      validators: [SHRINK],
      results: [failResult('rendered-output-shrink-guard')],
      accepted_routes: ['/a/', '/b/'],
      evidence: {}
    }
  }
];

const errors = [];
const examined = [];

for (const testCase of cases) {
  const dir = fixtureRoot(testCase.spec);
  let result;
  try { result = runIsolator(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const codeOk = result.code === testCase.expect_code;
  const outOk = testCase.expect_out.test(result.out);
  examined.push({ case: testCase.name, why: testCase.why, expected_exit: testCase.expect_code, actual_exit: result.code, output_matched: outOk });
  if (!codeOk) errors.push(`${testCase.name}: expected exit ${testCase.expect_code}, got ${result.code}. ${testCase.why}`);
  else if (!outOk) errors.push(`${testCase.name}: exit code was right but the output never said why (expected ${testCase.expect_out}). A correct verdict nobody can read is not a named outcome.`);
}

// Every declared mapping must still resolve against the validator's real evidence file,
// so a pointer cannot rot into one that silently charges nothing - which case
// `mapped_validator_naming_no_route_is_systemic` proves would be treated as systemic,
// i.e. it would take the whole lane down rather than mis-hold. Loud either way, but the
// mapping is supposed to work.
const registry = readJson('_validation_registry.json', { validators: [] });
const mapped = (registry.validators || []).filter((v) => Array.isArray(v.unit_attribution) && v.unit_attribution.length);
for (const v of mapped) {
  const evidenceRel = v.evidence_file || (v.produces_files || [])[0];
  if (!evidenceRel) { errors.push(`${v.id}: declares unit_attribution but names no evidence document, so nothing can resolve it.`); continue; }
  for (const pointer of v.unit_attribution) {
    const head = String(pointer).split('.')[0].replace(/\[\]$/, '');
    const doc = readJson(evidenceRel, null);
    if (doc && !Object.prototype.hasOwnProperty.call(doc, head)) {
      errors.push(`${v.id}: unit_attribution pointer "${pointer}" names "${head}", which is not a key in ${evidenceRel}. The mapping has drifted from the evidence it reads.`);
    }
  }
  examined.push({ case: `mapping_resolves:${v.id}`, why: 'A declared attribution pointer must match the shape its validator actually writes.', pointers: v.unit_attribution });
}

const { zeroExaminationVerdict } = require('../lib/zero_item_examination');
const verdict = zeroExaminationVerdict({
  validator: 'release-isolation-contract',
  unit: 'isolation case(s)',
  examined: examined.length,
  available: cases.length,
  stopReason: 'no isolation cases are defined, which cannot happen while this file declares them',
  inputs: ['scripts/release/hold_failing_units.mjs', '_validation_registry.json']
});
if (verdict.error) errors.push(verdict.error);

const report = {
  schema_version: '1.0',
  guard: 'release-isolation-contract',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: DATE,
  cases_examined: examined.length,
  mapped_validators: mapped.map((v) => v.id),
  examined,
  errors
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, EVIDENCE), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error('RELEASE ISOLATION CONTRACT FAIL');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(`RELEASE ISOLATION CONTRACT PASS: ${cases.length} constructed case(s) proved against scripts/release/hold_failing_units.mjs - an out-of-scope failure and an unmapped validator both fail the whole run, a zero-published run exits non-zero, and an in-scope failure is held while the rest publish; ${mapped.length} declared unit_attribution mapping(s) still resolve.`);
