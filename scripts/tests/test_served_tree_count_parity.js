#!/usr/bin/env node
'use strict';
/**
 * Served-tree count parity: one validator, one commit, one answer. Run as a
 * self-proof by velocity-canonical-anchor-links itself (a registered HARD_FAIL), so it
 * needs no registry slot of its own.
 *
 * 2026-10-14, Query Evidence Refresh run 38524268332: velocity-canonical-anchor-links
 * counted 18 links to memphisseniorcarehomes.com/request-assistance (cap 10) in a
 * lane with no dist/, while Validate Repo - with dist/ - counted 9 on the same tree.
 * The validator read dist when present and the whole repo root otherwise.
 *
 * This runs the real validator twice and compares the sitewide counts it reports:
 *   A. with dist/ present, plus a decoy page inside dist/ carrying 40 links to the
 *      capped URL - a validator that reads dist counts them;
 *   B. with dist/ moved aside - a validator that falls back to some other tree
 *      counts something else.
 * The counts must be identical and non-zero. dist/ is restored exactly as found.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist');
const ASIDE = path.join(ROOT, '.build', 'served-tree-parity-dist-aside');
const DECOY = path.join(DIST, '__served_tree_parity_decoy__');
const VALIDATOR = path.join(ROOT, 'scripts/validators/validate_velocity_canonical_anchor_links.js');
const VREPORT = path.join(ROOT, 'artifacts/validation/velocity-canonical-anchor-links.json');
const OUT = path.join(ROOT, 'artifacts/validation/served-tree-count-parity.json');

function counts(label) {
  try { fs.rmSync(VREPORT, { force: true }); } catch { /* absent */ }
  const r = spawnSync(process.execPath, [VALIDATOR], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, SERVED_TREE_PARITY_CHILD: '1' } });
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(VREPORT, 'utf8')); } catch { /* reported below */ }
  if (!doc || !doc.sitewide) {
    throw new Error(`${label}: the validator wrote no sitewide counts (exit ${r.status}): ${`${r.stdout}${r.stderr}`.slice(-600)}`);
  }
  return { exit: r.status, sitewide: doc.sitewide };
}

function main() {
  const hadDist = fs.existsSync(DIST);
  let builtDist = false;
  let a; let b;
  try {
    if (!hadDist) {
      const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build_pages_dist.js')], { cwd: ROOT, encoding: 'utf8' });
      if (built.status !== 0) throw new Error(`could not build a dist/ to compare against: ${built.stderr.slice(-400)}`);
      builtDist = true;
    }
    fs.mkdirSync(DECOY, { recursive: true });
    const link = '<a href="https://memphisseniorcarehomes.com/request-assistance/">x</a>';
    fs.writeFileSync(path.join(DECOY, 'index.html'), `<!doctype html><html><body><main>${link.repeat(40)}</main></body></html>\n`);
    a = counts('with dist');
    fs.rmSync(DECOY, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(ASIDE), { recursive: true });
    fs.rmSync(ASIDE, { recursive: true, force: true });
    fs.renameSync(DIST, ASIDE);
    b = counts('without dist');
  } finally {
    fs.rmSync(DECOY, { recursive: true, force: true });
    if (fs.existsSync(ASIDE)) { fs.rmSync(DIST, { recursive: true, force: true }); fs.renameSync(ASIDE, DIST); }
    if (builtDist) fs.rmSync(DIST, { recursive: true, force: true });
  }
  const same = JSON.stringify(a.sitewide) === JSON.stringify(b.sitewide);
  const nonZero = a.sitewide.served_html_files > 0 && a.sitewide.outbound_links > 0 && a.sitewide.senior_outbound_links > 0;
  const report = {
    schema_version: '1.0',
    guard: 'served-tree-count-parity',
    status: same && nonZero ? 'PASS' : 'FAIL',
    with_dist: a,
    without_dist: b,
    why: 'velocity-canonical-anchor-links must count the served tree from the repo root in every environment; dist/ presence may not change its answer.',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  if (!nonZero) {
    console.error(`SERVED TREE COUNT PARITY FAIL: nothing was counted (${JSON.stringify(a.sitewide).slice(0, 200)}); a zero count proves nothing.`);
    process.exit(1);
  }
  if (!same) {
    console.error('SERVED TREE COUNT PARITY FAIL: velocity-canonical-anchor-links gives a different answer depending on whether dist/ exists.');
    console.error(`  with dist (+40 decoy links inside dist): ${JSON.stringify({ ...a.sitewide, senior_links_per_url: undefined })}`);
    console.error(`  without dist:                           ${JSON.stringify({ ...b.sitewide, senior_links_per_url: undefined })}`);
    process.exit(1);
  }
  console.log(`SERVED TREE COUNT PARITY PASS: ${a.sitewide.served_html_files} served pages, ${a.sitewide.outbound_links} outbound links, ${a.sitewide.senior_outbound_links} to the senior canonical - identical with and without dist/ (a 40-link decoy inside dist/ was not counted).`);
}

main();
