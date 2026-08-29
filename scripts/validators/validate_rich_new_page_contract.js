#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { classifyRichNewPage, requiresRichAuthorityPage } = require('../lib/rich_new_page_classifier');
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const live = read('content/_live/pages.json', { pages: [] });
const staged = read('content/_staged/pages.json', { pages: [] });

// --------------------------------------------------------------- DEFECT 1
// What this used to do, and why that was wrong
// --------------------------------------------
// The release artifact was read as
//   read('artifacts/validation/velocity-content-release.json', { created: [] })
// so a MISSING artifact became an empty created list. Reproduced:
//   rm -rf artifacts/validation && node scripts/validators/validate_rich_new_page_contract.js
// printed "rich-new-page-contract PASS (0 created page(s))" and exited 0. This is
// a HARD_FAIL validator in seven profiles, and its green line covered the case
// where the release it is supposed to grade had not run, had crashed, or had had
// its evidence deleted. An absent release artifact is now a named stop.
const RELEASE_ARTIFACT = 'artifacts/validation/velocity-content-release.json';
const stop = (reason, remedy) => {
  console.error(`RICH NEW PAGE CONTRACT: STOP - ${reason}`);
  console.error(`  Remedy: ${remedy}`);
  console.error('  This is not a pass. Nothing was graded.');
  out('artifacts/validation/rich-new-page-contract.json', { schema_version: '1.0', validator: 'rich-new-page-contract', status: 'UNVERIFIED', checked_count: 0, checked: [], stop_reason: reason, remedy });
  process.exit(1);
};
if (!fs.existsSync(path.join(ROOT, RELEASE_ARTIFACT))) {
  stop(`${RELEASE_ARTIFACT} does not exist, so there is no record of what the release created and this validator has nothing to grade.`,
    'Run the velocity content release (npm run release:velocity-content or the release lane that produces it) before this validator, or restore the artifact. Its absence must never read as "no rich pages were broken".');
}
const created = read(RELEASE_ARTIFACT, null);
if (!created || !Array.isArray(created.created)) {
  stop(`${RELEASE_ARTIFACT} is unreadable or carries no "created" array, so the release cannot be enumerated.`,
    'Re-run the release so it writes a well-formed artifact.');
}
const approval = read('data/community/approval_queue.json', []);
const html = read('artifacts/validation/html-report-contract.json', {});
const pages = [...(live.pages || []), ...(staged.pages || [])];
const byRoute = new Map(pages.map((p) => [p.path || p.slug, p]));

// --------------------------------------------------------------- DEFECT 3
// What this used to do, and why that was wrong
// --------------------------------------------
// Nothing, and that was the whole problem. Because DEFECT 2 scoped every
// candidate row to a date that matched none of them, this validator never once
// asked the question it exists to ask: was the page that was admitted for build
// actually built? Turning the scoping on answered it. Of the 191 rich-authority-
// required page_specs in artifacts/validation/html-report-contract.json, 171
// rows - 136 distinct target_routes - name a route that exists in neither
// content/_live/pages.json, nor content/_staged/pages.json, nor on disk. They
// were discovered, classified, marked READY_TO_RELEASE, admitted for build, and
// never built, over 27 run dates from 2026-06-23 to 2026-08-27.
//
// That backlog cannot be cleared by this validator and must not be hidden by it.
// The governed ceiling is 2 new URLs/day (data/authority_scale/velocity_decision.json)
// and it is now genuinely enforced, so 136 routes is weeks of release-lane work;
// writing them here would mean inventing content the discovery pipeline never
// produced. So it takes the shape this repo already uses for exactly this
// situation (data/content/rendered_route_exclusions.json plus
// scripts/validators/validate_rendered_route_admission_parity.js): the backlog is
// DECLARED, per-route, with the run date it was admitted on so its age is legible,
// and its total is printed on every run and written into the evidence artifact.
// A declared backlog that nobody can see is the same defect wearing a permission
// slip, so the count is in the PASS line itself.
//
// What it can no longer do is grow or go stale. Every rich-authority route in the
// contract is reconciled against the declared set on every run, across ALL run
// dates rather than only the scoped one:
//   - admitted, not built, not declared  -> HARD FAIL (a new silent backlog item)
//   - declared but now built             -> HARD FAIL (a stale declaration that
//                                           outlived its cause is the next
//                                           version of this bug; delete the entry)
//   - zero rows examined                 -> HARD FAIL (see Rule 0)
const BACKLOG_REL = 'data/content/unbuilt_rich_page_backlog.json';
const backlogDoc = read(BACKLOG_REL, null);
const backlogErrors = [];
const declaredBacklog = new Map();
if (!backlogDoc || !Array.isArray(backlogDoc.routes)) {
  backlogErrors.push(`declared_backlog_unreadable:${BACKLOG_REL} - the declared-backlog file is the only record of which admitted routes are knowingly unbuilt; without it every unbuilt page is a silent gap again.`);
} else {
  for (const entry of backlogDoc.routes) {
    if (!entry || !entry.route) continue;
    if (!entry.reason || !entry.first_admitted_on) {
      backlogErrors.push(`declared_backlog_entry_incomplete:${entry.route} - a backlog entry without a reason and a first_admitted_on date is an unaudited exemption; its age must stay legible.`);
      continue;
    }
    declaredBacklog.set(entry.route, entry);
  }
  if (typeof backlogDoc.declared_count === 'number' && backlogDoc.declared_count !== backlogDoc.routes.length) {
    backlogErrors.push(`declared_backlog_count_mismatch:${BACKLOG_REL} says declared_count=${backlogDoc.declared_count} but carries ${backlogDoc.routes.length} routes. The published depth of the backlog must match the backlog.`);
  }
}
// "Built" means the same thing here as it does in the registry: a page object in
// live or staged, or rendered HTML on disk. Checking only pages.json would let a
// route that exists purely as rendered output read as unbuilt forever.
const builtOnDisk = (route) => {
  const rel = String(route || '').replace(/^\/+|\/+$/g, '');
  if (!rel) return false;
  return fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, `${rel}.html`));
};
const isBuilt = (route) => byRoute.has(route) || builtOnDisk(route);
const errors = [];
const checked = [];
const targetRows = [];

// --------------------------------------------------------------- DEFECT 2
// What this used to do, and why that was wrong
// --------------------------------------------
// The approval-queue filter and the html-report-contract filter both tested
//   String(row.source_run_id||'').includes('2026-07-03')
//   || String(row.source_artifacts?.manifest||'').includes('2026-07-03')
// A HARDCODED run date. Today is 2026-08-29, so both sources have contributed
// nothing for two months and never will again - the validator ran, matched no
// rows, and reported PASS over an empty set.
//
// Worse: those two field names do not exist on html-report-contract page_specs.
// Those rows carry `run_date` and `manifest_path`, not `source_run_id` and
// `source_artifacts.manifest`, so all 359 of them evaluated to '' and that source
// matched ZERO rows on every date, 2026-07-03 included. The filter was not merely
// stale, it never worked.
//
// The filter is kept - scoping this contract to the current run is correct - but
// it now reads each row's real provenance and compares against a live date:
// SOURCE_DATE (the repo convention) when it is set and actually present in the
// sources, otherwise the LATEST run date the sources carry. It can no longer
// silently address a date that no longer exists.
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const runDateOf = (row) => {
  for (const candidate of [row && row.run_date, row && row.source_run_id, row && row.source_artifacts && row.source_artifacts.manifest, row && row.manifest_path]) {
    const m = DATE_RE.exec(String(candidate || ''));
    if (m) return m[1];
  }
  return '';
};
const approvalRows = (Array.isArray(approval) ? approval : []).filter((row) => String(row.admission_basis || '').includes('HTML_REPORT_CONTRACT_PAGE_TO_BUILD') && row.target_route);
const htmlRows = (Array.isArray(html.page_specs) ? html.page_specs : []).filter((row) => row && row.target_route);
const datedRows = [...approvalRows, ...htmlRows].map((row) => ({ row, date: runDateOf(row) })).filter((x) => x.date);
const datesSeen = [...new Set(datedRows.map((x) => x.date))].sort();
const ENV_DATE = String(process.env.SOURCE_DATE || '').trim();
const TARGET_RUN_DATE = (/^\d{4}-\d{2}-\d{2}$/.test(ENV_DATE) && datesSeen.includes(ENV_DATE))
  ? ENV_DATE
  : (datesSeen[datesSeen.length - 1] || '');
const dateSource = TARGET_RUN_DATE === ENV_DATE ? 'SOURCE_DATE' : 'latest run date present in the sources';
if (!datesSeen.length && (approvalRows.length || htmlRows.length)) {
  stop(`${approvalRows.length + htmlRows.length} candidate row(s) carry no run date in any of run_date, source_run_id, source_artifacts.manifest or manifest_path, so this contract cannot be scoped to a run and would grade nothing.`,
    'Emit a run date on the rows (the producers already know it), or widen runDateOf() to the field they actually use. Do not let undated rows fall through as "nothing to check".');
}

for (const row of created.created) targetRows.push({ id: row.id, route: row.route, source: 'velocity-content-release' });
for (const row of approvalRows) {
  if (runDateOf(row) !== TARGET_RUN_DATE) continue;
  targetRows.push({ id: row.id, route: row.target_route, source: 'approval_queue', query: row.query, rich_page_type: row.rich_page_type, route_family: row.route_family, source_run_id: row.source_run_id, source_artifacts: row.source_artifacts });
}
for (const row of htmlRows) {
  if (runDateOf(row) !== TARGET_RUN_DATE) continue;
  targetRows.push({ id: row.id, route: row.target_route, source: 'html_report_contract', query: row.query, rich_page_type: row.rich_page_type, route_family: row.route_family, source_run_id: row.source_run_id || row.run_date, source_artifacts: row.source_artifacts || { manifest: row.manifest_path } });
}
// A route needs a rich authority page if the classifier says so, or if its shape
// is /guides/ or /clusters/ - those sections are rich by definition here.
const needsRichPage = (row, route) => {
  const rich = row.rich_page_type || classifyRichNewPage(row).rich_page_type;
  return requiresRichAuthorityPage(rich) || /\/(guides|clusters)\//.test(String(route || ''));
};
const dedupedRows = [...new Map(targetRows.map((row) => [row.route, row])).values()]
  .filter((row) => needsRichPage(row, row.route));

// ------------------------------------------------- backlog reconciliation
// Deliberately NOT scoped to TARGET_RUN_DATE. The grading loop below is scoped
// to one run because grading page quality is a per-release job; accounting for
// what was admitted and never built is not. Scoping the accounting to one date
// is how 136 routes accumulated unseen in the first place, so this pass reads
// every rich-authority row in the contract on every date.
const allRichRows = [...approvalRows.map((r) => ({ row: r, route: r.target_route })), ...htmlRows.map((r) => ({ row: r, route: r.target_route }))]
  .filter(({ row, route }) => needsRichPage(row, route));
const allRichRoutes = [...new Set(allRichRows.map((x) => x.route))];
const unbuiltRoutes = allRichRoutes.filter((route) => !isBuilt(route));
const undeclaredUnbuilt = unbuiltRoutes.filter((route) => !declaredBacklog.has(route));
const staleDeclarations = [...declaredBacklog.keys()].filter((route) => isBuilt(route));
if (undeclaredUnbuilt.length) {
  backlogErrors.push(
    `undeclared_unbuilt_rich_routes:${undeclaredUnbuilt.length} - these route(s) are admitted for build in the contract with a rich-authority page type, exist in neither content/_live/pages.json nor content/_staged/pages.json nor on disk, and are not declared in ${BACKLOG_REL}. ` +
    `Either build them through the release lane (npm run release:velocity-content, which respects the ${created.daily_new_url_ceiling || 2}/day ceiling), withdraw the spec, or declare them with a reason and a first_admitted_on date so the backlog stays counted. ` +
    `First 10: ${undeclaredUnbuilt.slice(0, 10).join(', ')}`
  );
}
if (staleDeclarations.length) {
  backlogErrors.push(
    `stale_backlog_declarations:${staleDeclarations.length} - these route(s) are declared unbuilt in ${BACKLOG_REL} but are now built. A declaration that outlives its cause is an exemption nobody granted, and it would hide the route the next time it broke. Delete the entries (and update declared_count). ` +
    `First 10: ${staleDeclarations.slice(0, 10).join(', ')}`
  );
}
const backlogSummary = {
  declared_total: declaredBacklog.size,
  rich_routes_in_contract: allRichRoutes.length,
  rich_rows_in_contract: allRichRows.length,
  unbuilt_total: unbuiltRoutes.length,
  undeclared_unbuilt: undeclaredUnbuilt.length,
  stale_declarations: staleDeclarations.length,
  oldest_admitted_on: [...declaredBacklog.values()].map((e) => e.first_admitted_on).sort()[0] || null,
  newest_admitted_on: [...declaredBacklog.values()].map((e) => e.first_admitted_on).sort().pop() || null,
  by_vertical: (backlogDoc && backlogDoc.by_vertical) || {},
  by_run_date_first_admitted: (backlogDoc && backlogDoc.by_run_date_first_admitted) || {},
  registry: BACKLOG_REL
};

let backlogged = 0;
for (const row of dedupedRows) {
  const page = byRoute.get(row.route);
  // A missing page that is DECLARED unbuilt is accounted for, not graded - there
  // is no page to grade. It is counted, and the undeclared case above is what
  // fails. An undeclared missing page still fails here too, so a route can never
  // slip through by being both unbuilt and unlisted.
  if (!page && declaredBacklog.has(row.route)) { backlogged += 1; continue; }
  if (!page) { errors.push(`created_page_missing:${row.route}`); continue; }
  const richType = page.rich_page_type || classifyRichNewPage(page).rich_page_type;
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const text = JSON.stringify(page).toLowerCase();
  if (requiresRichAuthorityPage(richType) && page.page_family === 'CREATE_COMMUNITY_QA') errors.push(`rich_page_downgraded_to_community_qa:${row.route}:${richType}`);
  if (requiresRichAuthorityPage(richType) && sections.length < 6) errors.push(`rich_page_too_thin:${row.route}:${richType}:${sections.length}`);
  for (const phrase of ['direct answer', 'source basis', 'why this page exists']) {
    if (!text.includes(phrase)) errors.push(`rich_page_missing_block:${row.route}:${phrase}`);
  }
  if (!page.content_atom) errors.push(`rich_page_missing_content_atom:${row.route}`);
  if (!page.admission_basis || !page.route_authority) errors.push(`rich_page_missing_admission_metadata:${row.route}`);
  checked.push({ route: row.route, rich_page_type: richType, page_family: page.page_family, sections: sections.length });
}
// ------------------------------------------------------------------- Rule 0
// Zero created pages must not read as a pass unless zero is genuinely expected
// and the release SAYS so. The release artifact states its own expectation:
// admitted_for_build / selected_under_daily_new_url_ceiling / created_count.
// If it claims it created pages and none of them reached targetRows, or if it
// says nothing about zero at all, an empty run is a failure, not a clean bill.
const releaseDeclaresZero = Number(created.admitted_for_build) === 0
  && Number(created.selected_under_daily_new_url_ceiling) === 0
  && Number(created.created_count || (created.created || []).length) === 0;
if (!releaseDeclaresZero && !created.created.length) {
  stop(`${RELEASE_ARTIFACT} does not declare a zero-page run (admitted_for_build=${created.admitted_for_build}, selected=${created.selected_under_daily_new_url_ceiling}, created_count=${created.created_count}) yet lists no created pages, so the release and its evidence disagree.`,
    'Re-run the release so the artifact records what it actually built. A release that claims admissions but produces no created rows must not be graded as clean.');
}
// The previous NOTHING_TO_CHECK exit(0) lived here. It let an empty candidate set
// pass as long as the release artifact also said zero, which is two pieces of
// bookkeeping agreeing with each other about a loop that ran zero times - the
// exact shape of the original defect. The reconciliation pass above reads the
// whole contract on every date, so the only way to reach zero now is an emptied,
// truncated or unreadable html-report-contract.json. That is a gutted input, not
// a quiet day, and it is a stop.
if (!allRichRows.length) {
  stop(`zero rich-authority row(s) were found in artifacts/validation/html-report-contract.json and data/community/approval_queue.json across all ${datesSeen.length} run date(s), so this validator examined nothing.`,
    'Restore or regenerate the html-report-contract (npm run citation:apply-html-report-contract). A contract with no rich-authority rows means the source was emptied or truncated, and passing on it would be the empty-loop failure this validator exists to catch.');
}
if (!dedupedRows.length) {
  stop(`no rich-authority page row is scoped to run date ${TARGET_RUN_DATE || '(none)'} (${dateSource}), so nothing was graded, even though the contract carries ${allRichRows.length} rich-authority row(s) overall.`,
    'Check the run-date scoping above and the release artifact. An empty graded set is never a clean bill of health for rich pages.');
}

const report = { schema_version: '1.1', validator: 'rich-new-page-contract', status: (errors.length || backlogErrors.length) ? 'FAIL' : 'PASS', checked_count: checked.length, checked, errors, backlog_errors: backlogErrors, declared_backlog: backlogSummary, backlogged_in_scope: backlogged, target_run_date: TARGET_RUN_DATE, run_date_source: dateSource, run_dates_seen: datesSeen.length, candidate_rows_seen: approvalRows.length + htmlRows.length, release_created_count: created.created.length };
out('artifacts/validation/rich-new-page-contract.json', report);
if (errors.length || backlogErrors.length) {
  console.error(JSON.stringify(report, null, 2));
  for (const e of backlogErrors) console.error(`VALIDATION FAIL: ${e}`);
  process.exit(1);
}
console.log('Rich new page contract');
console.log(`  rich-authority rows in contract  : ${backlogSummary.rich_rows_in_contract} (${backlogSummary.rich_routes_in_contract} distinct route(s), ${datesSeen.length} run date(s))`);
console.log(`  scoped to run date ${TARGET_RUN_DATE}  : ${dedupedRows.length} route(s) (${dateSource}; ${created.created.length} from the release)`);
console.log(`    graded (page exists)           : ${checked.length}`);
console.log(`    unbuilt, declared in backlog   : ${backlogged}  <-- NOT graded; there is no page to grade`);
console.log('');
console.log(`  DECLARED UNBUILT BACKLOG         : ${backlogSummary.declared_total}  <-- admitted for build, never built, awaiting the ${created.daily_new_url_ceiling || 2}/day release ceiling`);
console.log(`    oldest admitted on             : ${backlogSummary.oldest_admitted_on} (newest ${backlogSummary.newest_admitted_on})`);
for (const [vertical, n] of Object.entries(backlogSummary.by_vertical)) console.log(`    ${vertical}: ${n}`);
console.log(`    registry                       : ${BACKLOG_REL}`);
console.log(`  undeclared unbuilt routes        : ${backlogSummary.undeclared_unbuilt}`);
console.log(`  stale declarations (now built)   : ${backlogSummary.stale_declarations}`);
console.log('');
console.log(`rich-new-page-contract PASS: graded ${checked.length} of ${dedupedRows.length} rich page(s) scoped to run date ${TARGET_RUN_DATE} (${backlogged} not yet built); ${backlogSummary.declared_total} route(s) admitted for build remain UNBUILT and are declared in ${BACKLOG_REL} (oldest ${backlogSummary.oldest_admitted_on}). That backlog is not a pass for those pages - it is a counted debt.`);
