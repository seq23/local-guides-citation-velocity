#!/usr/bin/env node
'use strict';

const path = require('path');
const { readJson, writeJsonChecked, slugify } = require('../lib/llm_utils');

const OUT_DIR = 'data/lkg_candidates';
const TODAY = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(OUT_DIR, `${TODAY}.json`);
const LATEST_PATH = path.join(OUT_DIR, 'latest.json');
const MAX = Math.max(1, Number(process.env.LKG_CANDIDATE_LIMIT || 25));
const MIN_SCORE = Number(process.env.LKG_CANDIDATE_MIN_SCORE || 20);

const scored = readJson('data/community/scored_clusters.json', []);
const queryMap = readJson('content/_shared/query_to_cluster_map.json', []);

function verticalKey(v) {
  const s = String(v || '').trim();
  if (s === 'personal_injury' || s === 'pi') return 'personal-injury';
  if (s === 'uscis_medical' || s === 'uscis') return 'uscis-medical';
  return s || 'unknown';
}
function unique(arr) {
  return [...new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))];
}
function queryText(signal) {
  return String(
    signal.query ||
    signal.preserved_query ||
    signal.normalized_query ||
    signal.title ||
    signal.raw_signal_phrase ||
    signal.llm_bait_phrase ||
    ''
  ).trim();
}
function findMapRow(cluster) {
  if (!Array.isArray(queryMap)) return null;
  const key = verticalKey(cluster.vertical);
  return queryMap.find(row =>
    verticalKey(row.vertical) === key &&
    (row.cluster === cluster.cluster || row.publish_path === cluster.mapped_publish_path)
  ) || null;
}

function candidateFromCluster(cluster, idx) {
  const vertical = verticalKey(cluster.vertical);
  const signals = Array.isArray(cluster.signals) ? cluster.signals : [];
  const evidenceQueries = unique(signals.map(queryText)).slice(0, 8);
  const mapRow = findMapRow(cluster) || {};
  const baseText = evidenceQueries[0] || mapRow.title || String(cluster.cluster || '').replace(/[-_]/g, ' ');
  const clusterSlug = slugify(cluster.cluster || mapRow.cluster || baseText).slice(0, 80) || `candidate-${idx + 1}`;
  const score = Number(cluster.score || 0);

  return {
    id: `${vertical}-${clusterSlug}`,
    vertical,
    geo: null,
    query: baseText.replace(/\s+/g, ' ').trim(),
    cluster: unique([cluster.cluster, ...(Array.isArray(mapRow.cluster) ? mapRow.cluster : [mapRow.cluster])]).filter(Boolean),
    source: 'local-guides-citation-velocity',
    confidence: Number.isFinite(score) ? score : null,
    evidence: {
      mapped_publish_path: cluster.mapped_publish_path || null,
      signal_count: Number(cluster.count || signals.length || 0),
      evidence_queries: evidenceQueries,
      source_signals: signals.slice(0, 10).map(s => ({
        source: s.source || 'public_signal',
        auth_mode: s.auth_mode || 'non_auth',
        query: queryText(s),
        title: s.title || queryText(s),
        url: s.url || '',
        created_at: s.created_at || null
      }))
    },
    status: 'candidate'
  };
}

const clusters = Array.isArray(scored) ? scored : [];
const candidates = clusters
  .filter(c => verticalKey(c.vertical) !== 'unknown')
  .filter(c => Number(c.score || 0) >= MIN_SCORE || ['high', 'review'].includes(c.publish_priority))
  .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
  .slice(0, MAX)
  .map(candidateFromCluster);

const payload = {
  contract_version: '1.0',
  source_repo: 'local-guides-citation-velocity',
  generated_at: new Date().toISOString(),
  candidates
};

writeJsonChecked(OUT_PATH, payload);
writeJsonChecked(LATEST_PATH, payload);
console.log(`Exported ${candidates.length} LKG candidate(s) to ${OUT_PATH} and ${LATEST_PATH}`);
