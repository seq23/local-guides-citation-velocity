#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Recover the artifact blocks that were lost BEFORE the frozen store became reproducible.
 *
 * scripts/citation_velocity/recover_accepted_page_artifacts.js parses artifacts out of the
 * CURRENT accepted output, so it can only preserve what a page still has. It cannot bring
 * back what a page lost a week ago - and measurement showed a lot of that:
 *
 *   862 accepted routes are smaller today than they have ever been (1,251,715 bytes)
 *   111 of them are missing artifact blocks entirely - 626 blocks
 *
 * Most of those 626 are gone on purpose. 437 carry internal build-directive text and were
 * deleted by three landed repairs (#17 unsealed an internal-instruction leak across 148
 * pages, #18 stopped build-acceptance criteria rendering as reader red flags, #28 stopped
 * requiring compiler-invented headings). Restoring those would re-publish the exact defect
 * those PRs fixed, so they are refused here by the same predicate that removed them.
 *
 * What is left is 187 blocks of clean reader content across 56 routes, and git history
 * shows where they went. Two events, not a drift:
 *
 *   2026-08-24  "Route every Find a Provider CTA to the request surface" - a wide thaw to
 *               change CTA routing. The rebuild dropped artifacts the semantic manifest
 *               could no longer produce, and re-accepting installed the thinner pages as
 *               the new accepted bytes. The CTA change was intended; this was collateral.
 *   2026-08-27  the neuro absorption and #17, same mechanism, smaller blast radius.
 *
 * The old bytes are still in git, and the artifact renderer round-trips, so the loss is
 * recoverable rather than gone. This reads each route's largest historical version, takes
 * the clean blocks the page no longer carries, and writes them to
 * data/release/historic_recovered_artifacts.json, which scripts/lib/accepted_artifacts.js
 * merges in alongside the accepted store.
 *
 * Refused, never silently: internal-instruction text, a phrase named in
 * data/release/withheld_page_phrases.json, and any block whose heading is already on the
 * page today (a re-titled or re-rowed successor, not a hole).
 *
 * Rule 0: examining zero routes is a hard failure.
 *
 *   --check   fail if the file is out of date; write nothing.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { artifactsFromRenderedHtml, artifactKey } = require('../lib/rendered_artifact_recovery');
const { containsInternalInstruction, isInternalInstructionText } = require('../lib/internal_instruction_text');
const { normalizeForbidden } = require('../lib/html_fix_acceptance_parser');

const ROOT = path.resolve(__dirname, '../..');
const HISTORIC = 'data/release/historic_page_maximum.json';
const WITHHOLD = 'data/release/withheld_page_phrases.json';
const OUT = 'data/release/historic_recovered_artifacts.json';
const EVIDENCE = 'artifacts/validation/historic-artifact-recovery.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const CHECK_ONLY = process.argv.includes('--check');

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function main() {
  const historic = readJson(HISTORIC, null);
  if (!historic || !Array.isArray(historic.routes)) {
    console.error(`HISTORIC ARTIFACT RECOVERY FAIL: ${HISTORIC} is missing. Run scripts/release/measure_historic_page_maximum.js first.`);
    process.exit(1);
  }
  const withheld = new Map();
  for (const item of (readJson(WITHHOLD, { withheld: [] }).withheld || [])) {
    const key = String(item.implementation_path || '');
    if (!withheld.has(key)) withheld.set(key, new Set());
    withheld.get(key).add(normalizeForbidden(item.phrase));
  }

  const candidates = historic.routes.filter((r) => r.lost_artifact_blocks > 0);
  if (!candidates.length) {
    console.error('HISTORIC ARTIFACT RECOVERY FAIL: zero routes recorded as having lost artifact blocks. Either the measurement is stale or it never ran; both are defects, not a pass.');
    process.exit(1);
  }

  const routes = {};
  let examined = 0;
  let recovered = 0;
  const refused = { internal_instruction: 0, withheld_phrase: 0, heading_still_present: 0 };

  for (const row of candidates) {
    const file = String(row.implementation_path || '');
    const abs = rel(file);
    if (!file || !fs.existsSync(abs)) continue;
    let old;
    try { old = cp.execFileSync('git', ['show', `${row.historic_max_commit}:${file}`], { cwd: ROOT, maxBuffer: 1 << 27 }).toString('utf8'); }
    catch { continue; }
    examined += 1;

    const current = artifactsFromRenderedHtml(fs.readFileSync(abs, 'utf8'));
    const currentKeys = new Set(current.map(artifactKey));
    const currentTitles = new Set(current.map((a) => String(a.title)));
    const forbidden = withheld.get(file) || new Set();

    const keep = [];
    for (const artifact of artifactsFromRenderedHtml(old)) {
      if (currentKeys.has(artifactKey(artifact))) continue;
      if (containsInternalInstruction(artifact) || isInternalInstructionText(String(artifact.title))) { refused.internal_instruction += 1; continue; }
      if (forbidden.has(normalizeForbidden(artifact.title))) { refused.withheld_phrase += 1; continue; }
      // A heading that is still on the page means the block was re-authored, not lost.
      if (currentTitles.has(String(artifact.title))) { refused.heading_still_present += 1; continue; }
      keep.push(artifact);
    }
    if (!keep.length) continue;
    routes[file] = {
      route: `/${file.replace(/index\.html$/, '')}`,
      recovered_from_commit: row.historic_max_commit,
      historic_max_bytes: row.historic_max_bytes,
      artifact_count: keep.length,
      artifacts: keep
    };
    recovered += keep.length;
  }

  if (examined === 0) {
    console.error(`HISTORIC ARTIFACT RECOVERY FAIL: ${candidates.length} candidate route(s) and none was readable at its historic commit. Recovery is UNKNOWN, not complete.`);
    process.exit(1);
  }

  const doc = {
    schema_version: '1.0',
    authority: 'scripts/citation_velocity/recover_historic_artifact_loss.js',
    purpose: 'Clean reader-facing artifact blocks that a page carried at its historic maximum and lost through a thaw-rebuild-reaccept cycle, restored from git and merged in at render time.',
    policy: 'Internal build-directive text is never recovered: three landed PRs deleted it on purpose and restoring it would republish the defect they fixed. Neither is a phrase named in data/release/withheld_page_phrases.json, nor a block whose heading is still on the page.',
    generated_at: DATE,
    route_count: Object.keys(routes).length,
    artifact_count: recovered,
    refused,
    routes
  };
  const prev = fs.existsSync(rel(OUT)) ? fs.readFileSync(rel(OUT), 'utf8') : '';

  // Same defect as recover_accepted_page_artifacts.js: `generated_at` is a
  // wall-clock stamp inside the payload --check byte-compares, so this Tier 1
  // HARD_FAIL expired at UTC midnight even though the recovered set had not
  // changed. Re-serializing under the previous stamp is an exact byte test for
  // "only the date moved"; anything substantive still differs under any stamp and
  // still fails --check.
  const prevDoc = readJson(OUT, null);
  const prevGeneratedAt = prevDoc && typeof prevDoc.generated_at === 'string' ? prevDoc.generated_at : '';
  if (prevGeneratedAt && prev
    && `${JSON.stringify({ ...doc, generated_at: prevGeneratedAt }, null, 2)}\n` === prev) {
    doc.generated_at = prevGeneratedAt;
  }
  const next = `${JSON.stringify(doc, null, 2)}\n`;

  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(EVIDENCE), `${JSON.stringify({ ...doc, routes: undefined, status: 'PASS', mode: CHECK_ONLY ? 'CHECK' : 'WRITE', candidates: candidates.length, examined, file_changed: prev !== next }, null, 2)}\n`);

  if (CHECK_ONLY) {
    if (prev !== next) {
      console.error(`HISTORIC ARTIFACT RECOVERY FAIL (--check): ${OUT} is out of date. Run without --check and commit the result.`);
      process.exit(1);
    }
    console.log(`HISTORIC ARTIFACT RECOVERY PASS (--check): ${examined} route(s) examined; file current (${doc.route_count} route(s), ${recovered} artifact(s)).`);
    return;
  }
  fs.writeFileSync(rel(OUT), next);
  console.log(`HISTORIC ARTIFACT RECOVERY PASS: ${examined} of ${candidates.length} candidate route(s) examined; recovered ${recovered} clean block(s) across ${doc.route_count} route(s); refused ${refused.internal_instruction} internal-instruction, ${refused.withheld_phrase} withheld-phrase, ${refused.heading_still_present} already-present.`);
}

main();
