#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024;
// One definition of what is served, shared with every reader that asks the same
// question (scripts/lib/served_tree.js).
const servedTree = require('./lib/served_tree');
const ADMITTED_ROUTES = servedTree.admittedRoutes(ROOT);

const INTERNAL_DIRS = servedTree.INTERNAL_DIRS;

const PUBLIC_ROOT_FILES = new Set([
  '404.html', '_headers', '_redirects', 'about.html', 'disclaimer.html', 'feed.json',
  'feed.xml', 'humans.txt', 'index.html', 'indexnow.txt', 'llms-full.txt', 'llms.txt',
  'methodology.html', 'privacy.html', 'robots.txt', 'sitemap.xml', 'terms.html',
  // Favicon, touch icons, web manifest and the og:image card: one list, owned by
  // data/seo/site_brand_assets.json, so the published set and the installer agree.
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seo', 'site_brand_assets.json'), 'utf8')).files
]);

const PUBLIC_EXTENSIONS = new Set([
  '.avif', '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json', '.map',
  '.pdf', '.png', '.svg', '.txt', '.webmanifest', '.webp', '.woff', '.woff2', '.xml'
]);

// Cloudflare Web Analytics is auto-installed on this zone: the edge injects
// <script src="https://static.cloudflareinsights.com/beacon.min.js"> into every
// HTML response. Until 2026-10-08 the CSP in _headers allowed only 'self' and
// Clarity, so the browser refused the beacon on every page and the hub recorded
// zero pageloads for 30 days while the five canonicals recorded theirs. The
// refusal was even classified as harmless noise (scripts/browser/
// console_error_policy.js). Fail the build before writing dist if the CSP would
// block the beacon again.
function assertCspAllowsWebAnalytics() {
  const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  const csp = (headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1] || '';
  if (!csp) return; // no CSP, nothing can block the beacon
  const directive = (name) => ((csp.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`)) || [])[1] || '').split(/\s+/);
  const problems = [];
  if (!directive('script-src').includes('https://static.cloudflareinsights.com')) problems.push("script-src must allow https://static.cloudflareinsights.com");
  if (!directive('connect-src').includes('https://cloudflareinsights.com')) problems.push("connect-src must allow https://cloudflareinsights.com");
  // The homepage (scripts/lib/umbrella_homepage.js) loads IBM Plex Sans from
  // Google Fonts, the type the six canonical sites share; a CSP without these
  // two hosts silently falls back to the system font.
  if (!directive('style-src').includes('https://fonts.googleapis.com')) problems.push("style-src must allow https://fonts.googleapis.com");
  if (!directive('font-src').includes('https://fonts.gstatic.com')) problems.push("font-src must allow https://fonts.gstatic.com");
  if (problems.length) {
    console.error(`build_pages_dist: _headers CSP blocks Cloudflare Web Analytics or the homepage font: ${problems.join('; ')}`);
    process.exit(1);
  }
}
assertCspAllowsWebAnalytics();

function toRel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function shouldSkipDir(abs) {
  if (abs === DIST) return true;
  const rel = toRel(abs);
  if (!rel) return false;
  const first = rel.split('/')[0];
  if (rel === '.well-known') return false;
  return INTERNAL_DIRS.has(first);
}
const { routeForHtmlRel } = servedTree;
function renderedRelForRoute(route) {
  if (route === '/') return 'index.html';
  if (route.endsWith('.html')) return route.replace(/^\/+/, '');
  return `${route.replace(/^\/+|\/+$/g, '')}/index.html`;
}
function isPublicFile(abs) {
  const rel = toRel(abs);
  const parts = rel.split('/');
  const base = path.basename(rel);
  const ext = path.extname(base).toLowerCase();
  if (ext === '.html') return servedTree.isServedHtmlRel(rel, ADMITTED_ROUTES);
  if (parts.length === 1) return PUBLIC_ROOT_FILES.has(base) || /^[a-f0-9]{64}\.txt$/i.test(base);
  return PUBLIC_EXTENSIONS.has(ext);
}
function copyFile(abs) {
  const rel = toRel(abs);
  const dest = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
}
function walk(dir, visitor) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!shouldSkipDir(abs)) walk(abs, visitor);
    } else if (ent.isFile()) visitor(abs);
  }
}
function assertDistSafe() {
  const errors = [];
  walk(DIST, (abs) => {
    const rel = path.relative(DIST, abs).replace(/\\/g, '/');
    const size = fs.statSync(abs).size;
    if (size > MAX_CLOUDFLARE_ASSET_BYTES) errors.push(`oversized_asset:${rel}:${size}`);
    if (/^(data|content|scripts|artifacts|reports|docs|templates)\//.test(rel)) errors.push(`internal_asset_leaked:${rel}`);
    if (rel.endsWith('.html') && rel !== '404.html') {
      const route = routeForHtmlRel(rel);
      if (!route || !ADMITTED_ROUTES.has(route)) errors.push(`unadmitted_html_in_dist:${rel}`);
    }
  });
  for (const route of ADMITTED_ROUTES) {
    const rel = renderedRelForRoute(route);
    if (!fs.existsSync(path.join(DIST, rel))) errors.push(`admitted_route_missing_from_dist:${route}:${rel}`);
  }
  if (errors.length) throw new Error(`Pages dist safety check failed:\n${errors.join('\n')}`);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
let copied = 0;
walk(ROOT, (abs) => {
  if (!isPublicFile(abs)) return;
  copyFile(abs);
  copied += 1;
});
assertDistSafe();
console.log(`Pages dist built with ${copied} declared public files; admitted routes=${ADMITTED_ROUTES.size}.`);
