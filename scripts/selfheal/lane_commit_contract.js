'use strict';
// The commit surface of the one scheduled workflow allowed to write to main.
//
// query-evidence-refresh.yml runs the self-heal loop, validates the healed tree,
// then commits. Its commit pattern listed only the evidence files the lane
// refreshes, so every path a repair actually rewrites fell outside it: the lane
// validated one tree and committed a different one, and the next run repaired
// the same defect again, forever.
//
// The committable set is therefore derived from the registry rather than
// restated in YAML: whatever every ACTIVE validator declares its repair rewrites
// is, by construction, part of what this lane may commit. Adding a repair to the
// registry widens the commit surface with it and cannot drift out of sync.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// What the lane itself refreshes, independent of any repair.
const LANE_EVIDENCE_PATTERNS = [
  'data/signals/*.json',
  'data/queries/*.json',
  'data/queries/evidence/*.json',
  'data/authority_scale/query_atlas.json',
  'artifacts/validation/*.json',
];

function activeRepairWrites(root = ROOT) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, '_validation_registry.json'), 'utf8'));
  const out = new Set();
  for (const v of registry.validators || []) {
    if (v.status !== 'ACTIVE' || !v.repair_command) continue;
    for (const w of v.repair_writes || []) out.add(w);
  }
  return [...out].sort();
}

function committablePatterns(root = ROOT) {
  return [...LANE_EVIDENCE_PATTERNS, ...activeRepairWrites(root)];
}

// git add glob semantics: '*' stops at a path separator, '**' spans them.
function matches(pattern, filePath) {
  const rx = new RegExp(
    `^${pattern
      .split('/')
      .map((seg) => (seg === '**' ? '.*' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')))
      .join('/')}$`,
  );
  return rx.test(filePath);
}

function isCommittable(filePath, patterns) {
  return patterns.some((p) => matches(p, filePath));
}

module.exports = { ROOT, LANE_EVIDENCE_PATTERNS, activeRepairWrites, committablePatterns, matches, isCommittable };
