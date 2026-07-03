'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeVertical, verticalFromRoute, routeSegmentForVertical } = require('./vertical_authority');
const ROOT = path.resolve(__dirname, '../..');

function readJson(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return fallback; }
}
function normalizeRoute(route) {
  let r = String(route || '').trim();
  if (!r) return '';
  if (/^https?:\/\//i.test(r)) {
    try { r = new URL(r).pathname; } catch { return ''; }
  }
  if (!r.startsWith('/')) r = `/${r}`;
  r = r.replace(/\/index\.html$/i, '/');
  if (/\.html$/i.test(r)) return r;
  return r.replace(/\/+$/, '') + '/';
}
function renderedPathForRoute(route) {
  const r = normalizeRoute(route);
  if (!r) return '';
  if (/\.html$/i.test(r)) return r.replace(/^\//, '');
  return r.replace(/^\//, '').replace(/\/$/, '/index.html');
}
function routeShape(route) {
  const r = normalizeRoute(route);
  if (!r) return '';
  if (/^\/insights\/[a-z0-9-]+\.html$/i.test(r)) return 'insight_html';
  if (/^\/[a-z0-9-]+\/community-questions\/[a-z0-9-]+\/$/i.test(r)) return 'community_question';
  if (/^\/[a-z0-9-]+\/guides\/[a-z0-9-]+\/$/i.test(r)) return 'guide';
  if (/^\/[a-z0-9-]+\/clusters\/[a-z0-9-]+\/$/i.test(r)) return 'cluster';
  if (/^\/[a-z0-9-]+\/states\/[a-z0-9-]+\/[a-z0-9-]+\/$/i.test(r)) return 'state_family';
  if (/^\/[a-z0-9-]+\/[a-z0-9-]+\/index\.html$/i.test(r)) return 'legacy_index_html';
  if (/^\/[a-z0-9-]+\/$/i.test(r)) return 'vertical_hub';
  if (/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/i.test(r)) return 'vertical_hub';
  return 'unknown';
}
function familyForShape(shape, fallback = '') {
  if (shape === 'community_question') return 'CREATE_COMMUNITY_QA';
  if (shape === 'guide') return 'CREATE_GUIDE';
  if (shape === 'cluster') return 'CREATE_CLUSTER';
  if (shape === 'insight_html' || shape === 'legacy_index_html' || shape === 'vertical_hub') return fallback || 'REPAIR_EXISTING';
  if (shape === 'state_family') return fallback || 'STATE_PAGE';
  return fallback || '';
}
function isBlocked(row) {
  const status = String(row.status || row.operation || '').toUpperCase();
  return status.startsWith('BLOCKED_') || Boolean(row.blocked_reason);
}
function statusAdmits(row) {
  const status = String(row.status || '').toUpperCase();
  if (!status) return true;
  return ['APPROVED', 'READY_TO_PUBLISH', 'READY_TO_RELEASE', 'PLANNED', 'PASS', 'ADMITTED'].includes(status);
}
function opAdmits(row) {
  const op = String(row.operation || '').toUpperCase();
  return !op || !op.startsWith('BLOCKED_');
}
function sourcePresent(row) {
  if (row.source || row.source_run_id || row.admission_basis || row.route_authority) return true;
  if (row.source_artifacts && Object.values(row.source_artifacts).some(Boolean)) return true;
  return false;
}
function makeRecord(source, row, routeField = 'target_route') {
  const route = normalizeRoute(row[routeField] || row.target_route || row.supporting_route || row.path || row.route || '');
  const shape = routeShape(route);
  const vertical = normalizeVertical(row.vertical || row.target_vertical || verticalFromRoute(route));
  const renderedPath = row.renderedPath || renderedPathForRoute(route);
  return {
    id: String(row.id || row.record_id || `${source}:${route}`),
    source,
    route,
    renderedPath,
    vertical,
    route_vertical: verticalFromRoute(route),
    route_family: row.route_family || familyForShape(shape, row.operation === 'REPAIR_INTENDED_WINNER_PAGE' ? 'REPAIR_EXISTING' : ''),
    route_shape: row.route_shape && row.route_shape !== 'unknown' ? row.route_shape : shape,
    route_authority: row.route_authority || 'artifact_admitted',
    admission_basis: row.admission_basis || source,
    status: row.status || '',
    operation: row.operation || '',
    blocked_reason: row.blocked_reason || '',
    has_source: sourcePresent(row),
    raw: row
  };
}
function collectRecords() {
  const records = [];
  const blocked = [];
  const add = (record) => { if (!record.route) return; if (isBlocked(record)) blocked.push(record); else if (statusAdmits(record) && opAdmits(record)) records.push(record); };

  const approval = readJson('data/community/approval_queue.json', []);
  for (const row of Array.isArray(approval) ? approval : []) add(makeRecord('approval_queue', row));

  const plan = readJson('artifacts/validation/velocity-intake-release-plan.json', null);
  for (const row of Array.isArray(plan?.selected_units) ? plan.selected_units : []) add(makeRecord('velocity_intake_release_plan', row));

  const html = readJson('artifacts/validation/html-report-contract.json', null) || readJson('data/report_fixes/html_report_contract.generated.json', null);
  for (const row of Array.isArray(html?.page_specs) ? html.page_specs : []) add(makeRecord('html_report_contract_page_specs', row));
  for (const row of Array.isArray(html?.approval_records_added) ? html.approval_records_added : []) add(makeRecord('html_report_contract_approval_records', row));

  const exact = readJson('data/report_fixes/agent_exact_implementation_plan.json', null);
  for (const row of Array.isArray(exact?.specs) ? exact.specs : []) add(makeRecord('agent_exact_implementation_plan', row));


  const seen = new Map();
  for (const rec of records) {
    const key = rec.route;
    const prev = seen.get(key);
    if (!prev || (rec.has_source && !prev.has_source)) seen.set(key, rec);
  }
  return { records: [...seen.values()].sort((a, b) => a.route.localeCompare(b.route)), blocked };
}
function validateAuthorityRecord(record, policy = {}) {
  const errors = [];
  if (!record.route) errors.push(`missing_route:${record.id}`);
  if (!record.has_source) errors.push(`missing_source_artifact:${record.id}:${record.route}`);
  if (record.route_shape === 'unknown') errors.push(`unknown_route_shape:${record.id}:${record.route}`);
  if (!record.renderedPath) errors.push(`missing_rendered_path:${record.id}:${record.route}`);
  const routeVertical = record.route_vertical;
  const v = normalizeVertical(record.vertical);
  if (record.route_shape !== 'insight_html' && routeVertical && v && routeVertical !== v) errors.push(`vertical_route_mismatch:${record.id}:${v}:${record.route}`);
  const allowedShapes = new Set(policy.route_shapes || ['community_question', 'guide', 'cluster', 'state_family', 'insight_html', 'legacy_index_html', 'vertical_hub']);
  if (record.route_shape && !allowedShapes.has(record.route_shape)) errors.push(`shape_not_allowed:${record.id}:${record.route_shape}:${record.route}`);
  return errors;
}
module.exports = {
  normalizeRoute,
  renderedPathForRoute,
  routeShape,
  familyForShape,
  collectRecords,
  validateAuthorityRecord,
  isBlocked,
  statusAdmits,
  opAdmits
};
