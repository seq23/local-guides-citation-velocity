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
const path = require('path');
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
process.exit(run.status === null ? 1 : run.status);
