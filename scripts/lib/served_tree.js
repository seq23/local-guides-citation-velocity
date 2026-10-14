'use strict';
/**
 * The served tree, defined once.
 *
 * Cloudflare Pages serves `dist/` (wrangler.toml pages_build_output_dir), and
 * scripts/build_pages_dist.js fills it by copying from the repo root every HTML
 * file whose route is ADMITTED in data/content/page_admission_registry.json (plus
 * 404.html), skipping the internal directories below. Anything that asks "what
 * does the site serve?" reads this module instead of keeping its own list, and
 * reads it from the repo root - so the answer is the same whether or not a build
 * has left a `dist/` behind.
 *
 * 2026-10-14: velocity-canonical-anchor-links counted `dist` when present and the
 * whole repo root otherwise. Validate Repo (with dist) counted 9 links to one
 * canonical URL; Query Evidence Refresh (no dist) counted 18 against a cap of 10.
 * Same validator, same commit, two answers.
 */
const fs = require('fs');
const path = require('path');

const INTERNAL_DIRS = new Set([
  '.build', '.build-cache', '.cache', '.git', '.github', '.wrangler', 'artifacts', 'content',
  'data', 'distribution_scripts', 'docs', 'logs', 'node_modules', 'reports', 'scripts',
  'staging', 'templates', 'tmp'
]);

function admittedRoutes(root) {
  const payload = JSON.parse(fs.readFileSync(path.join(root, 'data', 'content', 'page_admission_registry.json'), 'utf8'));
  return new Set((payload.pages || []).filter((p) => p.publication_status === 'ADMITTED').map((p) => p.path));
}

function routeForHtmlRel(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  if (rel.endsWith('.html')) return `/${rel}`;
  return null;
}

function isInternalRel(rel) {
  if (!rel || rel === '.well-known' || rel.startsWith('.well-known/')) return false;
  const first = rel.split('/')[0];
  return first === 'dist' || INTERNAL_DIRS.has(first);
}

function isServedHtmlRel(rel, admitted) {
  if (!rel.endsWith('.html') || isInternalRel(rel)) return false;
  if (rel === '404.html') return true;
  const route = routeForHtmlRel(rel);
  return Boolean(route && admitted.has(route));
}

// Every served HTML file, as absolute paths under `root` (never under dist/).
function servedHtmlFiles(root) {
  const admitted = admittedRoutes(root);
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (ent.isDirectory()) { if (!isInternalRel(rel)) walk(abs); }
      else if (ent.isFile() && isServedHtmlRel(rel, admitted)) out.push(abs);
    }
  };
  walk(root);
  return out.sort();
}

module.exports = { INTERNAL_DIRS, admittedRoutes, routeForHtmlRel, isInternalRel, isServedHtmlRel, servedHtmlFiles };
