#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function fileForUrl(urlPath) {
  return path.join(ROOT, urlPath.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
}

function readFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function hasHrefPath(html, hrefPath) {
  return html.includes(`href="${hrefPath}"`) || html.includes(`href='${hrefPath}'`);
}

function strippedTextLength(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

const errors = [];
const reg = readJson('content/_shared/query_cluster_registry.json');
const map = readJson('content/_shared/query_to_cluster_map.json');

for (const [vertical, meta] of Object.entries(reg)) {
  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const file = fileForUrl(cmeta.path);
    const html = readFile(file);

    if (!html) {
      errors.push({ type: 'missing_cluster_page', page: cmeta.path, expected: file });
      continue;
    }

    if (!html.toLowerCase().includes('<html')) {
      errors.push({ type: 'missing_html_shell', page: cmeta.path });
    }

    if (strippedTextLength(html) < 700) {
      errors.push({ type: 'thin_cluster_page', page: cmeta.path, chars: strippedTextLength(html) });
    }

    if (!hasHrefPath(html, meta.atlas_path)) {
      errors.push({ type: 'missing_atlas_backlink', page: cmeta.path, expected: meta.atlas_path });
    }

    if (!html.includes('Questions in this cluster')) {
      errors.push({ type: 'missing_question_heading', page: cmeta.path });
    }

    const clusterItems = map.filter(item => item.vertical === vertical && item.cluster === cluster);

    for (const item of clusterItems) {
      if (!hasHrefPath(html, item.publish_path)) {
        errors.push({ type: 'missing_insight_link', page: cmeta.path, expected: item.publish_path });
      }

      const insightFile = path.join(ROOT, item.publish_path.replace(/^\//, ''));
      const insightHtml = readFile(insightFile);

      if (!insightHtml) {
        errors.push({ type: 'missing_insight_page', page: item.publish_path });
        continue;
      }

      if (!insightHtml.includes('Where this question fits')) {
        errors.push({ type: 'insight_missing_hierarchy_heading', page: item.publish_path });
      }

      if (!hasHrefPath(insightHtml, cmeta.path)) {
        errors.push({ type: 'insight_missing_cluster_link', page: item.publish_path, expected: cmeta.path });
      }

      if (!hasHrefPath(insightHtml, meta.atlas_path)) {
        errors.push({ type: 'insight_missing_atlas_link', page: item.publish_path, expected: meta.atlas_path });
      }
    }
  }
}

if (!errors.length) {
  console.log('✅ audit_all passed: no repairable structural/render issues found.');
  process.exit(0);
}

console.log(`❌ audit_all found ${errors.length} issue(s):`);
for (const e of errors) {
  console.log(`${e.type} | ${e.page}${e.expected ? ' | ' + e.expected : ''}${e.chars ? ' | chars=' + e.chars : ''}`);
}
process.exit(1);
