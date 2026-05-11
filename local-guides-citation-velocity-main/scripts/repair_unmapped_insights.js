#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REG_PATH = 'content/_shared/query_cluster_registry.json';
const MAP_PATH = 'content/_shared/query_to_cluster_map.json';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.html')) out.push(full);
  }
  return out;
}

const registry = readJson(REG_PATH);
const map = readJson(MAP_PATH);
const mapped = new Set(map.map(x => x.publish_path));

const verticals = Object.entries(registry)
  .map(([key, meta]) => ({
    key,
    base: meta.base_path || key.replace(/_/g, '-'),
    meta,
    clusters: Object.keys(meta.clusters || {}).sort((a, b) => b.length - a.length)
  }))
  .sort((a, b) => b.base.length - a.base.length);

let added = 0;
const failed = [];

for (const file of walk('insights')) {
  if (file === 'insights/index.html') continue;

  const publishPath = '/' + file.replace(/\\/g, '/');
  if (mapped.has(publishPath)) continue;

  const slug = path.basename(file, '.html');
  const vertical = verticals.find(v => slug.startsWith(v.base + '-'));

  if (!vertical) {
    failed.push(`${publishPath} :: could not infer vertical`);
    continue;
  }

  const rest = slug.slice(vertical.base.length + 1);

  let cluster = vertical.clusters.find(c => rest === c || rest.startsWith(c + '-'));

  if (!cluster && vertical.meta.clusters?.[vertical.base]) {
    cluster = vertical.base;
  }

  if (!cluster) {
    failed.push(`${publishPath} :: could not infer cluster for vertical=${vertical.key}`);
    continue;
  }

  const cmeta = vertical.meta.clusters[cluster] || {};
  const query = rest
    .replace(new RegExp('^' + cluster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-'), '')
    .replace(/^\d+-/, '')
    .replace(/-/g, ' ')
    .trim();

  map.push({
    vertical: vertical.key,
    cluster,
    publish_path: publishPath,
    atlas_path: vertical.meta.atlas_path || `/atlas/${vertical.base}/`,
    source_bucket: 'daily_release',
    source_type: 'generated_insight',
    normalized_query: query || slug
  });

  mapped.add(publishPath);
  added++;
  console.log(`Mapped unmapped insight: ${publishPath} -> ${vertical.key}/${cluster}`);
}

if (failed.length) {
  console.error('Could not repair some unmapped insights:');
  failed.forEach(x => console.error('- ' + x));
  process.exit(1);
}

writeJson(MAP_PATH, map);
console.log(`repair_unmapped_insights complete: added=${added}`);
