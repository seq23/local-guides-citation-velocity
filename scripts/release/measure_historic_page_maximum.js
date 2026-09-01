#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The shrink guard, pointed BACKWARDS.
 *
 * validate_rendered_output_shrink_guard.js was seeded from the rendered output as it
 * stood on 2026-09-01, so it protects every page from today onward - and silently
 * blesses whatever size a page had already been reduced to. A sibling repo
 * (sprylabs-hpc-site) was audited against the same defect list on the same day and
 * found 18 pages already re-frozen thinner on HEAD. A forward-only guard cannot see
 * those, which makes "we are guarded" a half-truth.
 *
 * So the history is measured. For every accepted route this walks 40 sampled commits
 * across main, records the largest the page has ever been, and asks whether it is
 * smaller than that today - and, more usefully, whether it has lost DELIVERED ARTIFACT
 * BLOCKS rather than merely bytes.
 *
 * The distinction matters and is the whole reason this writes two numbers. Several
 * landed PRs deliberately DELETED published content: #17 unsealed an internal-instruction
 * leak across 148 pages, #18 stopped build-acceptance criteria rendering as reader red
 * flags on 20 pages, #28 stopped requiring headings the compiler had invented. Those
 * pages are legitimately smaller. Reporting "N pages shrank" as a finding would treat
 * three correct repairs as damage - so byte shrink is recorded as context, and artifact
 * loss is what is called out.
 *
 * The output is a SHRINK-ONLY ratchet: a route on the list that climbs back to its
 * historic maximum must be deleted from it, and a route that falls below its historic
 * maximum without being on it is a new occurrence of the defect and fails.
 *
 * Rule 0: sampling zero commits, or measuring zero routes, is a hard failure.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { artifactsFromRenderedHtml, artifactKey } = require('../lib/rendered_artifact_recovery');

const ROOT = path.resolve(__dirname, '../..');
const REGISTRY = 'data/release/frozen_page_registry.json';
const OUT = 'data/release/historic_page_maximum.json';
const EVIDENCE = 'artifacts/validation/historic-page-maximum.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const SAMPLE_STRIDE = Number(process.env.HISTORIC_SAMPLE_STRIDE || 12);
const SAMPLE_MAX = Number(process.env.HISTORIC_SAMPLE_MAX || 40);

function rel(p) { return path.join(ROOT, p); }
function git(args, opts = {}) { return cp.execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8', ...opts }); }

function main() {
  const registry = JSON.parse(fs.readFileSync(rel(REGISTRY), 'utf8'));
  const paths = (registry.pages || []).map((p) => p.rendered_file).filter(Boolean);
  const want = new Set(paths);
  if (!want.size) { console.error('HISTORIC PAGE MAXIMUM FAIL: the frozen registry names no rendered files.'); process.exit(1); }

  const all = git(['log', '--format=%H', 'main', '--', '*.html']).split('\n').filter(Boolean);
  const commits = all.filter((_, i) => i % SAMPLE_STRIDE === 0).slice(0, SAMPLE_MAX);
  if (!commits.length) { console.error('HISTORIC PAGE MAXIMUM FAIL: sampled zero commits from main; history is unreadable and the measurement is UNKNOWN, not clean.'); process.exit(1); }

  const maxSize = new Map();
  const maxAt = new Map();
  for (const commit of commits) {
    const tree = git(['ls-tree', '-r', commit]);
    const rows = [];
    for (const line of tree.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const file = line.slice(tab + 1);
      if (!want.has(file)) continue;
      rows.push([line.slice(0, tab).split(/\s+/)[2], file]);
    }
    if (!rows.length) continue;
    const sizes = git(['cat-file', '--batch-check'], { input: `${rows.map((r) => r[0]).join('\n')}\n` }).split('\n');
    rows.forEach(([, file], i) => {
      const size = Number((sizes[i] || '').split(' ')[2]);
      if (!Number.isFinite(size)) return;
      if (!maxSize.has(file) || size > maxSize.get(file)) { maxSize.set(file, size); maxAt.set(file, commit); }
    });
  }
  if (!maxSize.size) { console.error('HISTORIC PAGE MAXIMUM FAIL: measured zero routes across the sampled history.'); process.exit(1); }

  const below = [];
  for (const file of paths) {
    if (!maxSize.has(file)) continue;
    const abs = rel(file);
    if (!fs.existsSync(abs)) continue;
    const current = fs.statSync(abs).size;
    const peak = maxSize.get(file);
    if (current >= peak) continue;
    const commit = maxAt.get(file);
    let lostArtifacts = 0;
    let sample = [];
    try {
      const old = git(['show', `${commit}:${file}`], { encoding: 'buffer' }).toString('utf8');
      const nowKeys = new Set(artifactsFromRenderedHtml(fs.readFileSync(abs, 'utf8')).map(artifactKey));
      const missing = artifactsFromRenderedHtml(old).filter((a) => !nowKeys.has(artifactKey(a)));
      lostArtifacts = missing.length;
      sample = missing.slice(0, 3).map((a) => `${a.type} | ${String(a.title).slice(0, 70)}`);
    } catch { /* an unreadable historic blob is reported as bytes-only, never as clean */ }
    below.push({ implementation_path: file, current_bytes: current, historic_max_bytes: peak, below_by_bytes: peak - current, historic_max_commit: commit.slice(0, 9), lost_artifact_blocks: lostArtifacts, lost_artifact_sample: sample });
  }
  below.sort((a, b) => (b.lost_artifact_blocks - a.lost_artifact_blocks) || (b.below_by_bytes - a.below_by_bytes));

  const withArtifactLoss = below.filter((r) => r.lost_artifact_blocks > 0);
  const doc = {
    schema_version: '1.0',
    authority: 'scripts/release/measure_historic_page_maximum.js',
    guard: 'scripts/validators/validate_rendered_output_shrink_guard.js',
    policy: 'SHRINK_ONLY. This is the enumerated set of accepted routes that are smaller today than they have ever been. A route that climbs back to its historic maximum must be deleted from the list. A route that falls below its historic maximum WITHOUT being listed is a new occurrence of the re-accept-rebaselines-a-shrink defect and fails.',
    reading_the_numbers: 'below_by_bytes is CONTEXT, not a finding: PRs #17, #18 and #28 deliberately deleted published content (an internal-instruction leak across 148 pages, build-acceptance criteria rendering as reader red flags on 20, and compiler-invented headings). Those pages are correctly smaller. lost_artifact_blocks is the number that matters - a delivered decision artifact that is no longer on the page.',
    measured_at: DATE,
    commits_sampled: commits.length,
    routes_measured: maxSize.size,
    routes_below_historic_max: below.length,
    routes_that_lost_artifact_blocks: withArtifactLoss.length,
    artifact_blocks_lost: withArtifactLoss.reduce((n, r) => n + r.lost_artifact_blocks, 0),
    total_bytes_below_historic_max: below.reduce((n, r) => n + r.below_by_bytes, 0),
    routes: below
  };
  fs.writeFileSync(rel(OUT), `${JSON.stringify(doc, null, 2)}\n`);
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(EVIDENCE), `${JSON.stringify({ ...doc, routes: undefined, top: withArtifactLoss.slice(0, 25) }, null, 2)}\n`);
  console.log(`HISTORIC PAGE MAXIMUM PASS: ${commits.length} commit(s) sampled; ${maxSize.size} accepted route(s) measured; ${below.length} below their historic maximum (${doc.total_bytes_below_historic_max} bytes), of which ${withArtifactLoss.length} lost ${doc.artifact_blocks_lost} delivered artifact block(s).`);
}

main();
