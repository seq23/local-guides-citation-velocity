#!/usr/bin/env node
'use strict';
const { readJson, writeJsonChecked } = require('../lib/llm_utils');
const scored = readJson('data/community/scored_clusters.json', []);
const publishQueue = readJson('data/community/publish_queue.json', []);
const approvalQueue = readJson('data/community/approval_queue.json', []);
writeJsonChecked('data/community/index_manifest.json', {
  schema_version: '2.0',
  generated_at: '2026-06-19T00:00:00.000Z',
  mode: 'velocity_signal_to_velocity_source_queue',
  scored_cluster_count: Array.isArray(scored) ? scored.length : 0,
  publish_queue_count: Array.isArray(publishQueue) ? publishQueue.length : 0,
  approval_queue_count: Array.isArray(approvalQueue) ? approvalQueue.length : 0,
  publish_queue_path: 'data/community/publish_queue.json',
  approval_queue_path: 'data/community/approval_queue.json',
  release_path: 'scripts/velocity_content_release.js',
  external_repository_mutation: false
});
console.log('Community Velocity source queue index updated');
