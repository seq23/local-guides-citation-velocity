'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function rel(p) { return path.join(ROOT, p); }
function normalizeImplementationPath(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  if (out && !out.endsWith('.html') && !out.endsWith('.json') && !out.endsWith('.csv')) out = out.replace(/\/+$/, '') + '/index.html';
  return out.replace(/\/+/g, '/');
}
function findExistingInsightsByNumber(numberedSlug) {
  const dir = rel('insights');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.html') && name.includes(numberedSlug))
    .map((name) => `insights/${name}`)
    .filter((candidate) => fs.existsSync(rel(candidate)))
    .sort();
}
function routeFamilyForPath(value) {
  const p = normalizeImplementationPath(value);
  if (!p) return 'UNKNOWN';
  if (p.startsWith('insights/')) return 'INSIGHT';
  if (p.includes('/community-questions/')) return 'COMMUNITY_QA';
  if (p.includes('/guides/')) return 'GUIDE';
  if (p.endsWith('/index.html')) return 'LIVE_PAGE';
  return 'STATIC_FILE';
}
function resolveTargetPath(value) {
  const raw = normalizeImplementationPath(value);
  if (!raw) return { implementation_path: '', status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: 'UNKNOWN', canonicalized_from: [] };
  if (fs.existsSync(rel(raw))) return { implementation_path: raw, status: 'EXACT_EXISTS', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
  const match = raw.match(/(^|\/)([a-z-]+-\d{3})-/);
  if (match) {
    const candidates = findExistingInsightsByNumber(match[2]);
    if (candidates.length === 1) return { implementation_path: candidates[0], status: 'CANONICALIZED_BY_NUMBERED_INSIGHT', block_reason: '', route_family: routeFamilyForPath(candidates[0]), canonicalized_from: [raw], candidates };
    if (candidates.length > 1) return { implementation_path: '', status: 'AMBIGUOUS_TARGET_RESOLUTION', block_reason: 'AMBIGUOUS_TARGET_RESOLUTION', route_family: 'UNKNOWN', canonicalized_from: [raw], candidates };
  }
  return { implementation_path: raw, status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
}
function routeFromPath(p) { return p ? `/${normalizeImplementationPath(p)}` : ''; }
module.exports = { normalizeImplementationPath, routeFamilyForPath, resolveTargetPath, routeFromPath };
