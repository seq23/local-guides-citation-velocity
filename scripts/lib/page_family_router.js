'use strict';

const fs = require('fs');
const path = require('path');
const { classifyOpportunity } = require('./citation_opportunity_classifier');
const ROOT = path.resolve(__dirname, '../..');
const POLICY_PATH = 'data/report_fixes/page_family_routing_policy.json';
function slugify(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'citation-question'; }
function normalizeVertical(v) { return String(v || '').replace(/_/g, '-'); }
function readPolicy() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_PATH), 'utf8')); } catch { return {}; } }
function routeForFamily(vertical, query, family) {
  const v = normalizeVertical(vertical);
  const slug = slugify(query);
  if (family === 'CREATE_GUIDE') return `/${v}/guides/${slug}/`;
  if (family === 'CREATE_CLUSTER') return `/${v}/clusters/${slug}/`;
  return `/${v}/community-questions/${slug}/`;
}
function routePage(row) {
  const policy = readPolicy();
  const decision = classifyOpportunity(row);
  const vertical = normalizeVertical(row.vertical);
  const verticalPolicy = policy.verticals?.[vertical] || policy.verticals?.[String(row.vertical || '')] || {};
  const allowed = new Set(verticalPolicy.allowed_families || policy.default_allowed_families || ['CREATE_COMMUNITY_QA']);
  if (decision.family === 'REPAIR_EXISTING') return { ...decision, status: 'REPAIR_EXISTING', target_route: row.target_route || '', renderedPath: row.renderedPath || '' };
  if (decision.family === 'EXPANSION_CANDIDATE') {
    return { ...decision, status: 'BLOCKED_EXPANSION_CANDIDATE', blocked_reason: 'OFF_VERTICAL_TOPIC', target_route: '', renderedPath: '' };
  }
  if (!allowed.has(decision.family)) {
    if (allowed.has('CREATE_COMMUNITY_QA') && decision.family !== 'CREATE_GUIDE') {
      const route = routeForFamily(vertical, row.query || row.normalized_query, 'CREATE_COMMUNITY_QA');
      return { family: 'CREATE_COMMUNITY_QA', reason: `downgraded_from_${decision.family}`, status: 'READY_TO_RELEASE', target_route: route, renderedPath: route.replace(/^\//, '').replace(/\/$/, '/index.html') };
    }
    return { ...decision, status: 'BLOCKED_UNSUPPORTED_PAGE_FAMILY', blocked_reason: 'UNSUPPORTED_PAGE_FAMILY', target_route: '', renderedPath: '' };
  }
  const route = routeForFamily(vertical, row.query || row.normalized_query, decision.family);
  return { ...decision, status: 'READY_TO_RELEASE', target_route: route, renderedPath: route.replace(/^\//, '').replace(/\/$/, '/index.html') };
}
module.exports = { routePage, routeForFamily, slugify };
