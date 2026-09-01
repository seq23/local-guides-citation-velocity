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
 * Rule 0: measuring zero pages is a failure. An empty loop and a clean site are
 * indistinguishable from the outside, and that is exactly how this defect hid.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BASELINE = 'data/release/rendered_size_baseline.json';
const HISTORIC = 'data/release/historic_page_maximum.json';
const OUT = 'artifacts/validation/rendered-output-shrink-guard.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function main() {
  const baseline = readJson(BASELINE, null);
  if (!baseline || !baseline.routes || !Object.keys(baseline.routes).length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${BASELINE} is missing or carries no route floors.`);
    console.error('  With no floor, "did this page lose content?" is UNKNOWN, which is not the same as NO.');
    console.error('  Run `npm run baseline:rendered-size -- --seed` after a build, then re-run.');
    process.exit(1);
  }
  const justified = new Map((baseline.justified_shrinks || []).map((s) => [String(s.implementation_path || ''), s]));

  const shrunk = [];
  const staleJustifications = [];
  const missing = [];
  let measured = 0;
  let atOrAbove = 0;

  for (const [relPath, floor] of Object.entries(baseline.routes)) {
    const abs = rel(relPath);
    if (!fs.existsSync(abs)) { missing.push(relPath); continue; }
    measured += 1;
    const size = fs.statSync(abs).size;
    if (size >= Number(floor)) { atOrAbove += 1; continue; }
    const named = justified.get(relPath);
    if (named && Number(named.to_bytes) === size) continue;
    shrunk.push({
      implementation_path: relPath,
      floor_bytes: Number(floor),
      current_bytes: size,
      lost_bytes: Number(floor) - size,
      justification: named ? `named, but for ${named.to_bytes} bytes, not ${size}` : 'none'
    });
  }

  // A justification that no longer reproduces has to be deleted, not left standing:
  // a permanent licence to shrink a route is the same hole in a different shape.
  for (const [relPath, named] of justified) {
    const abs = rel(relPath);
    if (!fs.existsSync(abs)) continue;
    const size = fs.statSync(abs).size;
    if (size !== Number(named.to_bytes)) staleJustifications.push({ implementation_path: relPath, expected_bytes: Number(named.to_bytes), current_bytes: size });
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
  const status = (shrunk.length || staleJustifications.length) ? 'FAIL' : 'PASS';
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
    stale_justifications: staleJustifications,
    total_bytes_lost: shrunk.reduce((n, s) => n + s.lost_bytes, 0)
  }, null, 2)}\n`);

  if (recoveredAboveHistoric.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${recoveredAboveHistoric.length} route(s) listed as below their historic maximum have climbed back. A ratchet may only tighten - delete these from ${HISTORIC}:`);
    for (const r of recoveredAboveHistoric.slice(0, 25)) console.error(`  ${r.implementation_path}  historic max ${r.historic_max_bytes}B, page is ${r.current_bytes}B`);
    process.exit(1);
  }
  if (staleJustifications.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${staleJustifications.length} justified shrink(s) no longer reproduce. A shrink licence may not outlive its shrink - delete these from ${BASELINE}:`);
    for (const s of staleJustifications) console.error(`  ${s.implementation_path}  named ${s.expected_bytes}B, page is ${s.current_bytes}B`);
    process.exit(1);
  }
  if (shrunk.length) {
    console.error(`RENDERED OUTPUT SHRINK GUARD FAIL: ${shrunk.length} page(s) below their accepted floor, ${shrunk.reduce((n, s) => n + s.lost_bytes, 0)} byte(s) of delivered content gone with no stated reason.`);
    for (const s of shrunk.slice(0, 25)) console.error(`  ${s.implementation_path}  ${s.floor_bytes} -> ${s.current_bytes} (-${s.lost_bytes}) [${s.justification}]`);
    if (shrunk.length > 25) console.error(`  ... and ${shrunk.length - 25} more in ${OUT}`);
    console.error('  Either recover the content, or name the shrink in justified_shrinks with the exact byte count and the reason.');
    process.exit(1);
  }
  console.log(`RENDERED OUTPUT SHRINK GUARD PASS: ${measured} page(s) measured against their accepted floor; ${(baseline.justified_shrinks || []).length} named shrink(s) still reproducing; ${missing.length} floor(s) with no file on disk.`);
  console.log(`  HISTORIC RATCHET: ${historicChecked} of ${historic.routes.length} route(s) enumerated as below their historic maximum are on disk and still below it.`);
  console.log(`                    ${historic.routes_that_lost_artifact_blocks} of them have lost ${historic.artifact_blocks_lost} delivered artifact block(s) - pre-existing, dated, and recorded in ${HISTORIC}.`);
}

main();
