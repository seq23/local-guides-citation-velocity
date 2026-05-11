#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readJson(rel, fallback) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const reg = readJson('content/_shared/query_cluster_registry.json', {});
const scorecard = readJson('reports/answer_surface_scorecard.json', { ranked: [] });
const scores = new Map((scorecard.ranked || []).map(x => [`${x.vertical}/${x.cluster}`, x]));

let rows = [];

for (const [vertical, meta] of Object.entries(reg)) {
  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const key = `${vertical}/${cluster}`;
    const score = scores.get(key) || {
      vertical,
      cluster,
      total_queries: 0,
      velocity_mentions: 0,
      canonical_mentions: 0,
      competitor_mentions: 0,
      score: 0,
      status: 'not_tested'
    };

    rows.push({
      ...score,
      path: cmeta.path,
      atlas_path: meta.atlas_path
    });
  }
}

rows = rows.sort((a, b) => {
  const order = { competitor_owned: 0, not_tested: 1, unknown: 2, velocity_visible: 3, canonical_visible: 4 };
  return (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.vertical.localeCompare(b.vertical);
});

const htmlRows = rows.map(r => `
<tr>
  <td>${esc(r.vertical)}</td>
  <td><a href="${esc(r.path)}">${esc(r.cluster)}</a></td>
  <td>${esc(r.status)}</td>
  <td>${esc(r.total_queries)}</td>
  <td>${esc(r.canonical_mentions)}</td>
  <td>${esc(r.velocity_mentions)}</td>
  <td>${esc(r.competitor_mentions)}</td>
  <td>${esc(r.score)}</td>
  <td><a href="${esc(r.atlas_path)}">Atlas</a></td>
</tr>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Answer Surface Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<main>
  <h1>Answer Surface Dashboard</h1>
  <p>This dashboard tracks answer-surface visibility by vertical and cluster. Until probe results are logged, clusters show as <strong>not_tested</strong>.</p>

  <table>
    <thead>
      <tr>
        <th>Vertical</th>
        <th>Cluster</th>
        <th>Status</th>
        <th>Queries Tested</th>
        <th>Canonical Mentions</th>
        <th>Velocity Mentions</th>
        <th>Competitor Mentions</th>
        <th>Score</th>
        <th>Atlas</th>
      </tr>
    </thead>
    <tbody>
${htmlRows}
    </tbody>
  </table>
</main>
</body>
</html>
`;

const out = path.join(ROOT, 'reports', 'answer-surface-dashboard.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Answer surface dashboard written: reports/answer-surface-dashboard.html (${rows.length} clusters)`);
