#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'release_batch.yml');

function fail(message) {
  console.error('Release batch workflow contract FAIL');
  console.error(`- ${message}`);
  process.exit(1);
}

if (!fs.existsSync(workflowPath)) {
  fail('missing .github/workflows/release_batch.yml');
}

const workflow = fs.readFileSync(workflowPath, 'utf8');

const required = [
  ['contents: write', 'workflow must have contents: write permission so it can commit released batch state'],
  ['actions/checkout@', 'workflow must checkout the repository'],
  ['actions/setup-node@', 'workflow must set up Node'],
  ['node-version: "24"', 'workflow must use Node 24'],
  ['run: npm ci', 'workflow must install dependencies before compile/build/validation steps'],
  ['node scripts/compile_reddit_queries.js', 'workflow must compile staged Reddit query clusters before release'],
  ['node scripts/release_batch.js "$BATCH_SIZE"', 'workflow must run release_batch with BATCH_SIZE'],
  ['npm run build', 'workflow must build after release batch state changes'],
  ['npm run guardrails:all', 'workflow must validate the full published surface after build'],
  ['git add -A', 'workflow must stage release state changes'],
  ['git commit -m "release batch ($BATCH_SIZE)', 'workflow must commit release batch changes with BATCH_SIZE context'],
  ['git push', 'workflow must push released state changes']
];

for (const [needle, message] of required) {
  if (!workflow.includes(needle)) fail(message);
}

const ciIndex = workflow.indexOf('run: npm ci');
const compileIndex = workflow.indexOf('node scripts/compile_reddit_queries.js');
const releaseIndex = workflow.indexOf('node scripts/release_batch.js "$BATCH_SIZE"');
const buildIndex = workflow.indexOf('npm run build');
const guardrailsIndex = workflow.indexOf('npm run guardrails:all');
const commitIndex = workflow.indexOf('git commit -m "release batch ($BATCH_SIZE)');

if (!(ciIndex < compileIndex)) fail('npm ci must run before compile_reddit_queries');
if (!(compileIndex < releaseIndex)) fail('compile_reddit_queries must run before release_batch');
if (!(releaseIndex < buildIndex)) fail('release_batch must run before build');
if (!(buildIndex < guardrailsIndex)) fail('build must run before guardrails:all');
if (!(guardrailsIndex < commitIndex)) fail('guardrails:all must run before commit');

if (/secrets\.[A-Z0-9_]+/.test(workflow) && /if:\s*\$\{\{[^\n]*secrets\./.test(workflow)) {
  fail('workflow must not use secrets.* directly inside if expressions');
}

const evidencePath = path.join(ROOT, 'artifacts', 'validation', 'release-batch-workflow.json');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'release-batch-workflow',
  status: 'PASS',
  workflow: '.github/workflows/release_batch.yml'
}, null, 2)}\n`);

console.log('Release batch workflow contract PASS');
