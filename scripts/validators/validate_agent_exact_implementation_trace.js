#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const cp = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const result = cp.spawnSync(process.execPath, ['scripts/validators/trace_agent_exact_implementation.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072'}
});
// WHAT THIS USED TO DO, AND WHY IT WAS WRONG
//
// `process.exit(result.status || 0)`. When a child is killed by a signal rather
// than exiting, spawnSync returns status === null and signal === 'SIGKILL', and
// `null || 0` is 0. So the one failure mode this wrapper exists to survive -- the
// traced child being OOM-killed, exactly the risk it acknowledges by running it
// under --max-old-space-size=3072 -- was reported to the runner as a clean pass.
// A spawn error (ENOENT, EACCES) has the same shape.
//
// The correct form is already in the sibling wrapper,
// scripts/validators/validate_deep_workflow_data_trace.js:11. This matches it, and
// names the signal so a kill is diagnosable rather than invisible.
if (result.error) {
  console.error(`agent-exact-implementation-trace: could not run the tracer: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  console.error(`agent-exact-implementation-trace: tracer killed by ${result.signal} (no exit code).`);
  console.error('  A signal death is a failure, never a pass. If it is SIGKILL, suspect the OOM killer.');
  process.exit(1);
}
process.exit(result.status || 0);
