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
const cp = require('child_process');

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

// A validator's `prepare_commands` run before it checks anything, and what they
// rewrite is as much a consequence of this lane running as a repair is. The
// promotion-candidates feed is the case that proved it: it is a projection of
// data/queries/measured_demand_candidates.json, the file this lane exists to
// refresh, rebuilt by the `npm run build` prepare step of the
// promotion-candidates-feed validator. Its own note says it is "rebuilt daily by
// query-evidence-refresh.yml". The lane could not commit it, so on any day the
// evidence actually moved - which is every day the lane does its job - the run
// hard-stopped on a file it was supposed to be producing.
//
// Derived from the registry for the same reason repair_writes is: a declared
// write widens the surface with it and cannot drift out of sync.
function activePrepareWrites(root = ROOT) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, '_validation_registry.json'), 'utf8'));
  const out = new Set();
  for (const v of registry.validators || []) {
    if (v.status !== 'ACTIVE' || !(v.prepare_commands || []).length) continue;
    for (const w of [...(v.prepare_produces_files || []), ...(v.prepare_mutates_files || [])]) out.add(w);
  }
  return [...out].sort();
}

// A declared write can be a build output the repo does not track - the
// promotion-candidates validator declares both feeds/promotion-candidates.json
// and its dist/ copy, and dist/ is in .gitignore. Handing an ignored path to
// `git add` is a hard error, so the lane derived a correct surface and then
// failed to commit it. An ignored path is not committable by anyone; it has no
// business in a commit surface.
//
// Only literal paths are testable this way; the wildcard patterns above are the
// lane's own long-standing evidence globs and are known to be tracked.
function withoutIgnored(patterns, root = ROOT) {
  const literals = patterns.filter((p) => !p.includes('*'));
  if (!literals.length) return patterns;
  const result = cp.spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: root, input: `${literals.join('\n')}\n`, encoding: 'utf8',
  });
  // 0 = some are ignored, 1 = none are, anything else = git could not answer and
  // we must not silently drop paths on a guess.
  if (result.status !== 0 && result.status !== 1) return patterns;
  const ignored = new Set((result.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean));
  return patterns.filter((p) => !ignored.has(p));
}

function committablePatterns(root = ROOT) {
  return withoutIgnored(
    [...new Set([...LANE_EVIDENCE_PATTERNS, ...activeRepairWrites(root), ...activePrepareWrites(root)])],
    root,
  );
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

module.exports = { ROOT, LANE_EVIDENCE_PATTERNS, activeRepairWrites, activePrepareWrites, withoutIgnored, committablePatterns, matches, isCommittable };
