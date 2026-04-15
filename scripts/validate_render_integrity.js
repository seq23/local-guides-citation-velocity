#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_cluster_registry.json'),'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_shared','query_to_cluster_map.json'),'utf8'));
const { hasHrefPath } = require('./lib/html_links');

function validateHtmlShell(kind, pagePath, html) {
  const low = html.toLowerCase();
  if (!low.includes('<html')) throw new Error(`${kind} ${pagePath} missing <html>`);
  if (!low.includes('<body')) throw new Error(`${kind} ${pagePath} missing <body>`);
  if (!low.includes('<main')) throw new Error(`${kind} ${pagePath} missing <main>`);
}

function strippedTextLength(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

for (const [vertical, meta] of Object.entries(reg)) {
  const atlasFile = path.join(ROOT, meta.atlas_path.replace(/^\//, ''), 'index.html');
  if (!fs.existsSync(atlasFile)) throw new Error(`Missing atlas page ${meta.atlas_path}`);
  const atlasHtml = fs.readFileSync(atlasFile, 'utf8');
  validateHtmlShell('Atlas page', meta.atlas_path, atlasHtml);
  if (strippedTextLength(atlasHtml) < 500) throw new Error(`Atlas page ${meta.atlas_path} text too thin`);
  for (const cmeta of Object.values(meta.clusters || {})) {
    if (!hasHrefPath(atlasHtml, cmeta.path)) throw new Error(`Atlas page ${meta.atlas_path} missing cluster anchor ${cmeta.path}`);
  }

  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const clusterItems = map.filter((item) => item.vertical === vertical && item.cluster === cluster);
    const clusterFile = path.join(ROOT, cmeta.path.replace(/^\//, ''), 'index.html');
    if (!fs.existsSync(clusterFile)) throw new Error(`Missing cluster page ${cmeta.path}`);
    const clusterHtml = fs.readFileSync(clusterFile, 'utf8');
    validateHtmlShell('Cluster page', cmeta.path, clusterHtml);
    if (strippedTextLength(clusterHtml) < 700) throw new Error(`Cluster page ${cmeta.path} text too thin`);
    if (!hasHrefPath(clusterHtml, meta.atlas_path)) throw new Error(`Cluster page ${cmeta.path} missing atlas anchor ${meta.atlas_path}`);
    if (!clusterItems.length) throw new Error(`Cluster ${vertical}/${cluster} has no mapped insights for render validation`);
    for (const item of clusterItems) {
      if (!hasHrefPath(clusterHtml, item.publish_path)) throw new Error(`Cluster page ${cmeta.path} missing mapped insight anchor ${item.publish_path}`);
      const insightFile = path.join(ROOT, item.publish_path.replace(/^\//, ''));
      if (!fs.existsSync(insightFile)) throw new Error(`Missing insight page ${item.publish_path}`);
      const insightHtml = fs.readFileSync(insightFile, 'utf8');
      validateHtmlShell('Insight page', item.publish_path, insightHtml);
      if (strippedTextLength(insightHtml) < 350) throw new Error(`Insight page ${item.publish_path} text too thin`);
      if (!hasHrefPath(insightHtml, cmeta.path)) throw new Error(`Insight page ${item.publish_path} missing cluster anchor ${cmeta.path}`);
      if (!hasHrefPath(insightHtml, meta.atlas_path)) throw new Error(`Insight page ${item.publish_path} missing atlas anchor ${meta.atlas_path}`);
    }
  }
}

console.log('Render integrity validation passed.');
