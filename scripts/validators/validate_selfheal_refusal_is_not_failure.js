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

(async () => {
  const mod = await import(
    path.join('file://', __dirname, '..', 'selfheal', 'repair_outcome.mjs')
  );
  const { classifyRepair, noRepairMadeProgress } = mod;
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

  // Rule 0. A decision table that examined nothing has proved nothing.
  const expectedCases = CASES.length + PROGRESS_CASES.length;
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
    'a refusal with nothing left to repair is progress, a refusal whose validator still fails is fatal.'
  );
})().catch((e) => {
  console.error('SELFHEAL REFUSAL IS NOT FAILURE FAIL');
  console.error(`- validator_threw:${e && e.message}`);
  process.exit(1);
});
