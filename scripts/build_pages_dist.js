#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024;

const INTERNAL_DIRS = new Set([
  '.build',
  '.cache',
  '.git',
  '.github',
  '.wrangler',
  'artifacts',
  'content',
  'data',
  'distribution_scripts',
  'docs',
  'logs',
  'node_modules',
  'reports',
  'scripts',
  'staging',
  'templates',
  'tmp'
]);

const PUBLIC_ROOT_FILES = new Set([
  '404.html',
  '_headers',
  '_redirects',
  'about.html',
  'disclaimer.html',
  'feed.json',
  'feed.xml',
  'humans.txt',
  'index.html',
  'indexnow.txt',
  'llms-full.txt',
  'llms.txt',
  'methodology.html',
  'privacy.html',
  'robots.txt',
  'sitemap.xml',
  'terms.html'
]);

const PUBLIC_EXTENSIONS = new Set([
  '.avif',
  '.css',
  '.gif',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.map',
  '.pdf',
  '.png',
  '.svg',
  '.txt',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
  '.xml'
]);

function toRel(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function shouldSkipDir(abs) {
  if (abs === DIST) return true;
  const rel = toRel(abs);
  if (!rel) return false;
  const first = rel.split('/')[0];
  if (rel === '.well-known') return false;
  return INTERNAL_DIRS.has(first);
}

function isPublicFile(abs) {
  const rel = toRel(abs);
  const parts = rel.split('/');
  const base = path.basename(rel);
  if (parts.length === 1) return PUBLIC_ROOT_FILES.has(base) || /^[a-f0-9]{64}\.txt$/i.test(base);
  const ext = path.extname(base).toLowerCase();
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
    } else if (ent.isFile()) {
      visitor(abs);
    }
  }
}

function assertDistSafe() {
  const errors = [];
  walk(DIST, (abs) => {
    const rel = path.relative(DIST, abs).replace(/\\/g, '/');
    const size = fs.statSync(abs).size;
    if (size > MAX_CLOUDFLARE_ASSET_BYTES) errors.push(`oversized_asset:${rel}:${size}`);
    if (/^(data|content|scripts|artifacts|reports|docs|templates)\//.test(rel)) {
      errors.push(`internal_asset_leaked:${rel}`);
    }
  });
  if (errors.length) {
    throw new Error(`Pages dist safety check failed:\n${errors.join('\n')}`);
  }
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
console.log(`Pages dist built with ${copied} public files.`);
