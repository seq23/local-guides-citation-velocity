'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function rel(p) { return path.join(ROOT, p); }
function normalizeImplementationPath(value) {
  let rawValue = value && typeof value === 'object' ? (value.value || value.path || value.url || value.target || '') : value;
  let out = String(rawValue || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  if (out && !out.endsWith('.html') && !out.endsWith('.json') && !out.endsWith('.csv')) out = out.replace(/\/+$/, '') + '/index.html';
  return out.replace(/\/+/g, '/');
}
function normalizeSlugComparable(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\.html$|\/index\.html$/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function editDistance(a, b) {
  a = String(a || ''); b = String(b || '');
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[a.length][b.length];
}
function similarityScore(a, b) {
  a = normalizeSlugComparable(a); b = normalizeSlugComparable(b);
  if (!a || !b) return 0; if (a === b) return 1;
  const A = new Set(a.split('-').filter(Boolean)), B = new Set(b.split('-').filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length; const union = new Set([...A, ...B]).size || 1;
  const token = inter / union;
  const len = Math.max(a.length, b.length) || 1;
  const levenshtein = 1 - (editDistance(a, b) / len);
  let prefix = 0;
  for (let i=0;i<Math.min(a.length,b.length);i++) { if (a[i]===b[i]) prefix++; else break; }
  return Math.max(token, levenshtein, prefix / len);
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
function walkHtml(dir, prefix='', out=[]) {
  const abs = rel(dir);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.join(dir, ent.name).replace(/\\/g, '/');
    if (ent.isDirectory()) walkHtml(r, prefix, out);
    else if (ent.isFile() && ent.name.endsWith('.html')) out.push(r);
  }
  return out;
}
function titleOf(file) { try { const text=fs.readFileSync(rel(file),'utf8'); return (text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() || ''; } catch { return ''; } }
let ROUTE_REGISTRY_CACHE = null;
function buildRouteRegistry() {
  if (ROUTE_REGISTRY_CACHE) return ROUTE_REGISTRY_CACHE;
  const files = [...walkHtml('insights'), ...walkHtml('guides'), ...walkHtml('compare'), ...walkHtml('near-me'), ...walkHtml('')]
    .filter((f, i, arr) => f && !f.includes('node_modules/') && arr.indexOf(f) === i && fs.existsSync(rel(f)));
  ROUTE_REGISTRY_CACHE = files.map(file => {
    const title = titleOf(file);
    return { implementation_path: normalizeImplementationPath(file), comparable_path: normalizeSlugComparable(file), title, comparable_title: normalizeSlugComparable(title) };
  });
  return ROUTE_REGISTRY_CACHE;
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
function resolveFuzzyRoute(raw, options = {}) {
  const registry = buildRouteRegistry();
  const hay = [raw, options.query, options.title].filter(Boolean).join(' ');
  const target = normalizeSlugComparable(hay || raw);
  const scored = registry.map(r => ({ ...r, score: Math.max(similarityScore(target, r.comparable_path), similarityScore(target, r.comparable_title)) }))
    .filter(r => r.score >= Number(options.threshold || 0.78)).sort((a,b)=>b.score-a.score || a.implementation_path.localeCompare(b.implementation_path));
  if (!scored.length) return { implementation_path: '', status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: 'UNKNOWN', canonicalized_from: [normalizeImplementationPath(raw)], candidates: [] };
  const top = scored[0]; const ties = scored.filter(r => top.score - r.score < 0.04);
  if (ties.length > 1) return { implementation_path: '', status: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', block_reason: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', route_family: 'UNKNOWN', canonicalized_from: [normalizeImplementationPath(raw)], candidates: ties.slice(0,5).map(x=>({ implementation_path:x.implementation_path, score:x.score })) };
  return { implementation_path: top.implementation_path, status: 'FUZZY_ROUTE_RESOLVED', block_reason: '', route_family: routeFamilyForPath(top.implementation_path), canonicalized_from: [normalizeImplementationPath(raw)], candidates: scored.slice(0,5).map(x=>({ implementation_path:x.implementation_path, score:x.score })) };
}
function resolveTargetPath(value) {
  const input = value && typeof value === 'object' ? value : { value };
  const raw = normalizeImplementationPath(input.value || input.path || input.url || input.target || value);
  const op = input.operation || '';
  if (!raw) return { implementation_path: '', status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: 'UNKNOWN', canonicalized_from: [] };
  if (op === 'CREATE_NEW_TARGET_PAGE') {
    if (fs.existsSync(rel(raw))) return { implementation_path: raw, status: 'EXACT_NEW_PAGE_DUPLICATE_EXISTS', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
    return { implementation_path: raw, status: 'NEW_PAGE_TARGET_PRESERVED', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
  }
  if (fs.existsSync(rel(raw))) return { implementation_path: raw, status: 'EXACT_EXISTS', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
  const normalized = normalizeSlugComparable(raw);
  const exactComparable = buildRouteRegistry().filter(r => r.comparable_path === normalized || r.comparable_title === normalized);
  if (exactComparable.length === 1) return { implementation_path: exactComparable[0].implementation_path, status: 'SLUG_NORMALIZED_EXISTS', block_reason: '', route_family: routeFamilyForPath(exactComparable[0].implementation_path), canonicalized_from: [raw] };
  if (exactComparable.length > 1) return { implementation_path: '', status: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', block_reason: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', route_family: 'UNKNOWN', canonicalized_from: [raw], candidates: exactComparable.map(x=>x.implementation_path) };
  const match = raw.match(/(^|\/)([a-z-]+-\d{3})-/);
  if (match) {
    const candidates = findExistingInsightsByNumber(match[2]);
    if (candidates.length === 1) return { implementation_path: candidates[0], status: 'CANONICALIZED_BY_NUMBERED_INSIGHT', block_reason: '', route_family: routeFamilyForPath(candidates[0]), canonicalized_from: [raw], candidates };
    if (candidates.length > 1) return { implementation_path: '', status: 'AMBIGUOUS_TARGET_RESOLUTION', block_reason: 'AMBIGUOUS_TARGET_RESOLUTION', route_family: 'UNKNOWN', canonicalized_from: [raw], candidates };
  }
  const fuzzy = resolveFuzzyRoute(raw, { query: input.query, title: input.title, threshold: input.threshold });
  if (!fuzzy.block_reason) return fuzzy;
  return { implementation_path: raw, status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
}
function routeFromPath(p) { return p ? `/${normalizeImplementationPath(p)}` : ''; }
module.exports = { normalizeImplementationPath, normalizeSlugComparable, similarityScore, buildRouteRegistry, resolveFuzzyRoute, routeFamilyForPath, resolveTargetPath, routeFromPath };
