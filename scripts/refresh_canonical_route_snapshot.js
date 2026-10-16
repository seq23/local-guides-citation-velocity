#!/usr/bin/env node
'use strict';
/**
 * Refresh data/canonical_route_snapshot.json: the URL set each canonical guide
 * site publishes in its sitemap (sitemap index -> child sitemaps -> <loc>).
 *
 * The snapshot is what scripts/lib/canonical_routes.js resolves velocity links
 * against and what validate_canonical_domains.js checks every insights href
 * against. A canonical route that is not in its site's sitemap is a link we
 * cannot prove returns 200 (16 Oct 2026: ~3,600 insights links pointed at 31
 * hub URLs that 404'd on the canonicals).
 *
 * Usage: node scripts/refresh_canonical_route_snapshot.js
 * Refuses to write a domain with zero routes (a failed fetch is not "no pages").
 */
const fs = require('fs');
const path = require('path');
const { CANONICAL_ROUTE_DOMAINS, SNAPSHOT_PATH } = require('./lib/canonical_routes');

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'theindustryguides-route-snapshot/1.0' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}
function locs(xml) { return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&')); }

async function routesFor(domain) {
  const root = await fetchText(`https://${domain}/sitemap.xml`);
  let urls = locs(root);
  if (/<sitemapindex/i.test(root)) {
    const children = urls; urls = [];
    for (const child of children) urls.push(...locs(await fetchText(child)));
  }
  const paths = new Set();
  for (const u of urls) {
    const parsed = new URL(u);
    if (parsed.hostname !== domain) continue;
    paths.add(parsed.pathname || '/');
  }
  return [...paths].sort();
}

(async () => {
  const out = { generated_at: new Date().toISOString(), source: 'each canonical domain /sitemap.xml (index + children)', domains: {} };
  for (const domain of CANONICAL_ROUTE_DOMAINS) {
    const routes = await routesFor(domain);
    if (!routes.length) throw new Error(`${domain}: sitemap yielded zero routes; refusing to write an empty route list`);
    out.domains[domain] = routes;
    console.log(`${domain}: ${routes.length} routes`);
  }
  fs.writeFileSync(path.resolve(SNAPSHOT_PATH), JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), SNAPSHOT_PATH)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
