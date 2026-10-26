#!/usr/bin/env node
'use strict';
/**
 * Apply the served head and disclosure contract to every page in dist/.
 *
 * Runs last in `npm run build`, after install_site_head_assets.js, so it sees the
 * og:image and icon tags that pass adds and normalizes the finished head. See
 * scripts/lib/served_head_contract.js for what each transform fixes and why this
 * is a publish-time layer (2,116 of 2,136 routes are frozen accepted bytes).
 *
 * Fails (exit 1) when it finds no pages, or when a page it rewrote still breaks
 * the contract: a pass that silently does nothing is the defect this guards.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const c = require('./lib/served_head_contract');

function portfolioHosts() {
  // The guide domains this site routes to, from the registry that already names
  // them, so the cap and the schema cannot disagree about who the portfolio is.
  const org = c.organizationNode();
  const hosts = (org.brand || [])
    .map((b) => { try { return new URL(b.url).hostname.replace(/^www\./, ''); } catch { return null; } })
    .filter(Boolean);
  return [...new Set(hosts)].filter((h) => h !== c.SITE_HOST);
}

// dist/x/index.html -> /x ; dist/index.html -> / ; dist/x.html -> /x
function routeFor(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (r === 'index.html') return '/';
  return `/${r.replace(/\/index\.html$/, '').replace(/\.html$/, '')}`;
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function main() {
  const outDir = path.resolve(ROOT, process.env.PAGES_OUT_DIR || 'dist');
  if (!fs.existsSync(outDir)) { console.error(`served-head-contract: ${outDir} not found`); process.exit(1); }
  const pages = walk(outDir);
  if (!pages.length) { console.error(`served-head-contract: no pages under ${outDir}`); process.exit(1); }
  const hosts = portfolioHosts();
  const org = c.organizationNode();
  if (!org.logo) { console.error('served-head-contract: the network Organization has no logo; add it to data/network/network_identity_registry.json'); process.exit(1); }
  let changed = 0;
  const governed = c.governedRoutes();
  if (!governed.size) { console.error('served-head-contract: no governed route read from data/page_families/velocity_page_specs.json; the cap exemption would reach nothing'); process.exit(1); }
  const counts = { title_trimmed: 0, description_fitted: 0, social_added: 0, ownership_added: 0, links_capped: 0, intake_tracked: 0, steps_ordered: 0, cap_exempt: 0 };
  for (const p of pages) {
    const before = fs.readFileSync(p, 'utf8');
    const beforeTitle = c.titleOf(before), beforeDesc = c.descOf(before);
    const route = routeFor(path.relative(outDir, p));
    const exemptFromCap = !c.isCappableRoute(route, governed);
    if (exemptFromCap) counts.cap_exempt += 1;
    const after = c.applyAll(before, { portfolioHosts: hosts, org, exemptFromCap, route });
    if (after === before) continue;
    if (c.titleOf(after) !== beforeTitle) counts.title_trimmed += 1;
    if (c.descOf(after) !== beforeDesc) counts.description_fitted += 1;
    if (/og:site_name/.test(after) && !/og:site_name/.test(before)) counts.social_added += 1;
    if (after.includes(c.OWNERSHIP_MARKER) && !before.includes(c.OWNERSHIP_MARKER)) counts.ownership_added += 1;
    if (/data-link-capped/.test(after)) counts.links_capped += 1;
    if (/request-assistance\/\?utm_source=/.test(after) && !/request-assistance\/\?utm_source=/.test(before)) counts.intake_tracked += 1;
    if (/<ol\b/i.test(after) && !/<ol\b/i.test(before)) counts.steps_ordered += 1;
    fs.writeFileSync(p, after);
    changed += 1;
  }
  console.log(`served-head-contract: pages=${pages.length} rewritten=${changed} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (!changed) {
    console.error('served-head-contract: nothing was rewritten; the pass ran inert');
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { portfolioHosts };
