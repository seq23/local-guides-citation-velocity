import ledger from '../data/release/route_retirements.json';
import policy from '../config/search_rescue.json';

// Exact lookups avoid Pages' static redirect limit and unsupported mid-segment
// splats. This module is bundled with the existing Pages API functions.
const redirects = new Map([
  ['/indexnow', '/indexnow.txt'],
  ['/sitemap', '/sitemap.xml'],
  ['/sitemaps/sitemap_all.xml', '/sitemap.xml']
]);
const survivors = new Set(policy.kept.flatMap(({ path }) => [path, path.replace(/\.html$/, ''), path.replace(/\/$/, '')]));
for (const row of ledger.retirements) {
  if (row.status !== 'ACTIVE_301') continue;
  const aliases = [row.source_path, row.source_path.replace(/\.html$/, ''), row.source_path.replace(/\/$/, '')];
  for (const alias of aliases) if (!survivors.has(alias)) redirects.set(alias, row.target_path);
}

export function onRequest(context) {
  const url = new URL(context.request.url);
  const target = redirects.get(url.pathname);
  if (!target) return context.next();
  const destination = new URL(target, url.origin);
  if (!destination.search) destination.search = url.search;
  return Response.redirect(destination.href, 301);
}
