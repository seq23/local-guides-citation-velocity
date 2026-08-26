#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const runsRoot = path.join(ROOT, 'data/report_fixes/agent_runs');
const POLICY_REL = 'data/report_fixes/agent_exact_implementation_policy.json';

// Run directories are named by the raw vertical token ("personal-injury"), but the
// intake normalizer writes its output under the canonical vertical ("personal_injury").
// The continuity check must resolve the same way the normalizer does, or every
// personal-injury run looks unabsorbed.
const verticalMap = {
  pi: 'personal_injury',
  'personal injury': 'personal_injury',
  personal_injury: 'personal_injury',
  'personal-injury': 'personal_injury',
  dentistry: 'dentistry',
  dental: 'dentistry',
  trt: 'trt',
  testosterone: 'trt',
  neuro: 'neuro',
  neuropsych: 'neuro',
  uscis: 'uscis-medical',
  'uscis medical': 'uscis-medical',
  'uscis-medical': 'uscis-medical',
  hair: 'trt',
  'hair-loss': 'trt',
  peptides: 'trt'
};
function normalizeVertical(value) {
  const key = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  return verticalMap[key] || verticalMap[key.replace(/-/g, ' ')] || key;
}
// A run whose manifest sits at one of these statuses is claimed by the pipeline and
// MUST have produced a normalized artifact. Anything else (QUARANTINED, drafts) is
// legitimately absent and is reported as a warning rather than an error.
const policy = read(POLICY_REL, {});
const ABSORBABLE_STATUSES = new Set(
  [...(policy.process_manifest_statuses || ['READY_FOR_ABSORPTION']), 'ABSORBED']
    .map((s) => String(s).toUpperCase())
);

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
    const status = String(manifest.status || '').toUpperCase();
    // Accept any of the paths the normalizer could legitimately have written, then
    // assert one of them is actually on disk. Naming the expected path without
    // checking for it is what let the 2026-08-26 TRT run vanish behind a green PASS.
    const normalizedCandidates = [...new Set([
      manifest.normalized_path,
      `data/report_fixes/normalized_agent_runs/${date}_${normalizeVertical(manifest.vertical || vertical)}.json`,
      `data/report_fixes/normalized_agent_runs/${date}_${vertical}.json`
    ].filter(Boolean))];
    const normalizedFound = normalizedCandidates.find((candidate) => exists(candidate)) || '';
    const normalized = normalizedFound || normalizedCandidates[0];
    if (ABSORBABLE_STATUSES.has(status) && !normalizedFound) {
      errors.push(`normalized_output_missing:${status}:${relDir}:expected_one_of:${normalizedCandidates.join(',')}`);
    } else if (!normalizedFound) {
      warnings.push(`normalized_output_absent_non_absorbable_status:${status || 'UNKNOWN'}:${relDir}`);
    }
    if (!exists(manifest.exact_implementation_policy || POLICY_REL)) errors.push(`exact_policy_missing:${relDir}`);
    checked.push({ date, vertical, manifest: manifestRel, manifest_status: status, normalized, normalized_exists: Boolean(normalizedFound), required_artifacts: required.map((key) => manifest[key]).filter(Boolean) });
  }
}
const report = { schema_version: '1.0', validator: 'agent-artifact-continuity', status: errors.length ? 'FAIL' : 'PASS', checked_count: checked.length, checked, errors, warnings };
out('artifacts/validation/agent-artifact-continuity.json', report);
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log(`agent-artifact-continuity PASS (${checked.length} run group(s))`);
