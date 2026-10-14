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
 *   --retire-stale-justifications
 *                remove every justified_shrinks entry whose page is back AT OR ABOVE
 *                its floor, and touch nothing else. The guard fails a justification
 *                that no longer reproduces ("a shrink licence may not outlive its
 *                shrink - delete these"), and until 2026-09-14 nothing performed that
 *                deletion: the content release lane grew eight personal-injury routes
 *                past the sizes their 2026-09-10 justifications named, and main went
 *                red on a bot commit. A justification whose page is BELOW its floor
 *                at some other size is NOT retired here - that is a new shrink and
 *                needs the judgment the guard asks a person for. Floors are never
 *                raised or lowered in this mode, so a fluctuating page cannot ratchet
 *                itself into a future failure by being run through a lane.
 *                It also TIGHTENS a loose licence: a page that grew above the size its
 *                justification names but is still below its floor has lost nothing
 *                (the guard treats to_bytes as the lowered floor), so to_bytes is
 *                raised to the page and the old value kept as tightened_from_bytes.
 *                A licence only ever narrows here; a later fall back to the old named
 *                size is then a loss the guard fails on. (2026-09-26: Validate Repo
 *                run 36225602982 went red on a uscis-medical page that grew 634B
 *                above its licence, because nothing handled this middle case.)
 *                WHO CALLS IT: `npm run ratchet:shrink-guard` runs in every lane that
 *                builds and pushes pages (velocity-content-release.yml,
 *                velocity-full-rebuild.yml), on the tree being pushed, staging its two
 *                files by explicit pathspec. rendered-output-shrink-guard's self-proof
 *                case every_page_publishing_lane_runs_the_ratchet fails if that wiring
 *                is removed. It is NOT a hard-fail validator: the currency validator
 *                that used to force it was retired 2026-09-22 (23bd31e99) because a
 *                stale row is bookkeeping, and bookkeeping must not turn main red.
 *   --check      with --retire-stale-justifications: exit non-zero if any entry
 *                WOULD be retired or tightened; write nothing
 *
 * Rule 0 for --retire-stale-justifications: a missing baseline, zero route floors, or
 * zero routes measurable on disk is a hard failure. A justification list that is empty
 * is a legitimate state and is reported as "0 examined", not treated as a pass on its
 * own - the routes on disk are what was measured.
 *
 * 2026-10-14: FLOORS ARE DELIVERED-BLOCK COUNTS (schema 2.0), not bytes. Every rule
 * above is unchanged and now applies per KIND of block (scripts/lib/delivered_blocks.js:
 * section, h2, h3, p, li, table inside <main>): a kind's floor only rises, a kind may
 * only fall under a justified_shrinks entry naming `to_blocks`, a licence only narrows.
 * Byte floors red main on a 2-byte jitter (run 38525995326) and passed five pages that
 * lost a whole block while growing elsewhere. `--seed` over a byte-era file reseeds the
 * floors from the current rendered output and archives the byte-era licences under
 * byte_era_archive.
 */

const fs = require('fs');
const path = require('path');
const { KINDS, deliveredBlocks, lostKinds } = require('../lib/delivered_blocks');

const ROOT = process.env.RENDERED_BASELINE_ROOT
  ? path.resolve(process.env.RENDERED_BASELINE_ROOT)
  : path.resolve(__dirname, '../..');
const BASELINE = 'data/release/rendered_size_baseline.json';
const REGISTRY = 'data/release/frozen_page_registry.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const SEED = process.argv.includes('--seed');
const RETIRE = process.argv.includes('--retire-stale-justifications');
const CHECK = process.argv.includes('--check');
const POLICY = 'RISE_ONLY, per kind of delivered block (section, h2, h3, p, li, table inside <main>; scripts/lib/delivered_blocks.js). A kind\'s floor may be raised when the rendered page gains blocks of that kind. It is never lowered by a rebuild, an accept, or a refreeze. Lowering one requires an entry in justified_shrinks naming the route, to_blocks (the counts it may fall to), and the reason the content left.';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }
function blocksOf(relPath) {
  const abs = rel(relPath);
  return fs.existsSync(abs) ? deliveredBlocks(fs.readFileSync(abs, 'utf8')) : null;
}
function isBlockEra(doc) {
  return Boolean(doc && doc.schema_version === '2.0'
    && Object.values(doc.routes || {}).every((v) => v && typeof v === 'object'));
}
function same(a, b) { return KINDS.every((k) => (Number(a && a[k]) || 0) === (Number(b && b[k]) || 0)); }
function maxOf(a, b) { return Object.fromEntries(KINDS.map((k) => [k, Math.max(Number(a && a[k]) || 0, Number(b && b[k]) || 0)])); }
function fresh(previous) {
  const doc = {
    schema_version: '2.0',
    authority: 'scripts/release/update_rendered_size_baseline.js',
    unit: 'delivered blocks per kind (scripts/lib/delivered_blocks.js)',
    policy: POLICY,
    guard: 'scripts/validators/validate_rendered_output_shrink_guard.js',
    seeded_at: DATE,
    justified_shrinks: [],
    routes: {}
  };
  if (previous) {
    doc.byte_era_archive = {
      archived_at: DATE,
      why: 'Byte floors replaced by delivered-block floors on 2026-10-14 (Validate Repo run 38525995326 red on a 2-byte jitter; five pages that lost a whole block passed because they grew elsewhere). Floors were reseeded from the rendered output after restoring the lost blocks; the byte-era licences are kept here as the record of why those pages once shrank.',
      seeded_at: previous.seeded_at || null,
      route_count: Object.keys(previous.routes || {}).length,
      justified_shrinks: previous.justified_shrinks || [],
      retired_justifications: previous.retired_justifications || []
    };
  }
  return doc;
}

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
  if (existing && !isBlockEra(existing) && !SEED) {
    console.error(`RENDERED SIZE BASELINE FAIL: ${BASELINE} is a byte-era file (schema ${existing.schema_version}). Floors are delivered-block counts now; run with --seed once to reseed them and archive the byte-era licences.`);
    process.exit(1);
  }
  const baseline = existing && isBlockEra(existing) ? existing : fresh(existing);
  baseline.routes = baseline.routes || {};
  baseline.justified_shrinks = baseline.justified_shrinks || [];
  if (RETIRE) { retireStaleJustifications(baseline); return; }
  const justified = new Map(baseline.justified_shrinks.map((s) => [String(s.implementation_path || ''), s]));
  let raised = 0;
  let added = 0;
  let measured = 0;
  let lowered = 0;
  for (const record of registry.pages) {
    const relPath = String(record.rendered_file || '');
    if (!relPath) continue;
    const current = blocksOf(relPath);
    if (!current) continue;
    measured += 1;
    const floor = baseline.routes[relPath];
    if (floor === undefined) { baseline.routes[relPath] = current; added += 1; continue; }
    const named = justified.get(relPath);
    if (lostKinds(floor, current).length && named && named.to_blocks && same(named.to_blocks, current)) {
      baseline.routes[relPath] = current; lowered += 1; continue;
    }
    const next = maxOf(floor, current);
    if (!same(next, floor)) { baseline.routes[relPath] = next; raised += 1; }
  }
  if (measured === 0) {
    console.error('RENDERED SIZE BASELINE FAIL: measured zero rendered pages. Build the site first; an empty measurement is not a baseline.');
    process.exit(1);
  }
  baseline.updated_at = DATE;
  baseline.route_count = Object.keys(baseline.routes).length;
  fs.writeFileSync(rel(BASELINE), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`RENDERED SIZE BASELINE PASS: measured ${measured} rendered page(s) in delivered blocks; ${added} added, ${raised} floor(s) raised, ${lowered} lowered under a named justification.`);
}

function retireStaleJustifications(baseline) {
  const floors = Object.entries(baseline.routes);
  if (!floors.length) {
    console.error(`RENDERED SIZE BASELINE FAIL: ${BASELINE} carries no route floors; there is nothing to measure a justification against.`);
    process.exit(1);
  }
  let onDisk = 0;
  for (const [relPath] of floors) if (fs.existsSync(rel(relPath))) onDisk += 1;
  if (onDisk === 0) {
    console.error(`RENDERED SIZE BASELINE FAIL: ${floors.length} route floor(s) recorded, zero measurable on disk. Nothing was checked. Build the site, then re-run.`);
    process.exit(1);
  }
  const kept = [];
  const retired = [];
  const tightened = [];
  const belowLicence = [];
  for (const named of baseline.justified_shrinks) {
    const relPath = String(named.implementation_path || '');
    const current = relPath ? blocksOf(relPath) : null;
    if (!current || !named.to_blocks) { kept.push(named); continue; }
    const floor = baseline.routes[relPath];
    if (same(current, named.to_blocks)) { kept.push(named); continue; }
    if (floor && !lostKinds(floor, current).length) {
      retired.push({ ...named, retired_at: DATE, recovered_to_blocks: current, floor_blocks: floor });
      continue;
    }
    if (!lostKinds(named.to_blocks, current).length) {
      const narrowed = { ...named, to_blocks: maxOf(named.to_blocks, current), tightened_from_blocks: named.to_blocks, tightened_at: DATE };
      tightened.push({ implementation_path: relPath, from_blocks: named.to_blocks, to_blocks: narrowed.to_blocks, floor_blocks: floor });
      kept.push(narrowed);
      continue;
    }
    belowLicence.push({ implementation_path: relPath, named_blocks: named.to_blocks, current_blocks: current, floor_blocks: floor });
    kept.push(named);
  }
  const fmt = (o) => KINDS.map((k) => `${k}=${Number(o && o[k]) || 0}`).join(' ');
  if (CHECK) {
    if (retired.length || tightened.length) {
      console.error(`RENDERED SIZE BASELINE FAIL (--check): of ${baseline.justified_shrinks.length} justified shrink(s), ${retired.length} name a page back at or above its floor and ${tightened.length} name a page that gained blocks above its licence. Run \`npm run ratchet:shrink-guard\` and commit ${BASELINE}:`);
      for (const r of retired.slice(0, 25)) console.error(`  moot ${r.implementation_path}  named ${fmt(r.to_blocks)}; page ${fmt(r.recovered_to_blocks)}`);
      for (const t of tightened.slice(0, 25)) console.error(`  loose ${t.implementation_path}  named ${fmt(t.from_blocks)}; page needs ${fmt(t.to_blocks)}`);
      process.exit(1);
    }
    console.log(`RENDERED SIZE BASELINE PASS (--check): ${onDisk} of ${floors.length} route floor(s) on disk; ${baseline.justified_shrinks.length} justified shrink(s) examined, none moot or loose; ${belowLicence.length} below their licence (left for the guard).`);
    return;
  }
  if (!retired.length && !tightened.length) {
    console.log(`RENDERED SIZE BASELINE PASS: ${onDisk} of ${floors.length} route floor(s) on disk; ${baseline.justified_shrinks.length} justified shrink(s) examined, none moot or loose, file unchanged; ${belowLicence.length} below their licence (left for the guard).`);
    return;
  }
  baseline.justified_shrinks = kept;
  baseline.retired_justifications = [...(Array.isArray(baseline.retired_justifications) ? baseline.retired_justifications : []), ...retired];
  baseline.updated_at = DATE;
  baseline.route_count = Object.keys(baseline.routes).length;
  fs.writeFileSync(rel(BASELINE), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`RENDERED SIZE BASELINE PASS: ${onDisk} of ${floors.length} route floor(s) on disk; ${retired.length} justified shrink(s) retired because the page is back at or above its floor; ${tightened.length} tightened up to a page that gained blocks; ${kept.length} kept; ${belowLicence.length} below their licence (left for the guard). No floor was changed.`);
}

main();
