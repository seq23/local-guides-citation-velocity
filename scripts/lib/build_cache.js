'use strict';
/**
 * Convergence-result cache for `npm run build`.
 *
 * This repo regenerates all ~2,070 rendered pages from scratch on every
 * `npm run build`, even when nothing that feeds the build changed - which is
 * most rebase-retry and CI-loop invocations. The generators feed each other
 * (a page's final bytes depend on generators that run AFTER it: the dentistry
 * report oracle and the frozen-output guard both run at the END of
 * build_site.js and can rewrite what an earlier stage produced), so a naive
 * per-page cache would ship half-built pages - exactly the defect
 * rendered-output-shrink-guard exists to catch, made permanent. This cache
 * does not attempt that. It caches the RESULT of one complete, successful
 * `npm run build` invocation, keyed by a hash of everything that can affect
 * that result, and restores the output tree byte-for-byte on a hit.
 *
 * Safety model
 * ------------
 *   - The key is a SHA-256 over every file under the input surface (scripts/,
 *     templates/, content/, data/, package.json, package-lock.json,
 *     _redirects) plus the env vars that change generator behaviour
 *     (ALLOW_CANONICAL_DATA_REGEN, VELOCITY_CONTENT_SOURCE, SOURCE_DATE) and a
 *     schema version for this cache format itself. File CONTENT is hashed,
 *     not mtime/size, so a reformatted-but-identical file or a touched file
 *     with no real change still hits the cache, and any real change - even
 *     one byte, anywhere in the input surface - always misses.
 *   - A cache entry is written atomically (built in a temp dir, renamed into
 *     place only once complete) and stamped `build_completed: true` only
 *     after the real build exited 0. restoreFromCache() refuses an entry
 *     whose stamp is missing, false, or whose recorded input_hash does not
 *     match the directory it lives in - that is "reject a cached artifact
 *     that did not come from a build that reached a fixed point."
 *   - Restoring only replays the exact delta a build produced (the tracked
 *     files it modified, mirrored against the current git HEAD, plus the
 *     gitignored .build/ and dist/ trees) rather than touching all ~2,070
 *     pages. This is safe specifically because the repo's own frozen-output
 *     guard (scripts/lib/frozen_pages.js) forces every frozen route's bytes
 *     from data/release/frozen_html_cache/** - part of the hashed input
 *     surface - not from whatever the file on disk currently holds. Two
 *     builds with the same input hash are already proven deterministic by
 *     this repo's own `deterministic-build` validator; this cache relies on
 *     that guarantee rather than re-deriving it.
 *   - On any doubt - missing metadata, a hash mismatch, a partially-written
 *     entry - the caller must fall back to a real build. This module never
 *     guesses; it returns false and lets the caller rebuild.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const rel = (p) => path.join(ROOT, p);

// Bump this if the cache's own format or safety logic changes, to invalidate
// every previously written entry without needing to touch the input surface.
const SCHEMA_VERSION = 1;

const INPUT_PATHS = ['scripts', 'templates', 'content', 'data', 'package.json', 'package-lock.json', '_redirects'];
const ENV_KEYS = ['ALLOW_CANONICAL_DATA_REGEN', 'VELOCITY_CONTENT_SOURCE', 'SOURCE_DATE'];
// build_site.js both READS and WRITES this file (loadContentState/saveContentState):
// it is a generation ledger (per-route rendered-hash + lastmod), not an
// independent source of truth. Its pre-freeze hash legitimately drifts build to
// build even with zero external input change - the served bytes for every
// frozen route are still forced byte-for-byte from data/release/frozen_html_cache
// regardless of what this file records - so hashing it as an INPUT would make the
// key change on every single run (this file, produced by run N, would always
// differ from what run N-1 hashed before it existed) and no two builds could ever
// hit. It is still captured normally in the OUTPUT delta below, since it is a
// real tracked file the build writes.
const INPUT_EXCLUDE = new Set(['content/_shared/content_state.json']);

// The wrapper, and the build-result-cache-integrity validator that proves it,
// each write their own evidence file AFTER a build+snapshot. Once written it
// sits on disk as an untracked file forever (nothing commits it), so `git
// status` reports it as part of every SUBSEQUENT run's delta unless excluded
// here - which would make every cache entry after the first carry a
// self-referential copy of the previous run's own bookkeeping, restored into
// itself on the next hit (and, for the validator's own evidence file,
// falsely reported as a byte-identity difference, since the isolated
// ground-truth build never produces it at all). Both are caching/proof
// metadata, never build output, so neither is ever part of what a restore
// reproduces.
const OUTPUT_DELTA_EXCLUDE = new Set([
  'artifacts/validation/build-cache.json',
  'artifacts/validation/build-result-cache-integrity.json',
]);
// Gitignored directories a build fully regenerates (never incrementally) -
// snapshotted and restored wholesale rather than diffed.
const BUILD_DIRS = ['.build', 'dist'];

function cacheDir() {
  return process.env.BUILD_CACHE_DIR ? path.resolve(process.env.BUILD_CACHE_DIR) : rel('.build-cache');
}

function walk(dir, out) {
  let names;
  try { names = fs.readdirSync(dir).sort(); } catch { return; }
  for (const name of names) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue; // never followed: a symlink is not build input content
    if (st.isDirectory()) { walk(p, out); continue; }
    if (st.isFile()) out.push(p);
  }
}

function inputFileList() {
  const files = [];
  for (const p of INPUT_PATHS) {
    const abs = rel(p);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) { files.push(abs); continue; }
    walk(abs, files);
  }
  return files.filter((abs) => !INPUT_EXCLUDE.has(path.relative(ROOT, abs).split(path.sep).join('/')));
}

/** SHA-256 over every input file's path + content, plus env and schema. Content is read fresh each call - no mtime/size shortcut - so this is always correct, never a fast guess. */
function computeInputHash(env = process.env) {
  const files = inputFileList();
  const h = crypto.createHash('sha256');
  h.update(`schema:${SCHEMA_VERSION}\n`);
  for (const key of ENV_KEYS) h.update(`env:${key}=${env[key] || ''}\n`);
  h.update(`node:${process.version}\n`);
  h.update(`files:${files.length}\n`);
  for (const abs of files) {
    h.update(path.relative(ROOT, abs));
    h.update('\0');
    h.update(fs.readFileSync(abs));
    h.update('\0');
  }
  return { hash: h.digest('hex'), fileCount: files.length };
}

/** Files git reports as added/modified/deleted since HEAD, restricted to the tracked tree - i.e. exactly what a build changed relative to the committed baseline. */
function trackedDelta() {
  const r = cp.spawnSync('git', ['status', '--porcelain=v1', '--no-renames'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git status failed: ${r.stderr || r.status}`);
  const out = [];
  for (const line of (r.stdout || '').split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (!file) continue;
    if (OUTPUT_DELTA_EXCLUDE.has(file)) continue;
    if (code.includes('D')) out.push({ path: file, action: 'deleted' });
    else out.push({ path: file, action: 'modified' });
  }
  return out;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDirWholesale(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

/**
 * Snapshot the result of a build that just exited 0 into an atomically-named
 * cache entry for `hash`. Returns the entry directory.
 */
function snapshotOutputs(hash, { fileCount } = {}) {
  const store = cacheDir();
  fs.mkdirSync(store, { recursive: true });
  const tmp = path.join(store, `.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const delta = trackedDelta();
  for (const entry of delta) {
    if (entry.action === 'deleted') continue;
    const src = rel(entry.path);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    copyFile(src, path.join(tmp, 'tracked', entry.path));
  }
  for (const dir of BUILD_DIRS) copyDirWholesale(rel(dir), path.join(tmp, 'build_dirs', dir));

  const meta = {
    schema_version: SCHEMA_VERSION,
    input_hash: hash,
    input_file_count: fileCount || null,
    created_at: new Date().toISOString(),
    source_date: process.env.SOURCE_DATE || null,
    node_version: process.version,
    git_head: (() => { try { return cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    tracked_delta: delta,
    build_dirs: BUILD_DIRS,
    build_completed: true,
  };
  fs.writeFileSync(path.join(tmp, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  const dest = path.join(store, hash);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest); // atomic on the same filesystem: no reader ever sees a partial entry
  return dest;
}

/** Read (never trust blindly) a cache entry's metadata. Returns null on anything short of a complete, matching, well-formed entry. */
function readEntryMeta(hash) {
  const entryDir = path.join(cacheDir(), hash);
  const metaPath = path.join(entryDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return null; }
  if (meta.schema_version !== SCHEMA_VERSION) return null;
  if (meta.build_completed !== true) return null; // reject: this entry never reached a completed build
  if (meta.input_hash !== hash) return null; // reject: metadata does not match the directory it lives in
  if (!Array.isArray(meta.tracked_delta)) return null;
  return meta;
}

/**
 * Attempt to restore the output of the build identified by `hash`. Returns
 * true on a verified restore, false if there is nothing usable - the caller
 * must then run a real build. Never partially restores: verification happens
 * before any file is touched.
 */
function restoreFromCache(hash) {
  const meta = readEntryMeta(hash);
  if (!meta) return false;
  const entryDir = path.join(cacheDir(), hash);

  // Verify every file the entry claims to carry actually exists before
  // touching the working tree - a half-copied entry (e.g. an interrupted
  // process from a previous run using the same PID/tmp name, or a corrupted
  // CI cache restore) must never be applied partially.
  for (const item of meta.tracked_delta) {
    if (item.action === 'deleted') continue;
    if (!fs.existsSync(path.join(entryDir, 'tracked', item.path))) return false;
  }
  for (const dir of meta.build_dirs || []) {
    if (!fs.existsSync(path.join(entryDir, 'build_dirs', dir))) return false;
  }

  for (const item of meta.tracked_delta) {
    const target = rel(item.path);
    if (item.action === 'deleted') { fs.rmSync(target, { force: true }); continue; }
    copyFile(path.join(entryDir, 'tracked', item.path), target);
  }
  for (const dir of meta.build_dirs || []) copyDirWholesale(path.join(entryDir, 'build_dirs', dir), rel(dir));

  return true;
}

/** Keep only the `keep` most recently created entries, to bound cache growth across CI runs. Never called automatically - the wrapper decides when. */
function pruneCacheEntries(keep = 5) {
  const store = cacheDir();
  if (!fs.existsSync(store)) return { removed: 0, kept: 0 };
  const entries = fs.readdirSync(store)
    .filter((name) => !name.startsWith('.tmp-'))
    .map((name) => {
      const metaPath = path.join(store, name, 'meta.json');
      let createdAt = 0;
      try { createdAt = Date.parse(JSON.parse(fs.readFileSync(metaPath, 'utf8')).created_at || '') || 0; } catch { createdAt = 0; }
      return { name, createdAt };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  const toRemove = entries.slice(keep);
  for (const e of toRemove) fs.rmSync(path.join(store, e.name), { recursive: true, force: true });
  return { removed: toRemove.length, kept: entries.length - toRemove.length };
}

module.exports = {
  ROOT,
  SCHEMA_VERSION,
  INPUT_PATHS,
  INPUT_EXCLUDE,
  ENV_KEYS,
  BUILD_DIRS,
  cacheDir,
  computeInputHash,
  trackedDelta,
  snapshotOutputs,
  readEntryMeta,
  restoreFromCache,
  pruneCacheEntries,
};
