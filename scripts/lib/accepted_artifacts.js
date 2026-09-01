'use strict';
/**
 * The durable copy of every citation-velocity artifact that has been DELIVERED on a
 * route but that the current pipeline can no longer re-derive.
 *
 * Why this file exists
 * --------------------
 * Artifact blocks reach a page from two upstreams: `citation_velocity_artifacts` on
 * the source record, and `data/report_fixes/agent_exact_semantic_acceptance_manifest.json`
 * by way of applyAgentExactRepairsToPage/ToInsightItem. Until 2026-09-01 the semantic
 * manifest was rewritten from scratch on every compile out of the CURRENT plan, and a
 * row leaves the plan the moment it lands in the implementation ledger - so a page's
 * artifacts vanished from source on the next run. Nothing failed, because the page was
 * frozen and the frozen guard restored its accepted bytes over the thinner rebuild.
 *
 * Measured on 2026-09-01 by thawing all 2,067 accepted routes in a throwaway worktree
 * and rebuilding: 249 pages came back smaller, 1,145,001 bytes lighter in total, and
 * every byte of it was artifact blocks. 106 routes had artifacts the rebuild could not
 * produce at all - 876 of them. The frozen store was holding the only copy.
 *
 * The manifest is durable now, which stops NEW loss. It cannot recover what was
 * already dropped: the compile that would have carried those entries forward ran
 * before the fix. This store is that recovery, parsed back out of the accepted output
 * itself by scripts/lib/rendered_artifact_recovery.js, and merged in at every render
 * site so a rebuild reproduces the delivered page instead of a thinner one.
 *
 * Accepted order wins. A rebuild that produces the same artifact again is deduped
 * against the accepted copy rather than appended, and anything genuinely NEW is
 * appended after - so this store makes pages whole without freezing them against
 * future repairs.
 */

const fs = require('fs');
const path = require('path');
const { artifactKey } = require('./rendered_artifact_recovery');

const ROOT = path.resolve(__dirname, '../..');
const STORE_REL = 'data/release/accepted_page_artifacts.json';
// Blocks a page carried at its historic maximum and lost through a thaw-rebuild-reaccept
// cycle (2026-08-24 and 2026-08-27). Recovered from git rather than from the accepted
// output, because the accepted output no longer has them. See
// scripts/citation_velocity/recover_historic_artifact_loss.js.
const HISTORIC_REL = 'data/release/historic_recovered_artifacts.json';

let CACHE = null;
function readRoutes(relPath) {
  try { return (JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8')).routes) || {}; }
  catch { return {}; }
}
function loadStore() {
  if (CACHE) return CACHE;
  const accepted = readRoutes(STORE_REL);
  const historic = readRoutes(HISTORIC_REL);
  // Accepted first, historic appended: what the page still has keeps its delivered order,
  // and what it lost is restored after it rather than shuffled into the middle.
  const routes = {};
  for (const [key, record] of Object.entries(accepted)) routes[key] = { ...record, artifacts: [...(record.artifacts || [])] };
  for (const [key, record] of Object.entries(historic)) {
    if (!routes[key]) routes[key] = { ...record, artifacts: [] };
    routes[key].artifacts = [...routes[key].artifacts, ...(record.artifacts || [])];
  }
  CACHE = { schema_version: '1.0', routes };
  return CACHE;
}
function resetCache() { CACHE = null; }

/** `/insights/x.html`, `insights/x.html`, `/dentistry/y/` and `dentistry/y/index.html` all key the same route. */
function renderedRelFor(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!out) return 'index.html';
  if (out.endsWith('.html')) return out;
  return `${out.replace(/\/+$/, '')}/index.html`;
}

/** The recovered artifacts for a route, or [] when nothing was ever lost there. */
function acceptedArtifactsFor(route) {
  const rel = renderedRelFor(route);
  if (!rel) return [];
  const record = loadStore().routes[rel];
  return record && Array.isArray(record.artifacts) ? record.artifacts : [];
}

/**
 * Accepted artifacts first, in the order they were delivered, then anything the
 * current build produces that the accepted output did not carry.
 */
function mergeAcceptedArtifacts(route, current) {
  const accepted = acceptedArtifactsFor(route);
  if (!accepted.length) return Array.isArray(current) ? current : [];
  // The accepted list is emitted VERBATIM, duplicates included.
  //
  // A first cut keyed the accepted list into a Map to dedupe it, which quietly ate
  // real content: /neuro/ carries two different comparison tables both titled "Direct
  // answer" - same type, same heading, different rows - and the second one vanished.
  // Deduping the delivered page against itself is the same silent loss this store
  // exists to stop. Only what the CURRENT build produces is deduped, and only against
  // what the accepted output already carries.
  //
  // A CURRENT block with an accepted block's key REPLACES it in place; it does not
  // lose to it. Dropping the current copy froze every accepted route against its own
  // future repairs: the 2026-09-01 absorption pass re-resolved seven TRT targets, the
  // ledger issued fresh markers for them, insights.json carried the new markers - and
  // the rendered pages kept the previous run's marker forever, because the repair
  // block has the same type and title every time and so always lost the dedupe. The
  // trace then reported repair_not_proven on a repair that had genuinely been made.
  //
  // Position and count come from the accepted list, so nothing is reordered and the
  // two same-titled /neuro/ tables both survive. Only the CONTENT is refreshed, and
  // only upward: a current block shorter than the accepted one is the shrink this
  // store exists to prevent, so in that case the accepted copy stands.
  const pending = new Map();
  for (const artifact of Array.isArray(current) ? current : []) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    const key = artifactKey(artifact);
    if (!pending.has(key)) pending.set(key, []);
    pending.get(key).push(artifact);
  }
  const weight = (artifact) => JSON.stringify(artifact || '').length;
  const consumed = new Set();
  const out = [];
  for (const artifact of accepted) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    const key = artifactKey(artifact);
    const queue = pending.get(key) || [];
    const replacement = queue.shift();
    if (replacement) {
      consumed.add(replacement);
      out.push(weight(replacement) >= weight(artifact) ? replacement : artifact);
    } else out.push(artifact);
  }
  for (const artifact of Array.isArray(current) ? current : []) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    if (consumed.has(artifact)) continue;
    out.push(artifact);
  }
  return out;
}

module.exports = { STORE_REL, HISTORIC_REL, acceptedArtifactsFor, mergeAcceptedArtifacts, renderedRelFor, resetCache };
