#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Maintain the rendered-size ratchet.
 *
 * The 2026-09-01 recoverability work found the failure mode this guards: a page was
 * thawed, rebuilt 22 KB lighter because its content was no longer derivable from
 * source, and re-accepted - which made the thinner output the new accepted baseline.
 * Nothing failed. The content was simply gone, and the frozen store had been the only
 * copy. An earlier attempt at the same repair dropped 14 KB and 22 KB exactly that way
 * and CI stayed green.
 *
 * So the baseline may only ever RISE. A page that grows raises its own floor; a page
 * that shrinks does not lower it. Lowering a floor requires a named entry in
 * `justified_shrinks` giving the route, the byte count, and why the content left.
 * That is the only way a page is allowed to get smaller, and it leaves a record a
 * human can read instead of a silently-rewritten number.
 *
 *   (no flags)   raise floors for pages that grew; never lower one
 *   --seed       create the file from the current rendered output (first run only)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BASELINE = 'data/release/rendered_size_baseline.json';
const REGISTRY = 'data/release/frozen_page_registry.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const SEED = process.argv.includes('--seed');

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function main() {
  const registry = readJson(REGISTRY, null);
  if (!registry || !Array.isArray(registry.pages) || !registry.pages.length) {
    console.error(`RENDERED SIZE BASELINE FAIL: ${REGISTRY} is missing or empty; there is nothing to measure.`);
    process.exit(1);
  }
  const existing = readJson(BASELINE, null);
  if (!existing && !SEED) {
    console.error(`RENDERED SIZE BASELINE FAIL: ${BASELINE} does not exist. Run once with --seed to create it.`);
    process.exit(1);
  }
  const baseline = existing || {
    schema_version: '1.0',
    authority: 'scripts/release/update_rendered_size_baseline.js',
    policy: 'RISE_ONLY. A route floor may be raised when the rendered page grows. It is never lowered by a rebuild, an accept, or a refreeze. Lowering one requires an entry in justified_shrinks naming the route, the new size, and the reason the content left.',
    guard: 'scripts/validators/validate_rendered_output_shrink_guard.js',
    seeded_at: DATE,
    justified_shrinks: [],
    routes: {}
  };
  baseline.routes = baseline.routes || {};
  baseline.justified_shrinks = baseline.justified_shrinks || [];

  const justified = new Map(baseline.justified_shrinks.map((s) => [String(s.implementation_path || ''), s]));

  let raised = 0;
  let added = 0;
  let measured = 0;
  let lowered = 0;
  for (const record of registry.pages) {
    const relPath = String(record.rendered_file || '');
    if (!relPath) continue;
    const abs = rel(relPath);
    if (!fs.existsSync(abs)) continue;
    measured += 1;
    const size = fs.statSync(abs).size;
    const floor = baseline.routes[relPath];
    if (floor === undefined) { baseline.routes[relPath] = size; added += 1; continue; }
    if (size > floor) { baseline.routes[relPath] = size; raised += 1; continue; }
    if (size < floor) {
      const named = justified.get(relPath);
      // A justified shrink lowers the floor exactly once, to the size the
      // justification names. It does not license every future shrink on that route.
      if (named && Number(named.to_bytes) === size) { baseline.routes[relPath] = size; lowered += 1; }
    }
  }

  if (measured === 0) {
    console.error('RENDERED SIZE BASELINE FAIL: measured zero rendered pages. Build the site first; an empty measurement is not a baseline.');
    process.exit(1);
  }

  baseline.updated_at = DATE;
  baseline.route_count = Object.keys(baseline.routes).length;
  fs.writeFileSync(rel(BASELINE), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`RENDERED SIZE BASELINE PASS: measured ${measured} rendered page(s); ${added} added, ${raised} floor(s) raised, ${lowered} lowered under a named justification.`);
}

main();
