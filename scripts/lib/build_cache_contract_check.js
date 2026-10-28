'use strict';
/**
 * The merge gate builds the site once per commit, and the three things that hold
 * that up are read here rather than trusted.
 *
 * Why it lives inside the site-hygiene blocker
 * -------------------------------------------
 * The gate's site-build stage runs `npm run build:cached`, so the gate DEPENDS on
 * the build-result cache. The byte-identity proof over that cache
 * (build-result-cache-integrity) cannot run inside the sharded lane: four stages
 * after site-build write into data/, part of the cache's hashed input surface, so
 * by validation time the hash has moved and it looks for an entry no build ever
 * used. It stays `audit`-only, where it runs standalone after a build.
 *
 * The gate still needs a guard, and the release profile is capped at 40 blockers
 * on purpose - "every blocker is a way for main to go red" - so this is folded
 * into the site-hygiene blocker, exactly as zero_paid_llm was and for the same
 * reason. It is text-and-config only, so it costs the gate nothing.
 *
 * What it reads:
 *   1. The lane still goes through the wrapper. A lane that quietly went back to
 *      `npm run build` would lose the single-build-per-commit property AND both
 *      refusals below, silently, and no test would notice.
 *   2. The wrapper still refuses a store inside the checkout, and an entry it
 *      cannot read back complete. Those two refusals ARE the gate's cache guard.
 *   3. The gate sets BUILD_CACHE_DIR outside the checkout. A cache entry holds a
 *      copy of the rendered tree, and search-quality-basics read those copies as
 *      duplicate indexable content and failed the whole gate. Gitignoring a
 *      directory does not hide it from a filesystem walker.
 *   4. The hashed input surface excludes the wall-clock-stamped generated ledgers
 *      (data/signals/**). The gate runs the citation preview in every job before
 *      the build and it rewrites those files with a real `generated_at`, so
 *      hashing them as input gives every job a different key for one commit -
 *      a cache that can never hit.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LANE = 'scripts/release/run_staged_release.js';
const WRAPPER = 'scripts/build_cache_wrapper.js';
const CACHE_LIB = 'scripts/lib/build_cache.js';
const GATE = '.github/workflows/validate-repo.yml';

const repoIo = {
  read: (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'),
  exists: (rel) => fs.existsSync(path.join(ROOT, rel)),
};

function check(io = repoIo, { reg = null } = {}) {
  const failures = [];
  const warnings = [];
  const read = (rel) => { try { return io.exists(rel) ? io.read(rel) : null; } catch { return null; } };

  const lane = read(LANE);
  if (lane === null) failures.push(`${LANE} is missing`);
  else if (!lane.includes("stage('site-build','npm run build:cached'")) {
    failures.push(`${LANE} no longer builds through the cache wrapper (expected stage('site-build','npm run build:cached'))`);
  }

  const wrapper = read(WRAPPER);
  if (wrapper === null) failures.push(`${WRAPPER} is missing`);
  else {
    for (const fn of ['refuseStoreInsideTheTree', 'refuseIncompleteEntry']) {
      if (!wrapper.includes(fn)) failures.push(`${WRAPPER} lost ${fn}: the gate's cache guard is that refusal`);
    }
  }

  const gate = read(GATE);
  if (gate === null) failures.push(`${GATE} is missing`);
  else {
    const m = gate.match(/^\s*BUILD_CACHE_DIR:\s*(\S+)\s*$/m);
    if (!m) failures.push(`${GATE} does not set BUILD_CACHE_DIR; a cache entry inside the checkout is read as duplicate content`);
    else if (!m[1].startsWith('/')) failures.push(`${GATE} sets BUILD_CACHE_DIR to a non-absolute path (${m[1]}); it must be outside the checkout`);
    else if (!gate.includes(`path: ${m[1]}`)) failures.push(`${GATE} caches a different path than BUILD_CACHE_DIR (${m[1]}), so nothing is persisted`);
  }

  const lib = read(CACHE_LIB);
  if (lib === null) failures.push(`${CACHE_LIB} is missing`);
  else {
    for (const p of (reg && Array.isArray(reg.input_exclude_prefixes) ? reg.input_exclude_prefixes : ['data/signals/'])) {
      if (!lib.includes(`'${p}'`)) failures.push(`${CACHE_LIB} no longer excludes ${p} from the hashed input surface; a wall-clock-stamped ledger in the key means no job can ever reuse another's entry`);
    }
    if (!lib.includes('INPUT_EXCLUDE_PREFIXES')) failures.push(`${CACHE_LIB} lost INPUT_EXCLUDE_PREFIXES`);
  }

  return { failures, warnings, stats: { lane: LANE, wrapper: WRAPPER, gate: GATE } };
}

/** Break each rule, confirm it is caught. A guard that cannot fail proves nothing. */
function selfTest({ reg = null } = {}) {
  const base = { read: repoIo.read, exists: repoIo.exists };
  const mk = (ov) => ({
    exists: (rel) => (rel in ov ? ov[rel] !== null : base.exists(rel)),
    read: (rel) => (rel in ov ? (ov[rel] === null ? (() => { throw new Error('missing'); })() : ov[rel]) : base.read(rel)),
  });
  const cases = [
    ['the lane stops building through the wrapper', { [LANE]: base.read(LANE).replace("stage('site-build','npm run build:cached'", "stage('site-build','npm run build'") }],
    ['the wrapper loses the store refusal', { [WRAPPER]: base.read(WRAPPER).split('refuseStoreInsideTheTree').join('noop') }],
    ['the wrapper loses the incomplete-entry refusal', { [WRAPPER]: base.read(WRAPPER).split('refuseIncompleteEntry').join('noop') }],
    ['the gate stops setting BUILD_CACHE_DIR', { [GATE]: base.read(GATE).replace(/^\s*BUILD_CACHE_DIR:.*$/m, '') }],
    ['the gate points BUILD_CACHE_DIR back inside the checkout', { [GATE]: base.read(GATE).replace(/^(\s*)BUILD_CACHE_DIR:.*$/m, '$1BUILD_CACHE_DIR: .build-cache') }],
    ['the gate caches a different path than it sets', { [GATE]: base.read(GATE).split('path: /tmp/velocity-build-cache').join('path: .build-cache') }],
    ['the signal ledgers go back into the hashed input surface', { [CACHE_LIB]: base.read(CACHE_LIB).split("'data/signals/'").join("'data/nothing-like-it/'") }],
    ['the lane file is deleted', { [LANE]: null }],
  ];
  const missed = [];
  for (const [name, ov] of cases) if (!check(mk(ov), { reg }).failures.length) missed.push(name);
  return { cases: cases.length, missed };
}

module.exports = { check, selfTest, repoIo, LANE, WRAPPER, CACHE_LIB, GATE };
