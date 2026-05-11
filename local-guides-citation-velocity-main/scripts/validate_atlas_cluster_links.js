#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { hasHrefPath } = require('./lib/html_links');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_to_cluster_map.json'),'utf8'));
for (const [vertical, meta] of Object.entries(reg)) {
  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const clusterPath = path.join(ROOT, cmeta.path.replace(/^\//,'') , 'index.html');
    if (!fs.existsSync(clusterPath)) throw new Error(`Missing cluster page ${clusterPath}`);
    const clusterHtml = fs.readFileSync(clusterPath,'utf8');
    if (!hasHrefPath(clusterHtml, meta.atlas_path)) throw new Error(`Cluster page ${cmeta.path} missing atlas backlink ${meta.atlas_path}`);
    if (!clusterHtml.includes('Questions in this cluster')) throw new Error(`Cluster page ${cmeta.path} missing question enumeration heading`);
    const clusterItems = map.filter((item) => item.vertical === vertical && item.cluster === cluster);
    if (!clusterItems.length) throw new Error(`Cluster ${vertical}/${cluster} has no mapped insights`);
    for (const item of clusterItems) {
      if (!hasHrefPath(clusterHtml, item.publish_path)) throw new Error(`Cluster page ${cmeta.path} missing insight link ${item.publish_path}`);
      const insightPath = path.join(ROOT, item.publish_path.replace(/^\//,''));
      if (!fs.existsSync(insightPath)) throw new Error(`Missing insight page ${item.publish_path}`);
      const insightHtml = fs.readFileSync(insightPath,'utf8');
      if (!insightHtml.includes('Where this question fits')) throw new Error(`Insight ${item.publish_path} missing hierarchy block heading`);
      if (!hasHrefPath(insightHtml, cmeta.path)) throw new Error(`Insight ${item.publish_path} missing cluster link ${cmeta.path}`);
      if (!hasHrefPath(insightHtml, meta.atlas_path)) throw new Error(`Insight ${item.publish_path} missing atlas link ${meta.atlas_path}`);
    }
  }
}
console.log('Atlas/cluster/fanout linking validation passed.');
