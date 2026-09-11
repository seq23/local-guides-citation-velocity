'use strict';
/**
 * ONE answer to "did the release lane REFUSE this recommendation on purpose, and why?"
 *
 * The exact-implementation trace (trace_agent_exact_implementation.js) knew about five
 * named holds and read each one from its own artifact: a route the freeze transaction
 * rejected to protect delivered content, a route the acceptance compiler refused to
 * author, a spec the planner BLOCKED with a reason, a create the release queue did not
 * admit, a create the daily ceiling or the measured-demand gate held. It counted every
 * one of them as a named stop and printed the census:
 *
 *   AGENT EXACT IMPLEMENTATION TRACE PASS: ... BLOCKED=2 ... REFUSED_BY_RELEASE_QUEUE=1;
 *   REFUSED_TO_PROTECT_DELIVERED_CONTENT=1
 *
 * The citation trace (trace_citation_agent_fixes.js) - which grades the SAME ledger
 * rows one step later in the SAME lane - knew about three of the five, and read them
 * from its own private copies. It had never heard of the other two. So on 2026-09-10
 * and 2026-09-11 the freeze transaction rejected /trt/best-top-near-me/ because the
 * rebuild would have dropped a marker three landed rows depend on, restored the
 * accepted bytes, and recorded the refusal in artifacts/validation/mutation-scope-
 * acceptance.json; the exact trace read that file and called it
 * REFUSED_TO_PROTECT_DELIVERED_CONTENT; and the citation trace, one command later,
 * failed the whole publish with
 *
 *   agent_aa7bdf139c78544b:rendered_missing_marker:trt/best-top-near-me/index.html:...
 *
 * demanding on the page a marker the lane had just, deliberately, declined to put
 * there. Three consecutive release runs went red on a decision the lane made on
 * purpose. That is this repo's named recurring defect - "two components each keeping
 * their own list with no link" - and it is closed the way the proof-path split was
 * closed (scripts/lib/recommendation_proof_path.js): the rule lives here, both traces
 * read it, and scripts/validators/validate_shared_refusal_ledger_resolution.js makes
 * sharing it structural rather than a convention.
 *
 * WHAT THIS MODULE IS NOT. It is not a way to pass. Every hold is evidence-gated: a
 * kind is only reported when the artifact that records it names this row (by id) or
 * this page (by rendered path), and a missing or unreadable artifact excuses nothing.
 * A row with no named hold is returned as null, and the caller fails it exactly as
 * before. A named hold is a NAMED STOP - it is printed with its kind and its reason,
 * it is never counted as proven, and the row stays selectable so a later release can
 * work it. What changes is only that a refusal with a recorded reason is progress the
 * lane can report, while an unexplained miss stays fatal.
 */

const fs = require('fs');
const path = require('path');

/**
 * Every hold kind the upstream can emit, with the artifact that records it. The
 * validator reads this table to prove each kind is still distinguishable from an
 * unexplained miss, so a new kind added here is under the guard by construction.
 */
const REFUSAL_KINDS = Object.freeze({
  BLOCKED: {
    source: 'data/report_fixes/agent_exact_implementation_plan.json',
    keyed_by: 'record id',
    meaning: 'the planner blocked this spec and recorded blocked_reason'
  },
  REFUSED_TO_PROTECT_DELIVERED_CONTENT: {
    source: 'artifacts/validation/mutation-scope-acceptance.json',
    keyed_by: 'rendered path',
    meaning: 'the freeze transaction rejected the rebuild of this route because it lost a ledgered marker landed rows depend on, and restored the accepted bytes'
  },
  REFUSED_BY_ACCEPTANCE_COMPILER: {
    source: 'artifacts/validation/semantic-acceptance-refusals.json',
    keyed_by: 'rendered path, and record id when the refusal names ids',
    meaning: 'compile_html_fix_acceptance_manifest.js refused to author a semantic entry for this route'
  },
  REFUSED_BY_RELEASE_QUEUE: {
    source: 'data/release/page_release_queue.json',
    keyed_by: 'record id',
    meaning: 'the release law marked this create ineligible and NOT_ADMITTED'
  },
  DEFERRED_BY_DAILY_CEILING: {
    source: 'artifacts/validation/velocity-content-release.json',
    keyed_by: 'record id',
    meaning: 'velocity_content_release.js skipped this create because the daily new-URL ceiling was reached'
  },
  HELD_BY_MEASURED_DEMAND_GATE: {
    source: 'artifacts/validation/velocity-content-release.json and data/demand/measured_demand.json',
    keyed_by: 'record id, or route through the demand predicate',
    meaning: 'the measured-demand gate refused to publish this route against absent demand'
  },
  RETIRED_ROUTE: {
    source: 'data/content/unbuilt_rich_page_backlog.json',
    keyed_by: 'route',
    meaning: 'the declared backlog retired this route with a retirement_reason_code'
  }
});

/** trace_status values the exact trace writes that are named stops, not outcomes. */
const EXACT_TRACE_HOLD_STATUSES = new Set([
  'BLOCKED',
  'REFUSED_TO_PROTECT_DELIVERED_CONTENT',
  'REFUSED_BY_ACCEPTANCE_COMPILER',
  'REFUSED_BY_RELEASE_QUEUE',
  'DEFERRED_BY_DAILY_CEILING',
  'HELD_BY_MEASURED_DEMAND_GATE'
]);

/** Files that must resolve refusals through this module. Read by the validator. */
const REFUSAL_LEDGER_CONSUMERS = Object.freeze([
  'scripts/validators/trace_citation_agent_fixes.js',
  'scripts/validators/trace_agent_exact_implementation.js'
]);

const SOURCES = Object.freeze({
  exactPlan: 'data/report_fixes/agent_exact_implementation_plan.json',
  exactTrace: 'artifacts/validation/agent-exact-implementation-trace.json',
  mutationScope: 'artifacts/validation/mutation-scope-acceptance.json',
  compilerRefusals: 'artifacts/validation/semantic-acceptance-refusals.json',
  releaseQueue: 'data/release/page_release_queue.json',
  contentRelease: 'artifacts/validation/velocity-content-release.json',
  backlog: 'data/content/unbuilt_rich_page_backlog.json'
});

function readJson(root, rel) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; }
}

/** `/a/b/` and `a/b/index.html` and `/a/b/index.html` -> `a/b/index.html`. */
function normalizeRenderedPath(value) {
  let v = String(value || '').trim().split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!v) return '';
  if (v.endsWith('/')) v = `${v}index.html`;
  else if (!/\.html?$/i.test(v)) v = `${v}/index.html`;
  return v;
}

/** `a/b/index.html` -> `/a/b/`; `insights/x.html` -> `/insights/x.html`. */
function normalizeRoute(value) {
  const rendered = normalizeRenderedPath(value);
  if (!rendered) return '';
  if (rendered.endsWith('/index.html')) return `/${rendered.slice(0, -'index.html'.length)}`;
  return `/${rendered}`;
}

/**
 * Load every refusal source once. `demandBackedRoute` is optional: the caller may pass
 * the predicate from scripts/lib/demand_backing so a route the demand corpus does not
 * back is held even when no release run happened to enumerate it. An unreadable corpus
 * holds nothing - the caller passes null and the check stays strict.
 */
function loadRefusalLedger(root, { demandBackedRoute = null } = {}) {
  const readable = {};
  const load = (key) => { const doc = readJson(root, SOURCES[key]); readable[SOURCES[key]] = Boolean(doc); return doc; };

  const plan = load('exactPlan');
  const blockedById = new Map();
  for (const spec of (plan && plan.specs) || []) {
    if (!spec || spec.status !== 'BLOCKED' || !spec.blocked_reason) continue;
    for (const id of [spec.record_id, ...(spec.record_ids || [])].filter(Boolean)) blockedById.set(id, spec);
  }

  const trace = load('exactTrace');
  const exactTraceHoldById = new Map();
  for (const row of (trace && trace.traces) || []) {
    if (!row || !EXACT_TRACE_HOLD_STATUSES.has(String(row.trace_status || ''))) continue;
    for (const id of [row.record_id, ...(row.record_ids || [])].filter(Boolean)) exactTraceHoldById.set(id, row);
  }

  const acceptance = load('mutationScope');
  const mutationRejectedByPath = new Map();
  for (const row of (acceptance && acceptance.rejected) || []) {
    if (!row) continue;
    const key = normalizeRenderedPath(row.rendered_file || row.route);
    if (key) mutationRejectedByPath.set(key, row);
  }

  const refusals = load('compilerRefusals');
  const compilerRefusedByPath = new Map();
  for (const row of (refusals && refusals.refused) || []) {
    if (!row) continue;
    const key = normalizeRenderedPath(row.implementation_path || row.target_route);
    if (key) compilerRefusedByPath.set(key, row);
  }

  const queue = load('releaseQueue');
  const queueRefusedById = new Map();
  for (const row of (queue && queue.records) || []) {
    if (row && row.id && row.eligible === false && String(row.lifecycle_state || '') === 'NOT_ADMITTED') {
      queueRefusedById.set(row.id, row);
    }
  }

  const release = load('contentRelease');
  const ceilingDeferredById = new Map();
  const demandHeldById = new Map();
  for (const row of (release && release.skipped) || []) {
    if (!row || !row.id) continue;
    const reason = String(row.reason || '');
    if (reason.includes('daily_new_url_ceiling_reached')) ceilingDeferredById.set(row.id, row);
    else if (reason === 'no_measured_demand_match') demandHeldById.set(row.id, row);
  }

  const backlog = load('backlog');
  const retiredByRoute = new Map();
  for (const entry of (backlog && backlog.routes) || []) {
    if (!entry || !entry.route || String(entry.disposition || '').toUpperCase() !== 'RETIRED') continue;
    if (!entry.retirement_reason_code && !entry.retired_reason) continue;
    retiredByRoute.set(normalizeRoute(entry.route), entry);
  }

  function compilerRefusalFor(renderedPath, ids) {
    const row = compilerRefusedByPath.get(renderedPath);
    if (!row) return null;
    const named = new Set([row.record_id, ...(row.record_ids || [])].filter(Boolean));
    if (named.size === 0) return row;
    return ids.some((id) => named.has(id)) ? row : null;
  }

  /**
   * The named stop for one recommendation, or null. `ids` may carry a merged spec's
   * record_ids; `route`/`renderedPath` name the page the proof is graded on.
   * `operation` narrows the create-only holds to creates, exactly as the traces did.
   */
  function namedStopFor({ id, ids = [], route, renderedPath, operation } = {}) {
    const allIds = Array.from(new Set([id, ...ids].filter(Boolean)));
    const page = normalizeRenderedPath(renderedPath || route);
    const isCreate = String(operation || '') === 'CREATE_NEW_TARGET_PAGE';

    for (const rid of allIds) {
      const spec = blockedById.get(rid);
      if (spec) return { kind: 'BLOCKED', reason: spec.blocked_reason, source: SOURCES.exactPlan, matched_by: `record_id:${rid}` };
    }
    for (const rid of allIds) {
      const row = exactTraceHoldById.get(rid);
      if (row) {
        return {
          kind: String(row.trace_status),
          reason: row.blocked_reason || row.acceptance_refusal_reason || row.release_queue_decision || String(row.trace_status).toLowerCase(),
          source: SOURCES.exactTrace,
          matched_by: `record_id:${rid}`
        };
      }
    }
    if (page && mutationRejectedByPath.has(page)) {
      const row = mutationRejectedByPath.get(page);
      const lost = (row.lost_markers || []).map((m) => (m && m.marker) || m).filter(Boolean);
      return {
        kind: 'REFUSED_TO_PROTECT_DELIVERED_CONTENT',
        reason: `${row.reason || 'ledgered_markers_lost'}${lost.length ? `:${lost.join('|')}` : ''}`,
        source: SOURCES.mutationScope,
        matched_by: `rendered_path:${page}`
      };
    }
    if (page) {
      const row = compilerRefusalFor(page, allIds);
      if (row) return { kind: 'REFUSED_BY_ACCEPTANCE_COMPILER', reason: row.reason || 'no_authority_grounded_entry', source: SOURCES.compilerRefusals, matched_by: `rendered_path:${page}` };
    }
    if (isCreate) {
      for (const rid of allIds) {
        if (queueRefusedById.has(rid)) return { kind: 'REFUSED_BY_RELEASE_QUEUE', reason: String(queueRefusedById.get(rid).decision || 'NOT_ADMITTED'), source: SOURCES.releaseQueue, matched_by: `record_id:${rid}` };
      }
      for (const rid of allIds) {
        if (ceilingDeferredById.has(rid)) return { kind: 'DEFERRED_BY_DAILY_CEILING', reason: String(ceilingDeferredById.get(rid).reason), source: SOURCES.contentRelease, matched_by: `record_id:${rid}` };
      }
      for (const rid of allIds) {
        if (demandHeldById.has(rid)) return { kind: 'HELD_BY_MEASURED_DEMAND_GATE', reason: 'no_measured_demand_match', source: SOURCES.contentRelease, matched_by: `record_id:${rid}` };
      }
      const r = normalizeRoute(route || renderedPath);
      if (r && demandBackedRoute && demandBackedRoute.slugCount && !demandBackedRoute(r)) {
        return { kind: 'HELD_BY_MEASURED_DEMAND_GATE', reason: 'route_not_in_measured_demand_corpus', source: 'data/demand/measured_demand.json', matched_by: `route:${r}` };
      }
      if (r && retiredByRoute.has(r)) {
        const entry = retiredByRoute.get(r);
        return { kind: 'RETIRED_ROUTE', reason: String(entry.retirement_reason_code || entry.retired_reason), source: SOURCES.backlog, matched_by: `route:${r}` };
      }
    }
    return null;
  }

  return {
    namedStopFor,
    sources: SOURCES,
    readable,
    // Exposed so the exact trace keys its own per-spec logic off the SAME maps rather
    // than re-reading the artifacts with its own path normalisation.
    blockedById,
    mutationRejectedByPath,
    compilerRefusedByPath,
    compilerRefusalFor,
    queueRefusedById,
    ceilingDeferredById,
    demandHeldById,
    retiredByRoute,
    exactTraceHoldById
  };
}

module.exports = {
  REFUSAL_KINDS,
  REFUSAL_LEDGER_CONSUMERS,
  EXACT_TRACE_HOLD_STATUSES,
  SOURCES,
  loadRefusalLedger,
  normalizeRenderedPath,
  normalizeRoute
};
