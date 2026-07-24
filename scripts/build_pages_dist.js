#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024;
const ADMISSION_REGISTRY = path.join(ROOT, 'data', 'content', 'page_admission_registry.json');
const admissionPayload = JSON.parse(fs.readFileSync(ADMISSION_REGISTRY, 'utf8'));
const ADMITTED_ROUTES = new Set((admissionPayload.pages || []).filter((p) => p.publication_status === 'ADMITTED').map((p) => p.path));

const INTERNAL_DIRS = new Set([
  '.build', '.cache', '.git', '.github', '.wrangler', 'artifacts', 'content', 'data',
  'distribution_scripts', 'docs', 'logs', 'node_modules', 'reports', 'scripts', 'staging',
  'templates', 'tmp'
]);

const PUBLIC_ROOT_FILES = new Set([
  '404.html', '_headers', '_redirects', 'about.html', 'disclaimer.html', 'feed.json',
  'feed.xml', 'humans.txt', 'index.html', 'indexnow.txt', 'llms-full.txt', 'llms.txt',
  'methodology.html', 'privacy.html', 'robots.txt', 'sitemap.xml', 'terms.html'
]);

const PUBLIC_EXTENSIONS = new Set([
  '.avif', '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json', '.map',
  '.pdf', '.png', '.svg', '.txt', '.webmanifest', '.webp', '.woff', '.woff2', '.xml'
]);

function toRel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function shouldSkipDir(abs) {
  if (abs === DIST) return true;
  const rel = toRel(abs);
  if (!rel) return false;
  const first = rel.split('/')[0];
  if (rel === '.well-known') return false;
  return INTERNAL_DIRS.has(first);
}
function routeForHtmlRel(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  if (rel.endsWith('.html')) return `/${rel}`;
  return null;
}
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
  if (ext === '.html') {
    if (rel === '404.html') return true;
    const route = routeForHtmlRel(rel);
    return Boolean(route && ADMITTED_ROUTES.has(route));
  }
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
