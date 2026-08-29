#!/usr/bin/env node
'use strict';
/**
 * Every rendered indexable page is either submitted or explicitly withheld.
 *
 * On 2026-08-29 a walk of the rendered tree found 197 pages under the five
 * verticals (plus one under /insights/) that scripts/build_site.js had written
 * to disk in the same release run that wrote the sitemaps, and that appeared in
 * no sitemap shard. None of them carried noindex. They were live, crawlable,
 * and never submitted: neither published nor withheld.
 *
 * The cause was not a walker bug. scripts/build_site.js:2598 filters the
 * rendered set through `isPubliclyAdmitted` (scripts/lib/page_admission.js),
 * which asks one question - is this route in
 * data/content/page_admission_registry.json - and only the survivors become
 * `publicWritten`, then `allUrls`, then the sitemap shards. The render loop at
 * scripts/build_site.js:2485-2510 asks that question of nothing: it writes an
 * indexable page for every route it is given. So admission gates advertising
 * and does not gate rendering, and the difference lands on disk as an
 * unadvertised live page. Line 2603 already computed the difference and
 * console.warn'd it. A warning in a build log is not a record; the gap had
 * grown from the 190 named in page_admission.js's own header comment to 198,
 * and nothing noticed.
 *
 * The existing sitemap-parity gate (scripts/validate_sitemap_parity.js) cannot
 * see this. It compares content/_live/published_urls.json against
 * sitemaps/sitemap_all.xml - two artifacts derived from the same `allUrls`
 * array a few lines apart. It agrees with itself by construction. It never
 * walks the rendered tree, so a page that never entered `allUrls` is invisible
 * to it. That is why it passed while 198 pages sat in the gap.
 *
 * This validator walks the rendered tree instead of the build's own bookkeeping
 * and requires every indexable rendered page to be accounted for by one of:
 *
 *   - present in a sitemap shard (submitted), or
 *   - carrying a noindex robots directive (withheld in the page itself), or
 *   - a 301 source in _redirects (withheld because it points elsewhere), or
 *   - the /404 error page, or
 *   - listed in data/content/rendered_route_exclusions.json with a reason.
 *
 * Reconciling the 198 that way splits them: 183 are already named stops - routes
 * retired with an ACTIVE_301 in _redirects under the authority of
 * data/release/route_retirements.json, mostly off-topic pages misfiled under
 * /personal-injury/ by a classifier default branch. The reproduction did not
 * read _redirects, so it counted a decided retirement as a gap. The remaining 15
 * are the real gap: rendered, indexable, submitted nowhere, redirected nowhere,
 * decided by nobody. They are seeded into the exclusion file with reason
 * RENDERED_BUT_UNADMITTED_PENDING_DISPOSITION, because admitting them or ceasing
 * to render them is a content decision this validator has no authority to make.
 * That backlog is declared, counted, and printed on every run. What it can no
 * longer do is grow: any rendered indexable page that is neither submitted nor
 * already declared hard-fails here.
 *
 * Rule 0: it hard-fails if it examined zero pages. This repo has a live problem
 * with guards that pass having walked an empty tree - sitemap-parity is one -
 * and a parity check that passes because it found nothing to check is the same
 * defect it exists to catch. The zero case is not the only shape of that
 * failure, so the check also runs in reverse: a sitemap route with no rendered
 * file fails, which catches a tree that was gutted rather than emptied.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const HOST = 'https://theindustryguides.com';
const EXCLUSIONS_REL = 'data/content/rendered_route_exclusions.json';

// The rendered route roots that are public surfaces. dist/ is a deploy copy of
// this same tree and staging/ and templates/ are not routes, so walking them
// would double-count or invent findings; they are named here rather than
// filtered by accident of a glob.
const ROUTE_ROOTS = [
  'personal-injury', 'dentistry', 'trt', 'neuro', 'uscis-medical',
  'insights', 'atlas', 'glossary', 'tools', 'medium', 'medium-articles'
];
// Skipped only at the top level. `dentistry` is a route root, but
// `atlas/dentistry/` and `medium-articles/dentistry/` are real pages, so a name
// filter applied at every depth silently drops them.
const TOP_LEVEL_SKIP = new Set([
  'node_modules', '.git', '.github', 'dist', 'staging', 'templates', 'scripts',
  'data', 'content', 'content-bank', 'artifacts', 'releases', 'reports',
  'proofs', 'outputs', 'docs', 'assets', 'functions', 'distribution_scripts',
  'seo', 'coverage', 'sitemaps', ...ROUTE_ROOTS
]);
const NESTED_SKIP = new Set(['node_modules', '.git']);

const problems = [];
const notes = [];

function readText(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

// ------------------------------------------------------------ submitted set
function sitemapRoutes() {
  const routes = new Set();
  const files = [];
  if (fs.existsSync(path.join(ROOT, 'sitemap.xml'))) files.push('sitemap.xml');
  const shardDir = path.join(ROOT, 'sitemaps');
  if (fs.existsSync(shardDir)) {
    for (const f of fs.readdirSync(shardDir)) if (f.endsWith('.xml')) files.push(path.join('sitemaps', f));
  }
  if (!files.length) {
    problems.push('No sitemap.xml and no sitemaps/*.xml were found. There is nothing to compare the rendered tree against, and passing on that would be the empty-loop failure this validator exists to catch.');
    return { routes, files };
  }
  for (const rel of files) {
    const xml = readText(rel) || '';
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      routes.add(m[1].trim().replace(HOST, ''));
    }
  }
  return { routes, files };
}

// --------------------------------------------------- named withholding rules
function redirectSources() {
  const set = new Set();
  const txt = readText('_redirects');
  if (!txt) return set;
  for (const line of txt.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const from = t.split(/\s+/)[0];
    if (from && from.startsWith('/')) set.add(from);
  }
  return set;
}

// A page that says noindex has withheld itself, in the artifact a crawler
// actually reads. That is a named stop, so it is accounted for.
const NOINDEX_RE = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i;

// ------------------------------------------------------------- rendered tree
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (NESTED_SKIP.has(entry.name)) continue;
      walk(abs, out);
    } else if (entry.name.endsWith('.html')) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      const route = entry.name === 'index.html'
        ? '/' + rel.slice(0, -'index.html'.length)
        : '/' + rel.replace(/\.html$/, '');
      out.push({ route, rel });
    }
  }
}

function renderedPages() {
  const out = [];
  for (const root of ROUTE_ROOTS) {
    const abs = path.join(ROOT, root);
    if (fs.existsSync(abs)) walk(abs, out);
  }
  // Top-level *.html and top-level comparison route directories.
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const abs = path.join(ROOT, entry.name);
    if (entry.isDirectory()) {
      if (TOP_LEVEL_SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (entry.name.endsWith('.html')) {
      out.push({ route: entry.name === 'index.html' ? '/' : '/' + entry.name.replace(/\.html$/, ''), rel: entry.name });
    }
  }
  return out;
}

// ------------------------------------------------------------ declared stops
function declaredExclusions() {
  const txt = readText(EXCLUSIONS_REL);
  if (txt === null) {
    problems.push(`Missing ${EXCLUSIONS_REL}. The declared-exclusion set is the only record of which rendered pages are knowingly unsubmitted; without it every withheld page is a silent gap again.`);
    return { byRoute: new Map(), doc: null };
  }
  let doc;
  try { doc = JSON.parse(txt); } catch (e) {
    problems.push(`Unreadable JSON: ${EXCLUSIONS_REL} (${e.message})`);
    return { byRoute: new Map(), doc: null };
  }
  const byRoute = new Map();
  for (const entry of (doc.routes || [])) {
    if (!entry || !entry.route) continue;
    if (!entry.reason) {
      problems.push(`${EXCLUSIONS_REL} declares ${entry.route} with no reason. An exclusion without a reason is a silent gap with extra steps.`);
      continue;
    }
    byRoute.set(entry.route, entry);
  }
  return { byRoute, doc };
}

// --------------------------------------------------------------------- run
const { routes: submitted, files: sitemapFiles } = sitemapRoutes();
const redirects = redirectSources();
const { byRoute: declared, doc: exclusionDoc } = declaredExclusions();
const pages = renderedPages();

// ------------------------------------------------------------------- Rule 0
if (!pages.length) {
  problems.push('Walked the rendered route roots and found zero HTML pages. This validator examined nothing and must not pass on an empty loop - a guard that agrees with an empty tree is exactly the defect it is hunting.');
}
if (!submitted.size && sitemapFiles.length) {
  problems.push('The sitemap files parsed to zero <loc> entries. Comparing a rendered tree against an empty submitted set would report every page as a gap or, if the tree were also empty, pass on nothing.');
}

// Cloudflare Pages serves `foo.html` at `/foo` and 308s the `.html` form, so the
// same page is spoken of under two names depending on which file is doing the
// speaking. Match on both rather than reporting a route as unaccounted for
// because the sitemap spelled it without the extension.
const variants = (route) => (route.endsWith('.html') ? [route, route.slice(0, -'.html'.length)] : [route, `${route}.html`]);
const knownTo = (lookup, route) => variants(route).some((v) => lookup.has(v));

const counts = { examined: pages.length, submitted: 0, noindex: 0, redirect: 0, error_page: 0, declared: 0, undeclared: 0 };
const undeclared = [];

for (const page of pages) {
  if (knownTo(submitted, page.route)) { counts.submitted += 1; continue; }
  if (page.route === '/404') { counts.error_page += 1; continue; }
  if (knownTo(redirects, page.route)) { counts.redirect += 1; continue; }
  const html = readText(page.rel) || '';
  if (NOINDEX_RE.test(html)) { counts.noindex += 1; continue; }
  if (knownTo(declared, page.route)) { counts.declared += 1; continue; }
  counts.undeclared += 1;
  undeclared.push(page.route);
}

if (undeclared.length) {
  problems.push(
    `${undeclared.length} rendered indexable page(s) are in no sitemap, carry no noindex, redirect nowhere, and are not declared in ${EXCLUSIONS_REL}. ` +
    'They are live and crawlable but never submitted - neither published nor withheld. ' +
    'Either admit the route (data/content/page_admission_registry.json), stop rendering it, give the page a noindex, or declare it with a reason. ' +
    `First 10: ${undeclared.slice(0, 10).join(', ')}`
  );
}

// The other direction, and the reason Rule 0 alone is not enough. Deleting the
// five vertical trees leaves 26 top-level comparison pages behind, so a walk
// still finds pages and a check that only asks "is every rendered page
// submitted?" passes on a tree that has lost 2,100 of them. Every route the
// sitemap advertises must also exist on disk, so a truncated render fails here
// rather than shipping 2,100 submitted 404s. Sitemap-index entries point at the
// shard XML files, not at pages, so they are not routes.
const renderedRoutes = new Set(pages.map((p) => p.route));
const advertisedNotRendered = [...submitted]
  .filter((r) => !r.endsWith('.xml') && !r.endsWith('.txt'))
  .filter((r) => !knownTo(renderedRoutes, r));
if (advertisedNotRendered.length) {
  problems.push(
    `${advertisedNotRendered.length} route(s) are submitted in a sitemap but have no rendered file. Those are advertised 404s, and at scale they are the signature of a truncated or partially-deleted render. ` +
    `First 10: ${advertisedNotRendered.slice(0, 10).join(', ')}`
  );
}

// A declared exclusion that has since been submitted is stale bookkeeping, not
// a live gap, so it is reported rather than failed - the backlog is allowed to
// shrink without a build breaking.
const stale = [...declared.keys()].filter((r) => submitted.has(r));
const vanished = [...declared.keys()].filter((r) => !pages.some((p) => p.route === r));
if (stale.length) notes.push(`${stale.length} declared exclusion(s) are now in the sitemap and can be deleted from ${EXCLUSIONS_REL}.`);
if (vanished.length) notes.push(`${vanished.length} declared exclusion(s) are no longer rendered and can be deleted from ${EXCLUSIONS_REL}.`);

if (exclusionDoc && typeof exclusionDoc.declared_count === 'number' && exclusionDoc.declared_count !== (exclusionDoc.routes || []).length) {
  problems.push(`${EXCLUSIONS_REL} says declared_count=${exclusionDoc.declared_count} but carries ${(exclusionDoc.routes || []).length} routes. The published depth of the backlog must match the backlog.`);
}

// ------------------------------------------------------------------- report
console.log('Rendered route admission parity');
console.log(`  rendered indexable pages examined : ${counts.examined}`);
console.log(`  in a sitemap shard               : ${counts.submitted}`);
console.log(`  withheld by noindex              : ${counts.noindex}`);
console.log(`  withheld as 301 redirect source  : ${counts.redirect}`);
console.log(`  error page                       : ${counts.error_page}`);
console.log(`  advertised but not rendered      : ${advertisedNotRendered.length}`);
console.log('');
console.log(`  DECLARED UNSUBMITTED BACKLOG     : ${counts.declared}  <-- rendered, live, never submitted, awaiting a human disposition`);
console.log(`  undeclared silent gaps           : ${counts.undeclared}`);
if (counts.declared) {
  const byReason = {};
  for (const r of declared.values()) if (!submitted.has(r.route)) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  for (const [reason, n] of Object.entries(byReason)) console.log(`    ${reason}: ${n}`);
}
for (const n of notes) console.log(`  note: ${n}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`VALIDATION FAIL: ${p}`);
  process.exit(1);
}
console.log('');
console.log('PASS: every rendered indexable page is submitted or explicitly withheld.');
