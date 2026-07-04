#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const pkg = read('package.json', { scripts: {} });
const contract = read('_agent_artifact_priority_contract.json', null);
const workflows = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ file: f, text: fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8') }));
const errors = [];
if (!contract) errors.push('priority_contract_missing');
for (const cmd of ['release:velocity-intake', 'release:velocity-content', 'citation:apply-agent-exact', 'release:daily-citation-intelligence']) {
  if (!pkg.scripts[cmd]) errors.push(`package_script_missing:${cmd}`);
}
const content = workflows.find((w) => w.file === 'velocity-content-release.yml');
if (!content) errors.push('velocity_content_release_workflow_missing');
else {
  if (!/contents:\s*write/.test(content.text)) errors.push('velocity_content_release_needs_contents_write');
  if (!/data\/report_fixes\/agent_runs\/\*\*\/agent_run_manifest\.json/.test(content.text)) errors.push('velocity_content_release_missing_agent_manifest_path_trigger');
  if (!/release:velocity-intake/.test(content.text)) errors.push('velocity_content_release_missing_release_velocity_intake');
}
const daily = workflows.find((w) => w.file === 'daily-citation-intelligence.yml');
if (!daily) errors.push('daily_citation_intelligence_workflow_missing');
else {
  if (!/contents:\s*read/.test(daily.text)) errors.push('daily_citation_intelligence_must_be_read_only');
  if (/release:velocity-intake|citation:apply-agent-exact|release:velocity-content/.test(daily.text)) errors.push('daily_citation_intelligence_calls_agent_mutation_lane');
}
const report = { schema_version: '1.0', validator: 'agent-artifact-priority', status: errors.length ? 'FAIL' : 'PASS', errors };
out('artifacts/validation/agent-artifact-priority.json', report);
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log('agent-artifact-priority PASS');
