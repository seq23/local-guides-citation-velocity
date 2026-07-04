'use strict';

const fs = require('fs');
const path = require('path');
const { classifyOpportunity } = require('./citation_opportunity_classifier');
const { normalizeVertical, routeSegmentForVertical } = require('./vertical_authority');
const { routeShape, renderedPathForRoute } = require('./page_family_authority');
const ROOT = path.resolve(__dirname, '../..');
const POLICY_PATH = 'data/report_fixes/page_family_routing_policy.json';
function slugify(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'citation-question'; }
function readPolicy() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_PATH), 'utf8')); } catch { return {}; } }
function routeForFamily(vertical, query, family) {
  const v = routeSegmentForVertical(vertical);
  const slug = slugify(query);
  if (family === 'CREATE_GUIDE') return `/${v}/guides/${slug}/`;
  if (family === 'CREATE_CLUSTER') return `/${v}/clusters/${slug}/`;
  return `/${v}/community-questions/${slug}/`;
}
function routePage(row) {
  const policy = readPolicy();
  const decision = classifyOpportunity(row);
  const vertical = normalizeVertical(row.vertical);
  const verticalPolicy = policy.verticals?.[vertical] || policy.verticals?.[routeSegmentForVertical(vertical)] || {};
  const allowed = new Set(verticalPolicy.allowed_families || policy.default_allowed_families || ['CREATE_COMMUNITY_QA']);
  if (decision.family === 'REPAIR_EXISTING') {
    const target = row.target_route || '';
    const renderedPath = row.renderedPath || renderedPathForRoute(target);
    return { ...decision, status: 'REPAIR_EXISTING', target_route: target, renderedPath, route_shape: target ? routeShape(target) : 'repair_existing', route_authority: 'artifact_admitted', admission_basis: 'existing_target_repair', rich_page_type: decision.rich_page_type || 'repair_existing' };
  }
  let family = decision.family;
  let reason = decision.reason;
  if (!allowed.has(family)) {
    if (allowed.has('CREATE_COMMUNITY_QA') && family !== 'CREATE_GUIDE') {
      reason = `downgraded_from_${family}`;
      family = 'CREATE_COMMUNITY_QA';
    } else {
      return { ...decision, status: 'BLOCKED_UNSUPPORTED_PAGE_FAMILY', blocked_reason: 'UNSUPPORTED_PAGE_FAMILY', target_route: '', renderedPath: '', route_shape: '', route_authority: 'blocked_by_route_shape_policy', admission_basis: '' };
    }
  }
  const route = routeForFamily(vertical, row.query || row.normalized_query, family);
  return { family, reason, status: 'READY_TO_RELEASE', target_route: route, renderedPath: renderedPathForRoute(route), route_shape: routeShape(route), route_authority: 'artifact_admitted', admission_basis: 'route_resolver', rich_page_type: decision.rich_page_type || (family === 'CREATE_GUIDE' ? 'checklist_guide' : family === 'CREATE_CLUSTER' ? 'cluster_page' : 'community_qa') };
}
module.exports = { routePage, routeForFamily, slugify };
