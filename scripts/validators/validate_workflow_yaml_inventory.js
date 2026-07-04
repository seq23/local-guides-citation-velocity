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
if (!exists('artifacts/validation/workflow-yaml-inventory.json')) errors.push('missing workflow inventory json');
if (!exists('reports/workflow-yaml-inventory.md')) errors.push('missing workflow inventory report');
const inventory = exists('artifacts/validation/workflow-yaml-inventory.json') ? readJson('artifacts/validation/workflow-yaml-inventory.json') : { workflows: [] };
const current = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`).sort();
const listed = (inventory.workflows || []).map((w) => w.path).sort();
if (JSON.stringify(current) !== JSON.stringify(listed)) errors.push(`workflow list mismatch current=${current.join(',')} listed=${listed.join(',')}`);
for (const w of inventory.workflows || []) {
  for (const field of ['path','name','trigger','primary_command','repo_lane','current_status','reason','allowed_runtime_mutations','forbidden_runtime_mutations','required_artifacts','validation_owner']) if (w[field] === undefined) errors.push(`inventory missing ${field}: ${w.path}`);
}
finish(errors, 'workflow-yaml-inventory-validation.json', { workflow_count: listed.length });
