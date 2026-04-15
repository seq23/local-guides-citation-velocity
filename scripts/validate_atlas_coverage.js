#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const atlas = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','atlas_registry.json'),'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_to_cluster_map.json'),'utf8'));

for (const [vertical, meta] of Object.entries(reg)) {
  if (!atlas[vertical]) throw new Error(`Missing atlas registry entry for ${vertical}`);
  const atlasMeta = atlas[vertical];
  if (atlasMeta.atlas_path !== meta.atlas_path) throw new Error(`Atlas path mismatch for ${vertical}`);
  const expectedClusterCount = Object.keys(meta.clusters || {}).length;
  const expectedQueryCount = map.filter((item) => item.vertical === vertical).length;
  if (atlasMeta.total_clusters !== expectedClusterCount) throw new Error(`Atlas total_clusters mismatch for ${vertical}: expected ${expectedClusterCount} got ${atlasMeta.total_clusters}`);
  if (atlasMeta.total_queries !== expectedQueryCount) throw new Error(`Atlas total_queries mismatch for ${vertical}: expected ${expectedQueryCount} got ${atlasMeta.total_queries}`);
  const atlasPath = path.join(ROOT, 'atlas', meta.base_path, 'index.html');
  if (!fs.existsSync(atlasPath)) throw new Error(`Missing atlas page ${atlasPath}`);
  const html = fs.readFileSync(atlasPath,'utf8');
  if (!html.includes(`Total clusters:</strong> ${expectedClusterCount}`)) throw new Error(`Atlas ${vertical} missing rendered total cluster count ${expectedClusterCount}`);
  if (!html.includes(`Total mapped query pages:</strong> ${expectedQueryCount}`)) throw new Error(`Atlas ${vertical} missing rendered total query count ${expectedQueryCount}`);
  for (const [clusterSlug, clusterMeta] of Object.entries(meta.clusters || {})) {
    if (!html.includes(clusterMeta.path)) throw new Error(`Atlas ${vertical} missing cluster link ${clusterMeta.path}`);
    if (!atlasMeta.clusters.find((item) => item.slug === clusterSlug && item.path === clusterMeta.path)) {
      throw new Error(`Atlas registry ${vertical} missing cluster metadata for ${clusterSlug}`);
    }
  }
}
console.log(`Atlas coverage validation passed (${Object.keys(reg).length} vertical atlases).`);
