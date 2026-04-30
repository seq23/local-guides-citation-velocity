#!/usr/bin/env node
'use strict';

const fs = require('fs');

const file = process.argv[2] || 'data/lkg_candidates/latest.json';
const EXPECTED_VERSION = '1.0';
const EXPECTED_ROLE = 'velocity_signal_detection_only';
const ALLOWED_VERTICALS = new Set(['personal-injury', 'dentistry', 'neuro', 'trt', 'uscis-medical']);

if (!fs.existsSync(file)) {
  console.error(`Missing LKG candidate export: ${file}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Invalid JSON in ${file}: ${e.message}`);
  process.exit(1);
}

const errors = [];
if (data.contract_version !== EXPECTED_VERSION) {
  errors.push(`contract_version must be ${EXPECTED_VERSION}`);
}
if (typeof data.source_repo !== 'string' || !data.source_repo.trim()) {
  errors.push('source_repo is required');
}
if (data.source_repo_role !== EXPECTED_ROLE) {
  errors.push(`source_repo_role must be ${EXPECTED_ROLE}`);
}
if (typeof data.generated_at !== 'string' || !data.generated_at.trim()) {
  errors.push('generated_at is required');
}
if (!Array.isArray(data.candidates)) {
  errors.push('candidates must be an array');
}

const ids = new Set();
for (const [i, c] of (data.candidates || []).entries()) {
  const prefix = `candidate[${i}]`;
  for (const k of ['id', 'vertical', 'query', 'cluster', 'source', 'status']) {
    if (
      c[k] === undefined ||
      c[k] === null ||
      (typeof c[k] === 'string' && !c[k].trim()) ||
      (Array.isArray(c[k]) && c[k].length === 0)
    ) {
      errors.push(`${prefix}.${k} is required`);
    }
  }
  if (c.source_role !== EXPECTED_ROLE) {
    errors.push(`${prefix}.source_role must be ${EXPECTED_ROLE}`);
  }
  if (!ALLOWED_VERTICALS.has(String(c.vertical || ''))) {
    errors.push(`${prefix}.vertical invalid: ${String(c.vertical)}`);
  }
  if (!Array.isArray(c.cluster) || c.cluster.length === 0) {
    errors.push(`${prefix}.cluster must be a non-empty array`);
  }
  if (ids.has(c.id)) {
    errors.push(`${prefix}.id duplicate: ${c.id}`);
  }
  ids.add(c.id);
}

if (errors.length) {
  console.error('LKG candidate validation failed:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(`LKG candidate export OK (${(data.candidates || []).length} candidate(s))`);
