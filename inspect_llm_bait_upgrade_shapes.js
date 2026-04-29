#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function exists(p){ return fs.existsSync(p); }
function readJson(p){
  if (!exists(p)) return null;
  try { return JSON.parse(fs.readFileSync(p,'utf8')); }
  catch(e){ return { __error: e.message }; }
}
function shapeOf(v){
  if (Array.isArray(v)) return { type:'array', length:v.length, sample:v[0] || null };
  if (v && typeof v === 'object') return { type:'object', keys:Object.keys(v), sample:Object.fromEntries(Object.entries(v).slice(0,3)) };
  return { type:typeof v, value:v };
}

const files = [
  'package.json',
  'content/_shared/query_cluster_registry.json',
  'content/_shared/query_to_cluster_map.json',
  'content/_shared/atlas_registry.json',
  'content/_live/pages.json',
  'content/_staged/pages.json',
  'content/_live/insights.json',
  'llms.txt',
  'sitemap.xml',
  'robots.txt'
];

const validators = exists('package.json')
  ? Object.entries(readJson('package.json').scripts || {}).filter(([k]) => /validate|preflight|ingest|release|build|audit/i.test(k))
  : [];

const report = {
  generated_at: new Date().toISOString(),
  repo_shape: {},
  package_scripts: Object.fromEntries(validators),
  proposed_file_change_map: {
    phase_1_llm_exports: {
      add: [
        'scripts/build_llm_exports.js',
        'scripts/validators/validate_llm_exports.js',
        'dist/llm/answers.json',
        'dist/llm/coverage.json',
        'dist/llm/query_coverage_map.json',
        'dist/llm/query_metadata.json',
        'dist/llm/internal_authority_graph.json'
      ],
      mutate: ['package.json', 'llms.txt'],
      source_of_truth: [
        'content/_shared/query_cluster_registry.json',
        'content/_shared/query_to_cluster_map.json',
        'content/_shared/atlas_registry.json',
        'content/_live/pages.json',
        'content/_live/insights.json'
      ]
    },
    phase_2_answer_blocks: {
      add: [
        'scripts/build_answer_blocks.js',
        'scripts/validators/validate_answer_blocks.js',
        'dist/llm/answer_blocks.json'
      ],
      mutate: ['package.json'],
      source_of_truth: ['insights/*.html', 'content/_shared/query_to_cluster_map.json']
    },
    phase_3_entity_concept_graph: {
      add: [
        'content/_shared/entity_registry.json',
        'content/_shared/concept_registry.json',
        'scripts/build_entity_graph.js',
        'scripts/validators/validate_entity_graph.js',
        'dist/llm/entity_graph.json'
      ],
      mutate: ['package.json'],
      source_of_truth: [
        'content/_shared/query_cluster_registry.json',
        'content/_shared/query_to_cluster_map.json',
        'content/_shared/entity_registry.json',
        'content/_shared/concept_registry.json'
      ]
    },
    phase_4_citation_targets: {
      add: [
        'scripts/build_citation_targets.js',
        'scripts/validators/validate_citation_targets.js',
        'dist/llm/citation_targets.json'
      ],
      mutate: ['package.json'],
      source_of_truth: [
        'content/_shared/query_cluster_registry.json',
        'content/_shared/query_to_cluster_map.json',
        'dist/llm/answer_blocks.json',
        'dist/llm/entity_graph.json'
      ]
    },
    phase_5_social_content_loop: {
      add_or_harden: [
        'scripts/social/collect_social.js',
        'scripts/social/normalize_social.js',
        'scripts/social/cluster_signals.js',
        'scripts/social/score_clusters.js',
        'scripts/social/map_queries_to_pages.js',
        'scripts/social/generate_patch_plan.js',
        'scripts/social/publish_queued_pages.js',
        'scripts/social/update_indexes.js',
        'scripts/validators/validate_social_content_loop.js'
      ],
      mutate: ['package.json', '.github/workflows/* if needed'],
      source_of_truth: [
        'data/social/raw/',
        'data/social/normalized/',
        'data/social/clusters/',
        'data/social/publish_queue.json',
        'data/social/published_manifest.json'
      ]
    }
  }
};

for (const f of files) {
  const data = f.endsWith('.json') ? readJson(f) : exists(f) ? fs.readFileSync(f,'utf8').slice(0,1000) : null;
  report.repo_shape[f] = {
    exists: exists(f),
    shape: f.endsWith('.json') && data ? shapeOf(data) : typeof data
  };
}

fs.mkdirSync('reports', {recursive:true});
fs.writeFileSync('reports/llm_bait_upgrade_shape_report.json', JSON.stringify(report,null,2) + '\n');

console.log('Wrote reports/llm_bait_upgrade_shape_report.json');
console.log(JSON.stringify(report.proposed_file_change_map, null, 2));
