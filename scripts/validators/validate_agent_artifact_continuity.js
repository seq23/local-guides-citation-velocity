#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const runsRoot = path.join(ROOT, 'data/report_fixes/agent_runs');
const errors = [];
const warnings = [];
const checked = [];
for (const date of fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot).sort() : []) {
  const dateDir = path.join(runsRoot, date);
  if (!fs.statSync(dateDir).isDirectory()) continue;
  for (const vertical of fs.readdirSync(dateDir).sort()) {
    const dir = path.join(dateDir, vertical);
    if (!fs.statSync(dir).isDirectory()) continue;
    const relDir = `data/report_fixes/agent_runs/${date}/${vertical}`;
    const manifestRel = `${relDir}/agent_run_manifest.json`;
    if (!exists(manifestRel)) { warnings.push(`legacy_or_missing_manifest:${relDir}`); continue; }
    const manifest = read(manifestRel, {});
    const required = ['csv_path', 'html_path'];
    if (manifest.json_path) required.push('json_path');
    else warnings.push(`legacy_agent_run_without_json_artifact:${relDir}`);
    if (String(manifest.vertical || '') !== vertical) errors.push(`manifest_vertical_mismatch:${relDir}:${manifest.vertical}:${vertical}`);
    for (const key of required) {
      const rel = manifest[key];
      if (!rel) errors.push(`manifest_${key}_missing:${relDir}`);
      else if (!exists(rel)) errors.push(`manifest_path_missing:${key}:${rel}`);
    }
    const normalized = manifest.normalized_path || `data/report_fixes/normalized_agent_runs/${date}_${vertical}.json`;
    if (String(manifest.status || '').toUpperCase() === 'ABSORBED' && !exists(normalized)) errors.push(`normalized_output_missing:${normalized}`);
    if (!exists(manifest.exact_implementation_policy || 'data/report_fixes/agent_exact_implementation_policy.json')) errors.push(`exact_policy_missing:${relDir}`);
    checked.push({ date, vertical, manifest: manifestRel, normalized, required_artifacts: required.map((key) => manifest[key]).filter(Boolean) });
  }
}
const report = { schema_version: '1.0', validator: 'agent-artifact-continuity', status: errors.length ? 'FAIL' : 'PASS', checked_count: checked.length, checked, errors, warnings };
out('artifacts/validation/agent-artifact-continuity.json', report);
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log(`agent-artifact-continuity PASS (${checked.length} run group(s))`);
