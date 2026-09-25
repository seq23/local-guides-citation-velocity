#!/usr/bin/env node
'use strict';
/**
 * Every served page carries a <title> of at least MIN_TITLE_CHARS and a meta
 * description of at least MIN_DESCRIPTION_CHARS (scripts/lib/search_snippet.js - the
 * same constants the generators use, so the two cannot disagree).
 *
 * Why: Bing Webmaster, 2026-09-25 - 86 titles under 30 characters and 43
 * descriptions under 100 on theindustryguides.com, all printed by generators that
 * passed a record's short label straight into the head. The generators now fit
 * both values (renderLayout in scripts/build_site.js, the insight head in
 * scripts/lib/publish_contract.js); this proves the served pages agree.
 *
 * Severity is STRONG_WARNING by owner rule (no content blockers, 2026-09-23): a
 * short snippet is a search-quality defect, not a broken route, so it is reported
 * on every run and blocks only the strict profile. It still exits 1 when it finds
 * one, and it refuses to pass having graded nothing.
 *
 * The ceilings (70 / 160) are counted and reported, never failed: about 1,300
 * accepted pages exceed 160 and changing them is a separate, owner-scoped change.
 */
const fs = require('fs');
const path = require('path');
const { MIN_TITLE_CHARS, MAX_TITLE_CHARS, MIN_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS } = require('../lib/search_snippet');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'artifacts', 'validation', 'search-snippet-floors.json');
// Measured 2026-09-25: 2,112 sitemap routes. The floor is far below that and far
// above what a truncated tree exposes.
const MIN_PAGES = 1500;

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function sitemapPaths() {
  const files = ['sitemap.xml'];
  const dir = path.join(ROOT, 'sitemaps');
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (n.endsWith('.xml')) files.push(path.join('sitemaps', n));
  const out = new Set();
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    for (const m of fs.readFileSync(abs, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const p = m[1].replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0] || '/';
      if (!p.endsWith('.xml')) out.add(p);
    }
  }
  return [...out].sort();
}

function fileFor(route) {
  const rel = route.replace(/^\/+/, '');
  const candidates = rel === '' ? ['index.html']
    : [rel, `${rel.replace(/\/$/, '')}/index.html`, `${rel.replace(/\/$/, '')}.html`];
  return candidates.map((c) => path.join(ROOT, c)).find((abs) => fs.existsSync(abs) && fs.statSync(abs).isFile()) || null;
}

const errors = [];
const unresolved = [];
let graded = 0;
let titlesOverCeiling = 0;
let descriptionsOverCeiling = 0;
for (const route of sitemapPaths()) {
  const abs = fileFor(route);
  if (!abs) { unresolved.push(route); continue; }
  const html = fs.readFileSync(abs, 'utf8');
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const tag = (html.match(/<meta\b[^>]*>/gi) || []).find((t) => /\bname=(["'])description\1/i.test(t)) || '';
  const desc = decode((tag.match(/\bcontent=(["'])([\s\S]*?)\1/i) || [])[2]);
  graded += 1;
  if (title.length < MIN_TITLE_CHARS) errors.push({ route, issue: 'title_below_floor', length: title.length, min: MIN_TITLE_CHARS, value: title });
  if (desc.length < MIN_DESCRIPTION_CHARS) errors.push({ route, issue: 'description_below_floor', length: desc.length, min: MIN_DESCRIPTION_CHARS, value: desc });
  if (title.length > MAX_TITLE_CHARS) titlesOverCeiling += 1;
  if (desc.length > MAX_DESCRIPTION_CHARS) descriptionsOverCeiling += 1;
}

const stops = [];
if (graded < MIN_PAGES) stops.push(`only ${graded} served page(s) graded; expected at least ${MIN_PAGES}. The sitemap is missing or the tree is unbuilt, so nothing was proven.`);
const report = {
  validator: 'search-snippet-floors',
  ok: !errors.length && !stops.length,
  graded_pages: graded,
  floors: { title_min: MIN_TITLE_CHARS, description_min: MIN_DESCRIPTION_CHARS },
  ceilings_reported_not_failed: { title_max: MAX_TITLE_CHARS, description_max: MAX_DESCRIPTION_CHARS, titles_over: titlesOverCeiling, descriptions_over: descriptionsOverCeiling },
  unresolved_sitemap_routes: unresolved.length,
  error_count: errors.length,
  stops,
  errors
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
if (stops.length) {
  console.error('SEARCH SNIPPET FLOORS: STOP');
  for (const s of stops) console.error(`- ${s}`);
  process.exit(1);
}
if (errors.length) {
  console.error(`SEARCH SNIPPET FLOORS: ${errors.length} served page(s) below the floor. Fix the generator (scripts/lib/search_snippet.js callers) or the page's source record, never the rendered page.`);
  for (const e of errors.slice(0, 50)) console.error(`- ${e.route}: ${e.issue} (${e.length} < ${e.min}) "${e.value}"`);
  process.exit(1);
}
console.log(`SEARCH SNIPPET FLOORS PASS: ${graded} served pages; every title >= ${MIN_TITLE_CHARS} and description >= ${MIN_DESCRIPTION_CHARS} characters (reported, not failed: ${titlesOverCeiling} titles > ${MAX_TITLE_CHARS}, ${descriptionsOverCeiling} descriptions > ${MAX_DESCRIPTION_CHARS}).`);
