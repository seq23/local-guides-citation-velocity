#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The page the world reads is the one in `dist/`, and nothing was checking it.
 *
 * agent-recommendation-page-application grades every ledger row on the bytes of the
 * page in the SOURCE tree. That is the right unit for "was the recommendation
 * applied", and it is where the 2026-09-09 investigation ended. It is not where a
 * reader ends. Between the source page and the published one the build runs
 * `Frozen accepted output guard` (2,069 restores on the 2026-09-10 tree),
 * `build_pages_dist`, the answer-shape pass, the dentistry marker pass and
 * `clarity:install` - five separate writers, any of which can hand back a page whose
 * source copy still shows a marker the published copy does not. Every guard in the
 * repo would stay green through that, because every guard reads the source copy.
 *
 * This closes it. For each recommendation the application baseline records as
 * APPLIED and which is STILL shown by its source page - so the row is known-landed,
 * not merely claimed - the same required_markers must appear in `dist/<renderedPath>`.
 *
 * Two failure modes, deliberately kept apart, because they are not the same defect
 * and must not share an allowance:
 *
 *   MARKERS_ABSENT_FROM_DIST - the page published and the build dropped the content.
 *       This is the silent-retirement class and there is NO allowance for it, ever.
 *       Measured zero on 2026-09-10 and there is no baseline field that could hold
 *       one, so it cannot be rebaselined away or ratcheted upward.
 *
 *   PAGE_ABSENT_FROM_DIST - the source page exists and shows the content but never
 *       reached the published tree at all. A different problem (admission, not
 *       rendering), and one with a real backlog behind it: 9 rows across 8 pages on
 *       2026-09-10, seven of them degenerate `https-theindustryguides-com-...` slugs
 *       from a URL that was parsed as a question. Shrink-only ratchet, keyed on the
 *       recommendation id so a new absence can never hide inside an old count.
 *
 * Rule 0: examining zero rows, zero pages or zero markers is a FAILURE. A build that
 * produced no dist tree, a ledger that lost its rows, or a baseline with no applied
 * ids all mean the published pages are UNVERIFIED, not verified. An empty loop that
 * exits 0 is exactly the "runs but inert" defect this repo keeps finding.
 */

const fs = require('fs');
const path = require('path');
const { auditFix } = require('./validate_agent_fix_ledger_truthfulness');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';
const APPLICATION_BASELINE_REL = 'data/report_fixes/agent_recommendation_page_application_baseline.json';
const BASELINE_REL = 'data/report_fixes/agent_recommendation_dist_application_baseline.json';
const OUT_REL = 'artifacts/validation/agent-recommendation-dist-application.json';
const DIST_DIR = 'dist';

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

function writeJson(rel, value) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message, extra) {
  console.error(`AGENT RECOMMENDATION DIST APPLICATION FAIL: ${message}`);
  for (const line of extra || []) console.error(`  ${line}`);
  process.exit(1);
}

function main() {
  const rebaseline = process.argv.slice(2).includes('--rebaseline');
  const ledger = readJson(LEDGER_REL, null);
  const application = readJson(APPLICATION_BASELINE_REL, null);

  if (!ledger || !Array.isArray(ledger.fixes) || !ledger.fixes.length) {
    fail(`${LEDGER_REL} is missing, unreadable or empty, so this validator examined zero recommendations. Whether the PUBLISHED pages show them is UNKNOWN, not proven.`);
  }
  if (!application || !Array.isArray(application.applied_ids) || !application.applied_ids.length) {
    fail(`${APPLICATION_BASELINE_REL} records no applied recommendation ids, so this validator had nothing to confirm in the published tree. Refusing to pass on an empty loop.`);
  }
  if (!fs.existsSync(path.join(ROOT, DIST_DIR))) {
    fail(`${DIST_DIR}/ does not exist, so no published page was read at all. Run the build before this validator; a missing dist is unverified, not clean.`);
  }

  const appliedIds = new Set(application.applied_ids);
  const markersAbsent = [];
  const pageAbsent = [];
  const examinedIds = [];
  const pagesExamined = new Set();
  let markersExamined = 0;

  for (const fix of ledger.fixes) {
    if (!appliedIds.has(fix.id)) continue;
    // Known-landed only: the row must still be shown by its own source page. A row
    // that regressed in the source tree is agent-recommendation-page-application's
    // to report, and double-reporting it here would just make two guards noisy about
    // one defect.
    if (auditFix(fix).reason) continue;
    const rendered = String(fix.renderedPath || '');
    const markers = (fix.required_markers || []).filter(Boolean);
    if (!rendered || !markers.length) continue;

    examinedIds.push(fix.id);
    pagesExamined.add(rendered);
    markersExamined += markers.length;

    const distRel = path.posix.join(DIST_DIR, rendered.split(path.sep).join('/'));
    if (!fs.existsSync(path.join(ROOT, distRel))) {
      pageAbsent.push({ id: fix.id, page: rendered, dist_path: distRel, run_date: fix.run_date || '' });
      continue;
    }
    const verdict = auditFix({ renderedPath: distRel, required_markers: markers });
    if (verdict.reason) {
      markersAbsent.push({
        id: fix.id,
        page: rendered,
        dist_path: distRel,
        run_date: fix.run_date || '',
        missing_markers: verdict.missing.slice(0, 3),
      });
    }
  }

  // Rule 0, three ways.
  if (!examinedIds.length) {
    fail(`${appliedIds.size} recommendation(s) are recorded APPLIED but none of them is still shown by its source page with a checkable rendered path, so zero published pages were examined. Refusing to pass on an empty loop.`);
  }
  if (!pagesExamined.size) {
    fail(`${examinedIds.length} landed recommendation(s) named no page, so zero published pages were examined. Refusing to pass on an empty loop.`);
  }
  if (!markersExamined) {
    fail(`${pagesExamined.size} published page(s) were opened but zero required_markers were compared against them. A check that compares no content proves nothing.`);
  }

  const baseline = readJson(BASELINE_REL, null);
  const allowedAbsentPages = new Set((baseline && baseline.page_absent_ids) || []);
  const newPageAbsent = pageAbsent.filter((row) => !allowedAbsentPages.has(row.id));
  const stalePageAbsent = [...allowedAbsentPages].filter((id) => !pageAbsent.some((row) => row.id === id));

  const report = {
    schema_version: '1.0',
    generated_at: new Date().toISOString().slice(0, 10),
    dist_dir: DIST_DIR,
    recommendations_examined: examinedIds.length,
    pages_examined: pagesExamined.size,
    markers_examined: markersExamined,
    markers_absent_from_dist: markersAbsent,
    page_absent_from_dist: pageAbsent,
    page_absent_unenrolled: newPageAbsent,
    page_absent_stale_allowances: stalePageAbsent,
  };
  writeJson(OUT_REL, report);

  if (rebaseline) {
    // The ratchet only tightens, and it can only ever hold the ADMISSION class. There
    // is deliberately no field here for a dropped marker: a build that retires content
    // from a page it did publish is never an allowance.
    if (markersAbsent.length) {
      const lines = [...new Set(markersAbsent.map((row) => `${row.page}: ${row.missing_markers[0] || ''}`))].slice(0, 20);
      console.error('AGENT RECOMMENDATION DIST APPLICATION REBASELINE REFUSED: '
        + `${markersAbsent.length} recommendation(s) are shown by their source page but NOT by the page the build published. `
        + 'That is content the build retired between the repo and dist/, and there is no allowance for it. '
        + 'Fix the build step that drops it; do not enrol it.');
      for (const line of lines) console.error(`  ${line}`);
      process.exit(1);
    }
    const next = {
      schema_version: '1.0',
      note: 'Shrink-only ratchet of recommendation ids whose source page shows the content but which never reached dist/. Admission backlog only. A marker dropped from a page that DID publish can never be enrolled here.',
      updated_at: new Date().toISOString().slice(0, 10),
      page_absent_count: pageAbsent.length,
      page_absent_ids: pageAbsent.map((row) => row.id).sort(),
    };
    if (baseline && (baseline.page_absent_ids || []).length < next.page_absent_ids.length) {
      console.error('AGENT RECOMMENDATION DIST APPLICATION REBASELINE REFUSED: this ratchet only tightens. '
        + `The allowance would rise from ${(baseline.page_absent_ids || []).length} to ${next.page_absent_ids.length}. `
        + `${newPageAbsent.length} page(s) stopped publishing; restore them to dist/ instead.`);
      for (const row of newPageAbsent.slice(0, 20)) console.error(`  ${row.page}`);
      process.exit(1);
    }
    writeJson(BASELINE_REL, next);
    console.log(`AGENT RECOMMENDATION DIST APPLICATION REBASELINED: ${next.page_absent_ids.length} admission allowance(s) enrolled; ${stalePageAbsent.length} retired.`);
    return;
  }

  const problems = [];
  if (markersAbsent.length) {
    problems.push(`${markersAbsent.length} recommendation(s) across ${new Set(markersAbsent.map((r) => r.page)).size} page(s) are shown by their source page but NOT by the page the build published:`);
    for (const row of markersAbsent.slice(0, 20)) problems.push(`  ${row.dist_path}: missing ${JSON.stringify(row.missing_markers[0] || '')}`);
  }
  if (newPageAbsent.length) {
    problems.push(`${newPageAbsent.length} recommendation(s) sit on a source page that shows the content but never reached ${DIST_DIR}/:`);
    for (const row of newPageAbsent.slice(0, 20)) problems.push(`  ${row.dist_path}`);
  }
  if (stalePageAbsent.length) {
    problems.push(`${stalePageAbsent.length} enrolled admission allowance(s) now publish and must be retired from the ratchet (npm run recover:recommendation-dist-application).`);
  }

  if (problems.length) {
    fail(`${examinedIds.length} landed recommendation(s) checked against the published tree and ${markersAbsent.length + newPageAbsent.length + stalePageAbsent.length} did not hold.`, problems);
  }

  console.log(`AGENT RECOMMENDATION DIST APPLICATION PASS: ${examinedIds.length} landed recommendation(s) across ${pagesExamined.size} page(s) re-confirmed against ${markersExamined} required marker(s) in the PUBLISHED ${DIST_DIR}/ tree. `
    + `Zero markers dropped by the build; ${pageAbsent.length} row(s) await admission, all enrolled in the shrink-only ratchet.`);
}

if (require.main === module) main();
module.exports = { main };
