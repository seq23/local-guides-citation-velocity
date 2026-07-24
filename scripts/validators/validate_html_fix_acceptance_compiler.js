#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';

function rel(p) {
  return path.join(ROOT, p);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(rel(p), 'utf8'));
}

const errors = [];
const warnings = [];

if (!fs.existsSync(rel(MANIFEST_PATH))) {
  errors.push(`missing:${MANIFEST_PATH}`);
} else {
  let manifest;
  try {
    manifest = readJson(MANIFEST_PATH);
  } catch (error) {
    errors.push(`invalid_json:${MANIFEST_PATH}:${error.message}`);
  }

  if (manifest) {
    if (manifest.generated_by !== 'compile_html_fix_acceptance_manifest.js') errors.push('semantic_manifest_wrong_origin');
    if (!Array.isArray(manifest.entries)) errors.push('semantic_manifest_entries_must_be_array');
    if (!manifest.entries?.length) warnings.push('semantic_manifest_empty');
    if (Number(manifest.entry_count || 0) !== (manifest.entries || []).length) errors.push('semantic_manifest_entry_count_mismatch');

    for (const [index, entry] of (manifest.entries || []).entries()) {
      if (!entry.implementation_path) errors.push(`entry_${index}:missing_implementation_path`);
      if (!Array.isArray(entry.row_requirements)) errors.push(`entry_${index}:row_requirements_must_be_array`);
      if (!Array.isArray(entry.required_strings)) errors.push(`entry_${index}:required_strings_must_be_array`);
      const impl = String(entry.implementation_path || '');
      if (impl.startsWith('uscis-medical/')) {
        if (entry.authority_grounded !== true) errors.push(`entry_${index}:uscis_requires_authority_grounded_compilation`);
        if (!Array.isArray(entry.authority_source_ids) || !entry.authority_source_ids.length) errors.push(`entry_${index}:uscis_missing_authority_source_ids`);
        if (!Array.isArray(entry.authority_urls) || !entry.authority_urls.length) errors.push(`entry_${index}:uscis_missing_authority_urls`);
        const serialized = JSON.stringify(entry).toLowerCase();
        for (const forbidden of ['skin test alternative','every lawyer','every attorney','valid indefinitely']) if (serialized.includes(forbidden)) errors.push(`entry_${index}:uscis_forbidden_stale_or_cross_vertical_phrase:${forbidden}`);
        if (impl === 'uscis-medical/index.html' && !serialized.includes('igra')) errors.push(`entry_${index}:uscis_tb_hub_missing_igra`);
      }
    }
  }
}

if (errors.length) {
  console.error('HTML FIX ACCEPTANCE MANIFEST VALIDATION FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`HTML FIX ACCEPTANCE MANIFEST VALIDATION PASS: warnings=${warnings.length}`);
