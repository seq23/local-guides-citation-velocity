#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * `npm run build:cached` - the same build `npm run build` runs, skipped
 * entirely when nothing that feeds it changed since the last time it ran.
 *
 * See scripts/lib/build_cache.js for the safety model. This script is
 * intentionally thin: it computes the input hash, tries a verified restore,
 * and on any miss or doubt falls back to running the real `npm run build`
 * (read from package.json, not duplicated here) and snapshots the result for
 * next time. A cache hit or miss is always logged and recorded to
 * artifacts/validation/build-cache.json so the decision is auditable, not
 * silent.
 *
 *   node scripts/build_cache_wrapper.js [--no-cache] [--prune]
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const {
  ROOT, computeInputHash, restoreFromCache, snapshotOutputs, cacheDir, pruneCacheEntries,
} = require('./lib/build_cache');

const args = process.argv.slice(2);
const NO_CACHE = args.includes('--no-cache') || process.env.BUILD_CACHE_DISABLE === '1';
const PRUNE = args.includes('--prune');

function realBuildCommand() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cmd = pkg.scripts && pkg.scripts.build;
  if (!cmd) throw new Error('package.json scripts.build is missing; nothing to cache');
  return cmd;
}

function writeEvidence(report) {
  fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'artifacts/validation/build-cache.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function main() {
  const startedAt = Date.now();
  const { hash, fileCount } = computeInputHash();
  console.log(`[build-cache] input hash ${hash.slice(0, 16)} over ${fileCount} file(s) in ${Date.now() - startedAt}ms`);

  if (!NO_CACHE) {
    const restored = restoreFromCache(hash);
    if (restored) {
      const ms = Date.now() - startedAt;
      console.log(`[build-cache] HIT ${hash.slice(0, 16)} - restored in ${ms}ms, real build skipped`);
      writeEvidence({
        validator_evidence: true, decision: 'HIT', input_hash: hash, input_file_count: fileCount, elapsed_ms: ms, cache_dir: cacheDir(), checked_at: new Date().toISOString(),
      });
      if (PRUNE) pruneCacheEntries();
      process.exit(0);
    }
    console.log(`[build-cache] MISS ${hash.slice(0, 16)} - running the real build`);
  } else {
    console.log('[build-cache] disabled (--no-cache); running the real build');
  }

  const buildStarted = Date.now();
  const cmd = realBuildCommand();
  const r = cp.spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit', env: process.env });
  const buildMs = Date.now() - buildStarted;
  if (r.status !== 0) {
    console.error(`[build-cache] real build FAILED (exit ${r.status}); nothing will be cached for ${hash.slice(0, 16)}`);
    writeEvidence({
      validator_evidence: true, decision: 'MISS_BUILD_FAILED', input_hash: hash, input_file_count: fileCount, build_ms: buildMs, checked_at: new Date().toISOString(),
    });
    process.exit(r.status ?? 1);
  }

  const snapStarted = Date.now();
  const entryDir = NO_CACHE ? null : snapshotOutputs(hash, { fileCount });
  const snapMs = Date.now() - snapStarted;
  const totalMs = Date.now() - startedAt;
  console.log(`[build-cache] MISS ${hash.slice(0, 16)} - build ${buildMs}ms, snapshot ${snapMs}ms, total ${totalMs}ms${entryDir ? ` -> ${entryDir}` : ' (not cached: --no-cache)'}`);
  writeEvidence({
    validator_evidence: true, decision: NO_CACHE ? 'MISS_NOT_CACHED' : 'MISS_CACHED', input_hash: hash, input_file_count: fileCount, build_ms: buildMs, snapshot_ms: snapMs, elapsed_ms: totalMs, cache_dir: cacheDir(), checked_at: new Date().toISOString(),
  });
  if (PRUNE) pruneCacheEntries();
}

main();
