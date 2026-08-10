#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const workflowDir = path.join(ROOT, '.github/workflows');
const lanes = {
  'validate-repo.yml': { lane: 'validate', status: 'replace', reason: 'Canonical validation lane replacing validate.yml.', command: 'npm run release:ci-validate', mutations: [] },
  'velocity-content-release.yml': { lane: 'content-release', status: 'replace', reason: 'Canonical manual controlled content-release lane; release_batch.yml merged here.', command: 'npm run release:velocity-intake', mutations: ['content/_live/**', 'data/report_fixes/**', 'artifacts/validation/**', 'reports/**', 'llms*.txt', 'sitemap*.xml'] },
  'daily-citation-intelligence.yml': { lane: 'signal-intelligence', status: 'add', reason: 'Daily traffic-qualified citation intelligence shadow/proof lane.', command: 'npm run release:daily-citation-intelligence', mutations: ['data/signals/**', 'artifacts/validation/**', 'reports/**'] },
  'velocity-full-rebuild.yml': { lane: 'full-rebuild', status: 'replace', reason: 'Canonical full rebuild lane replacing velocity_full_rebuild.yml.', command: 'npm run release:self-healing', mutations: ['content/_live/**', 'artifacts/validation/**', 'reports/**', 'llms*.txt', 'sitemap*.xml'] },
  'deploy-distribution.yml': { lane: 'deploy', status: 'modify', reason: 'Deploy lane consumes exact validated artifact and does not perform release mutation.', command: 'node scripts/prepare_distribution_from_attestation.js', mutations: ['.build/**', 'reports/indexnow-*.json'] },
  'postdeploy-public-audit.yml': { lane: 'postdeploy-audit', status: 'replace', reason: 'Canonical postdeploy audit lane replacing postdeploy_public_audit.yml.', command: 'npm run postdeploy:public-click-audit', mutations: ['artifacts/diagnostics/**'] },
  'search-intelligence-loop.yml': { lane: 'search-intelligence', status: 'add', reason: 'Scheduled read/diagnose/retest Search Intelligence lane with no independent publication authority.', command: 'npm run search:intelligence:closed-loop', mutations: ['data/search_intelligence/**', 'artifacts/validation/**'] },
  'ci-health-recovery.yml': { lane: 'ci-health', status: 'add', reason: 'Exact-SHA CI red/recovery observation and governed issue alert lane.', command: 'node scripts/search_intelligence/ci_health_alert.js', mutations: ['data/search_intelligence/automation_health.json'] }
};
const retired = [
  { path: '.github/workflows/validate.yml', action: 'REPLACE', replacement: '.github/workflows/validate-repo.yml' },
  { path: '.github/workflows/velocity_content_release.yml', action: 'REPLACE', replacement: '.github/workflows/velocity-content-release.yml' },
  { path: '.github/workflows/release_batch.yml', action: 'DELETE', replacement: '.github/workflows/velocity-content-release.yml' },
  { path: '.github/workflows/velocity_full_rebuild.yml', action: 'REPLACE', replacement: '.github/workflows/velocity-full-rebuild.yml' },
  { path: '.github/workflows/postdeploy_public_audit.yml', action: 'REPLACE', replacement: '.github/workflows/postdeploy-public-audit.yml' }
];
function trigger(text) {
  const out = [];
  if (/schedule:/.test(text)) out.push('schedule');
  if (/workflow_dispatch:/.test(text)) out.push('workflow_dispatch');
  if (/push:/.test(text)) out.push('push');
  if (/pull_request:/.test(text)) out.push('pull_request');
  if (/workflow_run:/.test(text)) out.push('workflow_run');
  if (/repository_dispatch:/.test(text)) out.push('repository_dispatch');
  return out;
}
function requiredArtifacts(name, text) {
  const out = [];
  const matches = text.match(/path:\s*\|([\s\S]*?)(?:\n\s*-[\s\w]|\n\w|$)/g) || [];
  for (const block of matches) out.push(...block.split('\n').slice(1).map((line) => line.trim()).filter(Boolean));
  if (!out.length && /upload-artifact/.test(text)) out.push('artifact path declared inline or by action');
  return out;
}
const workflows = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).sort().map((name) => {
  const rel = `.github/workflows/${name}`;
  const text = fs.readFileSync(path.join(workflowDir, name), 'utf8');
  const meta = lanes[name] || { lane: 'manual-maintenance', status: 'keep', reason: 'Non-canonical workflow requires review.', command: 'unknown', mutations: [] };
  return {
    path: rel,
    name: (text.match(/^name:\s*(.+)$/m) || [null, name])[1].replace(/^['"]|['"]$/g, ''),
    trigger: trigger(text),
    primary_command: meta.command,
    repo_lane: meta.lane,
    current_status: meta.status,
    reason: meta.reason,
    allowed_runtime_mutations: meta.mutations,
    forbidden_runtime_mutations: ['.github/**', 'package.json', 'package-lock.json', 'scripts/**', 'docs/**', '_repo*.json', '_validation_registry.json', '_repo_validation_matrix.json', '_citation_intelligence_contract.json', '_content_release_contract.json', 'data/strategy/**'],
    required_artifacts: requiredArtifacts(name, text),
    validation_owner: ['daily-citation-intelligence.yml','search-intelligence-loop.yml'].includes(name) ? 'citation/search-intelligence validators' : 'validation registry and workflow topology validators'
  };
});
const inventory = { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), workflow_count: workflows.length, workflows, retired_or_replaced_workflows: retired, canonical_lanes: ['validate','build','content-release','signal-intelligence','search-intelligence','ci-health','deploy','postdeploy-audit','full-rebuild','manual-maintenance','retired'] };
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/workflow-yaml-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
const rows = workflows.map((w) => `| ${w.path} | ${w.name} | ${w.trigger.join(', ')} | ${w.repo_lane} | ${w.current_status.toUpperCase()} | ${w.primary_command} | ${w.reason} |`).join('\n');
const retiredRows = retired.map((r) => `| ${r.path} | ${r.action} | ${r.replacement} |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'reports/workflow-yaml-inventory.md'), `# Workflow YAML Inventory\n\nGenerated: ${inventory.generated_at}\n\n| Path | Name | Trigger | Lane | Status | Primary command | Reason |\n|---|---|---|---|---|---|---|\n${rows}\n\n## Retired or replaced workflows\n\n| Path | Action | Replacement |\n|---|---|---|\n${retiredRows}\n`);
console.log(`workflow inventory: ${workflows.length} current workflows`);
