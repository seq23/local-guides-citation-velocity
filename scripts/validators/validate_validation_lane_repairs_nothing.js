#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A validation lane must not repair the thing it is about to check.
 *
 * THE OUTAGE. `_repo_validation_matrix.json` is a committed projection of
 * `_validation_registry.json`; `validation-registry` hard-fails with
 * `matrix:not-generated-from-current-registry` when the two disagree. On 2026-09-08 PR
 * #93 changed one string in the registry and did not regenerate the matrix. Validate
 * Repo passed. It passed because `release:ci-validate` ran
 * `scripts/validation/generate_validation_matrix.js` as its `validation-matrix-refresh`
 * stage six stages BEFORE `validation-registry` ran - so the check was handed a file
 * that same run had just rewritten. The desync merged to main, and the two lanes that
 * do not run the generator first (Velocity Content Release, Query Evidence Refresh)
 * failed on `validation-registry` on every run afterwards. It has no registered repair,
 * because it is a defect in a committed file rather than a repairable state, so
 * self-heal reported NOT CLEAN and both lanes went red daily.
 *
 * The check was never broken. It was never allowed to see the state it exists to catch.
 *
 * WHAT THIS PROVES. Three things, none of them specific to the matrix:
 *
 *   1. COMMITTED PROJECTIONS ENROL THEMSELVES. Every git-tracked JSON carrying a
 *      top-level `generated_from` is a projection of a source file that must travel
 *      with it. There is no second list to keep in step; a new projection is governed
 *      the day it declares its lineage. Examining zero is a FAILURE.
 *
 *   2. SOMETHING ACTUALLY COMPARES EACH ONE. A projection no ACTIVE HARD_FAIL
 *      validator declares alongside its source has nothing asserting parity, which is
 *      the "guard that cannot reach what it governs" shape. Named, not assumed.
 *
 *   3. NO VALIDATE-MODE STAGE REWRITES ONE. Stages are read out of the real stage list
 *      in scripts/release/run_staged_release.js. Any stage whose command reaches a
 *      script that writes an enrolled projection is EXECUTED here and the projection is
 *      compared byte-for-byte before and after. That is deliberately behavioural: a
 *      static allowlist of "safe" flags would be defeated by the next flag, and the
 *      question is not what a command is called but whether it writes the file. If it
 *      does write, the original bytes are restored and the stage is named as a repair
 *      of its own input.
 *
 * Rule 0: zero projections, zero stages, or zero writer-candidate scripts scanned is a
 * FAILURE. This guard proving nothing is not this guard passing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT_REL = 'artifacts/validation/validation-lane-repairs-nothing.json';
const LANE_REL = 'scripts/release/run_staged_release.js';
const REGISTRY_REL = '_validation_registry.json';
const abs = (rel) => path.join(ROOT, rel);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const errors = [];

// ---------------------------------------------------------------- 1. enrolment
function trackedFiles() {
  const outText = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return outText.split('\0').filter(Boolean);
}

let tracked;
try {
  tracked = trackedFiles();
} catch (e) {
  console.error(`VALIDATION LANE REPAIRS NOTHING FAIL: could not list tracked files (${e.message}). Enrolment is derived from git, so an unreadable index means this guard proved nothing.`);
  process.exit(1);
}

const projections = [];
for (const rel of tracked) {
  if (!rel.endsWith('.json')) continue;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(abs(rel), 'utf8')); } catch { continue; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
  if (typeof doc.generated_from !== 'string' || !doc.generated_from.trim()) continue;
  // `generated_from` names one or more source files, sometimes joined with " + ".
  const sources = doc.generated_from.split('+').map((s) => s.trim()).filter((s) => s && fs.existsSync(abs(s)));
  projections.push({ projection: rel, generated_from: doc.generated_from, sources });
}

if (!projections.length) {
  console.error(
    'VALIDATION LANE REPAIRS NOTHING FAIL: examined zero committed projections. Enrolment is every git-tracked '
    + 'JSON carrying a top-level `generated_from`; finding none means the lineage declaration was dropped or the '
    + 'enrolment rule has drifted off it. Projection integrity is UNKNOWN, not proven.',
  );
  process.exit(1);
}

for (const p of projections) {
  if (!p.sources.length) {
    errors.push(`${p.projection}:generated_from_names_no_existing_source:${JSON.stringify(p.generated_from)} - a projection whose source cannot be resolved cannot be compared to it`);
  }
}

// ------------------------------------------------- 2. something compares each one
const registry = JSON.parse(fs.readFileSync(abs(REGISTRY_REL), 'utf8'));
const validators = Array.isArray(registry.validators) ? registry.validators : [];
if (!validators.length) {
  console.error(`VALIDATION LANE REPAIRS NOTHING FAIL: ${REGISTRY_REL} declares no validators.`);
  process.exit(1);
}
const activeCommands = new Set(
  validators.filter((v) => v.status === 'ACTIVE' && v.command).map((v) => String(v.command).trim()),
);

for (const p of projections) {
  const asserter = validators.find((v) => v.status === 'ACTIVE' && v.severity === 'HARD_FAIL'
    && Array.isArray(v.requires_files)
    && v.requires_files.includes(p.projection)
    && p.sources.some((s) => v.requires_files.includes(s)));
  p.asserted_by = asserter ? asserter.id : null;
  if (!asserter) {
    errors.push(
      `${p.projection}:no_active_hard_fail_validator_declares_it_alongside_${p.sources.join('|') || 'its source'}`
      + ' - nothing in the registry is declared to read BOTH the projection and its source, so nothing is proven'
      + ' to be comparing them. Declare them in that validator\'s requires_files.',
    );
  }
}

// --------------------------------------- 3. no validate-mode stage rewrites one
const laneSrc = fs.readFileSync(abs(LANE_REL), 'utf8');
const stages = [...laneSrc.matchAll(/\bstage\(\s*'([^']+)'\s*,\s*'([^']+)'/g)].map((m) => ({ name: m[1], command: m[2] }));
if (!stages.length) {
  console.error(`VALIDATION LANE REPAIRS NOTHING FAIL: read zero stages out of ${LANE_REL}. The stage list is the population this guard governs; reading none means it governs nothing.`);
  process.exit(1);
}

// Which scripts write an enrolled projection? Derived by scanning every script the
// stage list can reach for a write call naming the projection's path. A regex over
// source would be a guess if it decided the VERDICT; here it only decides which
// commands are worth EXECUTING, and the verdict itself is the before/after bytes.
const scriptFiles = tracked.filter((rel) => rel.startsWith('scripts/') && (rel.endsWith('.js') || rel.endsWith('.mjs') || rel.endsWith('.cjs')));
if (!scriptFiles.length) {
  console.error('VALIDATION LANE REPAIRS NOTHING FAIL: scanned zero scripts for write targets.');
  process.exit(1);
}
const writersByProjection = new Map(projections.map((p) => [p.projection, new Set()]));
for (const rel of scriptFiles) {
  const src = fs.readFileSync(abs(rel), 'utf8');
  if (!/write(File)?Sync|createWriteStream|writeFile\(/.test(src)) continue;
  for (const p of projections) {
    const base = path.basename(p.projection);
    if (src.includes(p.projection) || src.includes(base)) writersByProjection.get(p.projection).add(rel);
  }
}

const stageChecks = [];
for (const s of stages) {
  const isValidatorCommand = activeCommands.has(s.command.trim());
  const suspects = [];
  for (const p of projections) {
    for (const writer of writersByProjection.get(p.projection)) {
      if (s.command.includes(writer)) suspects.push({ projection: p.projection, writer });
    }
  }
  const row = { stage: s.name, command: s.command, registered_validator_command: isValidatorCommand, writer_candidates: suspects, executed: false, rewrote: [] };
  stageChecks.push(row);
  if (!suspects.length) continue;

  // Execute it and watch the bytes. Restore anything it moved, then fail on it.
  const before = suspects.map(({ projection }) => ({ projection, bytes: fs.readFileSync(abs(projection)) }));
  row.executed = true;
  spawnSync(s.command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' },
  });
  for (const snap of before) {
    const after = fs.readFileSync(abs(snap.projection));
    if (sha(after) === sha(snap.bytes)) continue;
    fs.writeFileSync(abs(snap.projection), snap.bytes);
    row.rewrote.push(snap.projection);
    errors.push(
      `${LANE_REL}:stage_repairs_its_own_input:${s.name}:${snap.projection} - "${s.command}" rewrote a committed `
      + 'projection that a validator later in the same run compares to its source. The desync then cannot fail on '
      + 'the change that introduced it, and instead fails in every lane that does NOT run this stage. Make the '
      + 'stage ASSERT parity (and fail, naming the remedy) instead of restoring it. Original bytes restored.',
    );
  }
}

const executed = stageChecks.filter((r) => r.executed).length;

const report = {
  schema_version: '1.0',
  validator: 'validation-lane-repairs-nothing',
  status: errors.length ? 'FAIL' : 'PASS',
  lane: LANE_REL,
  enrolment_rule: 'every git-tracked JSON carrying a top-level generated_from',
  projections_examined: projections.length,
  projections,
  stages_examined: stages.length,
  scripts_scanned_for_write_targets: scriptFiles.length,
  stages_executed_as_writer_candidates: executed,
  stages: stageChecks,
  errors,
};
fs.mkdirSync(abs('artifacts/validation'), { recursive: true });
fs.writeFileSync(abs(OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  console.error(`VALIDATION LANE REPAIRS NOTHING FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(
  `VALIDATION LANE REPAIRS NOTHING PASS: ${projections.length} committed projection(s) examined `
  + `(${projections.map((p) => `${p.projection} <- ${p.generated_from}, asserted by ${p.asserted_by}`).join('; ')}); `
  + `${stages.length} stage(s) in ${LANE_REL} read, ${scriptFiles.length} script(s) scanned for write targets, `
  + `${executed} writer-candidate stage(s) executed and none rewrote a projection it is checked against.`,
);
