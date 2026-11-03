'use strict';
const fs = require('fs');
const path = require('path');
const identity = route => String(route).replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';

// The page routes the site's own sitemap lists (sitemap.xml plus sitemaps/*.xml),
// without the child-sitemap entries of a sitemap index.
function sitemapRoutes(root) {
  const files = ['sitemap.xml'];
  const dir = path.join(root, 'sitemaps');
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (n.endsWith('.xml')) files.push(path.join('sitemaps', n));
  const routes = new Set();
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      if (!/\.xml$/i.test(m[1])) routes.add(identity(m[1]));
    }
  }
  return [...routes];
}

// The floor follows the site's own sitemap, never a fixed page count (owner ruling
// 3 Nov 2026: a few hundred distinct pages is healthy; volume is not). Every page
// the sitemap lists must be admitted in the ledger and built; every admitted page
// must be built; an empty sitemap or an empty ledger fails (Rule 0). A deleted
// page without a recorded working 301 never counts.
function inventoryCoverage({ admitted, rendered, retirements, redirects, sitemap, minimum }) {
  if (minimum !== undefined) throw new Error('inventoryCoverage: a fixed page minimum is retired; pass sitemap (the listed routes) instead');
  const live = new Set(admitted.map(identity));
  const found = new Set(rendered.map(identity));
  const listed = new Set((sitemap || []).map(identity));
  const redirectMap = new Map(redirects.map(([from, to, status]) => [identity(from), { to: identity(to), status }]));
  const issues = [];
  if (!live.size) issues.push('no admitted routes');
  if (!listed.size) issues.push('the sitemap lists no pages, so the page floor examined nothing');
  for (const route of live) if (!found.has(route)) issues.push(`admitted route missing from indexable tree: ${route}`);
  for (const route of listed) {
    if (!live.has(route)) issues.push(`sitemap route not admitted in the ledger: ${route}`);
    else if (!found.has(route)) issues.push(`sitemap route missing from indexable tree: ${route}`);
  }
  const retired = new Set();
  for (const row of retirements) {
    if (row.status !== 'ACTIVE_301') continue;
    const source = identity(row.source_path), target = identity(row.target_path), rule = redirectMap.get(source);
    if (live.has(source) || !live.has(target) || !rule || rule.status !== '301' || rule.to !== target) {
      issues.push(`invalid retirement coverage: ${source} -> ${target}`);
    } else retired.add(source);
  }
  // A consolidation is never silent: every 301 onto an admitted page is recorded as a retirement.
  for (const [from, rule] of redirectMap) {
    if (rule.status === '301' && live.has(rule.to) && !retired.has(from)) issues.push(`301 onto an admitted page with no retirement record: ${from} -> ${rule.to}`);
  }
  const built = [...live].filter(r => found.has(r)).length;
  if (built < listed.size) issues.push(`only ${built} admitted route(s) built; the sitemap lists ${listed.size}`);
  return { coverage: live.size + retired.size, active: live.size, retired: retired.size, listed: listed.size, issues };
}
module.exports = { inventoryCoverage, sitemapRoutes };
