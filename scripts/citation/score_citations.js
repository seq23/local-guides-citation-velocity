#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'reports');

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

const canonicalDomains = {
  'personal-injury': 'theaccidentguides.com',
  dentistry: 'dentistryguides.com',
  neuro: 'neuroevalguides.com',
  trt: 'hormonesivhair.com',
  'uscis-medical': 'uscisexam.com'
};

const tracking = readJson('data/citation_tracking/results.json', { results: [] });
const results = tracking.results || [];

const summary = {};

for (const row of results) {
  const vertical = row.vertical || 'unknown';
  const cluster = row.cluster || 'unknown';
  const key = `${vertical}/${cluster}`;

  summary[key] ||= {
    vertical,
    cluster,
    total_queries: 0,
    velocity_mentions: 0,
    canonical_mentions: 0,
    competitor_mentions: 0,
    unknown_mentions: 0,
    score: 0
  };

  summary[key].total_queries++;

  const urls = row.returned_urls || [];
  const canonicalDomain = canonicalDomains[vertical];

  const hasVelocity = urls.some(u => String(u).includes('theindustryguides.com'));
  const hasCanonical = canonicalDomain && urls.some(u => String(u).includes(canonicalDomain));
  const hasAny = urls.length > 0;

  if (hasVelocity) summary[key].velocity_mentions++;
  if (hasCanonical) summary[key].canonical_mentions++;
  if (hasAny && !hasVelocity && !hasCanonical) summary[key].competitor_mentions++;
  if (!hasAny) summary[key].unknown_mentions++;
}

for (const item of Object.values(summary)) {
  const total = Math.max(item.total_queries, 1);
  item.score = Math.round(((item.canonical_mentions * 3 + item.velocity_mentions * 1.5) / total) * 100) / 100;
  item.status =
    item.canonical_mentions > 0 ? 'canonical_visible' :
    item.velocity_mentions > 0 ? 'velocity_visible' :
    item.competitor_mentions > 0 ? 'competitor_owned' :
    'unknown';
}

const ranked = Object.values(summary).sort((a, b) => b.score - a.score);

writeJson('reports/citation_scorecard.json', {
  generated_at: new Date().toISOString(),
  ranked
});

console.log(`Citation scorecard written: reports/citation_scorecard.json (${ranked.length} clusters)`);
