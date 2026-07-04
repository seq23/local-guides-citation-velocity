#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function writeReport(name, report) { fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'artifacts/validation', name), JSON.stringify(report, null, 2) + '\n'); }
function finish(errors, name, extra = {}) { const report = { validator: name.replace(/\.json$/, ''), ok: errors.length === 0, errors, ...extra }; writeReport(name, report); if (errors.length) { console.error(errors.join('\n')); process.exit(1); } console.log(`${report.validator} PASS`); }

const errors = [];
const inventory = exists('artifacts/validation/workflow-yaml-inventory.json') ? readJson('artifacts/validation/workflow-yaml-inventory.json') : { workflows: [] };
const pkg = readJson('package.json');
for (const w of inventory.workflows || []) {
  const command = w.primary_command || '';
  const npmMatch = command.match(/^npm run ([^\s]+)/);
  if (npmMatch && !pkg.scripts[npmMatch[1]]) errors.push(`workflow command not in package scripts:${w.path}:${npmMatch[1]}`);
  if (['validate','signal-intelligence','postdeploy-audit'].includes(w.repo_lane) && !(w.required_artifacts || []).length) errors.push(`workflow missing uploaded artifact contract:${w.path}`);
  if (w.repo_lane === 'deploy' && !(w.trigger || []).includes('workflow_run')) errors.push('deploy workflow must consume validate workflow_run or manual artifact');
}
finish(errors, 'workflow-artifacts.json', { workflow_count: (inventory.workflows || []).length });
