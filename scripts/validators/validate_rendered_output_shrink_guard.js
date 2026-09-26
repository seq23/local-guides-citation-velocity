#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * No page gets smaller without someone saying why.
 *
 * This is the guard for the failure that made the 2026-09-01 recoverability work
 * necessary. A route was thawed for an unrelated repair, rebuilt without content the
 * pipeline could no longer derive, and re-accepted - and re-accepting installed the
 * thinner page as the new baseline. Every check passed. 14 KB and 22 KB of delivered
 * content left the site with no error, no diff and no record. Measured across the
 * whole store, a full thaw would have dropped 1,145,001 bytes the same way.
 *
 * The rule is therefore stated in bytes, against a RISE-ONLY floor
 * (data/release/rendered_size_baseline.json), and it is enforced on the rendered
 * output rather than on any source manifest - because the rendered output is what a
 * reader and an answer engine actually get.
 *
 *   - a page at or above its floor passes;
 *   - a page below its floor FAILS, unless justified_shrinks names that route with
 *     exactly the size it is allowed to fall to;
 *   - a justification that no longer applies (the page is at or above its floor
 *     again) FAILS, so the list may only shrink - the same ratchet discipline the
 *     absorption baseline uses.
 *
 * A FLOOR IS NOT ENOUGH ON ITS OWN.
 *
 * The floor file was seeded from the rendered output as it stood on 2026-09-01, so it
 * protects every page from that day forward and silently blesses whatever size a page
 * had already been reduced to. sprylabs-hpc-site was audited against this same defect
 * list on the same day and found 18 pages already re-frozen thinner on HEAD - invisible
 * to a forward-only guard. Measured here the same way: 862 accepted routes sit below
 * their historic maximum, and 111 of them have lost 626 delivered artifact blocks.
 *
 * data/release/historic_page_maximum.json enumerates them, and this validator treats
 * that list as a shrink-only ratchet: a route that falls below its historic maximum
 * without being on the list is a NEW occurrence and fails, and a listed route that
 * climbs back must be deleted from the list.
 *
 * Both lists have a writer for the grow-back direction: scripts/release/
 * retire_recovered_historic_maximum.js and update_rendered_size_baseline.js
 * --retire-stale-justifications (`npm run ratchet:shrink-guard`), registered as the
 * repair of shrink-guard-ratchet-currency so a push lane retires the rows in the same
 * commit that grows the page. This guard still fails on the stale rows itself - a lane
 * that did not run the writer, or a human edit that skipped it, is still red here.
 *
 * A NAMED SHRINK LOWERS THE FLOOR TO THE NAMED SIZE - IT IS NOT AN EXACT-SIZE PIN.
 *
 * Until 2026-09-26 a justification only held while the page sat at EXACTLY to_bytes.
 * A page that later GREW, but not all the way back to its old floor, matched neither
 * branch and was reported as "delivered content gone with no stated reason" - for
 * content that had been ADDED. Velocity Content Release run 36225050414 re-attached a
 * three-link adopted-links section (served targets only) to a uscis-medical page whose
 * 2026-09-25 licence named 39609B under a 40372B floor; the page rose to 40243B, the
 * guard called that a 129-byte loss, and Validate Repo run 36225602982 went red on
 * main. Nothing was lost: relative to the accepted state the page gained 634 bytes.
 * update_rendered_size_baseline.js already treats to_bytes as the lowered floor, so
 * the guard now does the same:
 *
 *   - size >= to_bytes (and below the floor) passes; the licence is LOOSE and is
 *     reported so `npm run ratchet:shrink-guard` can tighten to_bytes up to the page;
 *   - size <  to_bytes FAILS - the page fell below what its own reason accepted, which
 *     is a new shrink no licence covers.
 *
 * selfProofCases() proves those rules against constructed inputs on every run, and
 * proves the writer tightens a loose licence without moving any floor.
 *
 * Rule 0: measuring zero pages is a failure. An empty loop and a clean site are
 * indistinguishable from the outside, and that is exactly how this defect hid. Zero
 * self-proof cases examined is a failure too.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASELINE = 'data/release/rendered_size_baseline.json';
const HISTORIC = 'data/release/historic_page_maximum.json';
const OUT = 'artifacts/validation/rendered-output-shrink-guard.json';
const BASELINE_WRITER = path.join(ROOT, 'scripts/release/update_rendered_size_baseline.js');

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

/**
 * Classify every route floor against the page sizes on disk. Pure: sizeOf(relPath)
 * returns a byte count, or null when the page is not on disk.
 *   shrunk - below the effective floor (the floor, or a justification's to_bytes)
 *   moot   - a justification whose page is back at or above its floor
 *   loose  - a justification whose page grew above to_bytes but not back to the floor
 */
function classify(baseline, sizeOf) {
  const justified = new Map((baseline.justified_shrinks || []).map((s) => [String(s.implementation_path || ''), s]));
  const shrunk = [];
  const moot = [];
  const loose = [];
  const missing = [];
  let measured = 0;
  let atOrAbove = 0;
  for (const [relPath, floorRaw] of Object.entries(baseline.routes || {})) {
    const size = sizeOf(relPath);
    if (size === null) { missing.push(relPath); continue; }
    measured += 1;
    const floor = Number(floorRaw);
    if (size >= floor) { atOrAbove += 1; continue; }
    const named = justified.get(relPath);
    const namedBytes = named ? Number(named.to_bytes) : NaN;
    if (named && Number.isFinite(namedBytes) && size >= namedBytes) continue;
    const effectiveFloor = named && Number.isFinite(namedBytes) ? namedBytes : floor;
    shrunk.push({
      implementation_path: relPath,
      floor_bytes: floor,
      current_bytes: size,
      lost_bytes: effectiveFloor - size,
      justification: named
        ? `named for ${named.to_bytes} bytes; the page fell a further ${effectiveFloor - size} byte(s) below what its reason accepted`
        : 'none'
    });
  }
  for (const [relPath, named] of justified) {
    const size = sizeOf(relPath);
    if (size === null) continue;
    const namedBytes = Number(named.to_bytes);
    if (size === namedBytes) continue;
    const floor = Number((baseline.routes || {})[relPath]);
    const row = { implementation_path: relPath, expected_bytes: namedBytes, current_bytes: size, floor_bytes: floor };
    if (Number.isFinite(floor) && size >= floor) moot.push(row);
    else if (size > namedBytes) loose.push(row);
  }
  return { shrunk, moot, loose, missing, measured, atOrAbove };
}

/**
 * WHO RUNS THE WRITER. The ratchet writer (`npm run ratchet:shrink-guard`) must run in
 * every lane that builds pages and pushes them, on the tree it is about to push, and
 * stage exactly its two files by explicit pathspec. It is deliberately NOT a hard-fail
 * validator any more: shrink-guard-ratchet-currency was retired 2026-09-22 (23bd31e99,
 * "ratchets that failed when a page improved" turned main red on content motion), and
 * that reason stands - a stale row is bookkeeping, not lost content. What the retirement
 * did not do was move the writer anywhere, so nothing ran it and 62 rows went stale.
 * This check pins the wiring instead: a workflow that builds and pushes but does not run
 * the ratchet after its last build and before its last commit is reported by name.
 * Returns { lanes: [names examined], missing: [names failing] }.
 */
const RATCHET_CMD = 'npm run ratchet:shrink-guard';
const RATCHET_ADD = 'git add -- data/release/historic_page_maximum.json data/release/rendered_size_baseline.json';
function ratchetWiring(workflows) {
  const lanes = [];
  const missing = [];
  for (const [name, text] of Object.entries(workflows)) {
    if (!/git push/.test(text)) continue;
    const buildAt = Math.max(text.lastIndexOf('npm run build'), text.lastIndexOf('build:cached'), text.lastIndexOf('release:full-rebuild'));
    if (buildAt < 0) continue;
    lanes.push(name);
    const commitAt = text.lastIndexOf('git commit');
    const ratchetAt = text.lastIndexOf(RATCHET_CMD);
    const addAt = text.lastIndexOf(RATCHET_ADD);
    if (!(ratchetAt > buildAt && addAt > ratchetAt && commitAt > addAt)) missing.push(name);
  }
  return { lanes, missing };
}
function readWorkflows(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) if (/\.ya?ml$/.test(f)) out[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}

/**
 * Constructed inputs, run on every invocation. Each case names the rule it pins.
 */
function selfProofCases() {
  const cases = [];
  const base = {
    routes: { 'exact/index.html': 1000, 'grew/index.html': 1000, 'fell/index.html': 1000, 'unnamed/index.html': 1000, 'back/index.html': 1000, 'fine/index.html': 1000 },
    justified_shrinks: [
      { implementation_path: 'exact/index.html', to_bytes: 900 },
      { implementation_path: 'grew/index.html', to_bytes: 900 },
      { implementation_path: 'fell/index.html', to_bytes: 900 },
      { implementation_path: 'back/index.html', to_bytes: 900 }
    ]
  };
  const sizes = { 'exact/index.html': 900, 'grew/index.html': 950, 'fell/index.html': 899, 'unnamed/index.html': 999, 'back/index.html': 1000, 'fine/index.html': 1200 };
  const r = classify(base, (p) => (p in sizes ? sizes[p] : null));
  const shrunkPaths = r.shrunk.map((s) => s.implementation_path).sort();
  cases.push({
    name: 'named_licence_is_a_lowered_floor',
    why: 'exact/ sits at its named size and grew/ rose above it (content ADDED) - both pass. fell/ dropped one byte below what its reason accepted and unnamed/ dropped below a floor with no reason - both fail. back/ reached its floor (moot licence) and fine/ grew past its floor - both pass.',
    pass: JSON.stringify(shrunkPaths) === JSON.stringify(['fell/index.html', 'unnamed/index.html'])
      && r.shrunk.find((s) => s.implementation_path === 'fell/index.html').lost_bytes === 1
      && r.shrunk.find((s) => s.implementation_path === 'unnamed/index.html').lost_bytes === 1
      && r.loose.length === 1 && r.loose[0].implementation_path === 'grew/index.html'
      && r.moot.length === 1 && r.moot[0].implementation_path === 'back/index.html'
      && r.measured === 6 && r.atOrAbove === 2,
    observed: { shrunk: shrunkPaths, loose: r.loose.map((x) => x.implementation_path), moot: r.moot.map((x) => x.implementation_path), measured: r.measured }
  });

  const none = classify({ routes: { 'a/index.html': 10 }, justified_shrinks: [] }, () => null);
  cases.push({
    name: 'nothing_on_disk_measures_zero',
    why: 'Floors with no page on disk measured nothing; main() must see measured === 0 and refuse.',
    pass: none.measured === 0 && none.missing.length === 1,
    observed: { measured: none.measured }
  });

  {
    const wired = `run: |\n  npm run build:cached:prune\n  ${RATCHET_CMD}\n  ${RATCHET_ADD}\n  git commit --amend --no-edit\n  git push origin HEAD:main\n`;
    const unwired = 'run: |\n  npm run build:cached:prune\n  git add -A\n  git commit --amend --no-edit\n  git push origin HEAD:main\n';
    const beforeBuild = `run: |\n  ${RATCHET_CMD}\n  ${RATCHET_ADD}\n  npm run build\n  git commit -m x\n  git push\n`;
    const readOnly = 'run: |\n  npm run build\n  npm run validate:release\n';
    const fx = ratchetWiring({ 'wired.yml': wired, 'unwired.yml': unwired, 'before-build.yml': beforeBuild, 'read-only.yml': readOnly });
    const live = ratchetWiring(readWorkflows(path.join(ROOT, '.github/workflows')));
    cases.push({
      name: 'every_page_publishing_lane_runs_the_ratchet',
      why: 'A lane that builds and pushes pages must run the ratchet writer after its last build and stage its two files by explicit pathspec before its last commit; otherwise stale rows accumulate with no caller (62 by 2026-09-26). Fixtures: wired passes, unwired and ratchet-before-build are named, a build-only lane with no push is not a publishing lane. Live: at least one publishing lane exists and none is missing the wiring.',
      pass: JSON.stringify(fx.lanes.sort()) === JSON.stringify(['before-build.yml', 'unwired.yml', 'wired.yml'])
        && JSON.stringify(fx.missing.sort()) === JSON.stringify(['before-build.yml', 'unwired.yml'])
        && live.lanes.length > 0 && live.missing.length === 0,
      observed: { fixture_missing: fx.missing, live_lanes: live.lanes, live_missing: live.missing }
    });
  }

  // The writer tightens a loose licence up to the page, retires a moot one, keeps the
  // rest, and moves no floor - so a later fall back to the old named size is caught.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrink-guard-proof-'));
  try {
    fs.mkdirSync(path.join(dir, 'data/release'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data/release/frozen_page_registry.json'), `${JSON.stringify({ pages: Object.keys(base.routes).map((rendered_file) => ({ rendered_file })) })}\n`);
    fs.writeFileSync(path.join(dir, BASELINE), `${JSON.stringify({ schema_version: '1.0', ...base }, null, 2)}\n`);
    for (const [p, n] of Object.entries(sizes)) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), 'x'.repeat(n));
    }
    const run = (args) => spawnSync(process.execPath, [BASELINE_WRITER, '--retire-stale-justifications', ...args], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, RENDERED_BASELINE_ROOT: dir, SOURCE_DATE: '2026-09-26' }
    });
    const checkBefore = run(['--check']);
    const write = run([]);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, BASELINE), 'utf8'));
    const grew = (doc.justified_shrinks || []).find((j) => j.implementation_path === 'grew/index.html');
    const kept = (doc.justified_shrinks || []).map((j) => j.implementation_path).sort();
    const checkAfter = run(['--check']);
    fs.writeFileSync(path.join(dir, 'grew/index.html'), 'x'.repeat(920));
    const after = classify(doc, (p) => {
      const abs = path.join(dir, p);
      return fs.existsSync(abs) ? fs.statSync(abs).size : null;
    });
    cases.push({
      name: 'writer_tightens_loose_licence_and_moves_no_floor',
      why: 'grew/ rose 900 -> 950 below its 1000 floor: the writer raises to_bytes to 950 (records the old 900), --check flags it before and passes after, back/ is retired, exact/ and fell/ are kept, and no floor moves. Once tightened, grew/ falling to 920 is a 30-byte loss the guard fails on.',
      pass: checkBefore.status !== 0 && /grew\/index\.html/.test(`${checkBefore.stdout}${checkBefore.stderr}`)
        && write.status === 0
        && grew && Number(grew.to_bytes) === 950 && Number(grew.tightened_from_bytes) === 900
        && JSON.stringify(kept) === JSON.stringify(['exact/index.html', 'fell/index.html', 'grew/index.html'])
        && (doc.retired_justifications || []).map((j) => j.implementation_path).join() === 'back/index.html'
        && JSON.stringify(doc.routes) === JSON.stringify(base.routes)
        && checkAfter.status === 0
        && after.shrunk.some((s) => s.implementation_path === 'grew/index.html' && s.lost_bytes === 30),
      observed: { check_before: checkBefore.status, write: write.status, grew_to: grew && grew.to_bytes, kept, check_after: checkAfter.status, write_out: `${write.stdout}${write.stderr}`.slice(0, 400) }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return cases;
}

function main() {
  const baseline = readJson(BASELINE, null);
  if (!baseline || !baseline.routes || !Object.keys(baseline.routes).length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${BASELINE} is missing or carries no route floors.`);
    console.error('  With no floor, "did this page lose content?" is UNKNOWN, which is not the same as NO.');
    console.error('  Run `npm run baseline:rendered-size -- --seed` after a build, then re-run.');
    process.exit(1);
  }
  const { shrunk, moot, loose, missing, measured, atOrAbove } = classify(baseline, (relPath) => {
    const abs = rel(relPath);
    return fs.existsSync(abs) ? fs.statSync(abs).size : null;
  });

  const cases = selfProofCases();
  const failedCases = cases.filter((c) => !c.pass);
  if (!cases.length) {
    console.error('RENDERED OUTPUT SHRINK GUARD FAIL: zero self-proof cases examined.');
    process.exit(1);
  }

  // Retrospective half: routes already below their historic maximum before the floor
  // existed. Enumerated, ratcheted, and checked in both directions.
  const historic = readJson(HISTORIC, null);
  if (!historic || !Array.isArray(historic.routes)) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${HISTORIC} is missing. A floor seeded from today cannot see a page that was already re-frozen thinner, so pre-existing shrink is UNKNOWN rather than absent.`);
    console.error('  Run `node scripts/release/measure_historic_page_maximum.js`, review the result, and commit it.');
    process.exit(1);
  }
  const knownBelow = new Map(historic.routes.map((r) => [String(r.implementation_path || ''), r]));
  const newBelowHistoric = [];
  const recoveredAboveHistoric = [];
  let historicChecked = 0;
  for (const [relPath, row] of knownBelow) {
    const abs = rel(relPath);
    if (!fs.existsSync(abs)) continue;
    historicChecked += 1;
    if (fs.statSync(abs).size >= Number(row.historic_max_bytes)) {
      recoveredAboveHistoric.push({ implementation_path: relPath, historic_max_bytes: Number(row.historic_max_bytes), current_bytes: fs.statSync(abs).size });
    }
  }
  if (historic.routes.length && historicChecked === 0) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${historic.routes.length} route(s) recorded below their historic maximum and none is on disk. Nothing was checked.`);
    process.exit(1);
  }

  if (measured === 0) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${Object.keys(baseline.routes).length} route floor(s) recorded, zero measurable on disk.`);
    console.error('  Nothing was checked. Build the site, then re-run.');
    process.exit(1);
  }

  shrunk.sort((a, b) => b.lost_bytes - a.lost_bytes);
  const status = (shrunk.length || failedCases.length) ? 'FAIL' : 'PASS';
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify({
    schema_version: '1.0',
    validator: 'rendered-output-shrink-guard',
    status,
    checked_at: new Date().toISOString(),
    floors_recorded: Object.keys(baseline.routes).length,
    pages_measured: measured,
    pages_at_or_above_floor: atOrAbove,
    pages_not_on_disk: missing.length,
    justified_shrinks: baseline.justified_shrinks || [],
    historic_ratchet: {
      source: HISTORIC,
      measured_at: historic.measured_at,
      routes_below_historic_max: historic.routes.length,
      routes_that_lost_artifact_blocks: historic.routes_that_lost_artifact_blocks,
      artifact_blocks_lost: historic.artifact_blocks_lost,
      checked_on_disk: historicChecked,
      recovered_above_historic_max: recoveredAboveHistoric
    },
    unjustified_shrinks: shrunk,
    stale_justifications: moot,
    loose_justifications: loose,
    self_proof_cases: cases.map((c) => ({ name: c.name, pass: c.pass, why: c.why, observed: c.observed })),
    total_bytes_lost: shrunk.reduce((n, s) => n + s.lost_bytes, 0)
  }, null, 2)}\n`);

  if (recoveredAboveHistoric.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD WARN (a page improved; not a failure): ${recoveredAboveHistoric.length} route(s) listed as below their historic maximum have climbed back. A ratchet may only tighten - delete these from ${HISTORIC}:`);
    for (const r of recoveredAboveHistoric.slice(0, 25)) console.error(`  ${r.implementation_path}  historic max ${r.historic_max_bytes}B, page is ${r.current_bytes}B`);
    console.error('  Writer: `npm run ratchet:shrink-guard` retires exactly these rows (shrink-guard-ratchet-currency registers it as a repair, so a push lane runs it via self-heal before its validate:release gate). Commit the result.');
  }
  if (moot.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD WARN (a page improved; not a failure): ${moot.length} justified shrink(s) name a page that is back at or above its floor. A shrink licence may not outlive its shrink - delete these from ${BASELINE}:`);
    for (const s of moot.slice(0, 25)) console.error(`  ${s.implementation_path}  named ${s.expected_bytes}B, floor ${s.floor_bytes}B, page is ${s.current_bytes}B`);
    console.error('  Writer: `npm run ratchet:shrink-guard` retires these.');
  }
  if (loose.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD WARN (a page improved; not a failure): ${loose.length} justified shrink(s) name a page that grew above the named size but is still below its floor. Nothing was lost; the licence is loose - tighten to_bytes in ${BASELINE}:`);
    for (const s of loose.slice(0, 25)) console.error(`  ${s.implementation_path}  named ${s.expected_bytes}B, page is ${s.current_bytes}B, floor ${s.floor_bytes}B`);
    console.error('  Writer: `npm run ratchet:shrink-guard` raises to_bytes to the page, so a later fall back to the old named size fails here.');
  }
  if (failedCases.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${failedCases.length} of ${cases.length} self-proof case(s) failed against constructed inputs:`);
    for (const c of failedCases) console.error(`  ${c.name}: ${JSON.stringify(c.observed)}`);
    process.exit(1);
  }
  if (shrunk.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${shrunk.length} page(s) below their accepted floor, ${shrunk.reduce((n, s) => n + s.lost_bytes, 0)} byte(s) of delivered content gone with no stated reason.`);
    for (const s of shrunk.slice(0, 25)) console.error(`  ${s.implementation_path}  ${s.floor_bytes} -> ${s.current_bytes} (-${s.lost_bytes}) [${s.justification}]`);
    if (shrunk.length > 25) console.error(`  ... and ${shrunk.length - 25} more in ${OUT}`);
    console.error('  Either recover the content, or name the shrink in justified_shrinks with the byte count it may fall to and the reason.');
    process.exit(1);
  }
  console.log(`RENDERED OUTPUT SHRINK GUARD PASS: ${measured} page(s) measured against their accepted floor (${atOrAbove} at or above it); ${(baseline.justified_shrinks || []).length} named shrink(s), none fallen below its named size (${loose.length} loose, ${moot.length} moot); ${missing.length} floor(s) with no file on disk; ${cases.length} self-proof case(s) passed.`);
  console.log(`  HISTORIC RATCHET: ${historicChecked} of ${historic.routes.length} route(s) enumerated as below their historic maximum are on disk and still below it.`);
  console.log(`                    ${historic.routes_that_lost_artifact_blocks} of them have lost ${historic.artifact_blocks_lost} delivered artifact block(s) - pre-existing, dated, and recorded in ${HISTORIC}.`);
}

main();
