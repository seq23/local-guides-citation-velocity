'use strict';
// Reviewed publication budget. Opportunity discovery is not publication authority.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function read(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error(`Search rescue: required source missing: ${rel}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const policy = read('config/search_rescue.json');
const { normalizeRoute } = require('./frozen_pages');
const kept = new Set(policy.kept.map(p => normalizeRoute(p.path)));
const retired = new Map(policy.retirements.map(p => [normalizeRoute(p.source_path), normalizeRoute(p.target_path)]));
if (!kept.size || kept.size > policy.max_pages) throw new Error('Search rescue: invalid publication budget');
for (const [from, to] of retired) {
  if (kept.has(from) || !kept.has(to) || from === to) throw new Error(`Search rescue: invalid retirement ${from} -> ${to}`);
}
const allowed = route => kept.has(normalizeRoute(route));
const target = route => {
  const normalized = normalizeRoute(route);
  return retired.get(normalized) || (normalized.startsWith('/insights/') ? retired.get(normalized.replace(/\/$/, '') + '.html') : undefined);
};
const write = (rel, value) => fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(value, null, 2) + '\n');
function prepare() {
  // Preflight all input files before any writes. The reviewed policy is canonical;
  // the admission registry is always re-derived, never used as a new keep list.
  const retirementBook = read('data/release/route_retirements.json');
  const admission = read('data/content/page_admission_registry.json');
  const frozen = read('data/release/frozen_page_registry.json');
  const contract = read('data/overhaul/full_scope_overhaul_contract.json');
  const redirects = fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8');
  const rows = new Map(retirementBook.retirements.map(r => [normalizeRoute(r.source_path), r]));
  policy.retirements.forEach(r => rows.set(normalizeRoute(r.source_path), r));
  // Existing retired URLs must land directly on a survivor, never on a new 301.
  for (const row of rows.values()) row.target_path = target(row.target_path) || row.target_path;
  for (const line of redirects.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+301\s*$/);
    if (!m || ['/indexnow', '/sitemap', '/sitemaps/sitemap_all.xml'].includes(m[1])) continue;
    const source = normalizeRoute(m[1]);
    if (!rows.has(source) && !kept.has(source)) rows.set(source, {
      source_path: m[1], target_path: target(m[2]) || m[2], status: 'ACTIVE_301',
      reason: 'Preserve historical exact redirect during search rescue.', evidence: ['_redirects']
    });
  }
  retirementBook.retirements = [...rows.values()];
  for (const row of retirementBook.retirements) {
    if (kept.has(normalizeRoute(row.source_path)) || !allowed(row.target_path)) throw new Error(`Search rescue: invalid historical retirement ${row.source_path} -> ${row.target_path}`);
  }
  const lines = redirects.split('\n').filter(line => !line.startsWith('# Search rescue'));
  const existing = new Set();
  const next = lines.map(line => {
    const m = line.match(/^(\S+)\s+(\S+)\s+(30[18])\s*$/);
    if (!m) return line;
    existing.add(normalizeRoute(m[1]));
    return `${m[1]} ${target(m[1]) || target(m[2]) || m[2]} ${m[3]}`;
  });
  for (const row of policy.retirements) if (!existing.has(normalizeRoute(row.source_path))) next.push(`${row.source_path} ${row.target_path} 301`);
  admission.pages = admission.pages.filter(p => allowed(p.path)); admission.count = admission.pages.length;
  // Retirement removes deployment admission, not the accepted archive. Keep
  // frozen historical records so postprocessors cannot mutate retired evidence.
  frozen.count = frozen.pages.length;
  contract.counts.approved_route_retirements = retirementBook.retirements.filter(r => r.status === 'ACTIVE_301').length;
  write('data/release/route_retirements.json', retirementBook);
  fs.writeFileSync(path.join(ROOT, '_redirects'), next.filter(Boolean).join('\n') + '\n');
  write('data/content/page_admission_registry.json', admission);
  write('data/release/frozen_page_registry.json', frozen);
  write('data/overhaul/full_scope_overhaul_contract.json', contract);
  console.log(`Search rescue: ${kept.size} kept, ${retired.size} consolidated; expansion paused=${policy.expansion_paused}`);
}
// Keep a bounded set of exact static rules. The Pages middleware serves the
// complete retirement ledger, including extensionless and slashless aliases.
// Prefix splats inside an insight filename are not a supported Pages route.
function deploymentRedirects(text) {
  const rules = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+(301|302|303|307|308)\s*$/);
    if (!m || /[*:]/.test(m[1])) throw new Error(`Unsupported static redirect: ${line}`);
    const destination = target(m[1]) || target(m[2]) || m[2];
    rules.set(m[1], `${m[1]} ${destination} ${m[3]}`);
  }
  return '# Exact static redirects; full 301 coverage is in functions/_middleware.js\n' + [...rules.values()].slice(0, 1990).join('\n') + '\n';
}
function resolveLinks(html) {
  const rewritten = html.replace(/(href=["'])([^"']+)(["'])/g, (all, start, href, end) => {
    if (!href.startsWith('/') && !href.startsWith('https://theindustryguides.com/')) return all;
    const url = new URL(href.replaceAll('&amp;', '&'), 'https://theindustryguides.com');
    const to = target(url.pathname) || target(url.pathname + '.html');
    return to ? `${start}${to}${url.search.replaceAll('&', '&amp;')}${url.hash}${end}` : all;
  });
  // Breadcrumb and collection URLs are navigation too. Keep the visible link
  // and its structured counterpart on the same final destination.
  return rewritten.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (all, start, raw, end) => {
    let data; try { data = JSON.parse(raw); } catch { return all; }
    const visit = node => {
      if (Array.isArray(node)) return node.map(visit);
      if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v)]));
      if (typeof node === 'string' && node.startsWith('https://theindustryguides.com/')) {
        const url = new URL(node), to = target(url.pathname) || target(url.pathname + '.html');
        if (to) return url.origin + to + url.search + url.hash;
      }
      return node;
    };
    return start + JSON.stringify(visit(data)).replaceAll('<', '\\u003c') + end;
  });
}
module.exports = { policy, allowed, target, prepare, deploymentRedirects, resolveLinks };
