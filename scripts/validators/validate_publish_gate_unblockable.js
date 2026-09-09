#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A GUARD THAT CANNOT UNBLOCK WHAT IT BLOCKS MUST NOT HOLD THE PUBLISH GATE.
 *
 * scripts/selfheal/heal_until_clean.mjs is the publish gate: validate -> repair ->
 * re-validate -> publish. A validator with no registered `repair_command` can never
 * become clean inside that contract. The loop can only ever name it and stop, so putting
 * it in the gate makes a REPORTING validator into a GATE it has no way to open - the
 * "guard that cannot reach what it governs" defect class.
 *
 * WHAT IT COST. Velocity Content Release was red on 9 of 11 days to 2026-09-09. On
 * 2026-09-09 alone THREE different repair-less validators each took the publish down in
 * turn: validation-registry (06:56), removal-directive-not-published (16:04),
 * clock-source-independence (18:09 and 18:45). Any one of the profile's repair-less
 * HARD_FAIL validators could do it, and none of them could undo it. Meanwhile the INGEST
 * half of the same pipeline pushes unconditionally - `absorb agent runs <date>` landed on
 * main on 09-05 and 09-09 with no `velocity content release` commit on either day - so
 * eleven days of agent artifacts were absorbed and never published: 698 recommendations
 * recorded and not applied, 63 pages named and never created. Two halves of one pipeline
 * with opposite failure semantics, and the divergence was silent.
 *
 * THE RULE THIS ASSERTS. Only a validator with a registered repair_command may hold the
 * gate. A repair-less validator still RUNS, still FAILS, and is still HARD_FAIL in
 * validate:release - the lane whose job is reporting, which blocks merges to main. What
 * it no longer does is strand the publication of content that already passed that lane.
 *
 * This validator guards the guard. It reads the loop's own source and proves the rule is
 * still implemented, so a future edit that reinstates the deadlock fails here rather than
 * silently costing another eleven days. It also proves the loop still SURFACES those
 * failures, because a rule that made them quiet instead of non-blocking would be the
 * weakening this repo forbids.
 *
 * Rule 0: examining zero validators, or failing to read the loop, is a FAILURE.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LOOP_REL = 'scripts/selfheal/heal_until_clean.mjs';
const REGISTRY_REL = '_validation_registry.json';
const OUT_REL = 'artifacts/validation/publish-gate-unblockable.json';

const errors = [];
const abs = (rel) => path.join(ROOT, rel);

let loop = '';
try {
  loop = fs.readFileSync(abs(LOOP_REL), 'utf8');
} catch (e) {
  console.error(`PUBLISH GATE UNBLOCKABLE FAIL: cannot read ${LOOP_REL} (${e.message}), so the gate's behaviour is UNKNOWN, not proven.`);
  process.exit(1);
}

let registry = null;
try {
  registry = JSON.parse(fs.readFileSync(abs(REGISTRY_REL), 'utf8'));
} catch (e) {
  console.error(`PUBLISH GATE UNBLOCKABLE FAIL: cannot read ${REGISTRY_REL} (${e.message}).`);
  process.exit(1);
}
const validators = Array.isArray(registry.validators) ? registry.validators : [];
if (!validators.length) {
  console.error(`PUBLISH GATE UNBLOCKABLE FAIL: ${REGISTRY_REL} declares no validators, so this examined zero. Refusing to pass on an empty loop.`);
  process.exit(1);
}

/**
 * The gate must partition its unresolved failures by whether a repair exists, must let
 * only the repairable half hold the gate, and must still print the other half. These are
 * behavioural assertions about the loop, each tied to the identifier that implements it,
 * so a rename that breaks the rule cannot pass by leaving a comment behind.
 */
const required = [
  { id: 'partitions_by_repair', re: /reportedOnly\s*=\s*unresolved\.filter\(\(id\)\s*=>\s*!repairFor\.has\(id\)\)/, why: 'the loop must separate failures that have a repair from those that do not' },
  { id: 'gate_held_only_by_repairable', re: /heldGate\s*=\s*unresolved\.filter\(\(id\)\s*=>\s*repairFor\.has\(id\)\)/, why: 'only a validator with a repair may hold the gate' },
  { id: 'publishable_ignores_unrepairable', re: /publishable\s*=\s*clean\s*\|\|\s*heldGate\.length\s*===\s*0/, why: 'the publish decision must not consider repair-less failures' },
  { id: 'exit_on_held_gate_only', re: /if\s*\(!publishable\)\s*\{/, why: 'the non-zero exit must be driven by the gate decision, not by cleanliness' },
  { id: 'reports_unrepairable_loudly', re: /FAILING,\s*NOT\s*BLOCKING/, why: 'a repair-less failure must still be printed by name; non-blocking must not become silent' },
  { id: 'writes_blocked_state', re: /publish-blocked-state\.json/, why: 'the blocked/publishable state must be written where a human and a health board can see it' },
];
for (const req of required) {
  if (!req.re.test(loop)) errors.push(`${LOOP_REL}:gate_rule_not_implemented:${req.id} - ${req.why}`);
}

// The old deadlock, named exactly so it cannot come back by copy-paste.
if (/safe_to_push:\s*clean\b/.test(loop) || /if\s*\(!clean\)\s*\{[\s\S]{0,200}?refusing to declare the tree publishable/.test(loop)) {
  errors.push(`${LOOP_REL}:gate_reinstates_deadlock - the gate decision is back to raw cleanliness, so any repair-less validator can again stop a publish it cannot restart`);
}

// How much of the profile this rule actually covers, reported as evidence rather than
// asserted. These are the validators that could previously have deadlocked a publish.
const gateProfile = 'release';
const inProfile = validators.filter((v) => v.status === 'ACTIVE' && (v.profiles || []).includes(gateProfile));
const hardFail = inProfile.filter((v) => v.severity === 'HARD_FAIL');
const withRepair = hardFail.filter((v) => v.repair_command);
const withoutRepair = hardFail.filter((v) => !v.repair_command);

if (!inProfile.length) {
  console.error(`PUBLISH GATE UNBLOCKABLE FAIL: no ACTIVE validator declares the "${gateProfile}" profile, so this examined zero gate members. Refusing to pass on an empty loop.`);
  process.exit(1);
}

const report = {
  schema_version: '1.0',
  validator: 'publish-gate-unblockable',
  status: errors.length ? 'FAIL' : 'PASS',
  gate: LOOP_REL,
  gate_profile: gateProfile,
  rule: 'Only a validator with a registered repair_command may hold the publish gate. A repair-less validator is reported in full and does not block.',
  assertions_checked: required.length,
  active_in_gate_profile: inProfile.length,
  hard_fail_in_gate_profile: hardFail.length,
  hard_fail_with_repair_may_hold_gate: withRepair.length,
  hard_fail_without_repair_report_only: withoutRepair.length,
  report_only_ids: withoutRepair.map((v) => v.id).sort(),
  errors,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
};
fs.mkdirSync(abs('artifacts/validation'), { recursive: true });
fs.writeFileSync(abs(OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  console.error(`PUBLISH GATE UNBLOCKABLE FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(
  `PUBLISH GATE UNBLOCKABLE PASS: ${required.length} behavioural assertion(s) against ${LOOP_REL}; `
  + `of ${hardFail.length} ACTIVE HARD_FAIL validator(s) in the "${gateProfile}" profile, ${withRepair.length} carry a repair and may hold the gate, `
  + `${withoutRepair.length} are report-only and can no longer deadlock a publish they cannot unblock.`,
);
