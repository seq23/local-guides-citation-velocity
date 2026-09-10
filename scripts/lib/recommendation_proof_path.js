'use strict';

/**
 * ONE answer to: "where does this recommendation's proof live, and does that page
 * exist yet?"
 *
 * THE DEFECT CLASS THIS MODULE EXISTS TO END
 * -----------------------------------------
 * The same bug was found and fixed three separate times, in three separate readers,
 * within one night (2026-09-09/10):
 *
 *   1. `updateLedger` in scripts/citation_velocity/prepare_velocity_intake_release.js
 *      (PR #114) rewrote every ledger row's `renderedPath` unconditionally. After #109
 *      stopped refusing local `FILEPATH:` targets, 39 rows re-resolved to
 *      CREATE_NEW_TARGET_PAGE and their proof pointer moved onto 13 `trt/…` routes that
 *      did not exist. Four release runs published zero pages.
 *   2. scripts/citation_velocity/compile_html_fix_acceptance_manifest.js asserted
 *      required content against those same not-yet-created targets.
 *   3. scripts/validators/trace_citation_agent_fixes.js reported
 *      `rendered_missing_route` on the same 8 TRT routes, on the run that had finally
 *      cleared absorption and pushed a real commit.
 *
 * Three independent readers, each with a private answer to the same question. That is
 * the repo's named recurring defect: "two components each keeping their own list with
 * no link". A fourth reader would have done it again.
 *
 * THE RULE, STATED ONCE
 * ---------------------
 * A recommendation's `renderedPath` is where it is PROVEN to be showing - not where the
 * plan would like it to live one day. The release lane creates new pages in
 * `release:velocity-content`, which runs AFTER the intake decides the route and BEFORE
 * the validators grade it. So between those two points a target route can be:
 *
 *   PROVEN                - a page that exists on disk today. Grade it there.
 *   PENDING_RELEASE_UNIT  - a page a LATER step in this same lane will create. It is
 *                           legitimately not gradeable yet. Not a regression, not a
 *                           pass either: it is HELD, named, and visible.
 *   MISSING               - nothing exists, and nothing in the lane is going to create
 *                           it. That is a genuine regression and it must fail.
 *
 * `pending_retarget_path` (written by PR #114) is the durable, on-disk record that a
 * retarget was deferred. It is the primary evidence. `releaseUnitPaths` is the
 * secondary evidence for a row the ledger has not yet been rewritten for - the routes
 * the CURRENT release plan is going to create in this same lane.
 *
 * EVERY CONSUMER RESOLVES THROUGH HERE. None keeps a private copy. A consumer that
 * needs a variation passes an option; it does not fork the logic.
 * scripts/validators/validate_shared_proof_path_resolution.js enforces that statically
 * and fails naming the file that forked, because a shared module nothing is forced to
 * use becomes a fourth private copy within a month.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');

/** The declared consumers. The guard validator reads THIS list, not a comment. */
const PROOF_PATH_CONSUMERS = [
  'scripts/citation_velocity/prepare_velocity_intake_release.js',
  'scripts/citation_velocity/compile_html_fix_acceptance_manifest.js',
  'scripts/validators/trace_citation_agent_fixes.js'
];

const PENDING_RETARGET_REASON = 'retarget_deferred_until_new_target_page_exists';

const PROOF_STATES = Object.freeze({
  PROVEN: 'PROVEN',
  PENDING_RELEASE_UNIT: 'PENDING_RELEASE_UNIT',
  MISSING: 'MISSING',
  UNDECLARED: 'UNDECLARED'
});

/** `https://host/a/b/`, `a/b`, `/a/b/` all normalize to `/a/b/`. */
function normalizeRoute(route) {
  let value = String(route === undefined || route === null ? '' : route).trim();
  if (!value) return '';
  value = value.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
  if (!value.startsWith('/')) value = `/${value}`;
  return value.replace(/\/+/g, '/');
}

/** `/trt/guides/x/` -> `trt/guides/x/index.html`; `/insights/y.html` -> `insights/y.html`. */
function routeToRenderedPath(route) {
  let value = normalizeRoute(route).replace(/^\//, '');
  if (!value) return '';
  if (value.endsWith('.html')) return value;
  value = value.replace(/\/+$/, '');
  return value ? `${value}/index.html` : '';
}

/** The inverse, for a caller that has a path and needs the route it publishes at. */
function renderedPathToRoute(renderedPath) {
  const value = String(renderedPath || '').replace(/^\/+/, '');
  if (!value) return '';
  if (/\/index\.html$/.test(value)) return `/${value.replace(/index\.html$/, '')}`;
  return `/${value}`;
}

function pathExists(root, rel) {
  const value = String(rel || '').replace(/^\/+/, '');
  if (!value) return false;
  try { return fs.existsSync(path.join(root, value)); } catch { return false; }
}

/**
 * Every rendered path the CURRENT release plan is going to create later in this same
 * lane. Read from the plan artifact the intake writes, so a consumer that runs before
 * `release:velocity-content` can still tell "not made YET" from "never coming".
 *
 * Returns a Set of rendered paths. An unreadable or absent plan yields an EMPTY set,
 * never null: an absent plan must not silently excuse a missing page.
 */
function releaseUnitPathsFromPlan(root = DEFAULT_ROOT, planRel = 'artifacts/validation/velocity-intake-release-plan.json') {
  const out = new Set();
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(path.join(root, planRel), 'utf8')); } catch { return out; }
  for (const unit of (plan && plan.selected_units) || []) {
    if (!unit) continue;
    if (String(unit.operation || '') !== 'CREATE_NEW_TARGET_PAGE') continue;
    const rendered = String(unit.renderedPath || '') || routeToRenderedPath(unit.target_route);
    const target = routeToRenderedPath(unit.target_route);
    if (target) out.add(target.replace(/^\/+/, ''));
    if (rendered) out.add(rendered.replace(/^\/+/, ''));
    const pending = String(unit.pending_retarget_path || '');
    if (pending) out.add(pending.replace(/^\/+/, ''));
  }
  return out;
}

/**
 * THE resolution. Give it a ledger row, a plan unit or an acceptance spec; it answers
 * with the one path to grade and why.
 *
 * @param {object} row              ledger row / plan unit / acceptance spec
 * @param {object} [options]
 * @param {string} [options.root]              repo root
 * @param {Set}    [options.releaseUnitPaths]  paths a later step in THIS lane creates
 * @param {string} [options.pathField]         field carrying the proven path
 *                                             (default `renderedPath`; the acceptance
 *                                             compiler passes `implementation_path`)
 * @returns {{state:string, gradeAt:string|null, renderedPath:string, targetPath:string,
 *            pendingRetargetPath:string, pendingRetargetReason:string, gradeable:boolean,
 *            detail:string}}
 */
function resolveRecommendationProof(row, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const releaseUnits = options.releaseUnitPaths instanceof Set ? options.releaseUnitPaths : new Set();
  const pathField = options.pathField || 'renderedPath';
  const record = row || {};

  const proven = String(record[pathField] || record.renderedPath || record.implementation_path || '').replace(/^\/+/, '');
  const targetPath = routeToRenderedPath(record.target_route || record.intended_winner_path || renderedPathToRoute(proven));
  const declaredPending = String(record.pending_retarget_path || '').replace(/^\/+/, '');
  const declaredReason = String(record.pending_retarget_reason || '') || (declaredPending ? PENDING_RETARGET_REASON : '');

  const base = {
    renderedPath: proven,
    targetPath,
    pendingRetargetPath: declaredPending,
    pendingRetargetReason: declaredReason
  };

  if (!proven && !targetPath) {
    return { ...base, state: PROOF_STATES.UNDECLARED, gradeAt: null, gradeable: false, detail: 'row declares neither a rendered path nor a target route' };
  }

  // 1. The row itself says a retarget was deferred. That is the durable record #114
  //    writes, and it outranks everything below. Grade where the content actually is.
  if (declaredPending && !pathExists(root, declaredPending)) {
    if (proven && pathExists(root, proven)) {
      return { ...base, state: PROOF_STATES.PROVEN, gradeAt: proven, gradeable: true, detail: `proof held at ${proven}; retarget to ${declaredPending} deferred until that page exists` };
    }
    return { ...base, state: PROOF_STATES.PENDING_RELEASE_UNIT, gradeAt: null, gradeable: false, detail: `${declaredPending} is a release unit a later step in this lane creates` };
  }

  // 2. The proven path is on disk. Grade it there - this is the ordinary case.
  if (proven && pathExists(root, proven)) {
    return { ...base, state: PROOF_STATES.PROVEN, gradeAt: proven, gradeable: true, detail: `rendered at ${proven}` };
  }

  // 3. Nothing on disk, but the current lane is going to create it. Held, not failed.
  const candidate = proven || targetPath;
  if (candidate && releaseUnits.has(candidate)) {
    return { ...base, state: PROOF_STATES.PENDING_RELEASE_UNIT, gradeAt: null, gradeable: false, pendingRetargetPath: base.pendingRetargetPath || candidate, pendingRetargetReason: base.pendingRetargetReason || PENDING_RETARGET_REASON, detail: `${candidate} is a release unit a later step in this lane creates` };
  }
  if (targetPath && targetPath !== candidate && releaseUnits.has(targetPath)) {
    return { ...base, state: PROOF_STATES.PENDING_RELEASE_UNIT, gradeAt: null, gradeable: false, pendingRetargetPath: base.pendingRetargetPath || targetPath, pendingRetargetReason: base.pendingRetargetReason || PENDING_RETARGET_REASON, detail: `${targetPath} is a release unit a later step in this lane creates` };
  }

  // 4. Nothing exists and nothing is coming. Genuine regression.
  return { ...base, state: PROOF_STATES.MISSING, gradeAt: null, gradeable: false, detail: `${candidate} does not exist and no step in this lane creates it` };
}

/**
 * The producer half, moved here verbatim from PR #114's `resolveProofPath` in
 * prepare_velocity_intake_release.js so the writer and every reader share one rule.
 *
 * A row's proof pointer only moves onto a page that EXISTS. If the row is currently
 * proven at its recorded path and the newly chosen target is not in the tree yet, the
 * proof stays where the content actually is and the intended move is recorded as
 * pending - visible, not silent. The release plan is untouched: the normalized run
 * still carries CREATE_NEW_TARGET_PAGE and the unit still creates the page, so the next
 * intake retargets on its own once the page is really there.
 *
 * This preserves evidence; it does not excuse a gap. A row whose recorded path does NOT
 * show its markers retargets exactly as before, and an existing target is adopted at
 * once. `isStillProvenAt` is injected because the producer grades with the ledger
 * truthfulness auditor, which must not become a dependency of every reader.
 */
function resolveProofPointer(prior, record, computed, { root = DEFAULT_ROOT, isStillProvenAt } = {}) {
  const priorPath = String((prior && prior.renderedPath) || '');
  const target = String(computed || '');
  if (!priorPath || priorPath === target) return { renderedPath: target, pending: '', reason: '' };
  if (!target || pathExists(root, target)) return { renderedPath: target, pending: '', reason: '' };
  const priorMarkers = Array.isArray(prior && prior.required_markers) ? prior.required_markers.filter(Boolean) : [];
  const markers = priorMarkers.length ? priorMarkers : [record && record.query].filter(Boolean);
  if (!markers.length) return { renderedPath: target, pending: '', reason: '' };
  if (typeof isStillProvenAt !== 'function' || !isStillProvenAt(priorPath, markers)) {
    return { renderedPath: target, pending: '', reason: '' };
  }
  return { renderedPath: priorPath, pending: target, reason: PENDING_RETARGET_REASON };
}

module.exports = {
  PROOF_PATH_CONSUMERS,
  PROOF_STATES,
  PENDING_RETARGET_REASON,
  normalizeRoute,
  routeToRenderedPath,
  renderedPathToRoute,
  releaseUnitPathsFromPlan,
  resolveRecommendationProof,
  resolveProofPointer
};
