#!/usr/bin/env node
'use strict';
/**
 * Delete a backlog entry once its route is built.
 *
 * The declared backlog in data/content/unbuilt_rich_page_backlog.json is now
 * drained by the release lane (scripts/content/build_page_release_queue.js
 * reads it as a third intake lane). The moment scripts/velocity_content_release.js
 * stages one of those routes, the declaration is stale - and
 * scripts/validators/validate_rich_new_page_contract.js hard-fails on a stale
 * declaration, deliberately, because a backlog entry that outlived its cause is
 * the next version of the bug it was written to stop.
 *
 * So the drain has two halves and this is the second one. Without it the first
 * successful drain would turn main red.
 *
 * ADMISSION - the half that was missing, and the daily red main it caused
 * ---------------------------------------------------------------------
 * Until now this script could only DELETE. Nothing anywhere ADDED a newly
 * admitted-but-unbuilt rich route to the declared backlog, so the backlog and
 * the contract were two lists with no link between them. Every absorption that
 * admitted a new rich-authority route therefore turned main red: the governed
 * ceiling is 2 new URLs a day, so almost none of the newly admitted routes can
 * be built on the run that admits them, and validate_rich_new_page_contract.js
 * hard-fails - correctly - on an admitted-unbuilt route that nobody declared.
 * The only remedy was a human hand-writing backlog entries. On 2026-09-03 that
 * was 11 neuro guides and clusters, and the release lane had failed the same way
 * on many days before it.
 *
 * The fix is NOT to soften that assertion. It is to give the pipeline the half
 * it never had: this now declares those routes, with the real run date the
 * contract admitted them on, so they become counted debt on the run that creates
 * them instead of an unexplained red. Both halves read the admitted set from
 * scripts/lib/rich_admitted_routes.js, which is also what the validator reads,
 * so the two lists cannot drift apart again.
 *
 * Automatic admission cannot become a dumping ground, because a second validator
 * governs the other direction: scripts/validators/validate_unbuilt_backlog_drain.js
 * (unbuilt-backlog-drain, Tier 5 HARD_FAIL) fails if the backlog is offered to no
 * one, if the release law refuses every row it is offered, or if an entry claims
 * to await a lane that cannot admit it. Declaring a route here puts it in front
 * of that consumer; it does not excuse it from being built.
 *
 * Rule 0: this exits non-zero if it cannot read the backlog, and non-zero if the
 * contract yields zero rich-authority rows to reconcile against - an empty
 * admitted set means the contract is missing or unreadable, which is a defect and
 * must never read as "nothing to admit". "Nothing to reconcile" over a non-empty
 * admitted set is a real and common outcome - most runs build nothing, because
 * the governed ceiling is 2 new URLs a day - but it is reported as a named
 * no-op, not as silence.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { admittedRichRoutes, builtPredicate, allowedRouteFamilies } = require('../lib/rich_admitted_routes');
const CANONICAL_BACKLOG = 'data/content/unbuilt_rich_page_backlog.json';

// A self-test seam, so a validator can prove the ADMISSION half actually works
// rather than only that the committed file currently looks right. The file
// looking right is exactly what a human hand-editing it also produces, which is
// how this defect kept coming back green between absorptions.
//
// scripts/validators/validate_unbuilt_backlog_admission.js sets these, hands this
// script a COPY of the backlog with the awaiting entries stripped out, and
// asserts they are all re-declared. Deleting or breaking admission makes that
// validator fail.
//
// The seam cannot touch canonical data: it is inert unless RECONCILE_SELFTEST=1,
// it refuses to run against the canonical path, and it writes its receipt
// somewhere else.
const SELFTEST = process.env.RECONCILE_SELFTEST === '1';
const BACKLOG_REL = SELFTEST && process.env.RECONCILE_BACKLOG_PATH
  ? process.env.RECONCILE_BACKLOG_PATH
  : CANONICAL_BACKLOG;
const RECEIPT_REL = SELFTEST
  ? (process.env.RECONCILE_RECEIPT_PATH || 'artifacts/validation/unbuilt-backlog-reconcile.selftest.json')
  : 'artifacts/validation/unbuilt-backlog-reconcile.json';
if (SELFTEST && BACKLOG_REL === CANONICAL_BACKLOG) {
  console.error('UNBUILT BACKLOG RECONCILE: STOP - RECONCILE_SELFTEST=1 without RECONCILE_BACKLOG_PATH pointing somewhere other than the canonical backlog.');
  console.error(`  The self-test seam must never write ${CANONICAL_BACKLOG}. Refusing rather than mutating canonical data under a test flag.`);
  process.exit(1);
}
if (SELFTEST) console.log(`UNBUILT BACKLOG RECONCILE: SELF-TEST MODE - reading and writing ${BACKLOG_REL}, not ${CANONICAL_BACKLOG}.`);

const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const write = (rel, value) => { const abs = path.join(ROOT, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, JSON.stringify(value, null, 2) + '\n'); };

const backlog = read(BACKLOG_REL, null);
if (!backlog || !Array.isArray(backlog.routes)) {
  console.error(`UNBUILT BACKLOG RECONCILE: STOP - ${BACKLOG_REL} is missing or carries no routes array.`);
  console.error('  The declared backlog is the only record of which admitted routes are knowingly unbuilt. Without it, every unbuilt page is a silent gap again, and this reconciler cannot tell a drained entry from a deleted one.');
  process.exit(1);
}

// Same "built" predicate the validator uses: a page object in live or staged, or
// rendered HTML on disk.
const isBuilt = builtPredicate(ROOT);
const RUN_DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

// The families the release law will actually admit. A newly declared route whose
// family is not on this list can never drain, and
// scripts/validators/validate_unbuilt_backlog_drain.js hard-fails on an entry
// that claims to await a lane that cannot admit it - correctly, because that is a
// promise the lane cannot keep. Such a route is declared RETIRED with the reason
// code the repo already uses for it, so it stays counted and legible rather than
// becoming a false promise or a deletion.
const ALLOWED_FAMILIES = allowedRouteFamilies(ROOT);
if (!ALLOWED_FAMILIES || !ALLOWED_FAMILIES.size) {
  console.error('UNBUILT BACKLOG RECONCILE: STOP - data/strategy/page_strategy_registry.json carries no allowed_route_families.');
  console.error('  Without the release law this reconciler cannot tell a route that is waiting to be built from one that can never be built, and would declare every new route as AWAITING_RELEASE_LANE regardless.');
  process.exit(1);
}

// The admitted set, derived once, shared with the validator that grades this file.
const admitted = admittedRichRoutes(ROOT);
if (!admitted.sourceRowCount) {
  console.error('UNBUILT BACKLOG RECONCILE: STOP - the contract sources yielded zero candidate rows.');
  console.error('  data/community/approval_queue.json and artifacts/validation/html-report-contract.json are the only record of what was admitted for build. With neither readable this reconciler cannot tell an empty backlog from an unread contract, and would silently declare nothing while validate_rich_new_page_contract.js grades against the real set.');
  process.exit(1);
}
if (!admitted.rows.length) {
  console.error(`UNBUILT BACKLOG RECONCILE: STOP - ${admitted.sourceRowCount} candidate row(s) were read and none classified as needing a rich-authority page.`);
  console.error('  Zero examined items is a hard failure, not a pass on an empty loop: it means the classifier or the rich_page_type field changed shape and this reconciler is now reconciling against nothing.');
  process.exit(1);
}

const drained = [];
const kept = [];
for (const entry of backlog.routes) {
  if (entry && entry.route && String(entry.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE' && isBuilt(entry.route)) {
    drained.push({ route: entry.route, first_admitted_on: entry.first_admitted_on || null, waited_days: entry.first_admitted_on ? Math.round((Date.now() - Date.parse(`${entry.first_admitted_on}T00:00:00Z`)) / 86400000) : null });
  } else {
    kept.push(entry);
  }
}

// ------------------------------------------------------------------ ADMIT
// Every rich-authority route the contract has admitted that is not built and not
// already declared. These are exactly the routes
// validate_rich_new_page_contract.js hard-fails on as
// `undeclared_unbuilt_rich_routes`, computed from the same module it uses, so
// declaring them here is what makes the counted-debt accounting complete rather
// than what hides a gap.
const declaredRoutes = new Set(kept.map((e) => e && e.route).filter(Boolean));
const admittedUnbuilt = admitted.routes.filter((route) => !isBuilt(route));
const toAdmit = admittedUnbuilt.filter((route) => !declaredRoutes.has(route));
const undated = [];
const retiredUnsupported = [];
for (const route of toAdmit) {
  const provenance = admitted.byRoute.get(route) || {};
  const dates = Array.isArray(provenance.admitted_on_run_dates) ? provenance.admitted_on_run_dates : [];
  // first_admitted_on must be the date the contract actually admitted the route,
  // not today - the whole point of the field is that the age of the debt stays
  // legible. A row carrying no date at all is recorded as such rather than being
  // quietly backdated or quietly stamped with today.
  const family = provenance.route_family || '';
  const buildable = ALLOWED_FAMILIES.has(family);
  const entry = {
    route,
    vertical: provenance.vertical || '',
    section: provenance.section || '',
    rich_page_type: provenance.rich_page_type || '',
    route_family: family,
    query: provenance.query || '',
    reason: 'ADMITTED_FOR_BUILD_NEVER_BUILT',
    first_admitted_on: dates[0] || RUN_DATE,
    last_admitted_on: dates[dates.length - 1] || RUN_DATE,
    admitted_on_run_dates: dates.length ? dates : [RUN_DATE],
    admitted_row_count: provenance.admitted_row_count || 0,
    disposition: buildable ? 'AWAITING_RELEASE_LANE' : 'RETIRED',
    declared_by: 'scripts/content/reconcile_unbuilt_backlog.js',
    declared_on: RUN_DATE
  };
  if (!buildable) {
    entry.retirement_reason_code = 'RETIRED_UNSUPPORTED_ROUTE_FAMILY';
    entry.retirement_reason = `The contract admitted this route with route family ${family || '(none resolved)'}, which data/strategy/page_strategy_registry.json does not list in allowed_route_families, so scripts/content/build_page_release_queue.js marks it SKIP_UNSUPPORTED and the release lane can never build it. It is retired rather than left AWAITING_RELEASE_LANE because declaring it as waiting would be a promise the lane cannot keep. Supporting this family is a product decision, not a defect in this reconciler; adding it to allowed_route_families is what would un-retire it.`;
    entry.retired_on = RUN_DATE;
    retiredUnsupported.push(route);
  }
  if (!dates.length) {
    entry.first_admitted_on_basis = 'RECONCILE_RUN_DATE_NO_CONTRACT_RUN_DATE_ON_ROW';
    undated.push(route);
  }
  kept.push(entry);
}

const awaiting = kept.filter((e) => String(e.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE').length;
if (drained.length || toAdmit.length) {
  backlog.routes = kept;
  backlog.declared_count = kept.length;
  backlog.drainable_count = awaiting;
  backlog.retired_count = kept.length - awaiting;
  if (drained.length) backlog.last_drained_on = RUN_DATE;
  if (toAdmit.length) backlog.last_admitted_on = RUN_DATE;
  // The published depth of the backlog is read straight out of this file by the
  // validator's summary, so a stale breakdown is a misreported debt.
  const byVertical = {};
  const byFirstAdmitted = {};
  for (const e of kept) {
    if (!e || !e.route) continue;
    const v = e.vertical || 'unknown';
    byVertical[v] = (byVertical[v] || 0) + 1;
    const d = e.first_admitted_on || 'undated';
    byFirstAdmitted[d] = (byFirstAdmitted[d] || 0) + 1;
  }
  backlog.by_vertical = Object.fromEntries(Object.entries(byVertical).sort((a, b) => b[1] - a[1]));
  backlog.by_run_date_first_admitted = Object.fromEntries(Object.entries(byFirstAdmitted).sort());
  write(BACKLOG_REL, backlog);
}

write(RECEIPT_REL, {
  schema_version: '1.0',
  status: 'PASS',
  drained_count: drained.length,
  drained,
  admitted_count: toAdmit.length,
  admitted: toAdmit,
  admitted_undated: undated,
  admitted_retired_unsupported_family: retiredUnsupported,
  allowed_route_families: [...ALLOWED_FAMILIES],
  rich_rows_examined: admitted.rows.length,
  rich_routes_examined: admitted.routes.length,
  candidate_rows_read: admitted.sourceRowCount,
  admitted_unbuilt_total: admittedUnbuilt.length,
  remaining_declared: backlog.routes.length,
  remaining_awaiting_release_lane: awaiting,
  note: (drained.length || toAdmit.length)
    ? 'The declared backlog was reconciled against the contract in both directions: routes now built were deleted, and admitted-but-unbuilt routes not yet declared were added as counted debt awaiting the release lane.'
    : 'No declared backlog entry became built on this run and the contract admitted no new unbuilt rich route. The governed ceiling is 2 new URLs a day, so most runs legitimately reconcile nothing; this is a named no-op over a non-empty admitted set, not a silent one.'
});

console.log(`UNBUILT BACKLOG RECONCILE PASS: examined ${admitted.rows.length} rich-authority row(s) over ${admitted.routes.length} route(s) from ${admitted.sourceRowCount} candidate row(s); drained=${drained.length}; newly declared=${toAdmit.length}; still awaiting the release lane=${awaiting}; declared total=${backlog.routes.length}`);
for (const row of drained) console.log(`  built and removed: ${row.route} (waited ${row.waited_days} day(s) since ${row.first_admitted_on})`);
for (const route of toAdmit) {
  const e = kept.find((x) => x && x.route === route) || {};
  const disp = String(e.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE'
    ? 'counted debt awaiting the release lane'
    : `counted debt RETIRED as ${e.retirement_reason_code}`;
  console.log(`  admitted and declared: ${route} (first admitted on ${e.first_admitted_on}, family ${e.route_family || 'none'}) - ${disp}, not a pass for this page`);
}
if (retiredUnsupported.length) console.log(`  NOTE: ${retiredUnsupported.length} newly declared route(s) were retired as RETIRED_UNSUPPORTED_ROUTE_FAMILY - the release law does not admit their route family, so they are counted debt with a named cause rather than a promise the lane cannot keep: ${retiredUnsupported.slice(0, 10).join(', ')}`);
if (undated.length) console.log(`  NOTE: ${undated.length} newly declared route(s) carried no run date on any contract row, so first_admitted_on records this run date and first_admitted_on_basis says so: ${undated.slice(0, 10).join(', ')}`);
if (!drained.length && !toAdmit.length) console.log(`  named no-op: nothing to reconcile. ${admittedUnbuilt.length} admitted route(s) are unbuilt and all of them are already declared; no declared route became built.`);
