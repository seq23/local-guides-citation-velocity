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

// ---------------------------------------------------------------------------
// EVERY DECLARED MAPPING IS PROVED AGAINST THE SHAPE IT WAS MEASURED FROM.
//
// The cases above prove the isolator's RULES. These prove the MAPPINGS: that the
// pointer a validator declares in _validation_registry.json actually picks the
// offending route out of the document that validator writes when it fails.
//
// Each document below is a reduction of what the named validator ACTUALLY WROTE
// when a failing state was constructed against the real tree on 2026-09-09. None
// of it was inferred from reading the validator's source, and that distinction
// earned its keep: every one of these arrays is EMPTY while the lane is green, so
// a passing evidence file cannot say whether its elements are strings or objects.
// medical-schema-emission turned out to be both - three arrays of bare path
// strings, three of objects keyed by `file` - and a single guessed shape would
// have declared three pointers that resolve to nothing.
//
// The validator entry is read LIVE from the registry, never copied here. So if a
// mapping is deleted, renamed, or repointed at a key its validator does not
// write, the in-scope case stops holding its route and this contract goes red.
// That is the negative proof: the mapping cannot rot in silence.
// ---------------------------------------------------------------------------
const errorsBeforeCases = [];
const registryDoc = readJson('_validation_registry.json', { validators: [] });
const registryEntry = (id) => (registryDoc.validators || []).find((v) => v.id === id) || null;

const MEASURED = [
  {
    id: 'rendered-internal-hrefs',
    label: 'broken_internal_href',
    route: '/trt/',
    measured: 'Adding <a href="/zzz-nonexistent-route-measure/"> to trt/index.html; the validator exited 1 and wrote this errors row.',
    evidence: {
      'artifacts/validation/hrefs.json': {
        validator: 'rendered-internal-hrefs', ok: false, checked: 79507, error_count: 1,
        errors: [{ file: 'trt/index.html', href: '/zzz-nonexistent-route-measure/', issue: 'internal target missing' }]
      }
    }
  },
  {
    id: 'no-internal-instruction-leak',
    label: 'build_instruction_on_the_page',
    route: '/trt/',
    measured: 'Appending "FILEPATH: trt/index.html || EDIT: add a table" to trt/index.html; the validator exited 1 and wrote this offenders row.',
    evidence: {
      'artifacts/validation/internal-instruction-leak.json': {
        schema_version: '1.0', validator: 'no-internal-instruction-leak', status: 'FAIL',
        pages_scanned: 2351, offender_count: 1, sealed_pre_existing: 0,
        offenders: [{ path: 'trt/index.html', reason: 'raw agent recommendation (FILEPATH:)', shapes: ['filepath', 'field-separator'] }]
      }
    }
  },
  {
    id: 'removal-directive-not-published',
    label: 'withheld_phrase_still_rendered',
    route: '/dentistry/cost-insurance/',
    measured: 'Appending the enumerated withheld phrase "Use the same questions with every lawyer on your shortlist" to dentistry/cost-insurance/index.html; the validator exited 1 and wrote this rendered_leaks row.',
    evidence: {
      'artifacts/validation/removal-directive-not-published.json': {
        schema_version: '1.0', validator: 'removal-directive-not-published', status: 'FAIL',
        routes_not_on_disk: [], source_leaks: [],
        rendered_leaks: [{
          implementation_path: 'dentistry/cost-insurance/index.html',
          phrase: 'Use the same questions with every lawyer on your shortlist',
          origin: 'enumerated:data/release/withheld_page_phrases.json'
        }]
      }
    }
  },
  {
    id: 'internal-link-inbound-coverage',
    label: 'published_page_nothing_links_to',
    route: '/zzz-isolation-measure/',
    measured: 'Publishing zzz-isolation-measure/index.html and adding its <loc> to sitemaps/sitemap_all.xml - a page nothing links to, which is the shape a release creates; the validator exited 1 across 2,056 examined pages and wrote this new_orphans row.',
    evidence: {
      'artifacts/validation/internal-link-inbound-coverage.json': {
        schema_version: '1.0', validator: 'internal-link-inbound-coverage', status: 'FAIL',
        orphan_count: 1, stale_baseline: [],
        new_orphans: [{ route: '/zzz-isolation-measure/', dead_inbound: [] }]
      }
    }
  }
];

// One case per DECLARED POINTER on medical-schema-emission, because the six arrays
// do not share a shape and a contract that exercised only the first would leave the
// other five unproved. Each row is what the validator wrote when that specific
// failure was constructed.
const MEDICAL_EVIDENCE_BASE = {
  schema_version: '1.0', validator: 'medical-schema-emission', status: 'FAIL',
  missing_medical_web_page: [], medical_web_page_on_non_medical_route: [],
  missing_price_specification: [], price_mismatch: [],
  price_in_markup_not_visible_on_page: [], json_ld_parse_failures: []
};
const MEDICAL_CASES = [
  { key: 'missing_medical_web_page', route: '/trt/', value: ['trt/index.html'],
    measured: 'Rewriting "MedicalWebPage" to "WebPage" in trt/index.html.' },
  { key: 'medical_web_page_on_non_medical_route', route: '/personal-injury/', value: ['personal-injury/index.html'],
    measured: 'Adding a MedicalWebPage JSON-LD node to personal-injury/index.html.' },
  { key: 'missing_price_specification', route: '/dentistry/dental-implants/', value: ['dentistry/dental-implants/index.html'],
    measured: 'Rewriting "PriceSpecification" to "Thing" in dentistry/dental-implants/index.html.' },
  { key: 'price_mismatch', route: '/dentistry/clear-aligners/',
    value: [{ file: 'dentistry/clear-aligners/index.html', row: 'In-office, doctor-monitored (Invisalign, ClearCorrect, Spark)', expected: '3000-8500', emitted: '3007-8500' }],
    measured: 'Shifting a minPrice by 7 in dentistry/clear-aligners/index.html.' },
  { key: 'price_in_markup_not_visible_on_page', route: '/dentistry/clear-aligners/',
    value: [{ file: 'dentistry/clear-aligners/index.html', row: 'In-office, doctor-monitored (Invisalign, ClearCorrect, Spark)', min: '$3,000', max: '$8,500' }],
    measured: 'Changing the visible "$3,000" to "$3,001" in dentistry/clear-aligners/index.html while leaving the markup correct.' },
  { key: 'json_ld_parse_failures', route: '/trt/',
    value: [{ file: 'trt/index.html', errors: ["Expected property name or '}' in JSON at position 2 (line 1 column 3)"] }],
    measured: 'Corrupting a JSON-LD block in trt/index.html.' }
];
for (const row of MEDICAL_CASES) {
  MEASURED.push({
    id: 'medical-schema-emission',
    label: row.key,
    route: row.route,
    measured: `${row.measured} The validator exited 1 and populated ${row.key}.`,
    evidence: { 'artifacts/validation/medical-schema-emission.json': { ...MEDICAL_EVIDENCE_BASE, [row.key]: row.value } }
  });
}

const OTHER_UNITS = ['/an-untouched-sibling/', '/another-untouched-sibling/'];
for (const m of MEASURED) {
  const entry = registryEntry(m.id);
  if (!entry) {
    errorsBeforeCases.push(`${m.id}: this contract proves a measured mapping for it, but no validator with that id is in _validation_registry.json. A proof about a validator that is not registered proves nothing.`);
    continue;
  }
  cases.push({
    name: `measured_mapping_holds_its_own_unit:${m.id}:${m.label}`,
    expect_code: 0,
    expect_out: new RegExp(`HELD ${m.route.replace(/\//g, '\\/')} - ${m.id}`),
    why: `${m.measured} With the route in this release's mutation scope, the failure is charged to it alone and the other ${OTHER_UNITS.length} units still publish.`,
    spec: {
      validators: [entry],
      results: [failResult(m.id)],
      accepted_routes: [m.route, ...OTHER_UNITS],
      evidence: m.evidence
    }
  });
  cases.push({
    name: `measured_mapping_out_of_scope_is_systemic:${m.id}:${m.label}`,
    expect_code: 1,
    expect_out: /never touched|build fault/,
    why: `The same measured failure, on a route this release never thawed. Safety property 1 holds for the new mappings too: the failure may not be held, and the whole run fails.`,
    spec: {
      validators: [entry],
      results: [failResult(m.id)],
      accepted_routes: OTHER_UNITS,
      evidence: m.evidence
    }
  });
  cases.push({
    name: `measured_mapping_zero_published_fails:${m.id}:${m.label}`,
    expect_code: 1,
    expect_out: /0 unit\(s\) publishable/,
    why: 'The held route is the only unit in scope, so nothing would publish. Safety property 2 holds for the new mappings too: isolation may never be a way to publish nothing and call it success.',
    spec: {
      validators: [entry],
      results: [failResult(m.id)],
      accepted_routes: [m.route],
      evidence: m.evidence
    }
  });
}

const errors = errorsBeforeCases;
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
