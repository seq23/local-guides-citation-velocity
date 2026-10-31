#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, PUBLISHED_URLS_PATH, loadJson } = require('./lib/publish_contract');

const { readSitemapChildren } = require('./lib/sitemap_children');
const HOST = 'https://theindustryguides.com';

function fail(msg) { console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
function parseLocs(xml) {
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}
function urlToFile(url) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('/')) return path.join(ROOT, pathname.replace(/^\//, ''), 'index.html');
  const direct = path.join(ROOT, pathname.replace(/^\//, ''));
  if (fs.existsSync(direct)) return direct;
  // Public URLs are extensionless because Cloudflare Pages serves `foo.html` at
  // `/foo` and 308-redirects the `.html` form. The rendered file keeps its
  // extension, so resolve `/insights/foo` back to `insights/foo.html`, and fall
  // back to a directory index for `/foo` -> `foo/index.html`.
  const withHtml = `${direct}.html`;
  if (fs.existsSync(withHtml)) return withHtml;
  const asIndex = path.join(direct, 'index.html');
  if (fs.existsSync(asIndex)) return asIndex;
  return withHtml;
}

if (!fs.existsSync(PUBLISHED_URLS_PATH)) fail('Missing content/_live/published_urls.json');
// The published set is the union of the children sitemap.xml names, and the
// children are a PARTITION: each URL in exactly one (Ahrefs, 14 Oct 2026: 448 pages
// "in multiple sitemaps" while sitemap_all.xml repeated every split child).
const sm = readSitemapChildren(ROOT);
if (!sm.children.length) fail('sitemap.xml names zero child sitemaps');
for (const rel of sm.missing) fail(`sitemap.xml names ${rel}, which does not exist`);
for (const rel of sm.unindexed) fail(`${rel} is on disk (and served) but sitemap.xml does not name it - a stale or catch-all sitemap`);
for (const d of sm.duplicates) fail(`URL listed in ${d.files.length} sitemaps (${d.files.join(', ')}): ${d.url}`);
if (process.exitCode) process.exit(1);

const inventory = loadJson(PUBLISHED_URLS_PATH);
const invUrls = (inventory.items || []).map(i => i.url).filter(Boolean).sort();
const sitemapUrls = sm.urls;
if (!sitemapUrls.length) fail('the sitemap children list zero URLs');

const invSet = new Set(invUrls);
const siteSet = new Set(sitemapUrls);
for (const url of invUrls) {
  if (!siteSet.has(url)) fail(`crawlable URL missing from every sitemap child: ${url}`);
  if (!url.startsWith(HOST + '/')) fail(`published inventory URL is off-host: ${url}`);
  const filePath = urlToFile(url);
  if (!fs.existsSync(filePath)) fail(`published inventory URL missing local file: ${url} -> ${path.relative(ROOT, filePath)}`);
  else {
    // Inventory and sitemap share a producer, so agreeing with each other is
    // insufficient: compare the URL to the actual rendered canonical too.
    const html = fs.readFileSync(filePath, 'utf8');
    const tag = (html.match(/<link\b[^>]*>/gi) || []).find((value) => /\brel=(["'])canonical\1/i.test(value));
    const canonical = tag?.match(/\bhref=(["'])(.*?)\1/i)?.[2];
    if (canonical !== url) fail(`sitemap URL is not self-canonical: ${url} -> ${canonical || '(missing)'}`);
  }
}
for (const url of sitemapUrls) {
  if (!invSet.has(url)) fail(`sitemap URL absent from published inventory: ${url}`);
}

// Parity with the sitemap is only half the question. The other half is whether a
// route the release lane released can reach a sitemap at all: the registry that
// decides is built from published_urls.json, which is built from what the
// registry admits, so a released page can render as indexable HTML and be named
// by no sitemap child, no feed and no llms export. That rule lives in
// scripts/validators/validate_admission_reachability.js, which was RETIRED with
// an empty `profiles` list - a guard nothing ran. Thirteen /medium-articles/
// routes sat in that gap from the 2026-06-19 baseline until 31 October 2026:
// /medium/ linked every one of them, build_pages_dist.js copies admitted routes
// only, so each published link answered 404 on the live site.
//
// Folded in here rather than registered as its own blocker because the release
// profile is capped at 40 HARD_FAILs on purpose (CLAUDE.md, "The merge gate"),
// and "a released page no sitemap can name" is a sitemap-parity defect by any
// reading. Running it as a child keeps that file the single statement of the
// rule instead of a second copy drifting here.
const { spawnSync } = require('child_process');
const reach = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'validators', 'validate_admission_reachability.js')], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(reach.stdout || '');
if (reach.status !== 0) {
  process.stderr.write(reach.stderr || '');
  fail('released-page admission reachability failed (see above): a released, rendered, non-retired route is absent from data/content/page_admission_registry.json, so no sitemap child can name it. Rebuild the registry (node scripts/build_page_admission_registry_2026_06_19.js), retire the route with a 301, or hold it back with publication_status EVIDENCE_ONLY.');
}

if (!process.exitCode) console.log(`Sitemap parity validation passed (${invUrls.length} URLs across ${sm.children.length} child sitemaps, each URL in exactly one).`);
