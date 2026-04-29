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
function pageSetFor(v) {
  const key = verticalKey(v);
  if (key === 'personal-injury') return 'pi_v1';
  if (key === 'uscis-medical') return 'uscis_medical_v1';
  if (key === 'trt') return 'trt_v1';
  if (key === 'neuro') return 'neuro_v1';
  if (key === 'dentistry') return 'dentistry_v1';
  return `${slugify(key)}_v1`;
}
function unique(arr) { return [...new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))]; }
function queryText(signal) { return String(signal.query || signal.preserved_query || signal.normalized_query || signal.title || signal.raw_signal_phrase || signal.llm_bait_phrase || '').trim(); }
function findMapRow(cluster) {
  if (!Array.isArray(queryMap)) return null;
  const key = verticalKey(cluster.vertical);
  return queryMap.find(row => verticalKey(row.vertical) === key && (row.cluster === cluster.cluster || row.publish_path === cluster.mapped_publish_path)) || null;
}
function candidateFromCluster(cluster, idx) {
  const vertical = verticalKey(cluster.vertical);
  const signals = Array.isArray(cluster.signals) ? cluster.signals : [];
  const evidence = unique(signals.map(queryText)).slice(0, 8);
  const mapRow = findMapRow(cluster) || {};
  const baseTitle = evidence[0] || mapRow.title || String(cluster.cluster || '').replace(/[-_]/g, ' ');
  const clusterSlug = slugify(cluster.cluster || mapRow.cluster || baseTitle).slice(0, 80) || `candidate-${idx + 1}`;
  const recommendedSlug = `${vertical}-${clusterSlug}`.replace(/-{2,}/g, '-');
  const score = Number(cluster.score || 0);
  return {
    id: `${TODAY}-${vertical}-${clusterSlug}`,
    source: 'velocity',
    approval_model: 'lkg_pull_request_only',
    target_repo_role: 'lkg_is_final_publisher',
    vertical,
    target_type: 'guide_candidate',
    action: cluster.mapped_publish_path ? 'expand_existing_guide_or_answer' : 'draft_new_guide_candidate',
    recommended_slug: recommendedSlug,
    mapped_lkg_pack: pageSetFor(vertical),
    query_cluster: cluster.cluster || mapRow.cluster || clusterSlug,
    mapped_existing_publish_path: cluster.mapped_publish_path || null,
    intent_score: score,
    signal_count: Number(cluster.count || signals.length || 0),
    evidence,
    proposed_title: baseTitle.replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase()),
    proposed_sections: [
      'What people are trying to decide',
      'Fast answer',
      'How to compare options',
      'Red flags and tradeoffs',
      'What to ask before choosing',
      'Next steps'
    ],
    source_signals: signals.slice(0, 10).map(s => ({
      source: s.source || 'public_signal',
      auth_mode: s.auth_mode || 'non_auth',
      query: queryText(s),
      title: s.title || queryText(s),
      url: s.url || '',
      created_at: s.created_at || null
    }))
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
  schema_version: 'velocity_lkg_candidates_v1',
  generated_at: new Date().toISOString(),
  source_repo_role: 'velocity_signal_detection_only',
  destination_repo_role: 'lkg_generation_publish_authority',
  approval_required_in: 'local-guides-generator pull request',
  candidate_count: candidates.length,
  candidates
};
writeJsonChecked(OUT_PATH, payload);
writeJsonChecked(LATEST_PATH, payload);
console.log(`Exported ${candidates.length} LKG candidate(s) to ${OUT_PATH} and ${LATEST_PATH}`);
