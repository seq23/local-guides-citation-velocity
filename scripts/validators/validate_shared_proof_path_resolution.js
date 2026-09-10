#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * A SHARED MODULE NOTHING IS FORCED TO USE BECOMES A FOURTH PRIVATE COPY.
 *
 * On 2026-09-09/10 the same defect was found and fixed three times, in three files,
 * because each had its own private answer to "where does this recommendation's proof
 * live, and does that page exist yet?":
 *
 *   1. prepare_velocity_intake_release.js moved 39 proof pointers onto 13 pages that
 *      did not exist. Four release runs published zero pages (PR #114).
 *   2. compile_html_fix_acceptance_manifest.js asserted required content on the same
 *      not-yet-created targets.
 *   3. trace_citation_agent_fixes.js failed the release on `rendered_missing_route`
 *      for 8 of those routes, on the one run that had cleared absorption.
 *
 * scripts/lib/recommendation_proof_path.js now owns the rule. This validator makes
 * sharing it structural rather than a convention: every consumer the module DECLARES
 * must require it, and none may carry a private re-implementation of the resolution.
 * It reads PROOF_PATH_CONSUMERS from the module itself - the same pattern
 * validate_repair_fixture_capability.js uses on the REPAIRS map - so adding a consumer
 * to the list is what puts it under the guard, and a comment can never stand in for it.
 *
 * It hard-fails when it examines zero consumers: a guard that looped over an empty list
 * and printed PASS would be the exact "runs but inert" defect this repo keeps finding.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_REL = 'scripts/lib/recommendation_proof_path.js';
const errors = [];
const examined = [];

let sharedModule = null;
try { sharedModule = require(path.join(ROOT, MODULE_REL)); } catch (err) {
  console.error(`SHARED PROOF PATH RESOLUTION FAIL: cannot load ${MODULE_REL}: ${err.message}`);
  process.exit(1);
}

const consumers = Array.isArray(sharedModule.PROOF_PATH_CONSUMERS) ? sharedModule.PROOF_PATH_CONSUMERS : [];

/**
 * A PRIVATE RE-IMPLEMENTATION, not a stylistic preference.
 *
 * Each pattern is a shape that was ACTUALLY in one of these three files and that
 * actually produced the defect. They are not a general ban on `fs.existsSync`: they
 * name the specific act of deciding, locally, whether a recommendation's page is on
 * disk and where to grade it.
 */
const FORKED_RESOLUTION_PATTERNS = [
  {
    id: 'private_proof_pointer',
    // The #114 function itself, redeclared rather than imported.
    pattern: /function\s+resolveProofPath\s*\([^)]*\)\s*\{(?![^}]*resolveProofPointer)/,
    detail: 'declares its own resolveProofPath body instead of delegating to resolveProofPointer()'
  },
  {
    id: 'private_route_to_rendered_path',
    // `/a/b/` -> `a/b/index.html`, restated. Three files each had a copy, and they did
    // not agree about trailing slashes or about `?`/`#`.
    pattern: /function\s+routeToRenderedPath\s*\(/,
    detail: 'declares its own routeToRenderedPath instead of importing it'
  },
  {
    id: 'inline_target_route_to_index_html',
    // The one-liner form of the same conversion, used to decide existence on the spot.
    pattern: /target_route\s*\.replace\([^)]*\)\s*\.replace\([^)]*index\\?\.html/,
    detail: 'converts target_route to a rendered path inline instead of importing routeToRenderedPath'
  },
  {
    id: 'private_pending_retarget_reason',
    // The state name spelled out locally drifts the moment one copy is edited.
    pattern: /'retarget_deferred_until_new_target_page_exists'|"retarget_deferred_until_new_target_page_exists"/,
    detail: 'spells the pending-retarget reason out locally instead of importing PENDING_RETARGET_REASON'
  }
];

const IMPORT_PATTERN = /require\(\s*['"][^'"]*lib\/recommendation_proof_path['"]\s*\)/;

for (const rel of consumers) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    errors.push(`${rel}:declared_consumer_missing_from_tree`);
    continue;
  }
  const source = fs.readFileSync(abs, 'utf8');
  examined.push(rel);
  if (!IMPORT_PATTERN.test(source)) {
    errors.push(`${rel}:does_not_require_${MODULE_REL} - every consumer must resolve through the shared module`);
  }
  for (const rule of FORKED_RESOLUTION_PATTERNS) {
    if (rule.pattern.test(source)) errors.push(`${rel}:forked_resolution:${rule.id} - ${rule.detail}`);
  }
}

// The module has to actually export what the consumers are told to use, or "they all
// import it" is satisfied by an empty file.
for (const name of ['resolveRecommendationProof', 'resolveProofPointer', 'routeToRenderedPath', 'releaseUnitPathsFromPlan', 'PROOF_STATES', 'PENDING_RETARGET_REASON']) {
  if (sharedModule[name] === undefined) errors.push(`${MODULE_REL}:missing_export:${name}`);
}

// Behavioural spot-check: the module must distinguish the three states, or a consumer
// importing it faithfully still gets the wrong answer.
const probeRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'proof-path-'));
try {
  fs.mkdirSync(path.join(probeRoot, 'insights'), { recursive: true });
  fs.writeFileSync(path.join(probeRoot, 'insights/proven.html'), 'marker');
  const held = sharedModule.resolveRecommendationProof(
    { renderedPath: 'insights/proven.html', target_route: '/trt/guides/not-yet/', pending_retarget_path: 'trt/guides/not-yet/index.html' },
    { root: probeRoot }
  );
  if (held.state !== sharedModule.PROOF_STATES.PROVEN || held.gradeAt !== 'insights/proven.html') {
    errors.push(`${MODULE_REL}:pending_retarget_row_did_not_grade_at_its_proven_path (got ${held.state}/${held.gradeAt})`);
  }
  const pending = sharedModule.resolveRecommendationProof(
    { renderedPath: 'trt/guides/not-yet/index.html', target_route: '/trt/guides/not-yet/' },
    { root: probeRoot, releaseUnitPaths: new Set(['trt/guides/not-yet/index.html']) }
  );
  if (pending.state !== sharedModule.PROOF_STATES.PENDING_RELEASE_UNIT) {
    errors.push(`${MODULE_REL}:a_route_this_lane_creates_later_was_not_held (got ${pending.state})`);
  }
  const missing = sharedModule.resolveRecommendationProof(
    { renderedPath: 'trt/guides/never/index.html', target_route: '/trt/guides/never/' },
    { root: probeRoot, releaseUnitPaths: new Set() }
  );
  if (missing.state !== sharedModule.PROOF_STATES.MISSING) {
    errors.push(`${MODULE_REL}:a_genuinely_missing_page_was_not_reported_MISSING (got ${missing.state}) - this guard must never excuse a real regression`);
  }
} finally {
  fs.rmSync(probeRoot, { recursive: true, force: true });
}

// RULE 0: no stage may exit 0 having done nothing.
if (!examined.length) {
  console.error('SHARED PROOF PATH RESOLUTION FAIL: examined zero consumers.');
  console.error(`  PROOF_PATH_CONSUMERS in ${MODULE_REL} is empty or unreadable, so this guard governs nothing.`);
  console.error('  A guard that cannot reach what it governs has not passed.');
  process.exit(1);
}

const report = {
  schema_version: '1.0',
  validator: 'shared-proof-path-resolution',
  status: errors.length ? 'FAIL' : 'PASS',
  shared_module: MODULE_REL,
  consumers_examined: examined,
  consumer_count: examined.length,
  forked_resolution_patterns: FORKED_RESOLUTION_PATTERNS.map((rule) => rule.id),
  errors,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10)
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/shared-proof-path-resolution.json'), JSON.stringify(report, null, 2) + '\n');

if (errors.length) {
  console.error('SHARED PROOF PATH RESOLUTION FAIL');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(`SHARED PROOF PATH RESOLUTION PASS: ${examined.length} consumer(s) resolve through ${MODULE_REL}; none carries a private copy.`);
