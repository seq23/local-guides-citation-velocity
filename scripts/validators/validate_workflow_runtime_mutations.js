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
const workflowContract = exists('data/workflows/workflow_contract_registry.json') ? readJson('data/workflows/workflow_contract_registry.json') : { workflows: [] };
const workflowByFile = new Map((workflowContract.workflows || []).map(w => [`.github/workflows/${w.file}`, w]));
// Approval is read from the registry, not hardcoded here. A hardcoded list inside
// a validator is exactly what drifts: query-evidence-refresh.yml shipped with a
// registry contract and a comment claiming approval, but this set was never
// updated, so a workflow the policy allows failed the release on every run.
const globalContract = workflowContract.global_contract || {};
const allowedMutators = new Set((globalContract.allowed_scheduled_mutation_workflows || []).map(f => `.github/workflows/${f}`));
const approvedScheduled = new Set([
  '.github/workflows/daily-citation-intelligence.yml',
  '.github/workflows/search-intelligence-loop.yml',
  ...allowedMutators,
]);
// The contract permits a bounded number of scheduled workflows that commit. This
// validator forbade all of them, contradicting the declared policy. The cap is the
// real control, so enforce the cap rather than a blanket ban.
const maxMutators = Number(globalContract.maximum_scheduled_mutation_workflows ?? 0);
if (allowedMutators.size > maxMutators) errors.push(`scheduled mutation workflows ${allowedMutators.size} exceed declared cap ${maxMutators}`);
const forbidden = new Set(contract.forbidden_runtime_mutations || []);
for (const w of inventory.workflows || []) {
  for (const must of forbidden) if (!(w.forbidden_runtime_mutations || []).includes(must)) errors.push(`workflow missing forbidden mutation:${w.path}:${must}`);
  for (const mutation of w.allowed_runtime_mutations || []) {
    if (forbidden.has(mutation)) errors.push(`workflow allows forbidden mutation:${w.path}:${mutation}`);
    if (/^(\.github|package\.json|package-lock\.json|scripts\/|docs\/|_repo|_validation_registry|_repo_validation_matrix)/.test(mutation.replace('/**',''))) errors.push(`workflow allowed mutation touches governance:${w.path}:${mutation}`);
  }
  if ((w.trigger || []).includes('schedule')) {
    const registered = workflowByFile.get(w.path);
    if (!approvedScheduled.has(w.path)) errors.push(`unapproved scheduled workflow:${w.path}`);
    if (!registered) errors.push(`scheduled workflow missing registry contract:${w.path}`);
    else if (registered.mutates_repo && !allowedMutators.has(w.path)) errors.push(`scheduled repo mutation forbidden:${w.path}`);
  }
}
finish(errors, 'workflow-runtime-mutations.json', { workflow_count: (inventory.workflows || []).length });
