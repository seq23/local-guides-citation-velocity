'use strict';
/**
 * One authority on "which published pages does an internal link actually reach".
 *
 * Ahrefs crawled theindustryguides.com on 2026-09-03 and reported 18 orphan pages.
 * Every internal mechanism said there were none: buildLinkCoveragePlan reported 125
 * adoptions placed, the rendered HTML of the host pages contained the anchors, and
 * validate_rendered_internal_hrefs confirmed the hrefs resolved. All three were
 * measuring the repo. None was measuring what a crawler is served.
 *
 * Two things break the equivalence, and this module is the single place that knows
 * about both:
 *
 *   1. A page whose route is a source line in _redirects still exists on disk and
 *      still renders its anchors. Requesting that route returns a 301, so no crawler
 *      ever reads the page and none of its outbound links exist as far as the graph
 *      is concerned. 15 of the 18 orphans were "linked" only from such a page.
 *
 *   2. A route may be published under a different string from the file that renders
 *      it: /about/ is about.html, /foo/ is foo/index.html. Comparing raw paths made
 *      1,249 of 2,067 sitemap routes look like they had no rendered file at all.
 *
 * Both the orphan-adoption queue and the inbound-coverage validator import this, so
 * the producer and the guard cannot drift into keeping two different lists of what
 * "reachable" means.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SITEMAP_DIR = 'sitemaps';
const REDIRECTS = '_redirects';
const HOST = 'theindustryguides.com';

// Directories that hold sources, generated bundles or archives rather than the
// served site. Walking them would count links from HTML nobody is ever served.
const NON_SITE_DIRS = new Set([
  'node_modules', '.git', '.build', '.github', 'dist', 'reports', 'staging', 'outputs',
  'content-bank', 'artifacts', 'logs', 'releases', 'proofs', 'docs', 'templates',
  'medium-articles', 'data', 'scripts', 'seo', 'content', 'functions', '.clarity', 'atlas-src'
]);

function normalizeRoute(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
  if (!out.startsWith('/')) return '';
  out = out.replace(/\/index\.html$/, '/');
  if (!/\.[a-z0-9]+$/i.test(out) && !out.endsWith('/')) out += '/';
  return out.replace(/\/{2,}/g, '/');
}

function readSitemapRoutes(root = ROOT) {
  const dir = path.join(root, SITEMAP_DIR);
  const routes = new Set();
  if (!fs.existsSync(dir)) return routes;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const route = normalizeRoute(match[1]);
      if (route) routes.add(route);
    }
  }
  return routes;
}

function readRedirectSources(root = ROOT) {
  const set = new Set();
  const abs = path.join(root, REDIRECTS);
  if (!fs.existsSync(abs)) return set;
  for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const from = trimmed.split(/\s+/)[0];
    const route = normalizeRoute(from);
    if (route) set.add(route);
  }
  return set;
}

function listRenderedHtml(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (NON_SITE_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (entry.name.endsWith('.html')) files.push(path.relative(root, abs));
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Build the served link graph.
 *
 * Returns:
 *   sitemapRoutes  Set    every <loc> in sitemaps/
 *   redirected     Set    every route that answers with a redirect
 *   rendered       Map    canonical route -> repo-relative html file
 *   indexable      Map    canonical route -> boolean (meta robots noindex)
 *   outbound       Map    canonical route -> Set of canonical routes it links to
 *   inboundLive    Map    canonical route -> Set of LIVE routes linking to it
 *   inboundDead    Map    canonical route -> Set of non-live routes linking to it
 *   isLive         fn     rendered && indexable && not a redirect source
 *   published      Array  sitemap routes that are rendered, indexable and not redirected
 */
function buildLinkGraph(root = ROOT) {
  const sitemapRoutes = readSitemapRoutes(root);
  const redirected = readRedirectSources(root);
  const files = listRenderedHtml(root);

  // A file serves the sitemap form of its route when one exists: about.html is
  // published as /about/, and dentistry/x/index.html as /dentistry/x/.
  const canonicalRouteFor = (rel) => {
    const withExtension = normalizeRoute(`/${rel}`);
    const asDirectory = rel.endsWith('index.html')
      ? withExtension
      : normalizeRoute(`/${rel.replace(/\.html$/, '/')}`);
    if (sitemapRoutes.has(withExtension)) return withExtension;
    if (sitemapRoutes.has(asDirectory)) return asDirectory;
    return withExtension;
  };

  const rendered = new Map();
  const alias = new Map();
  for (const rel of files) {
    const canonical = canonicalRouteFor(rel);
    rendered.set(canonical, rel);
    alias.set(normalizeRoute(`/${rel}`), canonical);
    alias.set(normalizeRoute(`/${rel.replace(/\.html$/, '/')}`), canonical);
    alias.set(canonical, canonical);
  }
  const resolve = (href) => {
    const normalized = normalizeRoute(href);
    return alias.get(normalized) || normalized;
  };

  const indexable = new Map();
  const outbound = new Map();
  for (const [route, rel] of rendered) {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    indexable.set(route, !/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html));
    const targets = new Set();
    for (const match of html.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>/gi)) {
      const attributes = `${match[1]}${match[3]}`;
      if (/rel=["'][^"']*nofollow/i.test(attributes)) continue;
      const href = match[2].trim();
      if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
      if (/^https?:\/\//i.test(href) && !href.includes(HOST)) continue;
      const target = resolve(href);
      if (target && target !== route) targets.add(target);
    }
    outbound.set(route, targets);
  }

  const isLive = (route) => rendered.has(route) && indexable.get(route) === true && !redirected.has(route);

  const inboundLive = new Map();
  const inboundDead = new Map();
  for (const route of rendered.keys()) { inboundLive.set(route, new Set()); inboundDead.set(route, new Set()); }
  for (const [source, targets] of outbound) {
    const live = isLive(source);
    for (const target of targets) {
      if (!inboundLive.has(target)) continue;
      (live ? inboundLive : inboundDead).get(target).add(source);
    }
  }

  const published = [...sitemapRoutes].filter((route) => isLive(route)).sort();

  return { sitemapRoutes, redirected, rendered, indexable, outbound, inboundLive, inboundDead, isLive, published, resolve };
}

/**
 * Published pages that no live page links to.
 *
 * `dead_inbound` names the pages that DO link to it but are not served, because that
 * distinction is the whole finding: "nothing links to it" and "the only thing that
 * links to it is a 301" need different repairs and only the second one looks fine
 * from inside the repo.
 */
function findOrphans(graph) {
  const orphans = [];
  for (const route of graph.published) {
    const live = graph.inboundLive.get(route) || new Set();
    if (live.size > 0) continue;
    orphans.push({
      route,
      dead_inbound: [...(graph.inboundDead.get(route) || new Set())].sort(),
    });
  }
  return orphans;
}

module.exports = { ROOT, HOST, normalizeRoute, readSitemapRoutes, readRedirectSources, listRenderedHtml, buildLinkGraph, findOrphans };
