#!/usr/bin/env node
'use strict';
/**
 * Two lanes went red on 2026-08-30 for two different ordering failures, and both
 * are invisible to every content validator in this repo.
 *
 * 1. SITEMAP DERIVED BEFORE THE REGISTRY IT READS.
 *    scripts/build_site.js:203 builds the sitemap from
 *    data/content/page_admission_registry.json. finalize_content_release.js
 *    rebuilt that registry four steps AFTER the build that reads it, so a route
 *    the release had just admitted could never reach the sitemap the release
 *    published. validate_page_release_law then failed it as sitemap_missing:
 *      /dentistry/guides/dental-bridge-vs-implant-which-is-better/
 *      /dentistry/guides/how-do-i-find-a-good-dentist-for-my-child/
 *    Detection was never the problem - the law caught it. The pipeline simply
 *    could not satisfy the law it was checked against.
 *
 * 2. FOUR MAIN WRITERS, FOUR CONCURRENCY GROUPS.
 *    query-evidence-refresh, velocity-content-release,
 *    daily-citation-intelligence and search-intelligence-loop all push to main
 *    and each held its own group, so nothing serialised them against each other.
 *    Two overlapped and the second lost its push with
 *    `! [rejected] main -> main (non-fast-forward)`. A group per workflow
 *    protects a workflow from itself, not the branch they all write to.
 *
 * Both are order-and-linkage facts, not content facts, so they are asserted here
 * directly. Zero-item rule: hard-fails when it finds no run() steps or no
 * main-writing workflow, rather than passing on an empty loop.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RELEASE = 'scripts/release/finalize_content_release.js';
const WORKFLOWS = '.github/workflows';
const errors = [];
const checks = [];

// --- 1. the sitemap-deriving build must run after the registry rebuild --------
const releaseSource = fs.readFileSync(path.join(ROOT, RELEASE), 'utf8');
const steps = [...releaseSource.matchAll(/run\('([^']+)'\)/g)].map((m) => m[1]);
if (!steps.length) {
  console.error(`[main-writer-ordering] FAIL: no run() steps found in ${RELEASE}; this check no longer reaches the pipeline it governs.`);
  process.exit(1);
}
const lastBuild = steps.map((s, i) => (/npm run build\b/.test(s) ? i : -1)).filter((i) => i >= 0).pop();
const registryStep = steps.findIndex((s) => /build_page_admission_registry/.test(s));
const releaseLaw = steps.findIndex((s) => /validate_page_release_law/.test(s));
if (lastBuild === undefined) errors.push(`${RELEASE} never runs the build that derives the sitemap`);
if (registryStep < 0) errors.push(`${RELEASE} never rebuilds data/content/page_admission_registry.json`);
if (releaseLaw < 0) errors.push(`${RELEASE} never runs validate_page_release_law`);
if (lastBuild !== undefined && registryStep >= 0 && releaseLaw >= 0) {
  if (lastBuild < registryStep) {
    errors.push(`the sitemap-deriving build (step ${lastBuild + 1}) runs BEFORE the admission registry rebuild (step ${registryStep + 1}). scripts/build_site.js reads that registry, so any route admitted by this release is missing from the sitemap it publishes.`);
  } else if (releaseLaw < lastBuild) {
    errors.push(`validate_page_release_law (step ${releaseLaw + 1}) runs BEFORE the last build (step ${lastBuild + 1}), so it grades a sitemap the release then replaces.`);
  } else {
    checks.push(`release order is registry(${registryStep + 1}) -> build(${lastBuild + 1}) -> page_release_law(${releaseLaw + 1})`);
  }
}

// --- 2. every workflow that pushes to main shares one concurrency group -------
const files = fs.readdirSync(path.join(ROOT, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));
const writers = [];
for (const file of files) {
  const src = fs.readFileSync(path.join(ROOT, WORKFLOWS, file), 'utf8');
  const pushesMain = /git-auto-commit-action|git push|safe-push-main/.test(src);
  if (!pushesMain) continue;
  const group = (src.match(/concurrency:\s*(?:\n\s*#[^\n]*)*\n\s*group:\s*([^\n]+)/) || [])[1];
  writers.push({file, group: group ? group.trim() : null});
}
if (!writers.length) {
  errors.push('no workflow was detected as writing to main; either the push mechanism changed or this scan no longer reaches what it governs.');
} else {
  const missing = writers.filter((w) => !w.group);
  const groups = [...new Set(writers.map((w) => w.group).filter(Boolean))];
  if (missing.length) errors.push(`${missing.length} main-writing workflow(s) declare no concurrency group: ${missing.map((w) => w.file).join(', ')}`);
  if (groups.length > 1) {
    errors.push(`${writers.length} workflows write to main under ${groups.length} different concurrency groups [${groups.join(', ')}], so nothing serialises them against each other: ${writers.map((w) => `${w.file}=${w.group}`).join(', ')}`);
  } else if (groups.length === 1) {
    checks.push(`${writers.length} main-writing workflow(s) share the single group "${groups[0]}"`);
  }
}

const report = {
  schema_version: '1.0',
  validator: 'main-writer-ordering',
  status: errors.length ? 'FAIL' : 'PASS',
  release_steps: steps.length,
  main_writers: writers,
  checks,
  errors,
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/main-writer-ordering.json'), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`[main-writer-ordering] FAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`[main-writer-ordering] PASS: ${steps.length} release step(s), ${writers.length} main-writing workflow(s); ${checks.join('; ')}`);
