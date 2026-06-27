#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const cp = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const result = cp.spawnSync(process.execPath, ['scripts/citation_velocity/build_agent_exact_implementation_plan.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072'}
});
process.exit(result.status || 0);
