#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Recover the delivered artifact blocks the pipeline can no longer re-derive.
 *
 * Reads the ACCEPTED bytes of every frozen route (the gzip blob in the frozen cache,
 * which is the authority - not the working tree, which a rebuild may already have
 * thinned), parses their citation-velocity artifacts back into structured records,
 * and writes them to data/release/accepted_page_artifacts.json, which every render
 * site merges in.
 *
 * Two things it deliberately does NOT do:
 *
 *   - It does not recover a phrase a landed agent report asked to have REMOVED. Those
 *     artifacts are dropped, and each drop is recorded in `withheld` with the route,
 *     the title, and the fix that asked for it. A drop is a shrink, and a shrink has
 *     to be named: the same record feeds
 *     data/release/rendered_size_baseline.json's justified_shrinks.
 *
 *   - It does not invent. Every artifact it writes was rendered on the live site and
 *     round-trips byte-for-byte through scripts/lib/citation_velocity_artifacts.js.
 *
 * Rule 0: examining zero frozen routes is a hard failure. Recovering zero is not -
 * that is the steady state once the store is complete, and the run says so.
 *
 *   --check   report what would change and exit non-zero if anything would; write nothing.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { artifactsFromRenderedHtml, stripContentAtomBlocks } = require('../lib/rendered_artifact_recovery');
const { renderCitationVelocityArtifacts } = require('../lib/citation_velocity_artifacts');
const { normalizeForbidden } = require('../lib/html_fix_acceptance_parser');
const { STORE_REL, renderedRelFor } = require('../lib/accepted_artifacts');

const ROOT = path.resolve(__dirname, '../..');
const REGISTRY = 'data/release/frozen_page_registry.json';
const WITHHOLD = 'data/release/withheld_page_phrases.json';
const EVIDENCE = 'artifacts/validation/accepted-artifact-recovery.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const CHECK_ONLY = process.argv.includes('--check');

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

/** The accepted bytes, from the frozen cache blob where one exists. */
function acceptedHtml(record) {
  const cache = record.cache_file ? rel(record.cache_file) : '';
  if (cache && fs.existsSync(cache)) {
    try { return zlib.gunzipSync(fs.readFileSync(cache)).toString('utf8'); } catch { /* fall through */ }
  }
  const rendered = record.rendered_file ? rel(record.rendered_file) : '';
  if (rendered && fs.existsSync(rendered)) return fs.readFileSync(rendered, 'utf8');
  return null;
}

// Withholding is an ENUMERATED list, never a heuristic.
//
// The first cut of this ran phrasesTheFixAsksToRemove() over each route's ledger
// recommendations. REMOVAL_VERB includes "fix" and "rewrite", so a report saying
// "rewrite the 'Direct answer' block" read as an instruction to delete the block, and
// the run proposed withholding "Direct answer", "Will my case go to trial?" and eight
// other perfectly good artifacts. That is the exact failure mode this whole change set
// exists to stop - content quietly disappearing because a screen was too eager - so
// nothing is withheld unless a human named it in data/release/withheld_page_phrases.json,
// with the route, the phrase, and the report that asked for it.
function withholdIndex() {
  const doc = readJson(WITHHOLD, { withheld: [] });
  const byPath = new Map();
  for (const item of doc.withheld || []) {
    const key = String(item.implementation_path || '');
    if (!key) continue;
    if (!byPath.has(key)) byPath.set(key, new Map());
    byPath.get(key).set(normalizeForbidden(item.phrase), item);
  }
  return byPath;
}

function main() {
  const registry = readJson(REGISTRY, null);
  if (!registry || !Array.isArray(registry.pages)) {
    console.error(`ACCEPTED ARTIFACT RECOVERY FAIL: ${REGISTRY} is missing or has no pages array; there is nothing to recover from.`);
    process.exit(1);
  }
  const withhold = withholdIndex();

  const previous = readJson(STORE_REL, { routes: {} });
  const routes = {};
  const withheld = [];
  let examined = 0;
  let artifactsRecovered = 0;
  let roundTripFailures = [];

  for (const record of registry.pages) {
    const implementationPath = String(record.rendered_file || renderedRelFor(record.route) || '');
    if (!implementationPath) continue;
    const html = acceptedHtml(record);
    if (html === null) continue;
    examined += 1;

    const accepted = artifactsFromRenderedHtml(html);
    if (!accepted.length) continue;

    // Proof the parse is lossless BEFORE anything is stored: re-render what was read
    // and require it to equal the accepted markup exactly. A route that does not
    // round-trip is reported, never silently half-recovered.
    const originalSections = stripContentAtomBlocks(html).match(/<section class="card citation-velocity-artifact [a-z_]+"(?: id="[^"]*")? data-citation-velocity-artifact="[a-z_]+">[\s\S]*?<\/section>/g) || [];
    if (renderCitationVelocityArtifacts(accepted) !== originalSections.join('\n')) {
      roundTripFailures.push(implementationPath);
      continue;
    }

    const forbidden = withhold.get(implementationPath) || new Map();
    const kept = [];
    for (const artifact of accepted) {
      const named = forbidden.size ? forbidden.get(normalizeForbidden(artifact.title)) : null;
      if (named) {
        withheld.push({
          implementation_path: implementationPath,
          type: artifact.type,
          title: artifact.title,
          reason: named.reason || 'Named in data/release/withheld_page_phrases.json.',
          source_fix: named.source_fix || ''
        });
        continue;
      }
      kept.push(artifact);
    }
    if (!kept.length) continue;
    routes[implementationPath] = {
      route: record.route,
      recovered_at: (previous.routes || {})[implementationPath]?.recovered_at || DATE,
      artifact_count: kept.length,
      artifacts: kept
    };
    artifactsRecovered += kept.length;
  }

  if (roundTripFailures.length) {
    console.error(`ACCEPTED ARTIFACT RECOVERY FAIL: ${roundTripFailures.length} route(s) do not round-trip through the artifact renderer, so their recovery would be lossy:`);
    for (const p of roundTripFailures.slice(0, 20)) console.error(`  ${p}`);
    process.exit(1);
  }

  // Rule 0: a run that looked at nothing must not report success. An empty frozen
  // store or a changed layout are both defects, not a clean bill of health.
  if (examined === 0) {
    console.error(`ACCEPTED ARTIFACT RECOVERY FAIL: examined zero accepted routes out of ${registry.pages.length} in the registry. Recovery is UNKNOWN, not complete.`);
    process.exit(1);
  }

  const store = {
    schema_version: '1.0',
    authority: 'scripts/citation_velocity/recover_accepted_page_artifacts.js',
    purpose: 'Artifact blocks delivered on an accepted route and merged back in at render time, so a rebuild reproduces the delivered page rather than a thinner one.',
    generated_at: DATE,
    route_count: Object.keys(routes).length,
    artifact_count: artifactsRecovered,
    withheld,
    routes
  };
  const prevText = fs.existsSync(rel(STORE_REL)) ? fs.readFileSync(rel(STORE_REL), 'utf8') : '';

  // `generated_at` is a wall-clock stamp living INSIDE the payload that --check
  // byte-compares, so the store expired at every UTC midnight. The accepted bytes
  // had not moved and the artifacts were identical - only the date was newer - yet
  // accepted-artifact-recovery is a Tier 1 HARD_FAIL, so from 00:00 UTC it blocked
  // validate:release in the content-release lane, the query-evidence self-heal
  // loop, and every profile that includes it. Regenerating and committing the
  // store cleared it for exactly one day, which is why this kept coming back.
  //
  // The store is a function of the accepted bytes, not of when it was written.
  // Re-serializing the freshly computed store under the PREVIOUS stamp is an exact
  // byte test for "nothing but the date moved": if that reproduces the committed
  // file, keep the old stamp and the store is genuinely unchanged. If any artifact,
  // route, or withholding differs, the bytes differ under any stamp, the new date
  // stands, and --check still fails exactly as it should.
  const prevGeneratedAt = typeof previous.generated_at === 'string' ? previous.generated_at : '';
  if (prevGeneratedAt && prevText
    && `${JSON.stringify({ ...store, generated_at: prevGeneratedAt }, null, 2)}\n` === prevText) {
    store.generated_at = prevGeneratedAt;
  }
  const nextText = `${JSON.stringify(store, null, 2)}\n`;

  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(EVIDENCE), `${JSON.stringify({
    schema_version: '1.0',
    status: 'PASS',
    checked_at: DATE,
    mode: CHECK_ONLY ? 'CHECK' : 'WRITE',
    accepted_routes_examined: examined,
    routes_with_recovered_artifacts: store.route_count,
    artifacts_recovered: artifactsRecovered,
    withheld_count: withheld.length,
    withheld,
    store_changed: prevText !== nextText
  }, null, 2)}\n`);

  if (CHECK_ONLY) {
    if (prevText !== nextText) {
      console.error(`ACCEPTED ARTIFACT RECOVERY FAIL (--check): ${STORE_REL} is out of date with the accepted output. Run without --check and commit the result.`);
      process.exit(1);
    }
    console.log(`ACCEPTED ARTIFACT RECOVERY PASS (--check): ${examined} accepted route(s) examined; store is current (${store.route_count} route(s), ${artifactsRecovered} artifact(s)).`);
    return;
  }

  fs.writeFileSync(rel(STORE_REL), nextText);
  console.log(`ACCEPTED ARTIFACT RECOVERY PASS: ${examined} accepted route(s) examined; ${store.route_count} route(s) carry ${artifactsRecovered} recovered artifact(s); ${withheld.length} withheld by a removal directive.`);
  for (const item of withheld) console.log(`  WITHHELD ${item.implementation_path} :: ${item.title}`);
}

main();
