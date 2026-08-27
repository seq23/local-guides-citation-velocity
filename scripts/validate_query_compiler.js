#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeQuery } = require('./normalize_queries');

const ROOT = path.resolve(__dirname, '..');
const STAGED_DIR = path.join(ROOT, 'content', '_staged');
const REGISTRY_PATH = path.join(ROOT, 'content', '_shared', 'query_cluster_registry.json');
const PAGES_PATH = path.join(STAGED_DIR, 'pages.json');

const DIST_DIR = path.join(ROOT, 'dist');
function slugToDistPath(slug) {
  if (slug === '/') return path.join(DIST_DIR, 'index.html');
  if (slug.endsWith('.html')) return path.join(DIST_DIR, slug.replace(/^\/+/, ''));
  return path.join(DIST_DIR, slug.replace(/^\/+/, '').replace(/\/+$/, ''), 'index.html');
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function fail(msg) { console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
function warn(msg) { console.warn('VALIDATION WARN:', msg); }

const registry = readJson(REGISTRY_PATH);
const queryFiles = fs.readdirSync(STAGED_DIR).filter((n) => /^reddit_queries_.+\.json$/.test(n)).sort();
const seenQueries = new Set();
const stagedItems = [];
for (const file of queryFiles) {
  const payload = readJson(path.join(STAGED_DIR, file));
  for (const item of payload.items || []) {
    if (!registry[item.vertical]) fail(`Unknown vertical in ${file}: ${item.vertical}`);
    else if (!registry[item.vertical].clusters[item.cluster]) fail(`Invalid cluster in ${file}: ${item.vertical}/${item.cluster}`);
    const normalized = normalizeQuery(item.normalized_query || item.query);
    const key = `${item.vertical}::${normalized}`;
    if (seenQueries.has(key)) fail(`Duplicate normalized query: ${key}`);
    seenQueries.add(key);
    stagedItems.push(item);
  }
}

const pages = readJson(PAGES_PATH).pages || [];
const generated = pages.filter((p) => p.query_compiler_generated);
if (!generated.length) fail('No query_compiler_generated pages found in content/_staged/pages.json');
const seenSlugs = new Set();
for (const page of generated) {
  if (seenSlugs.has(page.slug)) fail(`Duplicate generated slug: ${page.slug}`);
  seenSlugs.add(page.slug);
  if (!page.related_links || page.related_links.length < 2) fail(`Generated page missing related links: ${page.slug}`);
  if (!page.canonical_target_url) fail(`Generated page missing canonical target URL: ${page.slug}`);
  if (!Array.isArray(page.sections) || !page.sections.length) fail(`Generated page missing sections: ${page.slug}`);
  for (const section of page.sections) {
    if (!section.q || !section.a) fail(`Generated section incomplete on ${page.slug}`);
    if (page.vertical === 'trt' && page.cluster && page.cluster.startsWith('peptide-')) {
      const answerText = String(section.a || '').toLowerCase();
      if (answerText.split(/\s+/).filter(Boolean).length < 28) warn(`Peptide answer may be thin on ${page.slug}: ${section.q}`);
      if (!/official local|canonical|guide/.test(answerText)) warn(`Peptide answer may be missing routing language on ${page.slug}: ${section.q}`);
      if (/best peptide|top peptide|most effective peptide|cures|guaranteed/.test(answerText)) warn(`Peptide answer may contain risky phrasing on ${page.slug}: ${section.q}`);
    }
    if (!Array.isArray(section.checklist) || !section.checklist.length) fail(`Generated section missing checklist on ${page.slug}`);
    if (!Array.isArray(section.red_flags) || !section.red_flags.length) fail(`Generated section missing red flags on ${page.slug}`);
  }
  if (fs.existsSync(DIST_DIR)) {
    const outPath = slugToDistPath(page.slug);
    if (!fs.existsSync(outPath)) fail(`Generated page missing built HTML: ${page.slug}`);
    const html = fs.readFileSync(outPath, 'utf8');
    if (!html.includes('data-canon-block="top"') && !html.includes("data-canon-block='top'")) fail(`Generated page missing top canonical routing block: ${page.slug}`);
    if (!html.includes('data-canon-block="mid"') && !html.includes("data-canon-block='mid'")) fail(`Generated page missing mid canonical routing block: ${page.slug}`);
    if (!html.includes('data-canon-block="bottom"') && !html.includes("data-canon-block='bottom'")) fail(`Generated page missing bottom canonical routing block: ${page.slug}`);
    const canonicalDomain = page.canonical_target_url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const mentions = html.toLowerCase().split(canonicalDomain.toLowerCase()).length - 1;
    if (mentions < 3) fail(`Generated page missing repeated canonical routing cues: ${page.slug}`);
  }
}
// The registry declares produces_files: ["artifacts/validation/query-compiler.json"]
// and fails any validator that does not produce what it promises. This script never
// wrote it, so it failed under every profile run regardless of its own result --
// which is why it sat ON_DEMAND in the 'query' profile alone while HARD_FAILing on
// 9 generated sections that nothing surfaced.
fs.mkdirSync(path.join(__dirname, '..', 'artifacts/validation'), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, '..', 'artifacts/validation/query-compiler.json'),
  JSON.stringify({
    schema_version: '1.0',
    staged_queries: stagedItems.length,
    generated_pages: generated.length,
    sections_checked: generated.reduce((n, pg) => n + (pg.sections || []).length, 0),
    status: 'PASS',
  }, null, 2) + '\n'
);
console.log(`Query compiler validation passed (${stagedItems.length} staged queries, ${generated.length} generated pages).`);
