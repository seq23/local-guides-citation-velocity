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

let CACHE = null;
function loadStore() {
  if (CACHE) return CACHE;
  try { CACHE = JSON.parse(fs.readFileSync(path.join(ROOT, STORE_REL), 'utf8')); }
  catch { CACHE = { schema_version: '1.0', routes: {} }; }
  CACHE.routes = CACHE.routes || {};
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
  const acceptedKeys = new Set();
  const out = [];
  for (const artifact of accepted) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    acceptedKeys.add(artifactKey(artifact));
    out.push(artifact);
  }
  for (const artifact of Array.isArray(current) ? current : []) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    if (acceptedKeys.has(artifactKey(artifact))) continue;
    out.push(artifact);
  }
  return out;
}

module.exports = { STORE_REL, acceptedArtifactsFor, mergeAcceptedArtifacts, renderedRelFor, resetCache };
