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
const contract = exists('_content_release_contract.json') ? readJson('_content_release_contract.json') : { allowed_runtime_mutations: [], forbidden_runtime_mutations: [] };
const forbidden = new Set(contract.forbidden_runtime_mutations || []);
for (const w of inventory.workflows || []) {
  for (const must of forbidden) if (!(w.forbidden_runtime_mutations || []).includes(must)) errors.push(`workflow missing forbidden mutation:${w.path}:${must}`);
  for (const mutation of w.allowed_runtime_mutations || []) {
    if (forbidden.has(mutation)) errors.push(`workflow allows forbidden mutation:${w.path}:${mutation}`);
    if (/^(\.github|package\.json|package-lock\.json|scripts\/|docs\/|_repo|_validation_registry|_repo_validation_matrix)/.test(mutation.replace('/**',''))) errors.push(`workflow allowed mutation touches governance:${w.path}:${mutation}`);
  }
  if ((w.trigger || []).includes('schedule') && w.path !== '.github/workflows/daily-citation-intelligence.yml') errors.push(`only daily citation intelligence may be scheduled in this batch:${w.path}`);
}
finish(errors, 'workflow-runtime-mutations.json', { workflow_count: (inventory.workflows || []).length });
