#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Tighten the historic-maximum ratchet when a page climbs back.
 *
 * data/release/historic_page_maximum.json enumerates every accepted route that is
 * smaller today than it has ever been. validate_rendered_output_shrink_guard.js treats
 * that list as SHRINK-ONLY: a listed route that climbs back to its historic maximum
 * must be deleted from the list, or the guard fails.
 *
 * Until 2026-09-14 nothing in the repo performed that deletion. The content release
 * lane grows pages - that is its job - and on 2026-09-14 (Velocity Content Release run
 * 34851354622) it grew eight personal-injury routes past their recorded ceiling, found
 * the guard failing with "no registered repair", published anyway under the
 * repair-less-does-not-block rule, and handed a red tree to Validate Repo (run
 * 34858125966). Every improvement the lane makes to a previously-shrunk page would
 * turn main red the same way, via a bot commit no human could foresee.
 *
 * This is the missing writer. It reads the list, measures each listed route on disk,
 * and RETIRES every row whose page is at or above its historic maximum. It never adds
 * a row and never raises a ceiling - the full re-measurement in
 * measure_historic_page_maximum.js does that, on demand, from git history. So this can
 * only ever make the list shorter, which is the one direction the ratchet permits.
 *
 * Retired rows are not thrown away: they move to `retired`, with the size the page
 * recovered to and the date, so the record of what was below its maximum and when it
 * came back stays readable in the same file.
 *
 *   (no flags)   retire recovered rows and rewrite the file
 *   --check      exit non-zero if any row WOULD be retired; write nothing
 *
 * Rule 0: a missing list, a list with zero routes, or a list where zero routes are on
 * disk is a hard failure. "Nothing to retire" is only a conclusion when something was
 * measured.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.HISTORIC_RATCHET_ROOT
  ? path.resolve(process.env.HISTORIC_RATCHET_ROOT)
  : path.resolve(__dirname, '../..');
const HISTORIC = 'data/release/historic_page_maximum.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const CHECK = process.argv.includes('--check');

function rel(p) { return path.join(ROOT, p); }

function retireRecovered(historic) {
  const kept = [];
  const retired = [];
  let onDisk = 0;
  for (const row of historic.routes) {
    const relPath = String(row.implementation_path || '');
    const abs = rel(relPath);
    if (!relPath || !fs.existsSync(abs)) { kept.push(row); continue; }
    onDisk += 1;
    const size = fs.statSync(abs).size;
    if (size < Number(row.historic_max_bytes)) { kept.push(row); continue; }
    retired.push({
      implementation_path: relPath,
      historic_max_bytes: Number(row.historic_max_bytes),
      recovered_to_bytes: size,
      was_below_by_bytes: Number(row.below_by_bytes),
      lost_artifact_blocks: Number(row.lost_artifact_blocks || 0),
      retired_at: DATE
    });
  }
  return { kept, retired, onDisk };
}

function main() {
  let historic = null;
  try { historic = JSON.parse(fs.readFileSync(rel(HISTORIC), 'utf8')); } catch { historic = null; }
  if (!historic || !Array.isArray(historic.routes)) {
    console.error(`HISTORIC RATCHET RETIRE FAIL: ${HISTORIC} is missing or carries no routes array. Run \`npm run measure:historic-page-maximum\` first; there is nothing to tighten.`);
    process.exit(1);
  }
  if (!historic.routes.length) {
    console.error(`HISTORIC RATCHET RETIRE FAIL: ${HISTORIC} lists zero routes. An empty ratchet cannot be tightened, and an empty list is not evidence that every page is at its maximum.`);
    process.exit(1);
  }

  const { kept, retired, onDisk } = retireRecovered(historic);
  if (onDisk === 0) {
    console.error(`HISTORIC RATCHET RETIRE FAIL: ${historic.routes.length} route(s) listed and none is on disk. Nothing was measured. Build the site, then re-run.`);
    process.exit(1);
  }

  if (CHECK) {
    if (retired.length) {
      console.error(`HISTORIC RATCHET RETIRE FAIL (--check): ${retired.length} of ${onDisk} listed route(s) on disk have climbed back to their historic maximum and are still listed. Run \`npm run ratchet:historic-page-maximum\` and commit ${HISTORIC}:`);
      for (const r of retired.slice(0, 25)) console.error(`  ${r.implementation_path}  historic max ${r.historic_max_bytes}B, page is ${r.recovered_to_bytes}B`);
      process.exit(1);
    }
    console.log(`HISTORIC RATCHET RETIRE PASS (--check): ${onDisk} of ${historic.routes.length} listed route(s) measured on disk; every one is still below its historic maximum.`);
    return;
  }

  if (!retired.length) {
    console.log(`HISTORIC RATCHET RETIRE PASS: ${onDisk} of ${historic.routes.length} listed route(s) measured on disk; none has climbed back, so the list is unchanged.`);
    return;
  }

  const withArtifactLoss = kept.filter((r) => Number(r.lost_artifact_blocks) > 0);
  const { routes: _routes, retired: priorRetired, retired_at: _retiredAt, ...head } = historic;
  const doc = {
    ...head,
    routes_below_historic_max: kept.length,
    routes_that_lost_artifact_blocks: withArtifactLoss.length,
    artifact_blocks_lost: withArtifactLoss.reduce((n, r) => n + Number(r.lost_artifact_blocks), 0),
    total_bytes_below_historic_max: kept.reduce((n, r) => n + Number(r.below_by_bytes), 0),
    retired_at: DATE,
    retired: [...(Array.isArray(priorRetired) ? priorRetired : []), ...retired],
    routes: kept
  };
  fs.writeFileSync(rel(HISTORIC), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`HISTORIC RATCHET RETIRE PASS: ${onDisk} of ${historic.routes.length} listed route(s) measured on disk; ${retired.length} climbed back to their historic maximum and were retired; ${kept.length} remain below it.`);
  for (const r of retired.slice(0, 25)) console.log(`  retired ${r.implementation_path}  ${r.historic_max_bytes}B -> ${r.recovered_to_bytes}B`);
}

main();
