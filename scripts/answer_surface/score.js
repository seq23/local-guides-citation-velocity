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

function normalizeList(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.queries)) return x.queries;
  if (x && Array.isArray(x.observations)) return x.observations;
  if (x && typeof x === 'object') return Object.values(x).flat().filter(Boolean);
  return [];
}

const canonicalDomains = {
  'personal-injury': 'theaccidentguides.com',
  dentistry: 'dentistryguides.com',
  neuro: 'neuroevalguides.com',
  trt: 'hormonesivhair.com',
  'uscis-medical': 'uscisexam.com'
};

const queries = normalizeList(readJson('data/answer_surface_monitoring/queries.seed.json', []));
const observations = normalizeList(readJson('data/answer_surface_monitoring/observations.json', []));

const byCluster = new Map();

for (const q of queries) {
  if (!q.vertical || !q.cluster || !q.query) continue;
  const key = `${q.vertical}/${q.cluster}`;
  if (!byCluster.has(key)) {
    byCluster.set(key, {
      vertical: q.vertical,
      cluster: q.cluster,
      queries: [],
      observations: []
    });
  }
  byCluster.get(key).queries.push(q);
}

for (const obs of observations) {
  if (!obs.vertical || !obs.cluster || !obs.query) continue;
  const key = `${obs.vertical}/${obs.cluster}`;
  if (!byCluster.has(key)) {
    byCluster.set(key, {
      vertical: obs.vertical,
      cluster: obs.cluster,
      queries: [],
      observations: []
    });
  }
  byCluster.get(key).observations.push(obs);
}

const ranked = [];

for (const [, data] of byCluster.entries()) {
  const canonicalDomain = canonicalDomains[data.vertical];

  let canonical_mentions = 0;
  let velocity_mentions = 0;
  let competitor_mentions = 0;
  let unknown_mentions = 0;
  let scoreTotal = 0;

  for (const obs of data.observations) {
    const urls = obs.returned_urls || obs.sources || [];
    const rank = Number(obs.rank_estimate || obs.rank || 0);

    const hasVelocity = urls.some(u => String(u).includes('theindustryguides.com'));
    const hasCanonical = canonicalDomain && urls.some(u => String(u).includes(canonicalDomain));
    const hasAny = urls.length > 0;

    if (hasCanonical) canonical_mentions++;
    if (hasVelocity) velocity_mentions++;
    if (hasAny && !hasCanonical && !hasVelocity) competitor_mentions++;
    if (!hasAny) unknown_mentions++;

    let obsScore = 0;
    if (hasCanonical) obsScore += 6;
    if (hasVelocity) obsScore += 3;
    if (rank && rank <= 3) obsScore += 4;
    else if (rank && rank <= 5) obsScore += 2;
    else if (rank) obsScore += 1;
    if (hasAny && !hasCanonical && !hasVelocity) obsScore -= 2;

    scoreTotal += Math.max(0, obsScore);
  }

  const observed = data.observations.length;
  const score = observed ? Math.round((scoreTotal / observed) * 100) / 100 : 0;

  let status = 'not_observed';
  if (observed && canonical_mentions > 0) status = 'canonical_visible';
  else if (observed && velocity_mentions > 0) status = 'velocity_visible';
  else if (observed && competitor_mentions > 0) status = 'competitor_owned';
  else if (observed) status = 'unknown';

  ranked.push({
    vertical: data.vertical,
    cluster: data.cluster,
    total_queries: data.queries.length,
    observations: observed,
    canonical_mentions,
    velocity_mentions,
    competitor_mentions,
    unknown_mentions,
    score,
    status
  });
}

ranked.sort((a, b) => b.score - a.score || b.total_queries - a.total_queries);

writeJson('reports/answer_surface_scorecard.json', {
  generated_at: new Date().toISOString(),
  clusters: ranked.length,
  ranked
});

console.log(`Answer surface scorecard written: reports/answer_surface_scorecard.json (${ranked.length} clusters, ${observations.length} observations)`);
