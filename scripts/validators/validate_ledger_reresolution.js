#!/usr/bin/env node
'use strict';
// Registered entry point for the ledger/resolver agreement contract.
//
// The re-resolution lives in scripts/citation_velocity/reresolve_implementation_ledger.js
// because it is also the tool that APPLIES a move. This wrapper runs it in --check
// mode, which writes no ledger and fails when any entry points somewhere the current
// resolver no longer agrees with.
const { spawnSync } = require('child_process');
const path = require('path');
const script = path.resolve(__dirname, '../citation_velocity/reresolve_implementation_ledger.js');
const run = spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
