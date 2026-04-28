#!/usr/bin/env node
'use strict';

const fs = require('fs');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function collectItems(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) collectItems(v, out);
  } else if (value && typeof value === 'object') {
    out.push(value);
    for (const v of Object.values(value)) collectItems(v, out);
  }
  return out;
}

const reg = readJson('content/_shared/query_cluster_registry.json');
const valid = new Set(Object.keys(reg));

const files = [
  'content/_shared/query_to_cluster_map.json',
  'content/_live/insights.json',
  'content/_live/pages.json',
  'content/_staged/compiled_query_pages.json',
  'content/_staged/pages.json',
  'content/_staged/reddit_queries_pi.json',
  'content/_staged/reddit_queries_dentistry.json',
  'content/_staged/reddit_queries_trt.json',
  'content/_staged/reddit_queries_neuro.json',
  'content/_staged/reddit_queries_uscis.json',
  'data/answer_surface_monitoring/queries.seed.json',
  'data/answer_surface_monitoring/observations.json',
  'reports/answer_surface_scorecard.json',
  'reports/answer_surface_expansion_backlog.json'
];

let errors = [];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const items = collectItems(readJson(f));
  for (const item of items) {
    if (!item || typeof item !== 'object' || !item.vertical) continue;
    if (!valid.has(item.vertical)) errors.push(`${f} -> invalid vertical: ${item.vertical}`);
  }
}

if (errors.length) {
  console.error('\n❌ INVALID VERTICAL KEYS FOUND:\n');
  errors.forEach(e => console.error(e));
  process.exit(1);
}

console.log('✅ Vertical key validation passed');
