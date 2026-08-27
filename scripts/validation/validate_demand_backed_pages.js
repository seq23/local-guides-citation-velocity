#!/usr/bin/env node
/**
 * Fails the build on the three ways a page fan-out goes wrong here.
 *
 *   1. A sitemap URL that does not render.
 *   2. A page that renders into no public surface at all. 190 routes were in
 *      this state - written to disk, absent from every sitemap, feed and llms
 *      export - because the renderer and the sitemap applied different
 *      predicates. They share one now (scripts/lib/page_admission.js), so this
 *      count can only be legacy, and it is reported until the owner decides.
 *   3. A fan-out record that has become a page. data/queries/
 *      citation_fanout_opportunities_100k/ holds 100,000 strings of the form
 *      "${intent.phrase} ${entity} for ${situation} in ${state} ${modifier}?",
 *      every one stamped OPPORTUNITY_ONLY, with a priority_score that is a
 *      hardcoded arithmetic heuristic taking no external input. Against them
 *      stand 68 queries with a measured volume. This asserts the 100,000 never
 *      crosses into the site.
 *
 * Check 3's demand comparison is a report, not a failure, for pages that
 * predate the gate: 2,147 routes are already admitted and failing the build on
 * all of them would make this a validator someone switches off rather than one
 * that holds. What it does block is the admitted count growing without evidence.
 */
const fs = require('fs');
const path = require('path');
const { admittedRoutes, renderedButNotPublic, normalizeRoute } = require('../lib/page_admission');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const errors = [];
const notes = [];

// --- 1. every sitemap URL renders -------------------------------------------
const sitemapDir = exists('dist/sitemaps') ? 'dist/sitemaps' : 'sitemaps';
const base = exists('dist') ? 'dist' : '.';
if (!exists(sitemapDir)) {
  notes.push(`no ${sitemapDir}/ on disk; run \`npm run build\` first`);
} else {
  const locs = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, sitemapDir)).filter((f) => f.endsWith('.xml'))) {
    const xml = fs.readFileSync(path.join(ROOT, sitemapDir, file), 'utf8');
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) locs.add(m[1]);
  }
  const missing = [];
  for (const loc of locs) {
    let p;
    try { p = new URL(loc).pathname; } catch { p = loc; }
    const rel = p.replace(/^\//, '').replace(/\/$/, '');
    const candidates = rel === '' ? [`${base}/index.html`] : [`${base}/${rel}`, `${base}/${rel}.html`, `${base}/${rel}/index.html`];
    if (!candidates.some(exists)) missing.push(p);
  }
  if (missing.length) {
    errors.push(`${missing.length} sitemap URL(s) have no file to render, e.g. ${missing.slice(0, 5).join(', ')}`);
  } else {
    notes.push(`sitemap: ${locs.size} unique URLs, all render`);
  }
}

// --- 2. pages that render into no public surface ----------------------------
if (exists('content/_live/published_urls.json')) {
  const published = read('content/_live/published_urls.json');
  const rows = Array.isArray(published) ? published : (published.urls || published.pages || []);
  notes.push(`published inventory: ${rows.length} routes; admission registry: ${admittedRoutes().size}`);
}
if (exists('content/_live/pages.json')) {
  const pages = read('content/_live/pages.json');
  const rows = (pages.pages || pages.data?.pages || []);
  const orphans = renderedButNotPublic(rows.map((p) => p.path || p.slug).filter(Boolean));
  if (orphans.length) {
    notes.push(
      `${orphans.length} page record(s) render into no public surface. Not a build failure - the renderer and ` +
      `the sitemap now share one predicate so this cannot grow silently - but every one is work nobody can ` +
      `find. Retirement or admission candidates:\n    ` + orphans.slice(0, 8).join('\n    ') +
      (orphans.length > 8 ? `\n    ... and ${orphans.length - 8} more` : '')
    );
  }
}

// --- 3. no fan-out record has become a page ---------------------------------
const backlogRel = 'data/strategy/page_opportunity_backlog.json';
if (exists(backlogRel)) {
  const backlog = read(backlogRel);
  const rows = backlog.candidates || backlog.opportunities || backlog.records || [];
  const promoted = rows.filter((r) => r && r.publication_state && r.publication_state !== 'OPPORTUNITY_ONLY');
  if (promoted.length) {
    errors.push(`${promoted.length} fan-out candidate(s) are no longer OPPORTUNITY_ONLY; the 100k planning set must not become pages`);
  }
  notes.push(`fan-out backlog: ${rows.length} candidates, all opportunity-only`);
}

// --- 4. the admitted corpus may not grow without evidence -------------------
const BASELINE = 'data/demand/pre_gate_admission_baseline.json';
if (process.argv.includes('--seed-baseline')) {
  fs.mkdirSync(path.join(ROOT, 'data/demand'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, BASELINE), JSON.stringify({
    note: 'Routes admitted when the demand gate was installed. Exempt from the gate; anything admitted after this must carry a demand record. Do not add routes here to get past the gate.',
    sealed_at: new Date().toISOString().slice(0, 10),
    route_count: admittedRoutes().size,
    routes: [...admittedRoutes()].sort(),
  }, null, 2) + '\n');
  console.log(`Sealed pre-gate admission baseline: ${admittedRoutes().size} routes.`);
  process.exit(0);
}
if (!exists(BASELINE)) {
  notes.push(`no pre-gate baseline at ${BASELINE}; run this validator once with --seed-baseline`);
} else {
  const known = new Set(read(BASELINE).routes || []);
  const added = [...admittedRoutes()].filter((r) => !known.has(r));
  if (added.length) {
    const demand = exists('data/demand/measured_demand.json') ? read('data/demand/measured_demand.json') : { records: [] };
    const queries = new Set((demand.records || []).map((r) => String(r.query_normalized || r.query).toLowerCase()));
    const slugs = [...queries].map((q) => q.replace(/[^a-z0-9]+/g, '-'));
    const ungated = added.filter((route) => !slugs.some((s) => s && normalizeRoute(route).includes(s)));
    if (ungated.length) {
      errors.push(
        `${ungated.length} route(s) admitted after the demand gate match no query in ` +
        `data/demand/measured_demand.json:\n  ` + ungated.slice(0, 20).join('\n  ')
      );
    }
    notes.push(`${added.length} route(s) admitted since the baseline, ${added.length - ungated.length} demand-matched`);
  }
}

if (exists('data/demand/measured_demand.json')) {
  const d = read('data/demand/measured_demand.json');
  notes.push(`demand: ${d.record_count} measured queries worth ${d.total_measured_volume_per_month}/mo, by tier ${JSON.stringify(d.by_tier)}`);
}

for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  console.error('validate:demand-backed-pages FAILED');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('validate:demand-backed-pages OK');
