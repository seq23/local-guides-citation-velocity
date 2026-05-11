#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'content', '_live', 'insights.json');
const PAGES = path.join(ROOT, 'content', '_live', 'pages.json');
const REGISTRY = path.join(ROOT, 'content', '_shared', 'query_cluster_registry.json');

function fail(msg) { console.error(`INSIGHTS MANIFEST FAIL: ${msg}`); process.exitCode = 1; }
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { fail(`${path.relative(ROOT, p)} is not valid JSON: ${err.message}`); return null; }
}
function slugify(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
function sentenceCase(s) {
  const text = String(s || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
function expectedInsightPaths() {
  const { buildInsightInventory } = require('../lib/publish_contract');
  return buildInsightInventory().map((item) => item.publish_path).sort();
}


const raw = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
if (!raw.trim().startsWith('{') || !raw.trim().endsWith('}')) fail('content/_live/insights.json must be a complete JSON object; file appears truncated or corrupted');
const manifest = readJson(MANIFEST);
if (!manifest) process.exit(1);
if (manifest.policy !== 'insights are generated only from content/_live/pages.json inventory; folder walking is forbidden.') {
  fail('manifest policy is missing or changed; insights.json must remain generated from content/_live/pages.json only');
}
if (!Array.isArray(manifest.items)) fail('manifest.items must be an array');
const items = Array.isArray(manifest.items) ? manifest.items : [];
if (manifest.released_count !== items.length) fail(`released_count ${manifest.released_count} does not equal items.length ${items.length}`);
if (manifest.total !== items.length) fail(`total ${manifest.total} does not equal items.length ${items.length}`);
const seenPaths = new Set();
const required = ['slug','vertical','cluster','source_route','cluster_path','atlas_path','canonical_domain','title','description','publish_path','archive_path'];
for (const [idx, item] of items.entries()) {
  if (!item || typeof item !== 'object') { fail(`items[${idx}] must be an object`); continue; }
  for (const key of required) if (!item[key]) fail(`${item.publish_path || `items[${idx}]`} missing required key: ${key}`);
  if (!String(item.publish_path || '').startsWith('/insights/') || !String(item.publish_path || '').endsWith('.html')) fail(`${item.publish_path || `items[${idx}]`} has invalid publish_path`);
  if (seenPaths.has(item.publish_path)) fail(`duplicate publish_path in manifest: ${item.publish_path}`);
  seenPaths.add(item.publish_path);
  const htmlPath = path.join(ROOT, String(item.publish_path).replace(/^\//, ''));
  if (!fs.existsSync(htmlPath)) fail(`manifest item missing rendered HTML: ${item.publish_path}`);
}
const actualPaths = items.map((x) => x.publish_path).sort();
const expectedPaths = expectedInsightPaths();
const actualHash = crypto.createHash('sha256').update(actualPaths.join('\n')).digest('hex');
const expectedHash = crypto.createHash('sha256').update(expectedPaths.join('\n')).digest('hex');
if (actualHash !== expectedHash) {
  const actualSet = new Set(actualPaths);
  const expectedSet = new Set(expectedPaths);
  const extra = actualPaths.filter((p) => !expectedSet.has(p)).slice(0, 20);
  const missing = expectedPaths.filter((p) => !actualSet.has(p)).slice(0, 20);
  fail(`manifest drift from content/_live/pages.json. missing=${missing.length ? missing.join(', ') : 'none'} extra=${extra.length ? extra.join(', ') : 'none'}`);
}
if (!process.exitCode) console.log(`Insights manifest validation passed (${items.length} deterministic items).`);
process.exit(process.exitCode || 0);
