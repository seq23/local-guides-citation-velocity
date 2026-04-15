#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const atlas = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','atlas_registry.json'),'utf8'));
for (const [vertical, meta] of Object.entries(reg)) {
  if (!atlas[vertical]) throw new Error(`Missing atlas registry entry for ${vertical}`);
  const atlasPath = path.join(ROOT, 'atlas', meta.base_path, 'index.html');
  if (!fs.existsSync(atlasPath)) throw new Error(`Missing atlas page ${atlasPath}`);
  const html = fs.readFileSync(atlasPath,'utf8');
  for (const clusterMeta of Object.values(meta.clusters || {})) {
    if (!html.includes(clusterMeta.path)) throw new Error(`Atlas ${vertical} missing cluster link ${clusterMeta.path}`);
  }
}
console.log(`Atlas coverage validation passed (${Object.keys(reg).length} vertical atlases).`);
