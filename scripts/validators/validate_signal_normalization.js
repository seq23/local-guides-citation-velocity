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
const raw = exists('data/signals/raw/latest.json') ? readJson('data/signals/raw/latest.json') : { records: [] };
const normalized = exists('data/signals/normalized/latest.json') ? readJson('data/signals/normalized/latest.json') : { records: [] };
if ((raw.records || []).length < 5) errors.push('expected at least 5 raw fixture/shadow records');
if ((normalized.records || []).length !== (raw.records || []).length) errors.push('normalized count must equal raw count for fixture trace');
const required = ['normalized_id', 'source_signal_ids', 'normalized_query', 'vertical', 'candidate_type', 'route_owner', 'source_basis', 'risk_level', 'status'];
for (const item of normalized.records || []) {
  for (const field of required) if (item[field] === undefined || item[field] === null || item[field] === '') errors.push(`missing-normalized-field:${item.normalized_id || 'unknown'}:${field}`);
  if (item.source_basis !== 'offline_fixture_only' && item.source_basis !== 'metadata_and_short_excerpt_only' && item.source_basis !== 'repo_local_agent_artifact') errors.push(`unexpected-source-basis:${item.normalized_id}`);
}
fail(errors, 'signal-normalization.json', { raw_count: (raw.records || []).length, normalized_count: (normalized.records || []).length });
