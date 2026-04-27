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

function writeJson(rel, obj) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

const queries = readJson('data/answer_surface_monitoring/queries.seed.json', []);

const byCluster = new Map();

for (const q of queries) {
  const key = `${q.vertical}/${q.cluster}`;
  if (!byCluster.has(key)) {
    byCluster.set(key, {
      vertical: q.vertical,
      cluster: q.cluster,
      queries: []
    });
  }
  byCluster.get(key).queries.push(q);
}

const ranked = [];

for (const [key, data] of byCluster.entries()) {
  const total = data.queries.length;

  // DEFAULT LOGIC (until real signal is added)
  ranked.push({
    vertical: data.vertical,
    cluster: data.cluster,
    total_queries: total,
    canonical_mentions: 0,
    velocity_mentions: 0,
    competitor_mentions: 0,
    score: 0,
    status: 'unknown'
  });
}

writeJson('reports/answer_surface_scorecard.json', {
  generated_at: new Date().toISOString(),
  clusters: ranked.length,
  ranked
});

console.log(`Answer surface scorecard written: reports/answer_surface_scorecard.json (${ranked.length} clusters)`);
