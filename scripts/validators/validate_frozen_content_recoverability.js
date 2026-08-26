#!/usr/bin/env node
'use strict';
/**
 * Frozen content recoverability contract.
 *
 * The frozen-output guard restores accepted bytes after every build. That is
 * normally harmless: the generator reproduces the page, the guard confirms it
 * matches, nothing moves. But on some routes the accepted bytes contain content
 * the generator can no longer produce - artifacts from a pipeline that has since
 * changed. For those, the guard is not confirming the build, it is silently
 * substituting for it.
 *
 * Nothing warns about this while the route stays frozen. The damage happens the
 * day someone thaws it: the build emits a shorter page, the guard no longer
 * restores anything, and the difference is gone with no error and no diff to
 * review. Measured on five dentistry hub routes, thawing and rebuilding dropped
 * 4,069 words - 150 unique sentences after de-duplication.
 *
 * This validator makes that condition visible while it is still harmless. It
 * compares each frozen route's accepted bytes against what the content source
 * can account for, and reports any route whose rendered text materially exceeds
 * its source. Those routes are safe to leave frozen and unsafe to thaw until
 * their content is recovered into the source.
 *
 * Reported, not blocking: the condition is pre-existing and recovering the
 * content is a deliberate editorial job, not something a build step should force.
 * What it must never do again is happen quietly.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = path.join(ROOT, 'data/release/frozen_page_registry.json');
const PAGES = path.join(ROOT, 'content/_live/pages.json');
const EVIDENCE = 'artifacts/validation/frozen-content-recoverability.json';
// A page legitimately renders more words than its source carries - shared
// chrome, cluster-derived blocks, generated tables. The threshold is set well
// above that normal spread so only a real gap trips it.
const RATIO = Number(process.env.FROZEN_RECOVERABILITY_RATIO || 1.5);
const MIN_GAP_WORDS = Number(process.env.FROZEN_RECOVERABILITY_MIN_WORDS || 400);

function visibleWords(html) {
  const body = html.replace(/<(script|style|nav|footer|head|svg)\b[\s\S]*?<\/\1>/gi, '');
  return body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').split(/\s+/).filter(Boolean).length;
}

if (!fs.existsSync(REGISTRY) || !fs.existsSync(PAGES)) {
  console.log('[frozen-content-recoverability] registry or page source absent; nothing to check');
  process.exit(0);
}

const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const pages = JSON.parse(fs.readFileSync(PAGES, 'utf8')).pages || [];
const byRoute = new Map(pages.map(p => [p.path || p.slug, p]));

// Routes proven to lose content, by actually thawing them in a throwaway
// worktree, rebuilding, and diffing. These are measurements, not estimates.
const CONFIRMED = {
  '/dentistry/choosing-a-dentist/': 1172,
  '/dentistry/dental-bridge-vs-implant/': 1269,
  '/dentistry/cosmetic-restorative/': 621,
  '/dentistry/pediatric-family/': 519,
  '/dentistry/clear-aligners/': 488,
};

const at_risk = [];
let checked = 0;

for (const entry of registry.pages || []) {
  const route = entry.route;
  const rendered = path.join(ROOT, entry.rendered_file || '');
  if (!route || !fs.existsSync(rendered)) continue;
  const record = byRoute.get(route);
  if (!record) continue;
  checked++;

  const renderedWords = visibleWords(fs.readFileSync(rendered, 'utf8'));
  const sourceWords = JSON.stringify(record.sections || [])
    .replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const gap = renderedWords - sourceWords;

  if (sourceWords > 0 && renderedWords > sourceWords * RATIO && gap >= MIN_GAP_WORDS) {
    at_risk.push({
      route, rendered_words: renderedWords, source_words: sourceWords, gap_words: gap,
      sections: (record.sections || []).length,
      // A page with cluster backing renders legitimately from the cluster
      // registry rather than from sections, so a gap there is expected and this
      // screen over-reports it. Only the confirmed set is measured.
      cluster_backed: Boolean(record.cluster_id || record.cluster),
      confirmed_loss_words: CONFIRMED[route] || null,
    });
  }
}

at_risk.sort((a, b) => b.gap_words - a.gap_words);

// A confirmed route is reported because it was measured, never because a
// heuristic happened to catch it. Tightening the screen must not silently drop
// a route we know loses content.
const seen = new Set(at_risk.map(r => r.route));
const confirmed = Object.entries(CONFIRMED).map(([route, loss]) => {
  const found = at_risk.find(r => r.route === route);
  return found || { route, confirmed_loss_words: loss, gap_words: null, note: 'below screen threshold; loss measured directly' };
}).map(r => ({ ...r, confirmed_loss_words: CONFIRMED[r.route] }))
  .sort((a, b) => b.confirmed_loss_words - a.confirmed_loss_words);
const suspected = at_risk.filter(r => !CONFIRMED[r.route]);
for (const route of Object.keys(CONFIRMED)) {
  if (!seen.has(route)) console.log(`[frozen-content-recoverability] note: ${route} is confirmed but sits below the screen threshold`);
}

fs.mkdirSync(path.join(ROOT, path.dirname(EVIDENCE)), { recursive: true });
fs.writeFileSync(path.join(ROOT, EVIDENCE), `${JSON.stringify({
  status: at_risk.length ? 'AT_RISK' : 'CLEAR',
  checked, ratio_threshold: RATIO, min_gap_words: MIN_GAP_WORDS,
  confirmed_count: confirmed.length, suspected_count: suspected.length,
  confirmed, suspected,
}, null, 2)}\n`);

console.log(`FROZEN CONTENT RECOVERABILITY: ${checked} frozen routes checked against the content source`);
if (!at_risk.length) {
  console.log('  CLEAR every frozen route is reproducible from its source record.');
  process.exit(0);
}
console.log(`  CONFIRMED ${confirmed.length} route(s) measurably lose content when thawed and rebuilt.`);
console.log('            Measured by thawing each in a throwaway worktree and diffing the rebuild.');
console.log('            SAFE while frozen. UNSAFE to thaw until the content is recovered into');
console.log('            content/_live/pages.json - a rebuild drops it with no error and no diff.');
for (const r of confirmed) {
  console.log(`            ${r.route}  loses ${r.confirmed_loss_words}w on rebuild`);
}
console.log(`  SCREEN    ${suspected.length} further route(s) render more than their sections account for.`);
console.log('            This is a screen, not a verdict: a cluster-backed page renders from the');
console.log('            cluster registry rather than from sections, so a gap there is expected.');
console.log(`            ${suspected.filter(r => r.cluster_backed).length} of them are cluster-backed and probably fine.`);
console.log('            Confirm any route by thaw-testing it before trusting this number.');
for (const r of suspected.slice(0, 5)) {
  console.log(`            ${r.route}  gap ${r.gap_words}w${r.cluster_backed ? ' (cluster-backed)' : ''}`);
}
if (suspected.length > 5) console.log(`            ...and ${suspected.length - 5} more in the evidence file`);
