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
// budget that had not bound (85 selected of 125). The plan was simply never re-derived
// from the ledger it is supposed to follow. That is the "two components each keeping
// their own list with no link" defect, and it produced ~12 red runs on main in one day.
//
// carried-reason-truthfulness catches the SYMPTOM after the fact, inside a run that has
// already spent a full build. This catches the CAUSE, statically, at validation time:
//
//   Any step that invokes citation:prepare-velocity-intake must also invoke
//   citation:plan-agent-exact, after it, in that same step - unless it invokes
//   release:velocity-intake, the full pipeline that already chains both.
//
// Rule 0: examining zero steps is a FAILURE, not a pass on an empty loop. If the intake
// is renamed or the workflow is restructured so no step matches, this validator has
// stopped guarding anything and must say so rather than exit 0.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DIR = '.github/workflows';
const OUT = 'artifacts/validation/intake-plan-regeneration.json';

const INTAKE = 'citation:prepare-velocity-intake';
const PLANNER = 'citation:plan-agent-exact';
const FULL_PIPELINE = 'release:velocity-intake';

function rel(p) { return path.join(ROOT, p); }

// A workflow file is split into steps on `- name:` at any indentation. Steps are the
// unit that matters: the intake and the planner have to land in the SAME shell block,
// because a later step runs after validate:release has already judged the tree.
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
// `#` comment must not satisfy the requirement - otherwise this validator could be
// silenced by writing prose about the command instead of running it.
function invokes(stepLines, token) {
  for (let i = 0; i < stepLines.length; i += 1) {
    const line = stepLines[i];
    const code = line.replace(/#.*$/, '');
    if (code.includes(token)) return i;
  }
  return -1;
}

function main() {
  const dirAbs = rel(DIR);
  if (!fs.existsSync(dirAbs)) {
    console.error(`INTAKE PLAN REGENERATION FAIL: ${DIR} does not exist; there are no workflows to guard.`);
    process.exit(1);
  }
  const files = fs.readdirSync(dirAbs).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml')).sort();

  const examined = [];
  const errors = [];

  for (const name of files) {
    const relPath = `${DIR}/${name}`;
    const text = fs.readFileSync(rel(relPath), 'utf8');
    if (!text.includes(INTAKE)) continue;
    for (const step of splitSteps(text, relPath)) {
      const intakeAt = invokes(step.lines, INTAKE);
      if (intakeAt === -1) continue;
      const fullAt = invokes(step.lines, FULL_PIPELINE);
      const plannerAt = invokes(step.lines, PLANNER);
      const record = {
        file: relPath,
        step: step.name,
        line: step.line,
        intake_line: step.line + intakeAt,
        planner_line: plannerAt === -1 ? null : step.line + plannerAt,
        satisfied_by: null
      };
      if (fullAt !== -1) {
        record.satisfied_by = FULL_PIPELINE;
      } else if (plannerAt === -1) {
        errors.push(`${relPath}:${step.line + intakeAt}:"${step.name}":runs_${INTAKE}_without_${PLANNER}`);
      } else if (plannerAt < intakeAt) {
        errors.push(`${relPath}:${step.line + intakeAt}:"${step.name}":${PLANNER}_runs_before_${INTAKE}_so_it_reads_the_stale_ledger`);
      } else {
        record.satisfied_by = PLANNER;
      }
      examined.push(record);
    }
  }

  // Rule 0. Zero steps examined means the thing this guards no longer exists in the
  // shape this validator understands - which is not evidence that it is safe.
  if (!examined.length) {
    console.error(`INTAKE PLAN REGENERATION FAIL: no step in ${DIR} invokes ${INTAKE}. This validator examined zero items, which is not the same as finding nothing wrong - the command was probably renamed, and the guard is now inert.`);
    process.exit(1);
  }

  const report = {
    schema_version: '1.0',
    validator: 'intake-plan-regeneration',
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: new Date().toISOString(),
    workflow_files_scanned: files.length,
    steps_examined: examined.length,
    steps: examined,
    errors
  };
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify(report, null, 2)}\n`);

  if (errors.length) {
    console.error(`INTAKE PLAN REGENERATION FAIL: ${errors.length} step(s) rewrite the disposition ledger without re-deriving the exact plan from it.`);
    for (const e of errors) console.error(`- ${e}`);
    console.error(`Fix: add \`npm run ${PLANNER}\` immediately after \`npm run ${INTAKE}\` in that step, before the build and validate:release.`);
    process.exit(1);
  }
  console.log(`INTAKE PLAN REGENERATION PASS: ${examined.length} step(s) across ${files.length} workflow file(s) run ${INTAKE}; every one re-derives the exact plan before validating.`);
}

main();
