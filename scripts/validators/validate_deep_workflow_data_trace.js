#!/usr/bin/env node
'use strict';
const {spawnSync} = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const result = spawnSync(process.execPath, ['scripts/validation/validate_deep_workflow_data_trace.mjs'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072'}
});
process.exit(result.status || (result.signal ? 1 : 0));
