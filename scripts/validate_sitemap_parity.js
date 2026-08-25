#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, PUBLISHED_URLS_PATH, loadJson } = require('./lib/publish_contract');

const SITEMAP_ALL = path.join(ROOT, 'sitemaps', 'sitemap_all.xml');
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
if (!fs.existsSync(SITEMAP_ALL)) fail('Missing sitemaps/sitemap_all.xml');
if (process.exitCode) process.exit(1);

const inventory = loadJson(PUBLISHED_URLS_PATH);
const invUrls = (inventory.items || []).map(i => i.url).filter(Boolean).sort();
const sitemapUrls = parseLocs(fs.readFileSync(SITEMAP_ALL, 'utf8')).sort();

const invSet = new Set(invUrls);
const siteSet = new Set(sitemapUrls);
for (const url of invUrls) {
  if (!siteSet.has(url)) fail(`crawlable URL missing from sitemap_all.xml: ${url}`);
  if (!url.startsWith(HOST + '/')) fail(`published inventory URL is off-host: ${url}`);
  const filePath = urlToFile(url);
  if (!fs.existsSync(filePath)) fail(`published inventory URL missing local file: ${url} -> ${path.relative(ROOT, filePath)}`);
}
for (const url of sitemapUrls) {
  if (!invSet.has(url)) fail(`sitemap_all.xml URL absent from published inventory: ${url}`);
}
if (!process.exitCode) console.log(`Sitemap parity validation passed (${invUrls.length} URLs).`);
