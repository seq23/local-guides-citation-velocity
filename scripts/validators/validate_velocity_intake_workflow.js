#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const errors = [];
const warnings = [];
function has(txt, needle) { return txt.includes(needle); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
const workflowRel = '.github/workflows/velocity-content-release.yml';
const wf = read(workflowRel);
const pkg = JSON.parse(read('package.json'));
const registry = JSON.parse(read('data/workflows/workflow_contract_registry.json'));
for (const token of ['data/report_fixes/agent_runs/**/agent_run_manifest.json', 'npm run release:daily-citation-intelligence:preview', 'npm run release:velocity-intake', 'git push origin HEAD:main', 'contents: write', 'node-version: "24"', 'ALLOW_SOCIAL_FALLBACK_RELEASE: "1"']) if (!has(wf, token)) errors.push(`${workflowRel}:missing:${token}`);
if (!has(wf, "github.event_name != 'push'") || !has(wf, "snapshot update from baseline ZIP")) errors.push(`${workflowRel}:missing_snapshot_reentry_guard`);
if (fs.existsSync(path.join(ROOT, '.github/workflows/agent_run_absorption.yml'))) errors.push('separate_agent_run_absorption_workflow_present; use consolidated velocity-content-release.yml');
for (const script of ['validate:agent-run-intake','citation:prepare-velocity-intake','citation:apply-html-report-contract','validate:html-report-contract','release:velocity-intake','validate:velocity-intake-workflow']) if (!pkg.scripts || !pkg.scripts[script]) errors.push(`package_missing_script:${script}`);
const recommendationValidator = read('scripts/validators/validate_velocity_agent_recommendation_driven_output.js');
for (const token of ['agent-exact-implementation-plan.json','active_agent_exact_plan','ledger_entries_skipped']) if (!has(recommendationValidator, token)) errors.push(`recommendation_validator_missing_reentry_scope:${token}`);
const entry = (registry.workflows || []).find((w) => w.file === 'velocity-content-release.yml');
if (!entry) errors.push('workflow_registry_missing_velocity_content_release');
else {
  for (const token of ['push:agent_run_manifest','workflow_dispatch']) if (!(entry.triggers || []).includes(token)) errors.push(`workflow_registry_velocity_missing_trigger:${token}`);
  for (const cmd of ['npm run release:velocity-intake','npm run release:self-healing']) if (!(entry.commands || []).includes(cmd)) errors.push(`workflow_registry_velocity_missing_command:${cmd}`);
  const intakeScript = String((pkg.scripts || {})['release:velocity-intake'] || '');
  for (const token of ['citation:apply-html-report-contract','validate:html-report-contract']) if (!has(intakeScript, token)) errors.push(`release_velocity_intake_missing:${token}`);
  for (const consumed of ['Twin Agent ready manifests','traffic-qualified preview proof']) if (!JSON.stringify(entry.consumes || []).includes(consumed)) errors.push(`workflow_registry_velocity_missing_consume:${consumed}`);
}
const files = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).sort();
const registered = (registry.workflows || []).map((w) => w.file).sort();
if (JSON.stringify(files) !== JSON.stringify(registered)) errors.push(`workflow_inventory_mismatch:${files.join(',')}!=${registered.join(',')}`);
const report = {schema_version: '2.0', validator: 'velocity-intake-workflow', status: errors.length ? 'FAIL' : 'PASS', workflow: workflowRel, errors, warnings, checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10)};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/velocity-intake-workflow.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error('VELOCITY INTAKE WORKFLOW FAIL'); errors.forEach((e) => console.error(`- ${e}`)); process.exit(1); }
console.log('VELOCITY INTAKE WORKFLOW PASS');
