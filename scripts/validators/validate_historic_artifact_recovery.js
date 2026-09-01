#!/usr/bin/env node
'use strict';
// Registered entry point for the historic artifact-loss recovery contract.
//
// The recovery lives in scripts/citation_velocity/recover_historic_artifact_loss.js
// because it is also the tool that WRITES the file. This runs it in --check mode, which
// writes nothing and fails when data/release/historic_recovered_artifacts.json no longer
// matches what the measurement says a page is missing - in either direction: a block that
// silently left again, or internal build-directive text that has crept back in.
const { spawnSync } = require('child_process');
const path = require('path');
const script = path.resolve(__dirname, '../citation_velocity/recover_historic_artifact_loss.js');
const run = spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
