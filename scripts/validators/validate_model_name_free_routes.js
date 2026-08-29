#!/usr/bin/env node
'use strict';
/**
 * No public route, title or admitted candidate may name the model that made it.
 *
 * Incident, 2026-08-29. Seven rendered, indexable pages carried the generating
 * model in the URL and in the <title>:
 *
 *   .../how-is-fault-determined-in-a-personal-injury-case-openai-gpt-4o/
 *   .../what-are-the-requirements-for-the-i-693-medical-exam-perplexity/
 *   .../can-i-sue-for-pain-and-suffering-after-a-car-accident-gemini-1-5-flash/
 *
 * The queries were harvested from an LLM answer panel whose display string is
 * "question + answering model". Nothing stripped it, so one intake shape turned
 * into public URLs, page titles and admission-registry rows that all name a
 * vendor's model. A URL that names the model that wrote the page is a
 * generation artifact in the address bar: it reads as automated to a person and
 * to a search engine, on properties that exist in order to be cited.
 *
 * The seven were retired to 301s. The source was fixed in two places -
 * scripts/lib/page_family_router.js strips model names before a route is
 * minted, and scripts/content/build_page_release_queue.js refuses a row whose
 * route or query still carries one. This validator is the guard that makes the
 * fix permanent: it re-checks every surface where such a route could reappear,
 * including surfaces that bypass both of those files.
 *
 * A retired route is exempt: it is a named stop with a 301 in _redirects and an
 * entry in data/release/route_retirements.json, so it advertises nothing. The
 * exemption is computed from _redirects rather than listed here, so it cannot
 * go stale, and it is narrow - the route must actually redirect.
 *
 * Rule 0: it hard-fails if it examined zero routes. Every surface below is
 * normally thousands of rows; a run that checks nothing is a broken reader, not
 * a clean repo.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const { containsModelName, modelNamesIn } = require(path.join(ROOT, 'scripts/lib/model_name_guard.js'));

const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };

const redirectSources = (() => {
  const set = new Set();
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const from = t.split(/\s+/)[0];
      if (from && from.startsWith('/')) set.add(from);
    }
  } catch { /* an absent _redirects means no exemptions, which is the safe direction */ }
  return set;
})();
const isRetired = (route) => {
  const r = String(route || '');
  return redirectSources.has(r)
    || redirectSources.has(r.endsWith('/') ? r.slice(0, -1) : `${r}/`)
    || redirectSources.has(r.endsWith('.html') ? r.slice(0, -5) : `${r}.html`);
};

// Each surface names what it is and how to get a value out of it, so adding a
// surface later is one row rather than a new branch.
const SURFACES = [
  { rel: 'content/_live/published_urls.json', label: 'published URL inventory', rows: (d) => d.items || [], fields: (r) => [r.path] },
  { rel: 'data/content/page_admission_registry.json', label: 'page admission registry', rows: (d) => d.pages || [], fields: (r) => [r.path, r.primary_query] },
  { rel: 'content/_live/pages.json', label: 'live pages', rows: (d) => d.pages || [], fields: (r) => [r.path || r.slug, r.title] },
  { rel: 'content/_staged/pages.json', label: 'staged pages', rows: (d) => d.pages || [], fields: (r) => [r.path || r.slug, r.title] },
  { rel: 'content/_live/insights.json', label: 'insights manifest', rows: (d) => d.items || [], fields: (r) => [r.publish_path, r.title] },
  { rel: 'content/_live/medium_articles.json', label: 'medium article manifest', rows: (d) => d.items || [], fields: (r) => [r.publish_path, r.title] },
  { rel: 'data/release/page_release_queue.json', label: 'page release queue (admitted rows only)', rows: (d) => (d.records || []).filter((r) => r.eligible === true), fields: (r) => [r.target_route, r.query] },
  { rel: 'data/content/unbuilt_rich_page_backlog.json', label: 'unbuilt backlog (build candidates only)', rows: (d) => (d.routes || []).filter((r) => String(r.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE'), fields: (r) => [r.route, r.query] },
];

const problems = [];
let examined = 0;
const perSurface = [];
for (const surface of SURFACES) {
  const doc = read(surface.rel);
  if (!doc) { perSurface.push([surface.label, 'absent']); continue; }
  const rows = surface.rows(doc);
  let checked = 0;
  for (const row of rows) {
    const values = surface.fields(row).filter(Boolean);
    if (!values.length) continue;
    checked += 1;
    const route = String(values[0] || '');
    for (const value of values) {
      if (!containsModelName(value)) continue;
      if (isRetired(route)) continue;
      problems.push(`${surface.rel}: ${route} names a generating model (${modelNamesIn(value).join(', ')}) in "${String(value).slice(0, 120)}". A public route or title may never name the model that produced the page. Strip it at the source (scripts/lib/model_name_guard.js) and retire the published route with a 301 if it is already live.`);
    }
  }
  examined += checked;
  perSurface.push([surface.label, `${checked} row(s)`]);
}

// Rendered HTML, because a page can reach disk without passing through any of
// the manifests above.
const RENDER_ROOTS = ['personal-injury', 'dentistry', 'trt', 'neuro', 'uscis-medical', 'insights'];
let renderedChecked = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const route = entry.name === 'index.html' ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel.replace(/\.html$/, '')}`;
    renderedChecked += 1;
    if (containsModelName(route) && !isRetired(route)) {
      problems.push(`rendered tree: ${route} names a generating model (${modelNamesIn(route).join(', ')}) and is not retired by a 301 in _redirects. A crawler can reach this URL.`);
    }
  }
};
for (const root of RENDER_ROOTS) {
  const abs = path.join(ROOT, root);
  if (fs.existsSync(abs)) walk(abs);
}
examined += renderedChecked;
perSurface.push(['rendered HTML tree', `${renderedChecked} page(s)`]);

console.log('Model-name-free public routes');
for (const [label, count] of perSurface) console.log(`  ${label.padEnd(42)}: ${count}`);
console.log(`  total values examined                     : ${examined}`);

if (!examined) {
  console.error('');
  console.error('VALIDATION FAIL: this validator examined zero routes. Every surface it reads is normally thousands of rows, so an empty run means a broken reader, not a clean repo, and a guard that passes having checked nothing is the defect it exists to catch.');
  process.exit(1);
}
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`VALIDATION FAIL: ${p}`);
  process.exit(1);
}
console.log('');
console.log('PASS: no public route, title or admitted build candidate names the model that generated it.');
