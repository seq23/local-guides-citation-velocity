#!/usr/bin/env node
'use strict';
const cp = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const result = cp.spawnSync(process.execPath, ['scripts/citation_velocity/compile_html_fix_acceptance_manifest.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' }
});
process.exit(result.status || 0);
