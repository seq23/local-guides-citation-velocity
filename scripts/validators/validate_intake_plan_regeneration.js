#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// The intake and the exact plan are two lists of the same rows. Nothing linked them.
//
// `citation:prepare-velocity-intake` REWRITES the disposition ledger
// (data/report_fixes/agent_artifact_disposition_ledger.json): a row it skips is
// stamped SKIPPED_EXISTING_WITH_PROOF / exact_title_already_exists_in_pages, or
// SKIPPED_DUPLICATE_WITH_PROOF / canonical_route_already_selected.
//
// The carried REASON for those very same rows lives in a different file,
// data/report_fixes/agent_exact_implementation_plan.json, and only
// `citation:plan-agent-exact` writes it.
//
// The absorption step of velocity-content-release.yml ran the intake and never the
// planner, then ran validate:release. So every day the ledger moved and the plan did
// not, and carried-reason-truthfulness - correctly - failed on the gap: on 2026-09-03,
// 185 carried rows still blamed UNSELECTED_READY_ROW_OUTSIDE_PROCESSING_BUDGET for a
// budget that had not bound (85 selected of 125). That is the "two components each
// keeping their own list with no link" defect, and it produced ~12 red runs in one day.
//
// The first fix tried here added `npm run citation:plan-agent-exact` straight into the
// absorption step, right before build:cached. It made carried-reason-truthfulness pass
// and broke agent-exact-implementation-trace in the same run: the freshly-regenerated
// plan now carried PLANNED repair specs that release:velocity-intake had not applied
// yet - apply-agent-exact only runs in the NEXT job step - so trace read them as
// repair_not_proven. Reproduced directly: running citation:prepare-velocity-intake,
// citation:plan-agent-exact, build:cached, validate:release in that order on a clean
// tree, with nothing else applied, fails agent-exact-implementation-trace on exactly
// the routes the fresh plan just (re)selected. Trading one red validator for another
// is not a fix.
//
// The actual fix has two halves, and this validator asserts both statically:
//
//   1. The absorption step (and its rebase-retry re-derivation) may rewrite the
//      ledger via citation:prepare-velocity-intake, but must NOT also call
//      citation:plan-agent-exact in that same step. The plan on disk there stays
//      whatever the last full release cycle committed - already applied, already
//      traced - and only the ledger moves.
//   2. carried-reason-truthfulness must not be checked against that deliberately
//      stale plan. It is removed from the "release" validation profile (the one the
//      absorption step validates against) and instead required inside
//      release:velocity-intake's own script chain, immediately after
//      citation:plan-agent-exact - the one place both files are regenerated
//      together, before apply-agent-exact ever runs, so a real mismatch still fails
//      fast instead of being caught after a full build and publish.
//
// Rule 0: examining zero steps is a FAILURE, not a pass on an empty loop. If the
// intake is renamed or the workflow is restructured so nothing matches, this
// validator has stopped guarding anything and must say so rather than exit 0.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DIR = '.github/workflows';
const OUT = 'artifacts/validation/intake-plan-regeneration.json';
const REGISTRY_PATH = '_validation_registry.json';
const PKG_PATH = 'package.json';

const INTAKE = 'citation:prepare-velocity-intake';
const PLANNER = 'citation:plan-agent-exact';
const TRUTHFULNESS_ID = 'carried-reason-truthfulness';
const TRUTHFULNESS_SCRIPT = 'validate:carried-reason-truthfulness';
const FULL_PIPELINE_SCRIPT = 'release:velocity-intake';
const PREMATURE_CHECKPOINT_PROFILE = 'release';

function rel(p) { return path.join(ROOT, p); }
function readJson(p) { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); }

// A workflow file is split into steps on `- name:` at any indentation.
function splitSteps(text, file) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((line, i) => { if (/^\s*-\s+name:\s/.test(line)) starts.push(i); });
  const steps = [];
  for (let s = 0; s < starts.length; s += 1) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const body = lines.slice(from, to);
    steps.push({
      file,
      name: (body[0].match(/name:\s*(.*)$/) || [, ''])[1].trim(),
      line: from + 1,
      lines: body
    });
  }
  return steps;
}

// Only real shell invocations count. A line that merely mentions the script inside a
// `#` comment must not satisfy or violate the requirement - otherwise this validator
// could be silenced (or falsely tripped) by prose about the command.
function invokes(stepLines, token) {
  for (let i = 0; i < stepLines.length; i += 1) {
    const line = stepLines[i];
    const code = line.replace(/#.*$/, '');
    if (code.includes(token)) return i;
  }
  return -1;
}

function checkWorkflowSteps(errors) {
  const dirAbs = rel(DIR);
  if (!fs.existsSync(dirAbs)) {
    return { examined: [], scanned: 0, halted: `${DIR} does not exist; there are no workflows to guard.` };
  }
  const files = fs.readdirSync(dirAbs).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml')).sort();
  const examined = [];
  for (const name of files) {
    const relPath = `${DIR}/${name}`;
    const text = fs.readFileSync(rel(relPath), 'utf8');
    if (!text.includes(INTAKE)) continue;
    for (const step of splitSteps(text, relPath)) {
      const intakeAt = invokes(step.lines, INTAKE);
      if (intakeAt === -1) continue;
      const fullAt = invokes(step.lines, FULL_PIPELINE_SCRIPT);
      const plannerAt = invokes(step.lines, PLANNER);
      const record = { file: relPath, step: step.name, line: step.line, intake_line: step.line + intakeAt, planner_line: plannerAt === -1 ? null : step.line + plannerAt, full_pipeline: fullAt !== -1 };
      // Calling the full pipeline is always fine - it chains planner, apply, and
      // trace itself, in the right order, in one script.
      if (fullAt === -1 && plannerAt !== -1) {
        errors.push(`${relPath}:${step.line + plannerAt}:"${step.name}":runs_${PLANNER}_directly_after_${INTAKE}_without_apply_first:this_is_the_2026-09-03_regression_the_plan_carries_unapplied_specs_and_agent-exact-implementation-trace_fails`);
      }
      examined.push(record);
    }
  }
  return { examined, scanned: files.length, halted: null };
}

function checkFullPipelineOrdering(pkg, errors) {
  const script = String((pkg.scripts || {})[FULL_PIPELINE_SCRIPT] || '');
  if (!script) {
    errors.push(`package_missing_script:${FULL_PIPELINE_SCRIPT}`);
    return;
  }
  const plannerAt = script.indexOf(`npm run ${PLANNER}`);
  const truthAt = script.indexOf(`npm run ${TRUTHFULNESS_SCRIPT}`);
  if (plannerAt === -1) errors.push(`${FULL_PIPELINE_SCRIPT}:missing:${PLANNER}`);
  if (truthAt === -1) errors.push(`${FULL_PIPELINE_SCRIPT}:missing:${TRUTHFULNESS_SCRIPT}`);
  if (plannerAt !== -1 && truthAt !== -1 && truthAt < plannerAt) {
    errors.push(`${FULL_PIPELINE_SCRIPT}:${TRUTHFULNESS_SCRIPT}_runs_before_${PLANNER}_so_it_would_check_a_stale_plan`);
  }
  if (!pkg.scripts || !pkg.scripts[TRUTHFULNESS_SCRIPT]) errors.push(`package_missing_script:${TRUTHFULNESS_SCRIPT}`);
}

function checkProfileMembership(errors) {
  const reg = readJson(REGISTRY_PATH);
  const validator = (reg.validators || []).find((v) => v.id === TRUTHFULNESS_ID);
  if (!validator) {
    errors.push(`registry_missing_validator:${TRUTHFULNESS_ID}`);
    return;
  }
  if ((validator.profiles || []).includes(PREMATURE_CHECKPOINT_PROFILE)) {
    errors.push(`${TRUTHFULNESS_ID}:still_in_profile:${PREMATURE_CHECKPOINT_PROFILE}:this_profile_is_validated_at_the_absorption_checkpoint_before_the_plan_is_regenerated`);
  }
}

function main() {
  const errors = [];
  const { examined, scanned, halted } = checkWorkflowSteps(errors);
  if (halted) {
    console.error(`INTAKE PLAN REGENERATION FAIL: ${halted}`);
    process.exit(1);
  }

  const pkg = readJson(PKG_PATH);
  checkFullPipelineOrdering(pkg, errors);
  checkProfileMembership(errors);

  // Rule 0. Zero workflow steps examined means the thing this guards no longer
  // exists in the shape this validator understands - which is not evidence that
  // it is safe. The package.json and registry checks above still ran regardless.
  if (!examined.length) {
    console.error(`INTAKE PLAN REGENERATION FAIL: no step in ${DIR} invokes ${INTAKE}. This validator examined zero workflow steps, which is not the same as finding nothing wrong - the command was probably renamed, and the workflow-side guard is now inert.`);
    process.exit(1);
  }

  const report = {
    schema_version: '2.0',
    validator: 'intake-plan-regeneration',
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: new Date().toISOString(),
    workflow_files_scanned: scanned,
    workflow_steps_examined: examined.length,
    steps: examined,
    full_pipeline_script: FULL_PIPELINE_SCRIPT,
    truthfulness_deferred_to: TRUTHFULNESS_SCRIPT,
    errors
  };
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify(report, null, 2)}\n`);

  if (errors.length) {
    console.error(`INTAKE PLAN REGENERATION FAIL: ${errors.length} issue(s).`);
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }
  console.log(`INTAKE PLAN REGENERATION PASS: ${examined.length} workflow step(s) across ${scanned} file(s) invoke ${INTAKE}; none also invoke ${PLANNER} directly; ${FULL_PIPELINE_SCRIPT} chains ${PLANNER} before ${TRUTHFULNESS_SCRIPT}; ${TRUTHFULNESS_ID} is not in the "${PREMATURE_CHECKPOINT_PROFILE}" profile.`);
}

main();
