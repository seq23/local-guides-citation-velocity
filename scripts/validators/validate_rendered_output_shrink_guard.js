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
 * 2026-10-14: THE FLOOR IS DELIVERED BLOCKS, NOT BYTES. Byte floors failed both ways
 * on one day. Validate Repo run 38525995326 went red on main because
 * uscis-medical/civil-surgeon-near-me sat 2 bytes under a named floor - while that
 * same release had removed the "Use the canonical local guide before acting" block
 * from it and five sibling hubs, five of which grew elsewhere and passed, and #194
 * had removed it from seven more pages the day before, all passing. Counted in
 * blocks per kind (scripts/lib/delivered_blocks.js), those 13 pages each lose a
 * section and an h2, and across the 302 pages that release changed nothing else
 * moves. A kind may only fall under a named reason; growth in one kind never pays
 * for a loss in another. Read "bytes" below as "blocks per kind".
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
const { KINDS, deliveredBlocks, lostKinds } = require('../lib/delivered_blocks');

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
// Floors are DELIVERED-BLOCK COUNTS per kind (scripts/lib/delivered_blocks.js), not
// bytes. A kind below its floor fails unless justified_shrinks names the route with
// to_blocks - the counts it may fall to - and the page still holds at least those.
// lost_blocks counts what is missing below the effective floor, kind by kind; a gain
// in one kind never pays for a loss in another.
function classify(baseline, blocksOf) {
  const justified = new Map((baseline.justified_shrinks || []).map((s) => [String(s.implementation_path || ''), s]));
  const shrunk = [];
  const moot = [];
  const loose = [];
  const missing = [];
  let measured = 0;
  let atOrAbove = 0;
  for (const [relPath, floor] of Object.entries(baseline.routes || {})) {
    const current = blocksOf(relPath);
    if (current === null) { missing.push(relPath); continue; }
    measured += 1;
    if (!lostKinds(floor, current).length) { atOrAbove += 1; continue; }
    const named = justified.get(relPath);
    const licence = named && named.to_blocks && typeof named.to_blocks === 'object' ? named.to_blocks : null;
    if (licence && !lostKinds(licence, current).length) continue;
    // A licence IS the route's lowered floor, and it only narrows (the writer raises
    // it as the page gains blocks), so falling below it in any kind is the loss.
    const effective = licence || floor;
    const lost = lostKinds(effective, current);
    shrunk.push({
      implementation_path: relPath,
      floor_blocks: floor,
      current_blocks: current,
      lost_kinds: lost,
      lost_blocks: lost.reduce((n, l) => n + (l.floor - l.current), 0),
      justification: licence
        ? `named for ${JSON.stringify(licence)}; the page fell below what its reason accepted`
        : 'none'
    });
  }
  for (const [relPath, named] of justified) {
    const current = blocksOf(relPath);
    if (current === null || !named.to_blocks) continue;
    const floor = (baseline.routes || {})[relPath];
    const row = { implementation_path: relPath, expected_blocks: named.to_blocks, current_blocks: current, floor_blocks: floor || null };
    if (floor && !lostKinds(floor, current).length) moot.push(row);
    else if (!lostKinds(named.to_blocks, current).length && lostKinds(current, named.to_blocks).length) loose.push(row);
  }
  return { shrunk, moot, loose, missing, measured, atOrAbove };
}

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
// Every page-publishing lane runs this guard on the exact commit it pushes, after
// its last commit and before its last push (scripts/release/shrink_guard_push_gate.mjs).
const PUSH_GATE = 'node scripts/release/shrink_guard_push_gate.mjs';
function pushGateWiring(workflows) {
  const { lanes } = ratchetWiring(workflows);
  const missing = [];
  for (const name of lanes) {
    const text = workflows[name];
    const gateAt = text.lastIndexOf(PUSH_GATE);
    const commitAt = text.lastIndexOf('git commit');
    const pushAt = text.lastIndexOf('git push');
    const stopsOnThree = /if \[ "\$gate" = 3 \]; then[^\n]*exit 0; fi/.test(text.slice(gateAt))
      && /if \[ "\$gate" != 0 \]; then exit 1; fi/.test(text.slice(gateAt));
    if (!(gateAt > commitAt && pushAt > gateAt && stopsOnThree)) missing.push(name);
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
// A fixture page holding exactly `counts` delivered blocks, padded with `pad` bytes
// of text so byte size can move independently of the blocks.
function fixturePage(counts, pad = 0) {
  const parts = ['<!doctype html><html><head><script>var x = "<section><p>";</script></head><body><main>'];
  for (const k of KINDS) for (let i = 0; i < (counts[k] || 0); i += 1) parts.push(k === 'table' ? '<table><tr><td>t</td></tr></table>' : `<${k}>${k}</${k}>`);
  parts.push(`<!-- <section>not delivered</section> -->${'x'.repeat(pad)}</main><footer><p>f</p></footer></body></html>`);
  return parts.join('');
}

function selfProofCases() {
  const cases = [];
  const F = (section, p, li = 0) => ({ section, h2: 0, h3: 0, p, li, table: 0 });
  const base = {
    routes: { 'exact/index.html': F(4, 4), 'grew/index.html': F(4, 4), 'fell/index.html': F(4, 4), 'unnamed/index.html': F(4, 4), 'back/index.html': F(4, 4), 'fine/index.html': F(4, 4) },
    justified_shrinks: [
      { implementation_path: 'exact/index.html', to_blocks: F(3, 4) },
      { implementation_path: 'grew/index.html', to_blocks: F(3, 4) },
      { implementation_path: 'fell/index.html', to_blocks: F(3, 4) },
      { implementation_path: 'back/index.html', to_blocks: F(3, 4) }
    ]
  };
  const pages = { 'exact/index.html': F(3, 4), 'grew/index.html': F(3, 6), 'fell/index.html': F(2, 4), 'unnamed/index.html': F(3, 4), 'back/index.html': F(4, 4), 'fine/index.html': F(5, 4) };
  const r = classify(base, (p) => (p in pages ? deliveredBlocks(fixturePage(pages[p])) : null));
  const shrunkPaths = r.shrunk.map((s) => s.implementation_path).sort();
  cases.push({
    name: 'named_licence_is_a_lowered_floor',
    why: 'exact/ sits at its licence and grew/ gained paragraphs above it - both pass. fell/ dropped a section below what its reason accepted and unnamed/ dropped a section with no reason - both fail, one block each. back/ reached its floor (moot licence) and fine/ gained a section - both pass.',
    pass: JSON.stringify(shrunkPaths) === JSON.stringify(['fell/index.html', 'unnamed/index.html'])
      && r.shrunk.every((s) => s.lost_blocks === 1 && s.lost_kinds.length === 1 && s.lost_kinds[0].kind === 'section')
      && r.loose.length === 1 && r.loose[0].implementation_path === 'grew/index.html'
      && r.moot.length === 1 && r.moot[0].implementation_path === 'back/index.html'
      && r.measured === 6 && r.atOrAbove === 2,
    observed: { shrunk: shrunkPaths, loose: r.loose.map((x) => x.implementation_path), moot: r.moot.map((x) => x.implementation_path), measured: r.measured }
  });

  {
    // 2026-10-14: byte floors went red on a 2-byte jitter and passed pages that lost a
    // block while growing elsewhere. Block floors must do the opposite on both.
    const floor = deliveredBlocks(fixturePage(F(5, 6, 3), 400));
    const sizes = {
      'jitter/index.html': fixturePage(F(5, 6, 3), 10),
      'traded/index.html': fixturePage(F(4, 30, 3), 4000),
      'lostli/index.html': fixturePage(F(5, 6, 2), 900),
      'undelivered/index.html': fixturePage(F(5, 6, 3), 0).replace('<main>', '<main><script>"<section><section>"</script>')
    };
    const j = classify({ routes: Object.fromEntries(Object.keys(sizes).map((k) => [k, floor])), justified_shrinks: [] }, (p) => deliveredBlocks(sizes[p]));
    const bytes = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, v.length]));
    cases.push({
      name: 'byte_jitter_passes_and_growth_cannot_pay_for_a_lost_block',
      why: 'jitter/ is 390 bytes smaller with every block intact - passes. traded/ lost one section but gained 24 paragraphs and ~3.6 KB - fails, because a kind can only fall under a named reason. lostli/ lost one list item (a related link) while growing - fails. undelivered/ changed only inside a script - passes.',
      pass: JSON.stringify(j.shrunk.map((s) => s.implementation_path).sort()) === JSON.stringify(['lostli/index.html', 'traded/index.html'])
        && bytes['jitter/index.html'] < 1000 && bytes['traded/index.html'] > bytes['jitter/index.html'] + 3000,
      observed: { shrunk: j.shrunk.map((s) => `${s.implementation_path}:${s.lost_kinds.map((l) => l.kind).join('+')}`), bytes }
    });
  }

  const none = classify({ routes: { 'a/index.html': F(1, 1) }, justified_shrinks: [] }, () => null);
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
  {
    const gated = `run: |\n  npm run build:cached:prune\n  ${RATCHET_CMD}\n  ${RATCHET_ADD}\n  git commit --amend --no-edit\n  gate=0; ${PUSH_GATE} || gate=$?\n  if [ "$gate" = 3 ]; then echo stop; exit 0; fi\n  if [ "$gate" != 0 ]; then exit 1; fi\n  git push origin HEAD:main\n`;
    const ungated = `run: |\n  npm run build:cached:prune\n  ${RATCHET_CMD}\n  ${RATCHET_ADD}\n  git commit --amend --no-edit\n  git push origin HEAD:main\n`;
    const beforeCommit = `run: |\n  npm run build\n  gate=0; ${PUSH_GATE} || gate=$?\n  if [ "$gate" = 3 ]; then exit 0; fi\n  if [ "$gate" != 0 ]; then exit 1; fi\n  git commit -m x\n  git push\n`;
    const fx = pushGateWiring({ 'gated.yml': gated, 'ungated.yml': ungated, 'before-commit.yml': beforeCommit });
    const live = pushGateWiring(readWorkflows(path.join(ROOT, '.github/workflows')));
    cases.push({
      name: 'every_page_publishing_lane_gates_the_exact_pushed_commit',
      why: 'Run 38524703457 pushed a tree its own validate:release had failed on this guard. A publishing lane must run the push gate after its last commit and before its last push, stop on exit 3 without pushing, and fail on any other non-zero. Fixtures: gated passes; ungated and gate-before-commit are named. Live: at least one publishing lane, none missing the gate.',
      pass: JSON.stringify(fx.missing.sort()) === JSON.stringify(['before-commit.yml', 'ungated.yml'])
        && live.lanes.length > 0 && live.missing.length === 0,
      observed: { fixture_missing: fx.missing, live_lanes: live.lanes, live_missing: live.missing }
    });
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrink-guard-proof-'));
  try {
    fs.mkdirSync(path.join(dir, 'data/release'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data/release/frozen_page_registry.json'), `${JSON.stringify({ pages: Object.keys(base.routes).map((rendered_file) => ({ rendered_file })) })}\n`);
    fs.writeFileSync(path.join(dir, BASELINE), `${JSON.stringify({ schema_version: '2.0', ...base }, null, 2)}\n`);
    const put = (p, counts) => {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), fixturePage(counts));
    };
    for (const [p, counts] of Object.entries(pages)) put(p, counts);
    const run = (args) => spawnSync(process.execPath, [BASELINE_WRITER, ...args], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, RENDERED_BASELINE_ROOT: dir, SOURCE_DATE: '2026-10-14' }
    });
    const checkBefore = run(['--retire-stale-justifications', '--check']);
    const write = run(['--retire-stale-justifications']);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, BASELINE), 'utf8'));
    const grew = (doc.justified_shrinks || []).find((j) => j.implementation_path === 'grew/index.html');
    const kept = (doc.justified_shrinks || []).map((j) => j.implementation_path).sort();
    const checkAfter = run(['--retire-stale-justifications', '--check']);
    put('grew/index.html', F(3, 5));
    const after = classify(doc, (p) => {
      const abs = path.join(dir, p);
      return fs.existsSync(abs) ? deliveredBlocks(fs.readFileSync(abs, 'utf8')) : null;
    });
    // The floor writer: a page that gains blocks raises only that kind; a page that
    // loses blocks with no licence moves no floor.
    put('fine/index.html', F(4, 9));
    put('unnamed/index.html', F(2, 4));
    const raise = run([]);
    const raisedDoc = JSON.parse(fs.readFileSync(path.join(dir, BASELINE), 'utf8'));
    // A byte-era file is refused without --seed, and --seed archives its licences.
    fs.writeFileSync(path.join(dir, BASELINE), `${JSON.stringify({ schema_version: '1.0', routes: { 'fine/index.html': 1000 }, justified_shrinks: [{ implementation_path: 'fine/index.html', to_bytes: 900 }] })}\n`);
    const byteEra = run([]);
    const seed = run(['--seed']);
    const seeded = JSON.parse(fs.readFileSync(path.join(dir, BASELINE), 'utf8'));
    cases.push({
      name: 'writer_tightens_loose_licence_raises_per_kind_and_never_lowers',
      why: 'grew/ gained paragraphs above its licence: --check flags it, the writer raises to_blocks.p to 6 (old licence kept), back/ is retired, exact/ and fell/ are kept, no floor moves; a later fall to p=5 is a 1-block loss the guard fails on. The floor writer then raises fine/ p 4 -> 9 without touching its sections, and leaves unnamed/ (lost two sections, no licence) at its floor. A byte-era file is refused until --seed, which reseeds in blocks and archives the byte licences.',
      pass: checkBefore.status !== 0 && /grew\/index\.html/.test(`${checkBefore.stdout}${checkBefore.stderr}`)
        && write.status === 0
        && grew && Number(grew.to_blocks.p) === 6 && Number(grew.tightened_from_blocks.p) === 4
        && JSON.stringify(kept) === JSON.stringify(['exact/index.html', 'fell/index.html', 'grew/index.html'])
        && (doc.retired_justifications || []).map((j) => j.implementation_path).join() === 'back/index.html'
        && JSON.stringify(doc.routes) === JSON.stringify(base.routes)
        && checkAfter.status === 0
        && after.shrunk.some((s) => s.implementation_path === 'grew/index.html' && s.lost_blocks === 1)
        && raise.status === 0
        && raisedDoc.routes['fine/index.html'].p === 9 && raisedDoc.routes['fine/index.html'].section === 4
        && JSON.stringify(raisedDoc.routes['unnamed/index.html']) === JSON.stringify(base.routes['unnamed/index.html'])
        && byteEra.status !== 0
        && seed.status === 0 && seeded.schema_version === '2.0' && typeof seeded.routes['fine/index.html'] === 'object'
        && seeded.byte_era_archive && seeded.byte_era_archive.justified_shrinks.length === 1,
      observed: { check_before: checkBefore.status, write: write.status, grew_to: grew && grew.to_blocks, kept, check_after: checkAfter.status, raise: raise.status, fine: raisedDoc.routes && raisedDoc.routes['fine/index.html'], byte_era: byteEra.status, seed: seed.status, out: `${write.stdout}${write.stderr}${raise.stderr}${seed.stderr}`.slice(0, 400) }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return cases;
}

function fmtBlocks(o) { return KINDS.map((k) => `${k}=${Number(o && o[k]) || 0}`).join(' '); }

function main() {
  const baseline = readJson(BASELINE, null);
  if (!baseline || !baseline.routes || !Object.keys(baseline.routes).length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${BASELINE} is missing or carries no route floors.`);
    console.error('  With no floor, "did this page lose content?" is UNKNOWN, which is not the same as NO.');
    console.error('  Run `npm run baseline:rendered-size -- --seed` after a build, then re-run.');
    process.exit(1);
  }
  if (baseline.schema_version !== '2.0' || Object.values(baseline.routes).some((v) => !v || typeof v !== 'object')) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${BASELINE} is not a delivered-block baseline (schema 2.0, one block count per kind per route).`);
    console.error('  Run `npm run baseline:rendered-size -- --seed` after a build to reseed it, then re-run.');
    process.exit(1);
  }
  const { shrunk, moot, loose, missing, measured, atOrAbove } = classify(baseline, (relPath) => {
    const abs = rel(relPath);
    return fs.existsSync(abs) ? deliveredBlocks(fs.readFileSync(abs, 'utf8')) : null;
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

  shrunk.sort((a, b) => b.lost_blocks - a.lost_blocks);
  const status = (shrunk.length || failedCases.length) ? 'FAIL' : 'PASS';
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify({
    schema_version: '2.0',
    validator: 'rendered-output-shrink-guard',
    unit: 'delivered blocks per kind (scripts/lib/delivered_blocks.js)',
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
    total_blocks_lost: shrunk.reduce((n, s) => n + s.lost_blocks, 0)
  }, null, 2)}\n`);

  if (recoveredAboveHistoric.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD WARN (a page improved; not a failure): ${recoveredAboveHistoric.length} route(s) listed as below their historic maximum have climbed back. A ratchet may only tighten - delete these from ${HISTORIC}:`);
    for (const r of recoveredAboveHistoric.slice(0, 25)) console.error(`  ${r.implementation_path}  historic max ${r.historic_max_bytes}B, page is ${r.current_bytes}B`);
    console.error('  Writer: `npm run ratchet:shrink-guard` retires exactly these rows (shrink-guard-ratchet-currency registers it as a repair, so a push lane runs it via self-heal before its validate:release gate). Commit the result.');
  }
  if (moot.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD WARN (a page improved; not a failure): ${moot.length} justified shrink(s) name a page that is back at or above its floor. A shrink licence may not outlive its shrink - delete these from ${BASELINE}:`);
    for (const s of moot.slice(0, 25)) console.error(`  ${s.implementation_path}  named ${fmtBlocks(s.expected_blocks)}; page ${fmtBlocks(s.current_blocks)}`);
    console.error('  Writer: `npm run ratchet:shrink-guard` retires these.');
  }
  if (loose.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD WARN (a page improved; not a failure): ${loose.length} justified shrink(s) name a page that gained blocks above its licence but is still below its floor. Nothing was lost; the licence is loose - tighten to_blocks in ${BASELINE}:`);
    for (const s of loose.slice(0, 25)) console.error(`  ${s.implementation_path}  named ${fmtBlocks(s.expected_blocks)}; page ${fmtBlocks(s.current_blocks)}`);
    console.error('  Writer: `npm run ratchet:shrink-guard` raises to_blocks to the page, so a later fall back to the old licence fails here.');
  }
  if (failedCases.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${failedCases.length} of ${cases.length} self-proof case(s) failed against constructed inputs:`);
    for (const c of failedCases) console.error(`  ${c.name}: ${JSON.stringify(c.observed)}`);
    process.exit(1);
  }
  if (shrunk.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${shrunk.length} page(s) below their accepted floor, ${shrunk.reduce((n, s) => n + s.lost_blocks, 0)} delivered block(s) gone with no stated reason.`);
    for (const s of shrunk.slice(0, 25)) console.error(`  ${s.implementation_path}  ${s.lost_kinds.map((l) => `${l.kind} ${l.floor} -> ${l.current}`).join(', ')} [${s.justification}]`);
    if (shrunk.length > 25) console.error(`  ... and ${shrunk.length - 25} more in ${OUT}`);
    console.error('  Either recover the content, or name the shrink in justified_shrinks with to_blocks (the counts it may fall to) and the reason.');
    process.exit(1);
  }
  console.log(`RENDERED OUTPUT SHRINK GUARD PASS: ${measured} page(s) measured in delivered blocks against their accepted floor (${atOrAbove} at or above it in every kind); ${(baseline.justified_shrinks || []).length} named shrink(s), none fallen below its licence (${loose.length} loose, ${moot.length} moot); ${missing.length} floor(s) with no file on disk; ${cases.length} self-proof case(s) passed.`);
  console.log(`  HISTORIC RATCHET: ${historicChecked} of ${historic.routes.length} route(s) enumerated as below their historic maximum are on disk and still below it.`);
  console.log(`                    ${historic.routes_that_lost_artifact_blocks} of them have lost ${historic.artifact_blocks_lost} delivered artifact block(s) - pre-existing, dated, and recorded in ${HISTORIC}.`);
}

main();
