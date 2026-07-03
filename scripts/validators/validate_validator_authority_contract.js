#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const files = [
  'scripts/lib/citation_opportunity_classifier.js',
  'scripts/lib/page_family_router.js',
  'scripts/validators/validate_page_family_contract.js',
  'scripts/citation_velocity/apply_html_report_contract.js',
  'scripts/citation_velocity/prepare_velocity_intake_release.js',
  'scripts/velocity_content_release.js',
  'data/report_fixes/page_family_routing_policy.json'
];
const forbidden = [
  /neuro_expansion_topic_should_not_autopublish/,
  /BLOCKED_EXPANSION_CANDIDATE/,
  /broader_neurology_topic_outside_current_neuro_evaluation_scope/,
  /outside_current_[a-z0-9_-]+_scope/,
  /expansion_topics_require_review/,
  /migraine\|headache\|cgrp\|aimovig\|emgality\|ibuprofen\|vitamin b2\|magnesium\|neuromodulation/i
];
const errors = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { errors.push(`missing_authority_surface:${rel}`); continue; }
  const text = fs.readFileSync(abs, 'utf8');
  forbidden.forEach((re) => {
    if (re.test(text)) errors.push(`stale_validator_policy:${rel}:${String(re)}`);
  });
}
const report = {
  schema_version: '1.0',
  validator: 'validator-authority-contract',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_files: files,
  errors,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10)
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/validator-authority-contract.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) {
  console.error('VALIDATOR AUTHORITY CONTRACT FAIL');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(`VALIDATOR AUTHORITY CONTRACT PASS: checked=${files.length}`);
