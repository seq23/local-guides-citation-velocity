#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/workflows/workflow_contract_registry.json'), 'utf8'));
const errors = [];
const warnings = [];
const workflowDir = path.join(ROOT, '.github/workflows');
const files = fs.readdirSync(workflowDir).filter((x) => /\.ya?ml$/.test(x)).sort();
const registered = (reg.workflows || []).map((x) => x.file).sort();
function has(txt, token) { return txt.includes(token); }
function regex(txt, re) { return re.test(txt); }
if (JSON.stringify(files) !== JSON.stringify(registered)) errors.push(`workflow_inventory_mismatch:${files.join(',')}!=${registered.join(',')}`);
const textByFile = new Map(files.map((file) => [file, fs.readFileSync(path.join(workflowDir, file), 'utf8')]));
for (const w of reg.workflows || []) {
  const txt = textByFile.get(w.file);
  if (!txt) { errors.push(`${w.file}:missing`); continue; }
  if (!has(txt, 'node-version: "24"') && !has(txt, "node-version: '24'")) errors.push(`${w.file}:node24_missing`);
  if (!has(txt, 'NODE_OPTIONS: --max-old-space-size=3072')) errors.push(`${w.file}:node_memory_cap_missing`);
  if (!regex(txt, /timeout-minutes:\s*\d+/)) errors.push(`${w.file}:job_timeout_missing`);
  for (const permission of w.permissions || []) if (!has(txt, permission)) errors.push(`${w.file}:permission_missing:${permission}`);
  for (const cmd of w.commands || []) {
    const token = cmd.split(' ').slice(0, 4).join(' ');
    if (!has(txt, token)) errors.push(`${w.file}:command_missing:${token}`);
  }
  if (w.manual_ready && !has(txt, 'workflow_dispatch:')) errors.push(`${w.file}:manual_trigger_missing`);
  for (const input of w.required_inputs || []) {
    const block = new RegExp(`${input}:([\\s\\S]{0,320})required:\\s*true`);
    if (!block.test(txt)) errors.push(`${w.file}:required_input_missing_or_optional:${input}`);
  }
  if (w.mutates_repo && !has(txt, 'contents: write')) errors.push(`${w.file}:write_permission_missing`);
  if (!w.mutates_repo && regex(txt, /git\s+push|git\s+commit|commit validated/i)) errors.push(`${w.file}:unexpected_repo_mutation`);
  if (w.mutates_repo) {
    if (has(txt, 'npm run release:self-healing')) errors.push(`${w.file}:broad_self_healing_forbidden_in_safe_autonomy_workflow`);
    const pushPos = txt.indexOf('git push');
    const gatePos = txt.lastIndexOf('npm run validate:release', pushPos);
    if (pushPos >= 0 && gatePos < 0) errors.push(`${w.file}:push_without_release_revalidation`);
    if (w.file === 'velocity-content-release.yml' && !has(txt, 'npm run release:velocity-intake')) errors.push(`${w.file}:safe_harbor_intake_missing`);
    if (w.file === 'velocity-full-rebuild.yml') {
      if (!has(txt, 'npm run intelligence:build')) errors.push(`${w.file}:intelligence_build_missing`);
      if (!has(txt, 'npm run release:full-rebuild')) errors.push(`${w.file}:deterministic_full_rebuild_missing`);
    }
  }
  for (const forbidden of reg.global_contract.forbidden_actions || []) if (has(txt, forbidden)) errors.push(`${w.file}:forbidden:${forbidden}`);
}
const pushWorkflows = (reg.workflows || []).filter((w) => (w.triggers || []).some((t) => t.startsWith('push:')));
if (pushWorkflows.length > reg.global_contract.maximum_workflows_on_push) errors.push(`too_many_push_workflows:${pushWorkflows.length}`);
const allowedPush = new Set(reg.global_contract.allowed_push_workflows || []);
for (const w of pushWorkflows) if (!allowedPush.has(w.file)) errors.push(`non_canonical_push_workflow:${w.file}`);
const velocityPush = (reg.workflows || []).find((w) => w.file === 'velocity-content-release.yml' && (w.triggers || []).includes('push:agent_run_manifest'));
if (velocityPush) {
  const txt = textByFile.get('velocity-content-release.yml') || '';
  if (!has(txt, 'data/report_fixes/agent_runs/**/agent_run_manifest.json')) errors.push('velocity-content-release:push_path_not_limited_to_agent_manifest');
  if (!has(txt, 'npm run release:velocity-intake')) errors.push('velocity-content-release:missing_consolidated_intake_command');
}
const scheduledMutation = (reg.workflows || []).filter((w) => w.mutates_repo && (w.triggers || []).some((t) => t.startsWith('schedule:')));
if (scheduledMutation.length > reg.global_contract.maximum_scheduled_mutation_workflows) errors.push(`too_many_scheduled_mutation_workflows:${scheduledMutation.length}`);
for (const f of reg.global_contract.retired_workflows || []) if (files.includes(f)) errors.push(`retired_workflow_present:${f}`);
const validate = textByFile.get('validate-repo.yml') || '';
const deploy = textByFile.get('deploy-distribution.yml') || '';
const post = textByFile.get('postdeploy-public-audit.yml') || '';
for (const token of ['velocity-validated-${{ github.sha }}', 'npm run release:ci-validate', 'npm run release:daily-citation-intelligence:preview']) if (!has(validate, token)) errors.push(`validate_lineage_missing:${token}`);
for (const token of ['actions/download-artifact@v4', 'EXPECTED_COMMIT_SHA', 'steps.artifact.outputs.commit_sha', 'node scripts/prepare_distribution_from_attestation.js']) if (!has(deploy, token)) errors.push(`deploy_lineage_missing:${token}`);
const prepare = fs.readFileSync(path.join(ROOT, 'scripts/prepare_distribution_from_attestation.js'), 'utf8');
for (const token of ["d.status!=='VALIDATED_ARTIFACT_READY'", 'DISTRIBUTION_COMMIT_SHA_MISMATCH', '.build/indexnow-priority.txt', '.build/indexnow-batch.txt']) if (!has(prepare, token)) errors.push(`distribution_prepare_contract_missing:${token}`);
for (const token of ['required: true', 'default: "https://theindustryguides.com"', 'PLAYWRIGHT_BASE_URL', 'playwright@1.61.1', 'playwright install --with-deps chromium', 'npm run postdeploy:public-click-audit']) if (!has(post, token)) errors.push(`postdeploy_contract_missing:${token}`);
const report = {
  validator: 'workflow-data-trace',
  status: errors.length ? 'FAIL' : 'PASS',
  workflow_count: files.length,
  manual_ready_count: (reg.workflows || []).filter((x) => x.manual_ready).length,
  scheduled_count: (reg.workflows || []).filter((x) => (x.triggers || []).some((t) => t.startsWith('schedule:'))).length,
  push_count: pushWorkflows.length,
  scheduled_mutation_count: scheduledMutation.length,
  lineage: (reg.workflows || []).map((w) => ({file: w.file, lane: w.lane, triggers: w.triggers, consumes: w.consumes, produces: w.produces, upstream: w.upstream, downstream: w.downstream, failure_boundary: w.failure_boundary})),
  errors,
  warnings,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10)
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/workflow-data-trace.json'), JSON.stringify(report, null, 2) + '\n');
const md = ['# Workflow Data Trace', '', `Status: **${report.status}**`, `Workflows: ${files.length} · Manual-ready: ${report.manual_ready_count} · Scheduled: ${report.scheduled_count} · Push-triggered: ${report.push_count}`, '', '| Workflow | Lane | Triggers | Consumes | Produces | Failure boundary |', '|---|---|---|---|---|---|', ...report.lineage.map((x) => `| ${x.file} | ${x.lane} | ${x.triggers.join('<br>')} | ${(x.consumes || []).join('<br>')} | ${(x.produces || []).join('<br>')} | ${x.failure_boundary} |`)];
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/workflow-data-trace.md'), md.join('\n') + '\n');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`WORKFLOW DATA TRACE PASS: ${files.length} workflows; ${report.scheduled_count} scheduled; ${report.push_count} push-triggered; all ${report.manual_ready_count} manual-ready.`);
