#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const atlasSitemap = fs.readFileSync(path.join(ROOT,'sitemaps','sitemap_atlas.xml'),'utf8');
const clusterSitemap = fs.readFileSync(path.join(ROOT,'sitemaps','sitemap_clusters.xml'),'utf8');
const insightSitemap = fs.readFileSync(path.join(ROOT,'sitemaps','sitemap_insights.xml'),'utf8');
const map = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_to_cluster_map.json'),'utf8'));
for (const [vertical, meta] of Object.entries(reg)) {
  if (!atlasSitemap.includes(meta.atlas_path)) throw new Error(`Atlas sitemap missing ${meta.atlas_path}`);
  for (const cmeta of Object.values(meta.clusters || {})) {
    if (!clusterSitemap.includes(cmeta.path)) throw new Error(`Cluster sitemap missing ${cmeta.path}`);
  }
}
for (const item of map) {
  if (!insightSitemap.includes(item.publish_path)) throw new Error(`Insights sitemap missing ${item.publish_path}`);
}
console.log('Atlas/cluster sitemap validation passed.');
