#!/usr/bin/env node
'use strict';
/**
 * Put favicon, web-manifest and social-card head tags on every page in dist/.
 *
 * Purpose:
 * - /favicon.ico answered 404 and no page carried og:image (measured 10 Oct
 *   2026). The files themselves are committed at the repo root and published by
 *   scripts/build_pages_dist.js from data/seo/site_brand_assets.json; this adds
 *   the tags that point at them.
 *
 * Notes:
 * - Runs on dist/ after build_pages_dist.js, in the same position as
 *   install_clarity.js, so frozen accepted HTML at the repo root is never
 *   touched: the tags are a publish-time layer over frozen bytes.
 * - Fails (exit 1) when a brand file is missing from dist/ or no page exists.
 * - Idempotent: pages already carrying the marker are left alone.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKER = 'data-site-head-assets';

function die(msg) {
  console.error(`site-head-assets: ${msg}`);
  process.exit(1);
}

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) die(`missing ${rel}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function headBlock(host, b, og) {
  const base = `https://${host}`;
  const alt = escAttr(`${b.name} - ${b.tagline}`);
  return [
    `<link rel="icon" href="/favicon.ico" sizes="any" ${MARKER} />`,
    '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '<link rel="manifest" href="/site.webmanifest" />',
    `<meta name="theme-color" content="${escAttr(b.background)}" />`,
    `<meta property="og:image" content="${base}${og.path}" />`,
    `<meta property="og:image:secure_url" content="${base}${og.path}" />`,
    '<meta property="og:image:type" content="image/png" />',
    `<meta property="og:image:width" content="${og.width}" />`,
    `<meta property="og:image:height" content="${og.height}" />`,
    `<meta property="og:image:alt" content="${alt}" />`,
    `<meta name="twitter:image" content="${base}${og.path}" />`,
    `<meta name="twitter:image:alt" content="${alt}" />`,
  ].join('\n');
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function install(html, block) {
  if (html.includes(MARKER)) return null;
  const idx = html.search(/<\/head>/i);
  if (idx < 0) return null;
  let head = html.slice(0, idx);
  const rest = html.slice(idx);
  head = head.replace(/<meta name="twitter:card" content="summary"\s*\/?>/i, '<meta name="twitter:card" content="summary_large_image" />');
  // A page that already declares its own og:image keeps it; only icons are added.
  const lines = /property="og:image"/i.test(head)
    ? block.split('\n').filter((l) => !/og:image|twitter:image/.test(l)).join('\n')
    : block;
  return head + lines + '\n' + rest;
}

function main() {
  const site = readJson('data/site.json');
  site.siteUrl = site.base_url;
  const cfg = readJson('data/seo/site_brand_assets.json');
  const host = String(site.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
  const b = (cfg.hosts || {})[host];
  if (!b) {
    die(`no brand set for host "${host}" in data/seo/site_brand_assets.json`);
  }
  const outDir = path.resolve(ROOT, process.env.PAGES_OUT_DIR || 'dist');
  if (!fs.existsSync(outDir)) die(`output root ${outDir} not found`);
  for (const f of cfg.files) if (!fs.existsSync(path.join(outDir, f))) die(`${f} missing from ${path.relative(ROOT, outDir)}/; build_pages_dist.js publishes it from data/seo/site_brand_assets.json`);

  const block = headBlock(host, b, cfg.og);
  const pages = walk(outDir, []);
  if (!pages.length) die(`no pages under ${outDir}`);
  let changed = 0;
  for (const p of pages) {
    const next = install(fs.readFileSync(p, 'utf8'), block);
    if (next !== null) { fs.writeFileSync(p, next); changed += 1; }
  }
  console.log(`site-head-assets: ${host} files=${cfg.files.length} pages=${pages.length} tagged=${changed}`);
  installRankedLinks(outDir);
}

// Publish-time homepage block linking the pages that rank (position <= 15 with
// impressions), from data/search_intelligence/strengthened_pages.json. Same layer
// as the head tags: the frozen accepted bytes of index.html stay untouched.
const RANKED_MARKER = 'data-search-ranked-links="true"';
function rankedLinksBlock(pages) {
  return '<section class="homepage-section search-ranked-links" ' + RANKED_MARKER + '><div class="section-label">Read in search</div><h2>Guides readers find in search</h2><ul>' +
    pages.map((p) => '<li><a href="' + escAttr(p.route) + '">' + escAttr(p.title) + '</a></li>').join('') + '</ul></section>';
}
function installRankedLinks(outDir) {
  const reg = readJson('data/search_intelligence/strengthened_pages.json');
  if (!Array.isArray(reg.pages) || !reg.pages.length) die('data/search_intelligence/strengthened_pages.json lists no page');
  const home = path.join(outDir, 'index.html');
  const html = fs.readFileSync(home, 'utf8');
  if (html.includes(RANKED_MARKER)) return;
  const at = html.search(/<\/main>/i);
  if (at < 0) die('dist/index.html has no </main> for the ranked-links block');
  fs.writeFileSync(home, html.slice(0, at) + rankedLinksBlock(reg.pages) + html.slice(at));
  console.log(`site-head-assets: homepage links ${reg.pages.length} ranked page(s)`);
}

if (require.main === module) main();
module.exports = { install, headBlock, MARKER, RANKED_MARKER, rankedLinksBlock };
