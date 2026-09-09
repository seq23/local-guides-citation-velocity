#!/usr/bin/env node
'use strict';
// Registered entry point for the fix-ledger blocked-target contract.
//
// The re-resolution lives in
// scripts/citation_velocity/reresolve_blocked_fix_ledger_targets.js because it is also
// the tool that APPLIES a recovery. This wrapper runs it in --check mode, which writes
// no ledger and fails when any row marked BLOCKED_MISSING_TARGET names a target the
// current resolver can place on a page that exists.
//
// Same shape as validate_ledger_reresolution.js, which does this for the
// exact-implementation ledger. A signal death is a failure, never a pass: spawnSync
// returns status === null when the child is killed, and `null || 0` would report that
// as clean.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
// The two files the check reads and the repair rewrites, named here rather than only
// inside the pass: a wrapper that names nothing is a validator with no declared
// relationship to its own repair, which is how a repair ends up inert.
const LEDGER = 'data/report_fixes/agent_fix_ledger.json';
const EVIDENCE = 'artifacts/validation/blocked-target-resolvability.json';
if (!fs.existsSync(path.join(ROOT, LEDGER))) {
  console.error(`blocked-target-resolvability: ${LEDGER} is missing. There is no fix ledger to check, which is a failure, not a pass.`);
  process.exit(1);
}
const script = path.resolve(__dirname, '../citation_velocity/reresolve_blocked_fix_ledger_targets.js');
const run = spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit' });
if (run.error) {
  console.error(`blocked-target-resolvability: could not run the pass: ${run.error.message}`);
  process.exit(1);
}
if (run.signal) {
  console.error(`blocked-target-resolvability: pass killed by ${run.signal} (no exit code). A signal death is a failure, never a pass.`);
  process.exit(1);
}
// A clean exit with no evidence file is not a pass: the pass writes its report before
// it decides, so a missing report means it did not get that far.
if (run.status === 0 && !fs.existsSync(path.join(ROOT, EVIDENCE))) {
  console.error(`blocked-target-resolvability: the pass exited 0 but wrote no ${EVIDENCE}. A verdict with no evidence behind it is not a pass.`);
  process.exit(1);
}
process.exit(run.status === null ? 1 : run.status);
