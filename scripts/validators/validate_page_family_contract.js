#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(p, f = null) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return f; } }
function writeJson(p, v) { const out = path.join(ROOT, p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(v, null, 2) + '\n'); }
const errors = [];
const warnings = [];
const policy = readJson('data/report_fixes/page_family_routing_policy.json', null);
const approval = readJson('data/community/approval_queue.json', []);
const htmlReport = readJson('artifacts/validation/html-report-contract.json', null);
const velocityPlan = readJson('artifacts/validation/velocity-intake-release-plan.json', null);
if (!policy) errors.push('missing_page_family_routing_policy');
for (const row of Array.isArray(approval) ? approval : []) {
  if (String(row.status || '').startsWith('BLOCKED_')) errors.push(`blocked_record_in_approval_queue:${row.id}:${row.blocked_reason || row.status}`);
  const route = String(row.target_route || '');
  if (!route) errors.push(`approval_missing_target_route:${row.id}`);
  if (route.includes('/community-questions/') && ['CREATE_GUIDE', 'CREATE_CLUSTER'].includes(row.route_family)) errors.push(`route_family_route_mismatch:${row.id}:${row.route_family}:${route}`);
  if (route.includes('/guides/') && row.route_family && row.route_family !== 'CREATE_GUIDE') errors.push(`route_family_route_mismatch:${row.id}:${row.route_family}:${route}`);
}
const pageSpecs = htmlReport && Array.isArray(htmlReport.page_specs) ? htmlReport.page_specs : [];
for (const spec of pageSpecs) {
  if (spec.blocked_reason && !String(spec.status || '').startsWith('BLOCKED_')) warnings.push(`page_spec_blocked_reason_not_block_status:${spec.id}:${spec.blocked_reason}`);
  if (String(spec.query || '').match(/migraine|headache|cgrp|aimovig|emgality|ibuprofen|vitamin b2|magnesium|neuromodulation/i) && spec.vertical === 'neuro' && spec.target_route) errors.push(`neuro_expansion_topic_should_not_autopublish:${spec.query}:${spec.target_route}`);
}
const selected = velocityPlan && Array.isArray(velocityPlan.selected_units) ? velocityPlan.selected_units : [];
for (const unit of selected) {
  if (String(unit.operation || '').startsWith('BLOCKED_')) errors.push(`blocked_unit_selected:${unit.id}:${unit.operation}`);
}
const report = { schema_version: '1.0', validator: 'page-family-contract', status: errors.length ? 'FAIL' : 'PASS', checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0,10), approval_count: Array.isArray(approval) ? approval.length : 0, page_specs_checked: pageSpecs.length, selected_units_checked: selected.length, errors, warnings };
writeJson('artifacts/validation/page-family-contract.json', report);
if (errors.length) { console.error('PAGE FAMILY CONTRACT FAIL'); errors.forEach(e => console.error(`- ${e}`)); process.exit(1); }
console.log(`PAGE FAMILY CONTRACT PASS: approvals=${report.approval_count}; page_specs=${report.page_specs_checked}`);
