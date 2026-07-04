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
const plan = exists('artifacts/validation/daily-citation-release-plan.json') ? readJson('artifacts/validation/daily-citation-release-plan.json') : null;
if (!plan) errors.push('missing release plan');
const selected = plan?.selected || [];
const blocked = plan?.blocked || [];
const requiredSelected = new Set(['create', 'repair', 'atom_update', 'internal_link_update']);
for (const t of requiredSelected) if (!selected.some((u) => u.release_unit_type === t)) errors.push(`missing-selected-type:${t}`);
if (!blocked.some((u) => ['block', 'quarantine'].includes(u.release_unit_type))) errors.push('missing blocked/quarantined unit');
for (const unit of selected) {
  for (const field of ['candidate_id', 'release_unit_type', 'route_owner', 'page_family', 'expected_aeo_geo_seo_role', 'traffic_intent', 'risk_level', 'validation_requirements']) if (unit[field] === undefined || unit[field] === null || unit[field] === '') errors.push(`selected-unit-missing:${unit.candidate_id}:${field}`);
}
if (plan?.external_telemetry_present !== false) errors.push('external telemetry must be false in container proof');
fail(errors, 'release-plan-integrity.json', { selected_count: selected.length, blocked_count: blocked.length });
