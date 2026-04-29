#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = process.argv[2] || 'data/lkg_candidates/latest.json';
if (!fs.existsSync(file)) { console.error(`Missing LKG candidate export: ${file}`); process.exit(1); }
let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`Invalid JSON in ${file}: ${e.message}`); process.exit(1); }
const errors = [];
if (data.schema_version !== 'velocity_lkg_candidates_v1') errors.push('schema_version must be velocity_lkg_candidates_v1');
if (data.source_repo_role !== 'velocity_signal_detection_only') errors.push('source_repo_role must lock Velocity to signal detection only');
if (data.destination_repo_role !== 'lkg_generation_publish_authority') errors.push('destination_repo_role must lock LKG as publishing authority');
if (data.approval_required_in !== 'local-guides-generator pull request') errors.push('approval must happen in LKG PR');
if (!Array.isArray(data.candidates)) errors.push('candidates must be an array');
const allowedVerticals = new Set(['personal-injury','dentistry','neuro','trt','uscis-medical']);
const ids = new Set();
for (const [i, c] of (data.candidates || []).entries()) {
  const prefix = `candidate[${i}]`;
  for (const k of ['id','source','approval_model','target_repo_role','vertical','target_type','recommended_slug','mapped_lkg_pack','query_cluster','proposed_title']) {
    if (!c[k]) errors.push(`${prefix}.${k} is required`);
  }
  if (c.source !== 'velocity') errors.push(`${prefix}.source must be velocity`);
  if (c.approval_model !== 'lkg_pull_request_only') errors.push(`${prefix}.approval_model must be lkg_pull_request_only`);
  if (c.target_repo_role !== 'lkg_is_final_publisher') errors.push(`${prefix}.target_repo_role must be lkg_is_final_publisher`);
  if (!allowedVerticals.has(c.vertical)) errors.push(`${prefix}.vertical invalid: ${c.vertical}`);
  if (c.target_type !== 'guide_candidate') errors.push(`${prefix}.target_type must be guide_candidate`);
  if (!Array.isArray(c.evidence) || c.evidence.length === 0) errors.push(`${prefix}.evidence must contain at least one query/title`);
  if (!Array.isArray(c.proposed_sections) || c.proposed_sections.length < 4) errors.push(`${prefix}.proposed_sections must contain at least 4 sections`);
  if (String(c.recommended_slug || '').includes('--')) errors.push(`${prefix}.recommended_slug contains repeated hyphen`);
  if (/[^a-z0-9-]/.test(String(c.recommended_slug || ''))) errors.push(`${prefix}.recommended_slug must be lowercase slug`);
  if (ids.has(c.id)) errors.push(`${prefix}.id duplicate: ${c.id}`);
  ids.add(c.id);
}
if (errors.length) {
  console.error('LKG candidate validation failed:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`LKG candidate export OK (${(data.candidates || []).length} candidate(s))`);
