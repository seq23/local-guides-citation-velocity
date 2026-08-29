#!/usr/bin/env node
'use strict';
/**
 * A page the release lane released must be reachable.
 *
 * Incident, 2026-08-29. data/content/page_admission_registry.json is built from
 * content/_live/published_urls.json, and published_urls.json is written from the
 * routes that survive isPubliclyAdmitted, which asks the admission registry. A
 * route was admitted if it was published and published if it was admitted, so
 * the registry was a fixed point that nothing released after the 2026-06-19
 * baseline could enter.
 *
 * Eleven routes were sitting in that gap: promoted into content/_live/pages.json
 * with publication_status ADMITTED, rendered to disk as indexable HTML, named by
 * no sitemap, no feed and no llms export. A rendered indexable page in no
 * sitemap is inert - the work is done and nobody can find it - and the loop
 * would have swallowed every page the newly-wired backlog drain builds, turning
 * a 46-route drain into 46 new orphans.
 *
 * scripts/build_page_admission_registry_2026_06_19.js now also admits a live
 * page record that is ADMITTED, rendered, and not redirected away. This
 * validator re-derives that same set independently and fails if any member of
 * it is missing from the registry, so the loop cannot quietly come back - by a
 * revert, or by a new writer that rebuilds the registry from published_urls
 * alone.
 *
 * Rule 0: it hard-fails if it examined zero live page records.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };

const live = read('content/_live/pages.json');
const registry = read('data/content/page_admission_registry.json');
if (!live || !Array.isArray(live.pages)) {
  console.error('ADMISSION REACHABILITY: FAIL - content/_live/pages.json is missing or unreadable, so this validator examined zero released pages and cannot pass.');
  process.exit(1);
}
if (!registry || !Array.isArray(registry.pages)) {
  console.error('ADMISSION REACHABILITY: FAIL - data/content/page_admission_registry.json is missing or unreadable. The registry is the one authority on which routes are public; nothing can be checked against an absent one.');
  process.exit(1);
}

const admitted = new Set(registry.pages.map((p) => p.path));
const redirectSources = (() => {
  const set = new Set();
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const from = t.split(/\s+/)[0];
      if (from && from.startsWith('/')) set.add(from);
    }
  } catch { /* no _redirects means no retirements */ }
  return set;
})();
const isRedirected = (route) => redirectSources.has(route)
  || redirectSources.has(route.endsWith('/') ? route.slice(0, -1) : `${route}/`)
  || redirectSources.has(route.endsWith('.html') ? route.slice(0, -5) : `${route}.html`);
const isRendered = (route) => {
  const rel = String(route || '').replace(/^\/+|\/+$/g, '');
  if (!rel) return true;
  return fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, `${rel}.html`));
};

const counts = { examined: 0, admitted: 0, evidence_only: 0, retired: 0, not_rendered: 0, unreachable: 0 };
const unreachable = [];
for (const page of live.pages) {
  const route = page.path || page.slug;
  if (!route) continue;
  counts.examined += 1;
  const status = String(page.publication_status || '').toUpperCase();
  if (status !== 'ADMITTED') { counts.evidence_only += 1; continue; }
  if (isRedirected(route)) { counts.retired += 1; continue; }
  if (!isRendered(route)) { counts.not_rendered += 1; continue; }
  if (admitted.has(route)) { counts.admitted += 1; continue; }
  counts.unreachable += 1;
  unreachable.push(route);
}

console.log('Released-page admission reachability');
console.log(`  live page records examined       : ${counts.examined}`);
console.log(`  ADMITTED, rendered, in registry  : ${counts.admitted}`);
console.log(`  held back (not ADMITTED)         : ${counts.evidence_only}`);
console.log(`  retired by a 301                 : ${counts.retired}`);
console.log(`  record with no rendered page     : ${counts.not_rendered}`);
console.log(`  UNREACHABLE                      : ${counts.unreachable}`);

if (!counts.examined) {
  console.error('');
  console.error('VALIDATION FAIL: zero live page records were examined. content/_live/pages.json normally carries hundreds; an empty walk is a broken reader, and a reachability guard that passes over no pages is the defect it exists to catch.');
  process.exit(1);
}
if (unreachable.length) {
  console.error('');
  console.error(`VALIDATION FAIL: ${unreachable.length} released page(s) are ADMITTED in content/_live/pages.json and rendered as indexable HTML, but absent from data/content/page_admission_registry.json, so no sitemap, feed or llms export names them. They are inert: the work is done and nobody can find it. Rebuild the registry (node scripts/build_page_admission_registry_2026_06_19.js), or retire the route with a 301, or hold it back with publication_status EVIDENCE_ONLY.`);
  for (const route of unreachable.slice(0, 20)) console.error(`  ${route}`);
  process.exit(1);
}
console.log('');
console.log('PASS: every released, rendered, non-retired page is admitted and therefore reachable.');
