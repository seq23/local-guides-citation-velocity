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

function toArray(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.queries)) return x.queries;
  if (x && Array.isArray(x.observations)) return x.observations;
  if (x && Array.isArray(x.items)) return x.items;
  if (x && typeof x === 'object') return Object.values(x).flatMap(toArray);
  return [];
}

const queries = toArray(readJson('data/answer_surface_monitoring/queries.seed.json', []));
const existing = toArray(readJson('data/answer_surface_monitoring/observations.json', { observations: [] }));

const seen = new Set();
const observations = [];

for (const obs of existing) {
  if (!obs.vertical || !obs.cluster || !obs.query) continue;
  const key = `${obs.vertical}/${obs.cluster}/${obs.query.toLowerCase().trim()}`;
  seen.add(key);
  observations.push(obs);
}

for (const q of queries) {
  if (!q.vertical || !q.cluster || !q.query) continue;
  const key = `${q.vertical}/${q.cluster}/${q.query.toLowerCase().trim()}`;
  if (seen.has(key)) continue;
  seen.add(key);

  observations.push({
    vertical: q.vertical,
    cluster: q.cluster,
    query: q.query,
    source: q.source || 'collected_query_corpus',
    observation_status: 'pending_review',
    returned_urls: [],
    rank_estimate: null
  });
}

writeJson('data/answer_surface_monitoring/observations.json', {
  version: '2026-04-27',
  description: 'Auto-generated answer surface observation candidates from collected query corpus. Pending rows require permitted/manual review before URLs are added.',
  observations
});

console.log(`Generated ${observations.length} answer surface observation candidates`);
