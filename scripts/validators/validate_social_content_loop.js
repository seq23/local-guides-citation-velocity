#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const required = [
  'data/community/clusters.json',
  'data/community/scored_clusters.json',
  'data/community/index_manifest.json',
  'data/community/publish_queue.json',
  'data/community/approval_queue.json'
];
const optional = [
  'data/community/collection_status.json',
  'data/community/raw_signals.json',
  'data/community/normalized_signals.json',
  'data/community/mapped_signals.json'
];
const abs = f => path.join(ROOT, f);
const missing = required.filter(f => !fs.existsSync(abs(f)));
if (missing.length) {
  console.error(`Missing Velocity social/content loop outputs:\n${missing.join('\n')}`);
  process.exit(1);
}
for (const f of [...required, ...optional.filter(f => fs.existsSync(abs(f)))]) {
  JSON.parse(fs.readFileSync(abs(f), 'utf8'));
}
const scored = JSON.parse(fs.readFileSync(abs('data/community/scored_clusters.json'), 'utf8'));
const publishQueue = JSON.parse(fs.readFileSync(abs('data/community/publish_queue.json'), 'utf8'));
const approvalQueue = JSON.parse(fs.readFileSync(abs('data/community/approval_queue.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(abs('data/community/index_manifest.json'), 'utf8'));
const errors = [];
if (!Array.isArray(scored)) errors.push('scored_clusters.json must be an array');
if (!Array.isArray(publishQueue)) errors.push('publish_queue.json must be an array');
if (!Array.isArray(approvalQueue)) errors.push('approval_queue.json must be an array');
if (manifest.mode !== 'velocity_signal_to_velocity_source_queue') errors.push('index manifest must use Velocity-owned source queue mode');
if (manifest.external_repository_mutation !== false) errors.push('external repository mutation must be false');
for (const forbidden of ['data/lkg_candidates', 'data/canonical_candidates']) {
  if (fs.existsSync(abs(forbidden))) errors.push(`forbidden external candidate path exists: ${forbidden}`);
}
const bad = Array.isArray(scored) ? scored.filter(c => ['high', 'review'].includes(c.publish_priority) && !c.vertical) : [];
if (bad.length) errors.push('High/review-priority social clusters missing vertical mapping');
const report = {
  validator: 'social-content-loop',
  ok: errors.length === 0,
  scored_cluster_count: Array.isArray(scored) ? scored.length : 0,
  publish_queue_count: Array.isArray(publishQueue) ? publishQueue.length : 0,
  approval_queue_count: Array.isArray(approvalQueue) ? approvalQueue.length : 0,
  mode: manifest.mode,
  errors
};
fs.mkdirSync(abs('artifacts/validation'), { recursive: true });
fs.writeFileSync(abs('artifacts/validation/social-content-loop.json'), `${JSON.stringify(report, null, 2)}\n`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Social signal to Velocity source queue loop OK');
