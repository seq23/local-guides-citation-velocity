#!/usr/bin/env node
/**
 * Post-deploy live check: what the EDGE serves, after a deploy, from outside.
 *
 * Why a build-time validator is not enough (Search Readiness h4): the build can
 * pass and the edge can still serve the wrong thing. Both of these were true on
 * theindustryguides.com while every validator was green:
 *   - /sitemaps/sitemap_util.xml answered a 404 HTML page for nine days, and
 *     Search Console reported an error against it every day.
 *   - /sitemaps/sitemap_all.xml 301s to /sitemap.xml.
 * Nothing in the repository looked at the live host, so nothing could see either.
 *
 * Exits non-zero on any miss, with the URL and what it answered. Read-only: it
 * makes GET and HEAD requests and changes nothing.
 */
const HOST = process.env.LIVE_HOST || 'theindustryguides.com';
const BASE = `https://${HOST}`;
const UA = 'Mozilla/5.0 (compatible; theindustryguides-post-deploy-check)';

const misses = [];
const notes = [];
const miss = (url, why) => misses.push(`${url}: ${why}`);

async function get(url, { method = 'GET', redirect = 'manual' } = {}) {
  let res;
  try {
    res = await fetch(url, { method, redirect, headers: { 'user-agent': UA } });
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
  const type = res.headers.get('content-type') || '';
  const location = res.headers.get('location') || '';
  let text = '';
  if (method === 'GET') { try { text = await res.text(); } catch { text = ''; } }
  return { status: res.status, type, location, text };
}

// 1. Crawl files answer 200 with the right content type and are not the SPA 404.
async function crawlFiles() {
  const want = [
    ['/robots.txt', /text\/plain/, /^\s*(user-agent|sitemap)/im],
    ['/llms.txt', /text\/plain/, /industry guides/i],
    ['/llms-full.txt', /text\/plain/, /retrieval index/i],
    ['/sitemap.xml', /xml/, /<sitemapindex|<urlset/i],
    ['/feed.xml', /xml|rss/, /<rss|<feed/i]
  ];
  for (const [p, type, body] of want) {
    const r = await get(BASE + p);
    if (r.error) { miss(p, r.error); continue; }
    if (r.status !== 200) { miss(p, `status ${r.status}${r.location ? ` -> ${r.location}` : ''}`); continue; }
    if (!type.test(r.type)) { miss(p, `served as ${r.type}`); continue; }
    if (/<!doctype html|<html/i.test(r.text.slice(0, 400))) { miss(p, 'served an HTML page (the catch-all), not the file'); continue; }
    if (!body.test(r.text)) miss(p, 'answered 200 but the body is not what this file should contain');
  }
  notes.push(`${want.length} crawl file(s) answer 200 with the right type and body`);
}

// 2. Every sitemap the index names answers 200 as XML. This is the check that
// would have caught sitemap_util.xml the day it started 404ing.
async function sitemapChildren() {
  const idx = await get(`${BASE}/sitemap.xml`);
  if (idx.error || idx.status !== 200) { miss('/sitemap.xml', `cannot read the index (${idx.error || idx.status})`); return; }
  const locs = [...idx.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) { miss('/sitemap.xml', 'the index names no child sitemap'); return; }
  for (const url of locs) {
    const r = await get(url);
    if (r.error) { miss(url, r.error); continue; }
    if (r.status !== 200) { miss(url, `status ${r.status}${r.location ? ` -> ${r.location}` : ''} but the index names it`); continue; }
    if (!/xml/i.test(r.type) || !/<urlset|<sitemapindex/i.test(r.text.slice(0, 500))) miss(url, `served as ${r.type}, not sitemap XML`);
  }
  notes.push(`${locs.length} child sitemap(s) named by the index all answer 200 XML`);
}

// 3. Icons, web manifest and the og:image card are on our own host and answer.
async function brandAssets() {
  const files = ['/favicon.ico', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/site.webmanifest', '/og.png'];
  for (const p of files) {
    const r = await get(BASE + p, { method: 'HEAD' });
    if (r.error) { miss(p, r.error); continue; }
    if (r.status !== 200) miss(p, `status ${r.status}`);
  }
  notes.push(`${files.length} brand asset(s) answer 200 on our own host`);
}

// 4. The homepage's head and schema, as a browser gets it.
async function homepageHead() {
  const r = await get(`${BASE}/`, { redirect: 'follow' });
  if (r.error || r.status !== 200) { miss('/', `status ${r.error || r.status}`); return; }
  const h = r.text;
  const need = ['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name', 'og:image'];
  const lacks = need.filter((k) => !new RegExp(`property=["']${k}["']`).test(h));
  if (lacks.length) miss('/', `head lacks ${lacks.join(', ')}`);
  if (!/name=["']twitter:card["'][^>]*content=["']summary_large_image["']/.test(h)) miss('/', 'twitter:card is not summary_large_image');
  const blocks = [...h.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) { miss('/', 'no JSON-LD on the homepage'); return; }
  let org = null;
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1]); } catch { miss('/', 'a JSON-LD block does not parse'); continue; }
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (!org && [].concat(n['@type'] || []).some((t) => /^(Organization|NewsMediaOrganization|Corporation)$/.test(String(t)))) org = n;
      Object.values(n).forEach(walk);
    };
    walk(data);
  }
  if (!org) miss('/', 'JSON-LD has no Organization node');
  else {
    const orgLacks = ['name', 'url', 'logo'].filter((k) => !org[k]);
    for (const k of orgLacks) miss('/', `Organization lacks ${k}`);
    if (!orgLacks.length) notes.push('homepage Organization carries name, url and logo');
  }
}

// 5. The IndexNow key file, which the submitter is useless without.
async function indexNowKey() {
  const r = await get(`${BASE}/indexnow.txt`);
  if (r.error || r.status !== 200) { miss('/indexnow.txt', `status ${r.error || r.status}`); return; }
  const key = r.text.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{8,}$/i.test(key)) { miss('/indexnow.txt', 'holds no key'); return; }
  const k = await get(`${BASE}/${key}.txt`);
  if (k.error || k.status !== 200) miss(`/${key}.txt`, `the key file answered ${k.error || k.status}`);
  else if (k.text.trim() !== key) miss(`/${key}.txt`, 'does not contain its own key');
  else notes.push('IndexNow key file answers and matches /indexnow.txt');
}

// 6. A measured URL must not be served from a redirect: a 301 on a URL search
// already measured spends its ranking on a hop.
async function measuredRoutes() {
  const r = await get(`${BASE}/sitemaps/sitemap_core.xml`);
  if (r.error || r.status !== 200) { notes.push('sitemap_core.xml unreadable; no measured routes checked'); return; }
  const routes = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).slice(0, 12);
  for (const url of routes) {
    const res = await get(url, { method: 'HEAD' });
    if (res.error) { miss(url, res.error); continue; }
    if (res.status !== 200) miss(url, `status ${res.status}${res.location ? ` -> ${res.location}` : ''} but the sitemap names it`);
  }
  notes.push(`${routes.length} sitemap route(s) answer 200 without a redirect`);
}

const steps = [crawlFiles, sitemapChildren, brandAssets, homepageHead, indexNowKey, measuredRoutes];
for (const step of steps) {
  try { await step(); } catch (e) { miss(step.name, `check threw: ${e.message}`); }
}

// Rule 0: a check that graded nothing has proven nothing.
if (!notes.length && !misses.length) {
  console.error(`post-deploy live check: graded nothing against ${BASE}; the host was unreachable`);
  process.exit(1);
}
for (const n of notes) console.log(`  ok  ${n}`);
if (misses.length) {
  console.error(`\npost-deploy live check FAILED on ${HOST}: ${misses.length} miss(es)`);
  for (const m of misses) console.error(`  -  ${m}`);
  process.exit(1);
}
console.log(`\npost-deploy live check PASS on ${HOST}: crawl files, child sitemaps, brand assets, homepage head and schema, IndexNow key, measured routes.`);
