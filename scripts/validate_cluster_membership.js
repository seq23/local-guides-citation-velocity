#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_to_cluster_map.json'),'utf8'));
if (!Array.isArray(map) || !map.length) throw new Error('query_to_cluster_map.json is empty');
for (const item of map) {
  if (!item.vertical || !item.cluster) throw new Error(`Missing vertical/cluster in mapping for ${item.publish_path}`);
  if (!reg[item.vertical]) throw new Error(`Unknown vertical ${item.vertical} in mapping`);
  if (!reg[item.vertical].clusters[item.cluster]) throw new Error(`Unknown cluster ${item.vertical}/${item.cluster} in mapping`);
}
console.log(`Cluster membership validation passed (${map.length} mapped query pages).`);
