#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function writeReport(name, report) { fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'artifacts/validation', name), JSON.stringify(report, null, 2) + '\n'); }
function fail(errors, name, extra = {}) { const report = { validator: name.replace(/\.json$/, ''), ok: errors.length === 0, errors, ...extra }; writeReport(name, report); if (errors.length) { console.error(errors.join('\n')); process.exit(1); } console.log(`${report.validator} PASS`); }

const errors = [];
const contract = exists('data/content/atom_type_contract.json') ? readJson('data/content/atom_type_contract.json') : { required_fields: [], allowed_atom_types: [] };
const registry = exists('data/content/atom_registry.json') ? readJson('data/content/atom_registry.json') : { atoms: [] };
for (const atom of registry.atoms || []) {
  for (const field of contract.required_fields || []) if (atom[field] === undefined || atom[field] === null || atom[field] === '') errors.push(`atom-missing-field:${atom.atom_id || 'unknown'}:${field}`);
  if (!(contract.allowed_atom_types || []).includes(atom.atom_type)) errors.push(`atom-type-not-allowed:${atom.atom_id}:${atom.atom_type}`);
  if (!Array.isArray(atom.allowed_page_families) || !atom.allowed_page_families.length) errors.push(`atom-empty-page-families:${atom.atom_id}`);
}
if ((registry.atoms || []).length < 3) errors.push('expected at least 3 seed atoms');
fail(errors, 'atom-contract.json', { atom_count: (registry.atoms || []).length });
