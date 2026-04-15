#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_to_cluster_map.json'),'utf8'));
const insightsDir = path.join(ROOT, 'insights');
if (!Array.isArray(map) || !map.length) throw new Error('query_to_cluster_map.json is empty');

const seenPublishPaths = new Set();
for (const item of map) {
  if (!item.publish_path || !item.vertical || !item.cluster) {
    throw new Error(`Missing publish_path/vertical/cluster in mapping entry: ${JSON.stringify(item)}`);
  }
  if (seenPublishPaths.has(item.publish_path)) throw new Error(`Duplicate mapping for ${item.publish_path}`);
  seenPublishPaths.add(item.publish_path);
  if (!reg[item.vertical]) throw new Error(`Unknown vertical ${item.vertical} in mapping`);
  if (!reg[item.vertical].clusters[item.cluster]) throw new Error(`Unknown cluster ${item.vertical}/${item.cluster} in mapping`);
  const expectedAtlasPath = reg[item.vertical].atlas_path;
  if (item.atlas_path !== expectedAtlasPath) throw new Error(`Mapping atlas_path mismatch for ${item.publish_path}: expected ${expectedAtlasPath} got ${item.atlas_path}`);
  const htmlPath = path.join(ROOT, item.publish_path.replace(/^\//,''));
  if (!fs.existsSync(htmlPath)) throw new Error(`Mapped insight page missing on disk: ${item.publish_path}`);
}

const onDiskInsights = fs.readdirSync(insightsDir)
  .filter((name) => name.endsWith('.html') && name !== 'index.html')
  .map((name) => `/insights/${name}`);

const unmappedInsights = onDiskInsights.filter((publishPath) => !seenPublishPaths.has(publishPath));
if (unmappedInsights.length) {
  throw new Error(`Unmapped insight pages found (${unmappedInsights.length}). First examples: ${unmappedInsights.slice(0, 10).join(', ')}`);
}

const mappedButMissing = [...seenPublishPaths].filter((publishPath) => !onDiskInsights.includes(publishPath));
if (mappedButMissing.length) {
  throw new Error(`Mapped insight pages not present in /insights (${mappedButMissing.length}). First examples: ${mappedButMissing.slice(0, 10).join(', ')}`);
}

console.log(`Cluster membership validation passed (${map.length} mapped query pages, ${onDiskInsights.length} insight pages on disk).`);
