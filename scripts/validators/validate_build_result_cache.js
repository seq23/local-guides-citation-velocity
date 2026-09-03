#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Proves the build-result cache (scripts/lib/build_cache.js) is byte-identical
 * to a real build, not merely fast, and that a cache entry can only be trusted
 * when it actually came from a completed build.
 *
 * Two things are checked, both hard requirements:
 *
 *   1. A cache entry exists for the CURRENT input hash and is well-formed:
 *      build_completed === true, and its recorded input_hash matches the hash
 *      of the tree examining it (readEntryMeta() already rejects anything
 *      short of that - this validator additionally refuses to run at all if
 *      no entry exists, per Rule 0: examining zero cache entries proves
 *      nothing).
 *   2. Ground truth: every file the cache entry declares as output (its
 *      tracked_delta plus its gitignored build dirs) is hashed on the CURRENT
 *      tree, and again from a real, cache-disabled `npm run build` run in an
 *      isolated copy of the repo. Every declared file must match - not a
 *      sample, every one - or this fails and names exactly which files
 *      differ.
 *
 * Two paths are excluded from the strict per-file proof, both documented
 * here rather than silently dropped:
 *
 *   - content/_shared/content_state.json - the same read-write generation
 *     ledger excluded from the cache's input hash in scripts/lib/build_cache.js.
 *     Not independent input or public output; its pre-freeze hash field can
 *     still be mid-convergence on a stale starting tree even though the
 *     actual served bytes it tracks are already stable.
 *   - .build/ - a scratch directory the generators use for their own
 *     bookkeeping (never shipped: it is gitignored and nothing outside the
 *     build reads it except one warning-count check). .build/manifest.json
 *     records ABSOLUTE filesystem paths, so comparing the real checkout
 *     against a ground-truth build done in an isolated temp directory (a
 *     different absolute path, by construction) reports a difference that has
 *     nothing to do with the cache. validate_deterministic_build.js - this
 *     repo's own pre-existing build-determinism proof - draws the same line:
 *     its `roots` list never included .build/ either. dist/, the actual
 *     deploy artifact build_pages_dist.js produces, stays IN scope.
 *   - artifacts/validation/rendered_route_disposition.json - build_site.js
 *     stamps this diagnostic report with a real wall-clock `generated_at`
 *     (not the stable SOURCE_DATE pattern the rest of the build uses), so two
 *     separate build invocations always disagree on that one field even with
 *     byte-identical page output. Nothing reads this file back (grep-verified
 *     against scripts/); it is write-only diagnostics, still captured and
 *     restored by the cache like any other tracked delta entry, just not
 *     asserted byte-identical here.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');
const { computeInputHash, readEntryMeta, ROOT } = require('../lib/build_cache');

const EXCLUDE_FROM_PROOF = new Set([
  'content/_shared/content_state.json',
  'artifacts/validation/rendered_route_disposition.json',
]);
const EXCLUDE_DIR_FROM_PROOF = new Set(['.build']);
const EVIDENCE = 'artifacts/validation/build-result-cache-integrity.json';

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

function fingerprint(dir, relPaths) {
  const out = {};
  for (const rp of relPaths) {
    if (EXCLUDE_FROM_PROOF.has(rp) || EXCLUDE_DIR_FROM_PROOF.has(rp)) continue;
    const abs = path.join(dir, rp);
    if (!fs.existsSync(abs)) { out[rp] = null; continue; }
    if (fs.statSync(abs).isDirectory()) {
      const stack = [abs];
      while (stack.length) {
        const cur = stack.pop();
        for (const name of fs.readdirSync(cur).sort()) {
          const p2 = path.join(cur, name);
          const st = fs.lstatSync(p2);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) stack.push(p2);
          else out[path.relative(dir, p2).split(path.sep).join('/')] = sha256File(p2);
        }
      }
    } else {
      out[rp] = sha256File(abs);
    }
  }
  return out;
}

/**
 * The full comparison surface: every git-tracked file in the repository
 * (not just the paths the cache entry happened to touch - a stale or
 * corrupted file OUTSIDE that entry's declared delta must still be caught),
 * plus the gitignored build_dirs the cache also manages. Files under the
 * cache's own INPUT_PATHS are included too rather than filtered out: both
 * trees being compared start from the SAME copied input surface, so an input
 * file trivially matches unless something is actually wrong - inclusion only
 * adds a cheap extra check, never a source of false failure.
 */
function fullOutputSurface(buildDirs) {
  const tracked = cp.execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean);
  return [...new Set([...tracked, ...(buildDirs || [])])];
}

function main() {
  const { hash } = computeInputHash();
  const meta = readEntryMeta(hash);
  if (!meta) {
    console.error(`BUILD RESULT CACHE FAIL: no valid, complete cache entry for the current input hash ${hash.slice(0, 16)}. Run \`npm run build:cached\` first - there is nothing to prove against an empty cache.`);
    process.exit(1);
  }

  const outputPaths = fullOutputSurface(meta.build_dirs);
  if (!outputPaths.length) {
    console.error('BUILD RESULT CACHE FAIL: zero files in the comparison surface; nothing was proven.');
    process.exit(1);
  }

  const currentFingerprint = fingerprint(ROOT, outputPaths);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-build-cache-proof-'));
  let report;
  try {
    const excludes = new Set(['.git', 'node_modules', '.build', 'dist', 'reports', 'artifacts', '.build-cache']);
    fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const r = path.relative(ROOT, src); if (!r) return true; return !r.split(path.sep).some((x) => excludes.has(x)); } });
    // build_site.js reads artifacts/validation/frozen-content-recoverability.json
    // (see validate_deterministic_build.js for the same restoration and why).
    let tracked = [];
    try { tracked = cp.execSync('git ls-files -z artifacts', { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean); } catch { /* no git history to enumerate: proceed with nothing restored */ }
    for (const relp of tracked) {
      const src = path.join(ROOT, relp);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(tmp, relp);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const buildCmd = pkg.scripts && pkg.scripts.build;
    if (!buildCmd) throw new Error('package.json scripts.build is missing');
    const r = cp.spawnSync(buildCmd, {
      cwd: tmp, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, BUILD_CACHE_DISABLE: '1' },
    });
    if (r.status !== 0) throw new Error(`ground-truth build failed in ${tmp}:\n${r.stdout}\n${r.stderr}`);

    const groundTruthFingerprint = fingerprint(tmp, outputPaths);
    const keys = [...new Set([...Object.keys(currentFingerprint), ...Object.keys(groundTruthFingerprint)])].sort();
    const differences = keys.filter((k) => currentFingerprint[k] !== groundTruthFingerprint[k]);

    report = {
      schema_version: '1.0',
      validator: 'build-result-cache-integrity',
      status: differences.length ? 'FAIL' : 'PASS',
      input_hash: hash,
      cache_entry_created_at: meta.created_at,
      cache_entry_build_completed: meta.build_completed,
      output_paths_examined: outputPaths.length,
      files_fingerprinted: keys.length,
      excluded_from_proof: [...EXCLUDE_FROM_PROOF],
      differences,
      checked_at: new Date().toISOString(),
    };
  } catch (e) {
    report = {
      schema_version: '1.0',
      validator: 'build-result-cache-integrity',
      status: 'FAIL',
      input_hash: hash,
      error: e.message,
      checked_at: new Date().toISOString(),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, EVIDENCE), `${JSON.stringify(report, null, 2)}\n`);

  if (report.status !== 'PASS') {
    console.error(`BUILD RESULT CACHE FAIL: ${report.error || `${(report.differences || []).length} file(s) differ between the current tree and a real ground-truth build`}`);
    for (const d of (report.differences || []).slice(0, 20)) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`BUILD RESULT CACHE PASS: ${report.files_fingerprinted} file(s) hashed across ${report.output_paths_examined} tracked/build-dir path(s) - the current tree is byte-identical to a fresh, cache-disabled ground-truth build.`);
}

main();
