#!/usr/bin/env node
'use strict';
// Self-heal commit coverage.
//
// self-heal-repair-contract proves a repair can clear the validator that declares
// it. That is not enough on its own: the scheduled lane that runs the self-heal
// loop also has to be able to COMMIT what the repair rewrote. It could not.
// query-evidence-refresh.yml healed the tree, validated the healed tree, then
// committed a fixed evidence list that excluded every path a repair writes - so
// the state it validated was never the state it landed, and the next run
// repaired the identical defect again.
//
// This validator holds the commit surface to the registry: whatever an ACTIVE
// repair declares it rewrites must be committable by the lane that runs it, and
// must be declared in that workflow's governed mutation surface.

const fs = require('fs');
const path = require('path');
const { activeRepairWrites, committablePatterns, isCommittable } = require('../selfheal/lane_commit_contract.js');

const ROOT = path.resolve(__dirname, '../..');
const rel = (p) => path.join(ROOT, p);
const errors = [];

const LANE = '.github/workflows/query-evidence-refresh.yml';
const RUNNER = 'scripts/selfheal/run_lane_selfheal.mjs';

const writes = activeRepairWrites(ROOT);

// Zero-item guard. If no ACTIVE repair declares what it rewrites there is no
// commit surface to prove anything about, and this validator has proven nothing.
if (!writes.length) {
  console.error('SELF-HEAL COMMIT COVERAGE FAIL: no ACTIVE validator declares repair_writes; there is no repair surface to cover');
  process.exit(1);
}

if (!fs.existsSync(rel(LANE))) {
  console.error(`SELF-HEAL COMMIT COVERAGE FAIL: ${LANE} is missing; the lane that runs the self-heal loop must exist for its commit surface to be checkable`);
  process.exit(1);
}
if (!fs.existsSync(rel(RUNNER))) errors.push(`lane_runner_missing:${RUNNER}`);

const yaml = fs.readFileSync(rel(LANE), 'utf8');

// The lane must run the bounded runner, which is what refuses to commit a tree
// the run did not validate.
if (!yaml.includes(RUNNER)) {
  errors.push(`${LANE}:does_not_run_bounded_selfheal - the lane must invoke ${RUNNER}, which stops the run when a repair touches something this lane cannot commit`);
}

const patternLine = (yaml.match(/^\s*file_pattern:\s*(.+)$/m) || [])[1];
if (!patternLine) {
  errors.push(`${LANE}:no_file_pattern_declared`);
} else if (!/\$\{\{\s*steps\.selfheal\.outputs\.file_pattern\s*\}\}/.test(patternLine)) {
  // A literal pattern is allowed only if it actually covers every repair write.
  // This is the assertion that fails when the pattern is narrowed back.
  const literal = patternLine.trim().replace(/^["']|["']$/g, '').split(/\s+/).filter(Boolean);
  const uncovered = writes.filter((w) => !isCommittable(w, literal));
  if (uncovered.length) {
    errors.push(
      `${LANE}:commit_pattern_excludes_repair_writes - the lane runs the self-heal loop but its commit pattern cannot commit ${uncovered.join(', ')}; a run that repairs those validates one tree and commits another`,
    );
  }
}

// The governed mutation surface has to admit the same paths, or the workflow is
// committing files it never declared it may write.
const invPath = 'artifacts/validation/workflow-yaml-inventory.json';
if (!fs.existsSync(rel(invPath))) {
  errors.push(`workflow_inventory_missing:${invPath}`);
} else {
  const inv = JSON.parse(fs.readFileSync(rel(invPath), 'utf8'));
  const entry = (inv.workflows || []).find((w) => w.path === LANE);
  if (!entry) errors.push(`${LANE}:absent_from_workflow_inventory`);
  else if (!(entry.allowed_runtime_mutations || []).length) {
    errors.push(`${LANE}:declares_no_runtime_mutations - it commits to main, so an empty mutation surface means the governance path check examines nothing for it`);
  } else {
    const undeclared = writes.filter((w) => !isCommittable(w, entry.allowed_runtime_mutations));
    if (undeclared.length) errors.push(`${LANE}:repair_writes_not_in_declared_mutations:${undeclared.join(',')}`);
  }
}

const report = {
  validator: 'self-heal-commit-coverage',
  status: errors.length ? 'FAIL' : 'PASS',
  lane: LANE,
  active_repair_writes: writes,
  committable_patterns: committablePatterns(ROOT),
  error_count: errors.length,
  errors,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
};
fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
fs.writeFileSync(rel('artifacts/validation/self-heal-commit-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`SELF-HEAL COMMIT COVERAGE FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(
  `SELF-HEAL COMMIT COVERAGE PASS: ${writes.length} ACTIVE repair write path(s) are all committable by ${LANE} and declared in its governed mutation surface.`,
);
