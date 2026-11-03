#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const rescue = require('./lib/search_rescue');
const frozen = require('./lib/frozen_pages');
const { shape } = require('./lib/rescue_page_shape');
const ROOT = path.resolve(__dirname, '..');
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function directory(html, page, pages) {
  const entries = pages.filter(p => p.path !== page.path && (page.path !== '/insights/' || p.page_type === 'Insight'));
  if (!entries.length) throw new Error(`Search rescue: empty directory ${page.path}`);
  const title = page.path === '/insights/' ? 'Questions and practical decision guides' : 'Guide directory by topic';
  const body = `<main id="main-content" class="container"><h1>${title}</h1><p>This directory lists the reviewed guides currently published by The Industry Guides. Choose a specific question or a topic hub. Each editorial guide links its evidence and the appropriate next step.</p><h2>Which guide answers my question?</h2><ul>${entries.map(p => `<li><a href="${escapeHtml(p.path.replace(/\.html$/, ''))}">${escapeHtml(p.primary_query || p.path)}</a></li>`).join('')}</ul><p data-editorial-byline="true">By <a href="/about">The Industry Guides</a> · Updated <time data-review-date="true" datetime="2026-11-02">2026-11-02</time></p></main>`;
  const next = html.replace(/<main\b[^>]*>[\s\S]*?<\/main>/i, body);
  return next.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (all, start, raw, end) => {
    let data; try { data = JSON.parse(raw); } catch { return all; }
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if ([].concat(node['@type'] || []).includes('ItemList')) node.itemListElement = entries.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: 'https://theindustryguides.com' + p.path.replace(/\.html$/, ''), name: p.primary_query || p.path }));
      Object.values(node).forEach(v => Array.isArray(v) ? v.forEach(visit) : visit(v));
    }
    visit(data); return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
  });
}
function apply() {
  const admission = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content/page_admission_registry.json'), 'utf8'));
  const sources = new Map();
  for (const file of ['content/_live/pages.json', 'data/page_families/velocity_page_specs.json']) {
    for (const row of JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).pages) sources.set(row.slug || row.path, row);
  }
  const candidates = [];
  for (const page of admission.pages) {
    if (!rescue.allowed(page.path)) throw new Error(`Search rescue: unreviewed admission ${page.path}`);
    const file = path.join(ROOT, frozen.routeToRenderedRel(page.path));
    if (!fs.existsSync(file)) throw new Error(`Search rescue: missing survivor ${page.path}`);
    const current = fs.readFileSync(file, 'utf8');
    const source = sources.get(page.path);
    const description = source?.description || (current.match(/<meta\b[^>]*name="description"[^>]*content="([^"]+)"/) || [])[1];
    const published = source?.date_published || (current.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})[^\"]*"/) || [])[1];
    const isContent = page.vertical !== 'global' || page.page_type === 'Insight';
    const html = ['/insights/', '/atlas/'].includes(page.path) ? rescue.resolveLinks(directory(current, page, admission.pages)) : isContent ? shape(current, { route: page.path, description: description || page.primary_query, date: '2026-11-02', published, title: source?.title || page.primary_query }) : rescue.resolveLinks(current);
    candidates.push({ file, html, route: page.path });
  }
  // Whole-set preflight: no partial content update if a survivor is missing.
  for (const row of candidates) fs.writeFileSync(row.file, row.html);
  for (const row of candidates) frozen.freezeRoute(row.route);
  console.log(`Search rescue page shape: ${candidates.length} survivors; retained source facts and FAQ.`);
}
module.exports = { apply };
if (require.main === module) { rescue.prepare(); apply(); }
