import ledger from '../data/release/route_retirements.json';
import policy from '../config/search_rescue.json';

// Exact lookups avoid Pages' static redirect limit and unsupported mid-segment
// splats. This module is bundled with the existing Pages API functions.
const redirects = new Map([
  ['/indexnow', '/indexnow.txt'],
  ['/sitemap', '/sitemap.xml'],
  ['/sitemaps/sitemap_all.xml', '/sitemap.xml']
]);
function routeAliases(path) {
  const bare = path.replace(/\/$/, '').replace(/\.html$/, '');
  return bare.startsWith('/insights/') && !bare.slice('/insights/'.length).includes('/')
    ? [path, bare, `${bare}.html`]
    : [path, bare];
}

const survivors = new Set(policy.kept.flatMap(({ path }) => routeAliases(path)));
for (const row of ledger.retirements) {
  if (row.status !== 'ACTIVE_301') continue;
  for (const alias of routeAliases(row.source_path)) {
    if (!survivors.has(alias)) redirects.set(alias, row.target_path);
  }
}

// A child sitemap the build stops writing (its partition emptied: sitemap_util.xml,
// sitemap_all.xml, then sitemap_atlas.xml after the 2 Nov 2026 search rescue) stays
// submitted in Search Console, which logs an error against its 404 every day
// (Search Readiness e2). Any /sitemaps/*.xml the host does not serve therefore
// 301s to the index, the same answer sitemap_all.xml gets, which Search Console
// reads with zero errors.
const SITEMAP_CHILD = /^\/sitemaps\/[^/]+\.xml$/;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (SITEMAP_CHILD.test(url.pathname) && !redirects.has(url.pathname)) {
    const res = await context.next();
    if (res.status !== 404) return res;
    return Response.redirect(new URL('/sitemap.xml', url.origin).href, 301);
  }
  const target = redirects.get(url.pathname);
  if (!target) return context.next();
  const destination = new URL(target, url.origin);
  if (!destination.search) destination.search = url.search;
  return Response.redirect(destination.href, 301);
}
