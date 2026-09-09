#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Every page a recommendation named is confirmed PER PAGE, from the page itself.
 *
 * data/report_fixes/agent_fix_ledger.json is the repo's record of what the external
 * citation agents asked for: 3,142 rows, each naming a target page and the
 * `required_markers` that must appear on it. Three separate guards already read that
 * ledger, and between them they leave one whole class of recommendation unexamined:
 *
 *   agent-fix-ledger-truthfulness  - only rows that CLAIM a released status. A row
 *                                    demoted by its own repair leaves its field of view.
 *   agent-run-delivery-coverage    - per RUN DATE. Its cap is a single number for a
 *                                    whole day's recommendations.
 *   agent-run-absorption-completeness - joins named targets to the ledger, not the
 *                                    ledger to the rendered page.
 *
 * The hole is the UNIT. Recommendations for one page arrive across many run dates, and
 * a run-date cap constrains only that day's total - so a gap is free to move from one
 * page to another inside the same run without moving any number the existing guards
 * watch. Repair page A and break page B on the same run date and 2026-08-05 still
 * reads 97: the ledger is greener nowhere and every guard stays silent. Measured
 * 2026-09-09 the ledger names 366 distinct pages against 52 run dates, so a run-date
 * cap is an average over seven pages at a time.
 *
 * The second thing no existing guard emits is the per-page ANSWER. "Have all the pages
 * been fixed, created and updated" is a per-page question; a coverage percentage
 * cannot answer it. This writes recommended / applied / not applied for every page,
 * and carries `exists` per page so the pages the repo was supposed to CREATE are
 * visible as pages rather than folded into a percentage. Measured 2026-09-09: 107 rows
 * across 63 distinct paths name a page that is not in the tree at all. Seventeen of
 * those are not real absences - they are scorecard metadata
 * ("personal-injury/index.html | LEVEL: L1 | DELTA: ...") percent-encoded into a
 * pseudo-path, while the page itself sits in the repo. Those are the two paths
 * velocity-content-release.yml reported as `repair_not_proven:` on 2026-09-06 and
 * 2026-09-08, and citation_route_resolver.js now strips that decoration at the source.
 *
 * The unit here is the PAGE, not the run and not the claim, because "have all the
 * pages been fixed, created and updated" is a per-page question and an aggregate
 * cannot answer it. For every page any recommendation named, this reports
 * recommended / applied / not applied, and the evidence for "applied" is the bytes of
 * the page - never `implementation_status`. A status column is exactly what this
 * repo has already been burned by: on 2026-09-02 all 51 rows of a TRT run read
 * RELEASED_VERIFIED while twelve of their markers were absent from the page.
 *
 * Rule 0: examining zero pages, zero rows or zero markers is a FAILURE. An empty,
 * missing or unreadable ledger means application is UNKNOWN, not proven.
 *
 * The baseline is a shrink-only RATCHET, per page: the maximum number of
 * recommendations that page may leave unshown. A page over its cap is a regression.
 * A page whose gaps have fallen must be re-baselined down, so a repair cannot be
 * banked twice. A page the baseline has never seen is UNENROLLED - a third state,
 * not a regression - which still fails, because an unenrolled page has no cap, but is
 * repairable by `npm run recover:recommendation-page-application`. Enrolment buys no
 * slack: the shrink-only rule drives the new cap down on the next cycle as the release
 * lane renders the pages.
 */

const fs = require('fs');
const path = require('path');
const { auditFix } = require('./validate_agent_fix_ledger_truthfulness');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';
const BASELINE_REL = 'data/report_fixes/agent_recommendation_page_application_baseline.json';
const OUT_REL = 'artifacts/validation/agent-recommendation-page-application.json';

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

/**
 * Which page a row is about. renderedPath is the rendered target; intended_winner_path
 * is what the agent named when the intake could not resolve one. A row with neither
 * names no page and is reported separately rather than silently dropped.
 */
function pageKeyOf(fix) {
  return String(fix.renderedPath || fix.intended_winner_path || '').trim();
}

/**
 * One row's verdict, from the page's own bytes.
 *
 * `rendered_file_missing` is deliberately NOT excused here. The page a recommendation
 * named is either showing the requested content or it is not, and a page that does not
 * exist is not showing it. That is the whole difference between this guard and
 * agent-run-delivery-coverage.
 */
function verdictOf(fix) {
  const audit = auditFix(fix);
  if (!audit.reason) return { state: 'APPLIED', detail: '' };
  if (audit.reason === 'required_markers_absent') {
    return { state: 'NOT_APPLIED', detail: `required_markers_absent:${JSON.stringify(audit.missing[0] || '')}` };
  }
  if (audit.reason === 'rendered_file_missing') {
    return { state: 'NOT_APPLIED', detail: 'target_page_absent_from_tree' };
  }
  // no_rendered_path / no_required_markers: the row states no checkable target. It is
  // not applied and it is not a page-level gap either; it is an intake defect, counted
  // and reported as UNCHECKABLE so it can never be mistaken for a pass.
  return { state: 'UNCHECKABLE', detail: audit.reason };
}

function measure(ledger) {
  const pages = new Map();
  let uncheckable = 0;
  let markersExamined = 0;
  for (const fix of ledger.fixes || []) {
    const verdict = verdictOf(fix);
    if (verdict.state === 'UNCHECKABLE') { uncheckable += 1; continue; }
    const key = pageKeyOf(fix);
    if (!key) { uncheckable += 1; continue; }
    markersExamined += (fix.required_markers || []).filter(Boolean).length;
    if (!pages.has(key)) {
      pages.set(key, {
        page: key,
        exists: fs.existsSync(path.join(ROOT, key)),
        recommended: 0,
        applied: 0,
        not_applied: 0,
        examples: [],
      });
    }
    const row = pages.get(key);
    row.recommended += 1;
    if (verdict.state === 'APPLIED') row.applied += 1;
    else {
      row.not_applied += 1;
      if (row.examples.length < 3) row.examples.push({ id: fix.id, run_date: fix.run_date || '', reason: verdict.detail });
    }
  }
  return { pages, uncheckable, markersExamined };
}

function main() {
  const rebaseline = process.argv.slice(2).includes('--rebaseline');
  const ledger = readJson(LEDGER_REL, null);

  // Rule 0, three ways. Each of these means application is UNKNOWN, not proven.
  if (!ledger || !Array.isArray(ledger.fixes)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${LEDGER_REL} is missing or unreadable, so this validator examined zero recommendations. Whether the pages were fixed is UNKNOWN, not proven.`);
    process.exit(1);
  }
  if (!ledger.fixes.length) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${LEDGER_REL} holds zero recommendations, so this validator examined zero pages. An empty ledger cannot prove that every page was fixed; refusing to pass on an empty loop.`);
    process.exit(1);
  }

  const { pages, uncheckable, markersExamined } = measure(ledger);

  if (!pages.size) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${ledger.fixes.length} recommendation(s) present but none names a checkable page, so this validator examined zero pages. Refusing to pass on an empty loop.`);
    process.exit(1);
  }
  if (!markersExamined) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${pages.size} page(s) joined but zero required_markers were examined, so nothing was actually compared against a page. A join that checks no content proves nothing.`);
    process.exit(1);
  }

  const baseline = readJson(BASELINE_REL, null);
  const caps = (baseline && baseline.max_unapplied_by_page) || {};

  const rows = [...pages.values()].sort((a, b) => (b.not_applied - a.not_applied) || a.page.localeCompare(b.page));

  if (rebaseline) {
    const next = {};
    for (const row of rows) if (row.not_applied > 0) next[row.page] = row.not_applied;
    const before = Object.keys(caps).length ? caps : null;
    const identical = before && JSON.stringify(before) === JSON.stringify(next);
    if (identical) {
      console.error('AGENT RECOMMENDATION PAGE APPLICATION REBASELINE REFUSED: every page is already enrolled at its measured gap count and no cap can be tightened, so this would rewrite the identical baseline and report success. Nothing to repair.');
      process.exit(1);
    }
    const payload = {
      schema_version: '1.0',
      note: 'Shrink-only ratchet, per page. Each value is the maximum number of recommendations that page may leave unshown by its own rendered bytes. Lower it when a repair lands; never raise it. A page absent from this map must have zero gaps.',
      updated_at: new Date().toISOString().slice(0, 10),
      total_max_unapplied: Object.values(next).reduce((a, b) => a + b, 0),
      pages_with_gaps: Object.keys(next).length,
      max_unapplied_by_page: Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]])),
    };
    fs.writeFileSync(path.join(ROOT, BASELINE_REL), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`AGENT RECOMMENDATION PAGE APPLICATION REBASELINED: ${payload.pages_with_gaps} page(s) with gaps, ${payload.total_max_unapplied} unapplied recommendation(s) capped.`);
    process.exit(0);
  }

  if (!baseline) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${BASELINE_REL} is missing, so no page has a cap and every gap is ungoverned. Repair with: npm run recover:recommendation-page-application`);
    process.exit(1);
  }

  const regressed = [];
  const unenrolled = [];
  const slack = [];
  for (const row of rows) {
    const cap = Object.prototype.hasOwnProperty.call(caps, row.page) ? caps[row.page] : null;
    if (cap === null) {
      // A page with no gaps and no cap is correct: the baseline only lists pages that
      // have gaps, so absence means "must be zero" and zero is what it is.
      if (row.not_applied > 0) unenrolled.push(row);
      continue;
    }
    if (row.not_applied > cap) regressed.push({ ...row, cap });
    else if (row.not_applied < cap) slack.push({ ...row, cap });
  }
  // A cap for a page that no longer appears at all is stale in the same way.
  for (const page of Object.keys(caps)) {
    if (!pages.has(page)) slack.push({ page, recommended: 0, applied: 0, not_applied: 0, cap: caps[page], examples: [] });
  }

  const totals = rows.reduce((acc, r) => {
    acc.recommended += r.recommended;
    acc.applied += r.applied;
    acc.not_applied += r.not_applied;
    if (r.not_applied === 0) acc.pages_fully_applied += 1;
    else if (r.applied > 0) acc.pages_partially_applied += 1;
    else acc.pages_none_applied += 1;
    if (!r.exists) acc.pages_absent_from_tree += 1;
    return acc;
  }, { recommended: 0, applied: 0, not_applied: 0, pages_fully_applied: 0, pages_partially_applied: 0, pages_none_applied: 0, pages_absent_from_tree: 0 });

  const status = (regressed.length || unenrolled.length || slack.length) ? 'FAIL' : 'PASS';
  const report = {
    schema_version: '1.0',
    validator: 'agent-recommendation-page-application',
    status,
    ledger: LEDGER_REL,
    ledger_rows: ledger.fixes.length,
    uncheckable_rows: uncheckable,
    markers_examined: markersExamined,
    pages_examined: pages.size,
    totals,
    regressed_pages: regressed.map((r) => ({ page: r.page, cap: r.cap, not_applied: r.not_applied, exists: r.exists, examples: r.examples })),
    unenrolled_pages: unenrolled.map((r) => ({ page: r.page, not_applied: r.not_applied, exists: r.exists, examples: r.examples })),
    slack_pages: slack.map((r) => ({ page: r.page, cap: r.cap, not_applied: r.not_applied })),
    pages: rows.map((r) => ({ page: r.page, exists: r.exists, recommended: r.recommended, applied: r.applied, not_applied: r.not_applied, examples: r.examples })),
    checked_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const row of regressed.slice(0, 20)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${row.page} leaves ${row.not_applied} of ${row.recommended} recommendation(s) unshown, above its cap of ${row.cap}${row.exists ? '' : ' (the page is not in the tree at all)'} - e.g. ${row.examples[0] ? `${row.examples[0].id} ${row.examples[0].reason}` : 'see the report'}.`);
  }
  for (const row of unenrolled.slice(0, 20)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${row.page} is UNENROLLED with ${row.not_applied} of ${row.recommended} recommendation(s) unshown${row.exists ? '' : ' (the page is not in the tree at all)'}; it has no cap, so its gaps are ungoverned.`);
  }
  for (const row of slack.slice(0, 20)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${row.page} is capped at ${row.cap} but now leaves only ${row.not_applied} unshown. The ratchet is shrink-only; a banked repair must lower the cap or it can be silently spent again.`);
  }

  if (status === 'FAIL') {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION: FAIL - examined ${pages.size} page(s) and ${markersExamined} marker(s) across ${ledger.fixes.length} recommendation(s); ${regressed.length} regressed, ${unenrolled.length} unenrolled, ${slack.length} with stale slack. Repair with: npm run recover:recommendation-page-application`);
    process.exit(1);
  }
  console.log(`AGENT RECOMMENDATION PAGE APPLICATION PASS: ${pages.size} page(s) examined against ${markersExamined} required marker(s) from ${ledger.fixes.length} recommendation(s). ${totals.applied}/${totals.recommended} applied; ${totals.pages_fully_applied} page(s) fully applied, ${totals.pages_partially_applied} partial, ${totals.pages_none_applied} with none applied, ${totals.pages_absent_from_tree} target page(s) absent from the tree. Every page is at or under its shrink-only cap.`);
}

if (require.main === module) main();
module.exports = { pageKeyOf, verdictOf, measure, LEDGER_REL, BASELINE_REL, OUT_REL };
