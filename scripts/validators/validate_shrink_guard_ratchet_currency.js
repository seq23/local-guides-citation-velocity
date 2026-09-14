#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The shrink guard's two allowlists have a writer, and the writer works.
 *
 * rendered-output-shrink-guard keeps two shrink-only ratchets, and both go stale when
 * a page GROWS:
 *
 *   - data/release/historic_page_maximum.json lists routes below their historic
 *     maximum; a listed route that climbs back must be deleted ("a ratchet may only
 *     tighten - delete these");
 *   - data/release/rendered_size_baseline.json#justified_shrinks names the exact size
 *     a route was allowed to fall to; a justification whose page is no longer at that
 *     size must be deleted ("a shrink licence may not outlive its shrink").
 *
 * The guard is correct to fail on both. It also declares NO repair, deliberately,
 * because its third failure mode - a page below its accepted floor - needs a judgment
 * no command can supply (registry: repair_scope). That left the two grow-back modes
 * with a demand and no one to meet it. The content release lane grows pages - that is
 * its job - and on 2026-09-14 (run 34851354622) it grew eight personal-injury routes
 * past their recorded ceiling AND past the sizes their 2026-09-10 justifications
 * named. Self-heal saw "no registered repair: rendered-output-shrink-guard", the
 * publish gate correctly let a repair-less failure through, the lane pushed, and the
 * Validate Repo run it dispatched (34858125966) went red on main on a bot commit.
 * Every future improvement to a previously-shrunk page would do the same, because the
 * lane had no way to tighten the lists it was invalidating.
 *
 * This validator is the two grow-back modes with their own repair:
 *
 *   - it FAILS when any listed route is at or above its historic maximum on disk, or
 *     any justified shrink names a page that is back at or above its floor - the same
 *     conditions the guard fails on, so the guard's verdict is unchanged and a stale
 *     row a lane did NOT retire still hard-fails in Validate Repo;
 *   - its repair_command, `npm run ratchet:shrink-guard`, retires exactly those rows
 *     and nothing else - no floor is raised or lowered, no route is added - so
 *     self-heal in every push lane runs it before the unassisted validate:release gate
 *     and the retirement lands in the same commit as the growth that caused it.
 *
 * Then it proves both writers, against throwaway fixtures, on every run:
 *   1. a route that climbed back is removed from `routes` and recorded in `retired`;
 *   2. a route still below its maximum is left untouched, and --check passes;
 *   3. a list with zero routes hard-fails - an empty ratchet is not a clean one;
 *   4. a list whose routes are all off disk hard-fails - nothing measured is not clean;
 *   5. a missing list hard-fails;
 *   6. a justification whose page is back at its floor is retired, one whose page is
 *      still at the named size is kept, one whose page is below its floor at an
 *      UNNAMED size is kept for the guard, and no floor moves;
 *   7. a baseline with zero floors, or none on disk, hard-fails.
 *
 * Rule 0: hard-fails if either file is missing, if zero listed routes are on disk, or
 * if zero fixture cases were examined.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const HISTORIC = 'data/release/historic_page_maximum.json';
const BASELINE = 'data/release/rendered_size_baseline.json';
const WRITER = path.join(ROOT, 'scripts/release/retire_recovered_historic_maximum.js');
const BASELINE_WRITER = path.join(ROOT, 'scripts/release/update_rendered_size_baseline.js');
const OUT = 'artifacts/validation/shrink-guard-ratchet-currency.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }

function fixtureRoot(routes, pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historic-ratchet-'));
  fs.mkdirSync(path.join(dir, 'data/release'), { recursive: true });
  fs.writeFileSync(path.join(dir, HISTORIC), `${JSON.stringify({
    schema_version: '1.0',
    measured_at: '2026-09-10',
    routes_below_historic_max: routes.length,
    routes_that_lost_artifact_blocks: routes.filter((r) => r.lost_artifact_blocks > 0).length,
    artifact_blocks_lost: routes.reduce((n, r) => n + (r.lost_artifact_blocks || 0), 0),
    total_bytes_below_historic_max: routes.reduce((n, r) => n + r.below_by_bytes, 0),
    routes
  }, null, 2)}\n`);
  for (const [relPath, bytes] of Object.entries(pages)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x'.repeat(bytes));
  }
  return dir;
}

function runWriter(dir, args = []) {
  const r = spawnSync(process.execPath, [WRITER, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, HISTORIC_RATCHET_ROOT: dir, SOURCE_DATE: DATE }
  });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function baselineRoot(routes, justified, pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrink-ratchet-'));
  fs.mkdirSync(path.join(dir, 'data/release'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/release/frozen_page_registry.json'), `${JSON.stringify({ pages: Object.keys(routes).map((rendered_file) => ({ rendered_file })) })}\n`);
  fs.writeFileSync(path.join(dir, BASELINE), `${JSON.stringify({ schema_version: '1.0', seeded_at: '2026-09-01', justified_shrinks: justified, routes }, null, 2)}\n`);
  for (const [relPath, bytes] of Object.entries(pages)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x'.repeat(bytes));
  }
  return dir;
}

function runBaselineWriter(dir, args = []) {
  const r = spawnSync(process.execPath, [BASELINE_WRITER, '--retire-stale-justifications', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, RENDERED_BASELINE_ROOT: dir, SOURCE_DATE: DATE }
  });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const row = (p, max, cur, lost = 0) => ({
  implementation_path: p, current_bytes: cur, historic_max_bytes: max, below_by_bytes: max - cur,
  historic_max_commit: 'abcdef012', lost_artifact_blocks: lost, lost_artifact_sample: []
});

function fixtureCases() {
  const cases = [];
  const dirs = [];

  // 1. A route that climbed back is retired; a sibling still below stays; totals follow.
  {
    const dir = fixtureRoot([row('a/index.html', 1000, 800, 2), row('b/index.html', 500, 400)], { 'a/index.html': 1200, 'b/index.html': 400 });
    dirs.push(dir);
    const before = runWriter(dir, ['--check']);
    const run = runWriter(dir);
    const doc = readJson(path.join(dir, HISTORIC), {});
    const routes = (doc.routes || []).map((r) => r.implementation_path);
    const retired = (doc.retired || []).map((r) => r.implementation_path);
    cases.push({
      name: 'climbed_back_row_is_retired_and_recorded',
      why: 'The lane grew a/index.html from 800B past its 1000B ceiling. The row must leave routes, land in retired with the recovered size, and the summary counts must follow; b/index.html, still below, must be untouched.',
      pass: before.code !== 0 && /a\/index\.html/.test(before.out)
        && run.code === 0
        && routes.length === 1 && routes[0] === 'b/index.html'
        && retired.length === 1 && retired[0] === 'a/index.html'
        && doc.retired[0].recovered_to_bytes === 1200 && doc.retired[0].historic_max_bytes === 1000
        && doc.routes_below_historic_max === 1 && doc.routes_that_lost_artifact_blocks === 0 && doc.artifact_blocks_lost === 0
        && doc.total_bytes_below_historic_max === 100
        && runWriter(dir, ['--check']).code === 0,
      observed: { check_before: before.code, run: run.code, routes, retired, counts: [doc.routes_below_historic_max, doc.artifact_blocks_lost, doc.total_bytes_below_historic_max] }
    });
  }

  // 2. Nothing climbed back: the file is byte-identical afterwards and --check passes.
  {
    const dir = fixtureRoot([row('a/index.html', 1000, 800)], { 'a/index.html': 800 });
    dirs.push(dir);
    const original = fs.readFileSync(path.join(dir, HISTORIC), 'utf8');
    const check = runWriter(dir, ['--check']);
    const run = runWriter(dir);
    const after = fs.readFileSync(path.join(dir, HISTORIC), 'utf8');
    cases.push({
      name: 'still_below_row_is_left_alone',
      why: 'A ratchet may only tighten. A route still below its maximum is not touched, and a writer that rewrites an unchanged list would be a mutation with no cause.',
      pass: check.code === 0 && run.code === 0 && after === original,
      observed: { check: check.code, run: run.code, unchanged: after === original }
    });
  }

  // 3. Zero routes listed: hard fail, both modes.
  {
    const dir = fixtureRoot([], {});
    dirs.push(dir);
    const check = runWriter(dir, ['--check']);
    const run = runWriter(dir);
    cases.push({
      name: 'empty_list_hard_fails',
      why: 'An empty routes array examines nothing. Exiting 0 over it would let a truncated or never-measured list read as "every page is at its maximum".',
      pass: check.code !== 0 && run.code !== 0 && /zero routes/.test(run.out),
      observed: { check: check.code, run: run.code }
    });
  }

  // 4. Routes listed, none on disk: hard fail.
  {
    const dir = fixtureRoot([row('a/index.html', 1000, 800)], {});
    dirs.push(dir);
    const run = runWriter(dir);
    cases.push({
      name: 'nothing_on_disk_hard_fails',
      why: 'A list whose pages are all absent measured nothing; that is UNKNOWN, not clean, and must not be reported as "none climbed back".',
      pass: run.code !== 0 && /none is on disk/.test(run.out),
      observed: { run: run.code }
    });
  }

  // 5. Missing file: hard fail.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historic-ratchet-'));
    dirs.push(dir);
    const run = runWriter(dir);
    cases.push({
      name: 'missing_list_hard_fails',
      why: 'No list means no ratchet. The writer must refuse rather than create an empty one.',
      pass: run.code !== 0 && /missing/.test(run.out),
      observed: { run: run.code }
    });
  }

  // 6. Justified shrinks: moot one retired, reproducing one kept, unnamed-size one kept, floors untouched.
  {
    const justified = [
      { implementation_path: 'grew/index.html', from_bytes: 1000, to_bytes: 900, reason: 'test' },
      { implementation_path: 'same/index.html', from_bytes: 1000, to_bytes: 900, reason: 'test' },
      { implementation_path: 'lower/index.html', from_bytes: 1000, to_bytes: 900, reason: 'test' }
    ];
    const routes = { 'grew/index.html': 900, 'same/index.html': 900, 'lower/index.html': 900, 'other/index.html': 500 };
    const dir = baselineRoot(routes, justified, { 'grew/index.html': 1300, 'same/index.html': 900, 'lower/index.html': 850, 'other/index.html': 600 });
    dirs.push(dir);
    const before = runBaselineWriter(dir, ['--check']);
    const run = runBaselineWriter(dir);
    const doc = readJson(path.join(dir, BASELINE), {});
    const keptPaths = (doc.justified_shrinks || []).map((j) => j.implementation_path);
    const retiredPaths = (doc.retired_justifications || []).map((j) => j.implementation_path);
    cases.push({
      name: 'moot_justification_is_retired_floors_untouched',
      why: 'grew/ is back above its floor: its licence is moot and leaves. same/ still reproduces: kept. lower/ is below floor at a size the licence does not name: a NEW shrink, kept so the guard fails on it. other/ grew, and its floor must NOT rise - this mode is not the rise-only floor update.',
      pass: before.code !== 0 && /grew\/index\.html/.test(before.out) && !/same\/index\.html/.test(before.out)
        && run.code === 0
        && keptPaths.length === 2 && keptPaths.includes('same/index.html') && keptPaths.includes('lower/index.html')
        && retiredPaths.length === 1 && retiredPaths[0] === 'grew/index.html' && doc.retired_justifications[0].recovered_to_bytes === 1300
        && JSON.stringify(doc.routes) === JSON.stringify(routes)
        && runBaselineWriter(dir, ['--check']).code === 0,
      observed: { check_before: before.code, run: run.code, kept: keptPaths, retired: retiredPaths, routes: doc.routes }
    });
  }

  // 7. A baseline with zero floors, and one with floors but nothing on disk, hard-fail.
  {
    const empty = baselineRoot({}, [], {});
    dirs.push(empty);
    const offDisk = baselineRoot({ 'a/index.html': 100 }, [], {});
    dirs.push(offDisk);
    const e = runBaselineWriter(empty);
    const o = runBaselineWriter(offDisk);
    cases.push({
      name: 'baseline_with_nothing_to_measure_hard_fails',
      why: 'No floors, or floors with no page on disk, measured nothing; the writer must refuse rather than report "none moot".',
      pass: e.code !== 0 && /no route floors|missing or empty/.test(e.out) && o.code !== 0 && /zero measurable on disk/.test(o.out),
      observed: { empty: e.code, off_disk: o.code }
    });
  }

  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  return cases;
}

function main() {
  for (const w of [WRITER, BASELINE_WRITER]) {
    if (!fs.existsSync(w)) {
      console.error(`SHRINK GUARD RATCHET CURRENCY FAIL: ${path.relative(ROOT, w)} is missing. The ratchet has no writer, so a stale row can only be retired by hand.`);
      process.exit(1);
    }
  }

  // Live half: the committed list, measured against the rendered output on disk.
  const historic = readJson(rel(HISTORIC), null);
  if (!historic || !Array.isArray(historic.routes) || !historic.routes.length) {
    console.error(`SHRINK GUARD RATCHET CURRENCY FAIL: ${HISTORIC} is missing or lists zero routes. Run \`npm run measure:historic-page-maximum\`, review, and commit.`);
    process.exit(1);
  }
  let onDisk = 0;
  const climbedBack = [];
  for (const r of historic.routes) {
    const abs = rel(String(r.implementation_path || ''));
    if (!r.implementation_path || !fs.existsSync(abs)) continue;
    onDisk += 1;
    const size = fs.statSync(abs).size;
    if (size >= Number(r.historic_max_bytes)) climbedBack.push({ implementation_path: r.implementation_path, historic_max_bytes: Number(r.historic_max_bytes), current_bytes: size });
  }
  if (onDisk === 0) {
    console.error(`SHRINK GUARD RATCHET CURRENCY FAIL: ${historic.routes.length} route(s) listed and none is on disk. Nothing was measured. Build the site, then re-run.`);
    process.exit(1);
  }

  const baseline = readJson(rel(BASELINE), null);
  if (!baseline || !baseline.routes || !Object.keys(baseline.routes).length) {
    console.error(`SHRINK GUARD RATCHET CURRENCY FAIL: ${BASELINE} is missing or carries no route floors.`);
    process.exit(1);
  }
  const mootJustifications = [];
  for (const named of baseline.justified_shrinks || []) {
    const relPath = String(named.implementation_path || '');
    const abs = rel(relPath);
    if (!relPath || !fs.existsSync(abs)) continue;
    const size = fs.statSync(abs).size;
    const floor = Number(baseline.routes[relPath]);
    if (size !== Number(named.to_bytes) && Number.isFinite(floor) && size >= floor) mootJustifications.push({ implementation_path: relPath, named_bytes: Number(named.to_bytes), floor_bytes: floor, current_bytes: size });
  }

  // Behavioural half: the writers, against constructed inputs.
  const cases = fixtureCases();
  const failedCases = cases.filter((c) => !c.pass);
  if (!cases.length) {
    console.error('SHRINK GUARD RATCHET CURRENCY FAIL: zero writer cases examined.');
    process.exit(1);
  }

  const status = (climbedBack.length || mootJustifications.length || failedCases.length) ? 'FAIL' : 'PASS';
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify({
    schema_version: '1.0',
    validator: 'shrink-guard-ratchet-currency',
    status,
    checked_at: DATE,
    writers: ['scripts/release/retire_recovered_historic_maximum.js', 'scripts/release/update_rendered_size_baseline.js --retire-stale-justifications'],
    repair_command: 'npm run ratchet:shrink-guard',
    routes_listed: historic.routes.length,
    routes_on_disk: onDisk,
    retired_on_record: Array.isArray(historic.retired) ? historic.retired.length : 0,
    climbed_back_still_listed: climbedBack,
    justified_shrinks_listed: (baseline.justified_shrinks || []).length,
    retired_justifications_on_record: Array.isArray(baseline.retired_justifications) ? baseline.retired_justifications.length : 0,
    moot_justifications_still_listed: mootJustifications,
    writer_cases: cases.map((c) => ({ name: c.name, pass: c.pass, why: c.why, observed: c.observed }))
  }, null, 2)}\n`);

  if (failedCases.length) {
    console.error(`SHRINK GUARD RATCHET CURRENCY FAIL: ${failedCases.length} of ${cases.length} writer case(s) failed against constructed inputs:`);
    for (const c of failedCases) console.error(`  ${c.name}: ${JSON.stringify(c.observed)}`);
    process.exit(1);
  }
  if (climbedBack.length || mootJustifications.length) {
    console.error(`SHRINK GUARD RATCHET CURRENCY FAIL: ${climbedBack.length} listed route(s) have climbed back to their historic maximum and ${mootJustifications.length} justified shrink(s) name a page that is back at or above its floor. A ratchet may only tighten. Repair: \`npm run ratchet:shrink-guard\`, then commit ${HISTORIC} and ${BASELINE} (self-heal runs this in every push lane).`);
    for (const r of climbedBack.slice(0, 25)) console.error(`  ${HISTORIC}: ${r.implementation_path}  historic max ${r.historic_max_bytes}B, page is ${r.current_bytes}B`);
    for (const r of mootJustifications.slice(0, 25)) console.error(`  ${BASELINE}: ${r.implementation_path}  named ${r.named_bytes}B, floor ${r.floor_bytes}B, page is ${r.current_bytes}B`);
    process.exit(1);
  }
  console.log(`SHRINK GUARD RATCHET CURRENCY PASS: ${onDisk} of ${historic.routes.length} listed route(s) on disk and still below their historic maximum (${Array.isArray(historic.retired) ? historic.retired.length : 0} retired on record); ${(baseline.justified_shrinks || []).length} justified shrink(s) still reproducing (${Array.isArray(baseline.retired_justifications) ? baseline.retired_justifications.length : 0} retired on record); writers proven on ${cases.length} constructed case(s).`);
}

main();
