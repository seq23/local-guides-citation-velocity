#!/usr/bin/env node
'use strict';

// A repair that refuses because there is NOTHING LEFT TO REPAIR must not be
// read as a repair that failed.
//
// Run 34274346332 (2026-09-08) took Velocity Content Release red on exactly
// this. `recover:run-delivery-coverage-ratchet` printed "REBASELINE REFUSED:
// no run is unenrolled and no cap can be tightened, so this would rewrite the
// identical baseline and report success. Nothing to repair." and exited 1,
// while agent-run-delivery-coverage's own artifact recorded PASS in that same
// run. The loop saw exit!=0, logged "repair FAILED", and declared
// REPAIRS_CHANGED_NOTHING.
//
// This is the third appearance of ONE mechanism: the loop inferring tree
// health from a repair's exit code instead of asking the validator. The
// 2026-09-03 fix added that recheck but gated it behind `code === 0`, so the
// non-zero half survived. This guard pins the whole decision table so the next
// variant cannot be shipped by fixing only the case that is currently red.
//
// Rule 0: this validator hard-fails if it examines zero cases.

const path = require('path');

const CASES = [
  {
    name: 'refusal_with_nothing_to_repair_and_validator_now_passes',
    why: 'run 34274346332: the exact regression this guard exists for',
    input: { code: 1, before: 'T', after: 'T', recheckPasses: true },
    expect: { failed: false, refusedButResolved: true, noOp: false }
  },
  {
    name: 'refusal_while_validator_still_fails_is_still_fatal',
    why: 'the assertion must NOT be weakened: a real broken repair stays fatal',
    input: { code: 1, before: 'T', after: 'T', recheckPasses: false },
    expect: { failed: true, refusedButResolved: false, noOp: false }
  },
  {
    name: 'exit_zero_no_file_changed_and_validator_still_fails_is_a_no_op',
    why: 'the 2026-09-03 case must keep working',
    input: { code: 0, before: 'T', after: 'T', recheckPasses: false },
    expect: { failed: false, refusedButResolved: false, noOp: true }
  },
  {
    name: 'exit_zero_no_file_changed_but_validator_now_passes_is_progress',
    why: 'already fixed mid-pass by Tier 8; must not be named a dead end',
    input: { code: 0, before: 'T', after: 'T', recheckPasses: true },
    expect: { failed: false, refusedButResolved: false, noOp: false }
  },
  {
    name: 'exit_zero_that_changed_the_tree_is_plain_progress',
    why: 'the ordinary success path is never rechecked and never a no-op',
    input: { code: 0, before: 'T', after: 'T2' },
    expect: { failed: false, refusedButResolved: false, noOp: false }
  }
];

const PROGRESS_CASES = [
  {
    name: 'a_resolved_refusal_counts_as_progress',
    repaired: [{ id: 'x', code: 1, no_op: false, resolved_by_recheck: true }],
    expectNoProgress: false
  },
  {
    name: 'a_genuinely_failed_repair_is_no_progress',
    repaired: [{ id: 'x', code: 1, no_op: false, resolved_by_recheck: false }],
    expectNoProgress: true
  },
  {
    name: 'a_no_op_is_no_progress',
    repaired: [{ id: 'x', code: 0, no_op: true, resolved_by_recheck: false }],
    expectNoProgress: true
  },
  {
    name: 'one_resolved_among_failures_still_counts_as_progress',
    repaired: [
      { id: 'a', code: 1, no_op: false, resolved_by_recheck: false },
      { id: 'b', code: 1, no_op: false, resolved_by_recheck: true }
    ],
    expectNoProgress: false
  }
];

// The other half of the same outage: the loop captured the repair's stdout and
// stderr and printed none of it, so the CI log read "repair FAILED ... (exit 1)"
// while the repair had already printed a complete named stop. A stop that is not
// printed is not a named stop.
const RENDER_CASES = [
  {
    name: 'a_failed_repair_echoes_its_own_words',
    why: 'run 34274346332: the refusal text existed and never reached the log',
    input: {
      id: 'agent-run-delivery-coverage',
      cmd: 'npm run recover:run-delivery-coverage-ratchet',
      code: 1,
      verdict: { failed: true, refusedButResolved: false, noOp: false, resolvedByRecheck: false },
      out: 'AGENT RUN DELIVERY COVERAGE REBASELINE REFUSED: nothing to repair.'
    },
    mustInclude: ['repair FAILED', 'REBASELINE REFUSED: nothing to repair.'],
    mustNotInclude: ['printed NOTHING']
  },
  {
    name: 'a_failed_repair_that_says_nothing_is_itself_named',
    why: 'a bare non-zero exit must not pass through silently',
    input: {
      id: 'x',
      cmd: 'npm run recover:x',
      code: 1,
      verdict: { failed: true, refusedButResolved: false, noOp: false, resolvedByRecheck: false },
      out: '   \n  '
    },
    mustInclude: ['repair FAILED', 'printed NOTHING'],
    mustNotInclude: []
  },
  {
    name: 'a_resolved_refusal_still_shows_why_it_refused',
    why: 'the benign case must remain legible, not merely quiet',
    input: {
      id: 'x',
      cmd: 'npm run recover:x',
      code: 1,
      verdict: { failed: false, refusedButResolved: true, noOp: false, resolvedByRecheck: true },
      out: 'REFUSED: no run is unenrolled'
    },
    mustInclude: ['nothing left to repair', 'REFUSED: no run is unenrolled'],
    mustNotInclude: ['repair FAILED', 'printed NOTHING']
  },
  {
    name: 'a_no_op_echoes_whatever_it_printed',
    why: 'the exit-0 dead end is as much a triage problem as the exit-1 one',
    input: {
      id: 'x',
      cmd: 'npm run recover:x',
      code: 0,
      verdict: { failed: false, refusedButResolved: false, noOp: true, resolvedByRecheck: false },
      out: 'nothing to do'
    },
    mustInclude: ['repair NO-OP', 'nothing to do'],
    mustNotInclude: ['repair FAILED']
  },
  {
    name: 'plain_success_is_not_narrated',
    why: 'the ordinary path stays quiet; only exceptions are explained',
    input: {
      id: 'x',
      cmd: 'npm run recover:x',
      code: 0,
      verdict: { failed: false, refusedButResolved: false, noOp: false, resolvedByRecheck: false },
      out: 'rewrote the baseline'
    },
    mustBeEmpty: true
  }
];

(async () => {
  const mod = await import(
    path.join('file://', __dirname, '..', 'selfheal', 'repair_outcome.mjs')
  );
  const { classifyRepair, noRepairMadeProgress, renderRepairOutcome } = mod;
  const errors = [];
  let examined = 0;

  for (const c of CASES) {
    examined += 1;
    const got = classifyRepair(c.input);
    for (const [k, want] of Object.entries(c.expect)) {
      if (got[k] !== want) {
        errors.push(`classify:${c.name}:${k}:expected=${want}:actual=${got[k]}`);
      }
    }
  }

  for (const c of PROGRESS_CASES) {
    examined += 1;
    const got = noRepairMadeProgress(c.repaired);
    if (got !== c.expectNoProgress) {
      errors.push(`progress:${c.name}:expected=${c.expectNoProgress}:actual=${got}`);
    }
  }

  for (const c of RENDER_CASES) {
    examined += 1;
    let lines;
    try {
      lines = renderRepairOutcome(c.input);
    } catch (e) {
      errors.push(`render:${c.name}:threw:${e && e.message}`);
      continue;
    }
    if (!Array.isArray(lines)) {
      errors.push(`render:${c.name}:did_not_return_lines`);
      continue;
    }
    const text = lines.join('\n');
    if (c.mustBeEmpty) {
      if (lines.length) errors.push(`render:${c.name}:expected_no_output:actual=${JSON.stringify(text)}`);
      continue;
    }
    for (const needle of c.mustInclude || []) {
      if (!text.includes(needle)) errors.push(`render:${c.name}:missing=${JSON.stringify(needle)}:actual=${JSON.stringify(text)}`);
    }
    for (const needle of c.mustNotInclude || []) {
      if (text.includes(needle)) errors.push(`render:${c.name}:must_not_contain=${JSON.stringify(needle)}:actual=${JSON.stringify(text)}`);
    }
  }

  // Rule 0. A decision table that examined nothing has proved nothing.
  const expectedCases = CASES.length + PROGRESS_CASES.length + RENDER_CASES.length;
  if (examined === 0 || examined !== expectedCases) {
    console.error('SELFHEAL REFUSAL IS NOT FAILURE FAIL');
    console.error(
      `- examined_zero_or_partial_cases:examined=${examined}:expected=${expectedCases}`
    );
    process.exit(1);
  }

  if (errors.length) {
    console.error('SELFHEAL REFUSAL IS NOT FAILURE FAIL');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log(
    `SELFHEAL REFUSAL IS NOT FAILURE PASS: ${examined} decision case(s) examined; ` +
    'a refusal with nothing left to repair is progress, a refusal whose validator still fails is fatal, and every non-routine repair outcome echoes the repair\'s own words.'
  );
})().catch((e) => {
  console.error('SELFHEAL REFUSAL IS NOT FAILURE FAIL');
  console.error(`- validator_threw:${e && e.message}`);
  process.exit(1);
});
