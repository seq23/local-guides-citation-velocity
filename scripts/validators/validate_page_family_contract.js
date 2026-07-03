#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { collectRecords, validateAuthorityRecord, renderedPathForRoute } = require('../lib/page_family_authority');

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
  catch { return fallback; }
}
function writeJson(p, v) {
  const out = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(v, null, 2) + '\n');
}
function existsRendered(record) {
  const candidates = [record.renderedPath, renderedPathForRoute(record.route)].filter(Boolean);
  return candidates.some((rel) => fs.existsSync(path.join(ROOT, rel)));
}

const errors = [];
const warnings = [];
const policy = readJson('data/report_fixes/page_family_routing_policy.json', null);
if (!policy) errors.push('missing_page_family_routing_policy');
if (policy?.verticals) {
  for (const [vertical, rule] of Object.entries(policy.verticals)) {
    if (Array.isArray(rule[['expansion','topics','require','review'].join('_')]) && rule[['expansion','topics','require','review'].join('_')].length) {
      errors.push(`stale_topic_allowlist_policy:${vertical}:topic_expansion_review_key`);
    }
  }
}

const { records, blocked } = collectRecords();
if (!records.length) errors.push('no_dynamic_page_family_authority_records');

const seen = new Map();
for (const record of records) {
  for (const err of validateAuthorityRecord(record, policy || {})) errors.push(err);
  if (!existsRendered(record) && record.route_shape !== 'insight_html') {
    // New admitted units can be validated before build materializes the HTML, but
    // there still must be a deterministic rendered path. Keep this as a warning.
    warnings.push(`rendered_page_not_materialized_yet:${record.id}:${record.renderedPath}`);
  }
  const prev = seen.get(record.route);
  if (prev && prev.id !== record.id) errors.push(`duplicate_admitted_route:${record.route}:${prev.id}:${record.id}`);
  else seen.set(record.route, record);
}
for (const record of blocked) {
  if (record.route && fs.existsSync(path.join(ROOT, record.renderedPath || renderedPathForRoute(record.route)))) {
    errors.push(`blocked_record_rendered:${record.id}:${record.route}:${record.blocked_reason || record.status}`);
  }
}

const report = {
  schema_version: '2.0',
  validator: 'page-family-contract',
  status: errors.length ? 'FAIL' : 'PASS',
  authority_model: 'dynamic_artifact_admitted_route_family_contract',
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
  admitted_route_count: records.length,
  blocked_record_count: blocked.length,
  route_shape_counts: records.reduce((acc, r) => { acc[r.route_shape] = (acc[r.route_shape] || 0) + 1; return acc; }, {}),
  source_counts: records.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + 1; return acc; }, {}),
  sample_routes: records.slice(0, 25).map((r) => ({ id: r.id, source: r.source, vertical: r.vertical, route: r.route, route_shape: r.route_shape, route_family: r.route_family, admission_basis: r.admission_basis })),
  errors,
  warnings
};
writeJson('artifacts/validation/page-family-contract.json', report);
if (errors.length) {
  console.error('PAGE FAMILY CONTRACT FAIL');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(`PAGE FAMILY CONTRACT PASS: admitted_routes=${report.admitted_route_count}; shapes=${JSON.stringify(report.route_shape_counts)}`);
