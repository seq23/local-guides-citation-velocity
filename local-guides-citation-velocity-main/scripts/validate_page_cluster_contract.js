#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const inventories = [
  path.join(ROOT,'content','_live','pages.json'),
  path.join(ROOT,'content','_staged','pages.json')
];
const pathToExpected = new Map();
for (const meta of Object.values(reg)) {
  for (const [clusterSlug, clusterMeta] of Object.entries(meta.clusters || {})) {
    if (clusterMeta && clusterMeta.path) pathToExpected.set(clusterMeta.path, clusterSlug);
  }
}
let checked = 0;
for (const inv of inventories) {
  const data = JSON.parse(fs.readFileSync(inv,'utf8'));
  for (const page of (data.pages || [])) {
    const expected = pathToExpected.get(page.slug);
    if (!expected) continue;
    checked += 1;
    if (page.cluster !== expected) {
      throw new Error(`${path.relative(ROOT, inv)} page ${page.slug} must declare cluster=${expected} (got ${page.cluster || 'null'})`);
    }
  }
}
console.log(`Page cluster contract passed (${checked} cluster path pages checked).`);
