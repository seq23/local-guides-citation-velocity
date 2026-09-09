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
 * The baseline is a shrink-only RATCHET keyed on the recommendation ID rather than on
 * a per-page count, because a count cannot separate the three things that make a page's
 * gap number rise, and conflating them is how a ratchet becomes a rubber stamp:
 *
 *   REGRESSED  - an id the baseline recorded as APPLIED is no longer shown. Content that
 *                had landed is gone. The repair REFUSES to enrol it.
 *   UNENROLLED - an id never seen before: newly ingested work. A failure, because it is
 *                ungoverned, but repairable by enrolment.
 *   STALE      - an allowance for an id now shown. The ratchet must retire it or a
 *                landed repair can be spent twice.
 *
 * This validator's first version capped a per-page COUNT, and its repair set that cap to
 * whatever it measured - so ingesting new work looked identical to a page regressing and
 * the repair would have RAISED the cap and banked the regression. That is the "repair
 * that merely makes it stop failing" the registry's self_heal_policy forbids. Keyed on
 * ids, the repair structurally cannot un-fail a regression.
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
  const unappliedIds = new Set();
  const appliedIds = new Set();
  let uncheckable = 0;
  let markersExamined = 0;
  for (const fix of ledger.fixes || []) {
    const verdict = verdictOf(fix);
    if (verdict.state === 'UNCHECKABLE') { uncheckable += 1; continue; }
    const key = pageKeyOf(fix);
    if (!key) { uncheckable += 1; continue; }
    markersExamined += (fix.required_markers || []).filter(Boolean).length;
    if (verdict.state === 'APPLIED') appliedIds.add(fix.id); else unappliedIds.add(fix.id);
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
  return { pages, uncheckable, markersExamined, unappliedIds, appliedIds };
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

  const { pages, uncheckable, markersExamined, appliedIds: appliedNow } = measure(ledger);

  if (!pages.size) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${ledger.fixes.length} recommendation(s) present but none names a checkable page, so this validator examined zero pages. Refusing to pass on an empty loop.`);
    process.exit(1);
  }
  if (!markersExamined) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${pages.size} page(s) joined but zero required_markers were examined, so nothing was actually compared against a page. A join that checks no content proves nothing.`);
    process.exit(1);
  }

  const baseline = readJson(BASELINE_REL, null);
  const allowedUnapplied = new Set((baseline && baseline.unapplied_ids) || []);
  const provenApplied = new Set((baseline && baseline.applied_ids) || []);

  const rows = [...pages.values()].sort((a, b) => (b.not_applied - a.not_applied) || a.page.localeCompare(b.page));
  const pageOfId = new Map();
  for (const fix of ledger.fixes) pageOfId.set(fix.id, pageKeyOf(fix));

  // The ratchet is keyed on the recommendation ID, not on a per-page count, because a
  // count cannot tell three different things apart and this repo has already been bitten
  // by conflating them:
  //
  //   REGRESSED  - an id this baseline recorded as APPLIED is now unapplied. The page
  //                lost content it had. This can never be rebaselined away.
  //   UNENROLLED - an id the baseline has never seen. Newly ingested work, not yet
  //                released. A real failure (it is ungoverned) but repairable by
  //                enrolment, exactly as agent-run-delivery-coverage treats a new run.
  //   STALE      - an id the baseline allows to be unapplied that is now applied. The
  //                ratchet must tighten or a landed repair can be silently spent again.
  //
  // A count-based cap reports all three as the same number, so ingesting new work looks
  // identical to a page regressing - and the repair, which sets the cap to whatever is
  // measured, would then RAISE the cap and bank the regression. That is precisely the
  // "repair that merely makes it stop failing" the registry's self_heal_policy forbids,
  // and this validator's first version had it. Keyed on ids, the repair enrols new ids
  // and retires applied ones, and structurally cannot un-fail a regression.
  const regressedIds = [];
  const unenrolledIds = [];
  const staleIds = [];
  for (const fix of ledger.fixes) {
    const key = pageKeyOf(fix);
    if (!key || !pages.has(key)) continue;
    const applied = verdictOf(fix).state === 'APPLIED';
    if (applied) {
      if (allowedUnapplied.has(fix.id)) staleIds.push(fix.id);
    } else if (provenApplied.has(fix.id)) {
      regressedIds.push(fix.id);
    } else if (!allowedUnapplied.has(fix.id)) {
      unenrolledIds.push(fix.id);
    }
  }

  if (rebaseline) {
    if (regressedIds.length) {
      const byPage = new Map();
      for (const id of regressedIds) {
        const p = pageOfId.get(id) || '(unknown page)';
        byPage.set(p, (byPage.get(p) || 0) + 1);
      }
      console.error(`AGENT RECOMMENDATION PAGE APPLICATION REBASELINE REFUSED: ${regressedIds.length} recommendation(s) this baseline recorded as APPLIED are no longer shown by their page. Enrolling them would bank a regression and retire content that had already landed. Put the content back on the page instead.`);
      for (const [p, n] of [...byPage].slice(0, 10)) console.error(`  ${p}: ${n} regressed`);
      process.exit(1);
    }
    if (!unenrolledIds.length && !staleIds.length && baseline) {
      console.error('AGENT RECOMMENDATION PAGE APPLICATION REBASELINE REFUSED: no recommendation is unenrolled and no allowance can be retired, so this would rewrite the identical baseline and report success. Nothing to repair.');
      process.exit(1);
    }
    const nextUnapplied = [...new Set([...allowedUnapplied, ...unenrolledIds])].filter((id) => !appliedNow.has(id)).sort();
    const nextApplied = [...appliedNow].sort();
    const payload = {
      schema_version: '2.0',
      note: 'Shrink-only ratchet keyed on recommendation id. unapplied_ids are the recommendations allowed to remain unshown by their target page; applied_ids are the ones proven shown. An id may move from unapplied_ids to applied_ids and never back: a row in applied_ids that stops being shown is a REGRESSION and this repair refuses to enrol it.',
      updated_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
      unapplied_count: nextUnapplied.length,
      applied_count: nextApplied.length,
      unapplied_ids: nextUnapplied,
      applied_ids: nextApplied,
    };
    fs.writeFileSync(path.join(ROOT, BASELINE_REL), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`AGENT RECOMMENDATION PAGE APPLICATION REBASELINED: ${unenrolledIds.length} newly ingested recommendation(s) enrolled, ${staleIds.length} allowance(s) retired; ${nextUnapplied.length} still unshown, ${nextApplied.length} proven shown.`);
    process.exit(0);
  }

  if (!baseline) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${BASELINE_REL} is missing, so no recommendation has an allowance and every gap is ungoverned. Repair with: npm run recover:recommendation-page-application`);
    process.exit(1);
  }

  const groupByPage = (ids) => {
    const m = new Map();
    for (const id of ids) {
      const p = pageOfId.get(id) || '(unknown page)';
      if (!m.has(p)) m.set(p, []);
      m.get(p).push(id);
    }
    return [...m].map(([page, list]) => ({ page, count: list.length, ids: list.slice(0, 3) })).sort((a, b) => b.count - a.count);
  };
  const regressed = groupByPage(regressedIds);
  const unenrolled = groupByPage(unenrolledIds);
  const slack = groupByPage(staleIds);

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
    regressed_pages: regressed,
    unenrolled_pages: unenrolled,
    stale_allowance_pages: slack,
    regressed_recommendations: regressedIds.length,
    unenrolled_recommendations: unenrolledIds.length,
    stale_allowances: staleIds.length,
    pages: rows.map((r) => ({ page: r.page, exists: r.exists, recommended: r.recommended, applied: r.applied, not_applied: r.not_applied, examples: r.examples })),
    // SOURCE_DATE is the repo's reproducible-build stamp, and stamping it into a report
    // field is what clock-source-independence explicitly permits: it records when the
    // tree was graded without any verdict depending on it. A raw wall-clock ISO string
    // here changed on every single run, churning a committed receipt for no information.
    checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const row of regressed.slice(0, 20)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${row.page} REGRESSED - ${row.count} recommendation(s) this baseline recorded as applied are no longer shown by the page (e.g. ${row.ids[0]}). Content that had landed is gone; this cannot be rebaselined away.`);
  }
  for (const row of unenrolled.slice(0, 20)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${row.page} has ${row.count} UNENROLLED recommendation(s) not shown by the page (e.g. ${row.ids[0]}); newly ingested work with no allowance, so it is ungoverned until enrolled or released.`);
  }
  for (const row of slack.slice(0, 20)) {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION FAIL: ${row.page} has ${row.count} allowance(s) that are now shown by the page (e.g. ${row.ids[0]}). The ratchet is shrink-only; a landed repair must retire its allowance or it can be silently spent again.`);
  }

  if (status === 'FAIL') {
    console.error(`AGENT RECOMMENDATION PAGE APPLICATION: FAIL - examined ${pages.size} page(s) and ${markersExamined} marker(s) across ${ledger.fixes.length} recommendation(s); ${regressedIds.length} regressed, ${unenrolledIds.length} unenrolled, ${staleIds.length} stale allowance(s) across ${regressed.length + unenrolled.length + slack.length} page(s). Repair with: npm run recover:recommendation-page-application`);
    process.exit(1);
  }
  console.log(`AGENT RECOMMENDATION PAGE APPLICATION PASS: ${pages.size} page(s) examined against ${markersExamined} required marker(s) from ${ledger.fixes.length} recommendation(s). ${totals.applied}/${totals.recommended} applied; ${totals.pages_fully_applied} page(s) fully applied, ${totals.pages_partially_applied} partial, ${totals.pages_none_applied} with none applied, ${totals.pages_absent_from_tree} target page(s) absent from the tree. Every unshown recommendation is a known, enrolled allowance and nothing that had landed has regressed.`);
}

if (require.main === module) main();
module.exports = { pageKeyOf, verdictOf, measure, LEDGER_REL, BASELINE_REL, OUT_REL };
