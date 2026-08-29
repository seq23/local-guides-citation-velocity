#!/usr/bin/env node
'use strict';
// Doubled vertical slugs ("dentistry-dentistry-...") must never reach a route.
//
// What this used to do, and why that was wrong
// --------------------------------------------
// walk() opened with `if(!fs.existsSync(full)) return;` and the driver was
// `walk('insights'); walk('atlas'); walk('dist');`. dist/ is a BUILD output. On
// any tree where the build had not run - a fresh clone, a CI job that validates
// before it builds, a sandbox - dist/ did not exist, walk() returned instantly,
// and the check evaporated. Reproduced: with no dist/ present the validator
// printed "Double vertical slug validation passed." and exited 0 having scanned
// the rendered routes not at all. readTextSafe() had the same hole: a missing or
// unreadable seed file returned '' and scanFile() bailed on the falsy string, so
// a vanished sitemap.xml or llms.txt also counted as clean.
//
// The fix is a floor, not a loosened assertion. Every directory in the sweep and
// every named seed file must EXIST, and the sweep must actually examine at least
// as many files as the current real tree carries. A missing directory is now a
// hard failure that names the directory and the remedy; it is never a silent
// return. "There was nothing to scan" and "I scanned everything and it was
// clean" no longer print the same sentence.

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const verticals = ['dentistry', 'neuro', 'trt', 'uscis-medical', 'personal-injury'];
const patterns = verticals.map(v => `${v}-${v}-`);

// Measured on the real tree at 2026-08-29 by running this sweep and counting the
// files it actually opened: insights/ 1243 + atlas/ 6 + dist/ 2207 + 6 seed
// files = 3462. MIN is a FLOOR, set below the measured count so ordinary content
// growth or a small prune does not trip it, but far above the handful of files a
// truncated or unbuilt tree exposes (an unbuilt tree loses all 2207 dist/ files
// at once and lands under 1300). Changing it must be deliberate: re-measure by
// running this validator and reading the scanned count it now prints.
const MEASURED_FILES_2026_08_29 = 3462;
const MIN_FILES_SCANNED = 3000;

const SEED_FILES = [
  'content/_shared/query_to_cluster_map.json',
  'content/_shared/atlas_registry.json',
  'content/_live/insights.json',
  'content/_live/published_urls.json',
  'sitemap.xml',
  'llms.txt',
];
const SWEEP_DIRS = ['insights', 'atlas', 'dist'];

const issues = [];
const stops = [];
let scanned = 0;

function fullPath(rel) { return path.join(ROOT, rel); }

function scanFile(relPath, { required = false } = {}) {
  const full = fullPath(relPath);
  if (!fs.existsSync(full)) {
    if (required) stops.push(`required input ${relPath} does not exist, so it was not scanned`);
    return;
  }
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) {
    stops.push(`required input ${relPath} could not be read (${e.message}), so it was not scanned`);
    return;
  }
  scanned++;
  for (const pat of patterns) { if (text.includes(pat)) issues.push({ file: relPath, pattern: pat }); }
}

function walk(dirRel) {
  const full = fullPath(dirRel);
  // Was `return`. A directory that is not there means this sweep covered none of
  // the routes it lives in, which is a failure to check - not a clean result.
  if (!fs.existsSync(full)) {
    stops.push(`sweep directory ${dirRel}/ does not exist, so none of its routes were scanned for doubled vertical slugs`);
    return;
  }
  for (const name of fs.readdirSync(full)) {
    const rel = path.join(dirRel, name);
    const abs = fullPath(rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isDirectory()) walk(rel);
    else if (/\.(json|xml|txt|html|js|md)$/.test(name)) scanFile(rel);
  }
}

for (const rel of SEED_FILES) scanFile(rel, { required: true });
for (const dir of SWEEP_DIRS) walk(dir);

// ------------------------------------------------------------------- Rule 0
if (scanned < MIN_FILES_SCANNED) {
  stops.push(`only ${scanned} file(s) were scanned; expected at least ${MIN_FILES_SCANNED} (the tree measured ${MEASURED_FILES_2026_08_29} on 2026-08-29). The tree is unbuilt or truncated, so this check graded almost nothing.`);
}

if (stops.length) {
  console.error('DOUBLE VERTICAL SLUG VALIDATION: STOP - the sweep did not cover the tree, so it cannot report a result.');
  for (const s of stops) console.error(`- ${s}`);
  console.error(`  Scanned ${scanned} file(s) across ${SWEEP_DIRS.map(d => `${d}/`).join(', ')} and ${SEED_FILES.length} seed file(s).`);
  console.error('  Remedy: build the site first (dist/ is a build output) and re-run, or restore the missing input. A missing directory must never read as "no doubled slugs found".');
  process.exit(1);
}

if (issues.length) {
  console.error('DOUBLE VERTICAL SLUG VALIDATION FAIL');
  for (const issue of issues.slice(0, 100)) console.error(`- ${issue.file}: contains "${issue.pattern}"`);
  if (issues.length > 100) console.error(`...and ${issues.length - 100} more`);
  process.exit(1);
}
console.log(`Double vertical slug validation passed: ${scanned} file(s) scanned across ${SWEEP_DIRS.map(d => `${d}/`).join(', ')} plus ${SEED_FILES.length} seed file(s); 0 doubled vertical slugs (patterns: ${patterns.join(', ')}).`);
