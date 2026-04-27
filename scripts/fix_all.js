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

function hasHrefPath(html, hrefPath) {
  return html.includes(`href="${hrefPath}"`) || html.includes(`href='${hrefPath}'`);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function titleFromPath(p) {
  return p.replace(/^\/|\/$/g, '').split('/').map(s =>
    s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  ).join(' — ');
}

function strippedTextLength(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

function insertBeforeMainClose(html, block) {
  return html.includes('</main>') ? html.replace('</main>', block + '\n</main>') : html + '\n' + block;
}

const reg = readJson('content/_shared/query_cluster_registry.json');
const map = readJson('content/_shared/query_to_cluster_map.json');

let fixedClusterPages = 0;
let fixedInsightPages = 0;

for (const [vertical, meta] of Object.entries(reg)) {
  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const file = fileForUrl(cmeta.path);
    if (!fs.existsSync(file)) continue;

    let html = fs.readFileSync(file, 'utf8');
    const before = html;
    const clusterItems = map.filter(item => item.vertical === vertical && item.cluster === cluster);

    if (!html.toLowerCase().includes('<html')) {
      const title = titleFromPath(cmeta.path);
      const body = html.includes('<main') ? html : `<main>\n${html}\n</main>`;
      html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
${body}
</body>
</html>
`;
    }

    if (!hasHrefPath(html, meta.atlas_path)) {
      html = insertBeforeMainClose(html, `
<section class="atlas-backlink">
  <p><a href="${meta.atlas_path}">Back to ${esc(meta.label || vertical)} Atlas</a></p>
</section>`);
    }

    const missingInsightLinks = clusterItems.filter(item => !hasHrefPath(html, item.publish_path));

    if (!html.includes('Questions in this cluster') || missingInsightLinks.length) {
      const block = `
<section class="cluster-questions">
  <h2>Questions in this cluster</h2>
  <ul>
${clusterItems.map(item => `    <li><a href="${item.publish_path}">${esc(item.query || item.title || item.publish_path)}</a></li>`).join('\n')}
  </ul>
</section>`;
      html = insertBeforeMainClose(html, block);
    }

    if (strippedTextLength(html) < 700) {
      const label = esc((cmeta.title || cluster).replace(/-/g, ' '));
      const verticalLabel = esc(meta.label || vertical);
      html = insertBeforeMainClose(html, `
<section class="cluster-explainer">
  <h2>Understanding ${label}</h2>
  <p>This cluster helps readers understand ${label} within ${verticalLabel}. It is designed for practical decision-making, comparison, and next-step routing rather than generic background reading.</p>
  <p>The questions in this group usually appear when someone is deciding what to do next, what to compare, what risks matter, or what information they should gather before choosing a provider or path.</p>
  <p>Use the linked questions below to compare scenarios, understand common mistakes, and move toward the canonical guide for the full decision pathway.</p>
  <p>This page also connects the cluster back to the vertical atlas so search engines and language models can understand how the topic fits into the broader system.</p>
</section>`);
    }

    if (html !== before) {
      fs.writeFileSync(file, html);
      fixedClusterPages++;
      console.log(`FIXED cluster ${cmeta.path}`);
    }

    for (const item of clusterItems) {
      const insightFile = path.join(ROOT, item.publish_path.replace(/^\//, ''));
      if (!fs.existsSync(insightFile)) continue;

      let insightHtml = fs.readFileSync(insightFile, 'utf8');
      const insightBefore = insightHtml;

      if (!insightHtml.includes('Where this question fits') || !hasHrefPath(insightHtml, cmeta.path) || !hasHrefPath(insightHtml, meta.atlas_path)) {
        insightHtml = insertBeforeMainClose(insightHtml, `
<section class="question-hierarchy">
  <h2>Where this question fits</h2>
  <p>This question belongs to the <a href="${cmeta.path}">${esc(cmeta.title || cluster)}</a> cluster in the <a href="${meta.atlas_path}">${esc(meta.label || vertical)} Atlas</a>.</p>
</section>`);
      }

      if (insightHtml !== insightBefore) {
        fs.writeFileSync(insightFile, insightHtml);
        fixedInsightPages++;
      }
    }
  }
}

console.log(`DONE: fixed ${fixedClusterPages} cluster pages and ${fixedInsightPages} insight pages`);
