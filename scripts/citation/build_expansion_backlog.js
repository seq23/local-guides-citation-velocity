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

const reg = readJson('content/_shared/query_cluster_registry.json', {});
const map = readJson('content/_shared/query_to_cluster_map.json', []);
const scorecard = readJson('reports/citation_scorecard.json', { ranked: [] });

const scores = new Map((scorecard.ranked || []).map(x => [`${x.vertical}/${x.cluster}`, x]));

const backlog = [];

for (const [vertical, meta] of Object.entries(reg)) {
  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const key = `${vertical}/${cluster}`;
    const score = scores.get(key) || {
      status: 'not_tested',
      score: 0,
      total_queries: 0,
      canonical_mentions: 0,
      velocity_mentions: 0,
      competitor_mentions: 0
    };

    const clusterItems = map.filter(item => item.vertical === vertical && item.cluster === cluster);

    let priority = 0;
    const reasons = [];

    if (score.status === 'competitor_owned') {
      priority += 100;
      reasons.push('Competitors visible but canonical/velocity not visible');
    }

    if (score.status === 'not_tested' || score.status === 'unknown') {
      priority += 60;
      reasons.push('Cluster has no citation visibility data yet');
    }

    if ((score.score || 0) < 1) {
      priority += 40;
      reasons.push('Low citation dominance score');
    }

    if (clusterItems.length < 8) {
      priority += 25;
      reasons.push('Low query depth for cluster');
    }

    if (clusterItems.length >= 20 && (score.score || 0) < 1) {
      priority += 20;
      reasons.push('High query demand but weak visibility');
    }

    if (priority <= 0) continue;

    backlog.push({
      vertical,
      cluster,
      path: cmeta.path,
      atlas_path: meta.atlas_path,
      priority,
      status: score.status,
      score: score.score || 0,
      current_query_count: clusterItems.length,
      reasons,
      recommended_actions: [
        'Add 3-5 new insight pages for unanswered long-tail questions',
        'Strengthen short-answer block on cluster page',
        'Add stronger canonical-domain handoff',
        'Add related-cluster links from adjacent high-volume clusters',
        'Promote strongest matching canonical page in LKG'
      ]
    });
  }
}

backlog.sort((a, b) => b.priority - a.priority);

writeJson('reports/auto_expansion_backlog.json', {
  generated_at: new Date().toISOString(),
  count: backlog.length,
  backlog
});

console.log(`Auto-expansion backlog written: reports/auto_expansion_backlog.json (${backlog.length} clusters)`);
