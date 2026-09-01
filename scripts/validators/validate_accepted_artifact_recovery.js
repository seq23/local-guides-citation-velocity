#!/usr/bin/env node
'use strict';
// Registered entry point for the accepted-artifact recovery contract.
//
// The recovery itself lives in scripts/citation_velocity/recover_accepted_page_artifacts.js
// because it is also the tool that WRITES the store. This wrapper runs it in --check
// mode, which writes nothing and fails when data/release/accepted_page_artifacts.json
// no longer matches the accepted output - i.e. when a delivered artifact block has
// stopped being reproducible by a build.
const { spawnSync } = require('child_process');
const path = require('path');
const script = path.resolve(__dirname, '../citation_velocity/recover_accepted_page_artifacts.js');
const run = spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
