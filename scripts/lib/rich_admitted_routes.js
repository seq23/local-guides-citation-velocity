'use strict';
/**
 * The single derivation of "which routes has the contract admitted for build,
 * with a rich-authority page type".
 *
 * This module exists because the repo had TWO answers to that question and no
 * link between them:
 *
 *   scripts/validators/validate_rich_new_page_contract.js computed the admitted
 *   set and HARD_FAILed on any admitted-unbuilt route missing from
 *   data/content/unbuilt_rich_page_backlog.json.
 *
 *   scripts/content/reconcile_unbuilt_backlog.js maintained that same backlog,
 *   but only ever DELETED entries whose route had become built. It had no
 *   admission half at all, so it could not compute the set the validator was
 *   grading it against.
 *
 * The consequence was a daily red main. Every absorption that admitted a new
 * rich-authority route produced routes that no component declared - the 2/day
 * new-URL ceiling means almost none of them can be built on the run that admits
 * them - and the release lane hard-failed until a human hand-wrote the backlog
 * entries. On 2026-09-03 that was 11 neuro guides and clusters.
 *
 * Both sides now read the admitted set from here, so the two lists cannot drift
 * apart again: a change to the admission rule changes the validator and the
 * reconciler in the same commit, by construction.
 *
 * This module derives; it never writes and never decides policy. Whether an
 * admitted-unbuilt route is acceptable is still the validator's call, and
 * whether the backlog is actually draining is still
 * scripts/validators/validate_unbuilt_backlog_drain.js's call.
 */
const fs = require('fs');
const path = require('path');
const { classifyRichNewPage, requiresRichAuthorityPage } = require('./rich_new_page_classifier');

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/** The run date a candidate row carries, in whichever field its producer used. */
function runDateOf(row) {
  for (const candidate of [
    row && row.run_date,
    row && row.source_run_id,
    row && row.source_artifacts && row.source_artifacts.manifest,
    row && row.manifest_path,
  ]) {
    const m = DATE_RE.exec(String(candidate || ''));
    if (m) return m[1];
  }
  return '';
}

/**
 * A route needs a rich authority page if the classifier says so, or if its shape
 * is /guides/ or /clusters/ - those sections are rich by definition here.
 */
function needsRichPage(row, route) {
  const rich = (row && row.rich_page_type) || classifyRichNewPage(row).rich_page_type;
  return requiresRichAuthorityPage(rich) || /\/(guides|clusters)\//.test(String(route || ''));
}

/**
 * "Built" means a page object in live or staged, or rendered HTML on disk.
 * Checking only pages.json would let a route that exists purely as rendered
 * output read as unbuilt forever.
 */
function builtPredicate(ROOT) {
  const read = (rel, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
  };
  const live = read('content/_live/pages.json', { pages: [] });
  const staged = read('content/_staged/pages.json', { pages: [] });
  const known = new Set(
    [...(live.pages || []), ...(staged.pages || [])].map((p) => p.path || p.slug).filter(Boolean),
  );
  return (route) => {
    if (known.has(route)) return true;
    const rel = String(route || '').replace(/^\/+|\/+$/g, '');
    if (!rel) return false;
    return fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, `${rel}.html`));
  };
}

function verticalOf(route) {
  const m = /^\/([^/]+)\//.exec(String(route || ''));
  return m ? m[1] : '';
}
function sectionOf(route) {
  const m = /^\/[^/]+\/([^/]+)\//.exec(String(route || ''));
  return m ? m[1] : '';
}

/**
 * The route family the release law would evaluate this route under. Taken from
 * the row when the producer recorded one, then the classifier, then the route
 * shape - the same order build_page_release_queue.js resolves it in.
 */
function familyOf(row, route) {
  const stated = (row && row.route_family) || classifyRichNewPage(row).route_family;
  if (stated) return stated;
  const section = sectionOf(route);
  if (section === 'guides') return 'CREATE_GUIDE';
  if (section === 'clusters') return 'CREATE_CLUSTER';
  if (section === 'community-questions') return 'CREATE_COMMUNITY_QA';
  return '';
}

/**
 * The route families the release law will admit, read from the strategy registry
 * that scripts/content/build_page_release_queue.js enforces. A family absent from
 * this list can be admitted into the contract but can never be built, which is
 * why the reconciler must not declare such a route as AWAITING_RELEASE_LANE.
 */
function allowedRouteFamilies(ROOT) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/strategy/page_strategy_registry.json'), 'utf8'));
    return new Set(d.allowed_route_families || []);
  } catch { return null; }
}

/**
 * Every rich-authority route the contract has admitted, on EVERY run date.
 *
 * Deliberately not scoped to a single run date. Grading page quality is a
 * per-release job; accounting for what was admitted and never built is not.
 * Scoping the accounting to one date is how 136 routes accumulated unseen.
 *
 * Returns { rows, routes, byRoute, sourceRowCount } where byRoute maps a route
 * to its admission provenance: the run dates it was admitted on, how many rows
 * named it, and the page type and query the contract recorded for it.
 */
function admittedRichRoutes(ROOT) {
  const read = (rel, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
  };
  const approval = read('data/community/approval_queue.json', []);
  const html = read('artifacts/validation/html-report-contract.json', {});

  const approvalRows = (Array.isArray(approval) ? approval : [])
    .filter((row) => String(row.admission_basis || '').includes('HTML_REPORT_CONTRACT_PAGE_TO_BUILD') && row.target_route);
  const htmlRows = (Array.isArray(html.page_specs) ? html.page_specs : [])
    .filter((row) => row && row.target_route);

  const sourceRowCount = approvalRows.length + htmlRows.length;
  const rows = [...approvalRows, ...htmlRows]
    .map((row) => ({ row, route: row.target_route }))
    .filter(({ row, route }) => needsRichPage(row, route));

  const byRoute = new Map();
  for (const { row, route } of rows) {
    let entry = byRoute.get(route);
    if (!entry) {
      entry = {
        route,
        vertical: verticalOf(route),
        section: sectionOf(route),
        rich_page_type: (row && row.rich_page_type) || classifyRichNewPage(row).rich_page_type || '',
        route_family: familyOf(row, route),
        query: (row && row.query) || '',
        admitted_on_run_dates: new Set(),
        admitted_row_count: 0,
      };
      byRoute.set(route, entry);
    }
    entry.admitted_row_count += 1;
    const d = runDateOf(row);
    if (d) entry.admitted_on_run_dates.add(d);
    if (!entry.rich_page_type && row && row.rich_page_type) entry.rich_page_type = row.rich_page_type;
    if (!entry.query && row && row.query) entry.query = row.query;
  }
  for (const entry of byRoute.values()) {
    entry.admitted_on_run_dates = [...entry.admitted_on_run_dates].sort();
  }

  return { rows, routes: [...byRoute.keys()], byRoute, sourceRowCount, approvalRows, htmlRows };
}

module.exports = {
  DATE_RE,
  runDateOf,
  needsRichPage,
  builtPredicate,
  familyOf,
  allowedRouteFamilies,
  admittedRichRoutes,
  verticalOf,
  sectionOf,
};
