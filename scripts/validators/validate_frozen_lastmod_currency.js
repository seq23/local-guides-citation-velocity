#!/usr/bin/env node
'use strict';
/**
 * The sitemap never claims a frozen page is older than the page says it is.
 *
 * THE OUTAGE. A frozen route's <lastmod> is data/release/frozen_page_registry.json
 * accepted_lastmod, which build_site.js writes over the build's own content-hash
 * date. Until 2026-09-21 that field was copied from the admission registry on
 * every refreeze, and the admission registry is rebuilt from the sitemap the
 * freeze had just written - a closed loop no content change could move. The
 * 2026-08-26 answer-shape pass rewrote the direct answer on ~1,800 accepted
 * pages, stamped "Last reviewed: 2026-08-26" and dateModified on each of them,
 * refroze them, and left every sitemap date where it was: 2026-06-19 for the
 * baseline cohort. Three components each kept their own date - the sitemap, the
 * visible review stamp, the JSON-LD - and the one the cadence gate reads was the
 * oldest. 91 days after the admission date (2026-09-18) the gate counted 1,147
 * pages as stale, refresh_debt hit 54% against a 20% tolerance, and Validate
 * Repo went red on every push to main. The pages were current. The signal was
 * frozen.
 *
 * WHAT THIS PROVES, per FROZEN record:
 *   1. accepted_lastmod is a date.
 *   2. accepted_lastmod >= every date the ACCEPTED bytes declare (the visible
 *      review stamp and JSON-LD dateModified), read from the frozen cache so a
 *      drifted working file cannot vouch for itself.
 *   3. the committed sitemap carries exactly accepted_lastmod for the route, so
 *      the override in build_site.js and the registry cannot disagree.
 * and, once per run, that the freeze rule itself still behaves: unchanged bytes
 * keep their date, changed bytes take the freeze date, and a declared on-page
 * date always wins over an older registry date. Proved positively and
 * negatively, so a regression in scripts/lib/frozen_pages.js fails here before
 * it can re-pin a single route.
 *
 * It hard-fails on zero FROZEN records: "0 routes checked" is not a pass.
 *
 * WHY EXISTING CHECKS DO NOT COVER IT. frozen-output-integrity proves the bytes
 * match the registry; page-release-law proves the route is in a sitemap; the
 * cadence gate reads the date but has no idea what the page itself says. None
 * of them compares the sitemap's date with the page's own.
 */
const fs = require('fs');
const path = require('path');
const { loadRegistry, acceptedHtmlForRoute, declaredDatesInHtml, acceptedLastmodFor, REGISTRY_REL } = require('../lib/frozen_pages');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/frozen-lastmod-currency.json');
const SITEMAPS = ['sitemaps/sitemap_all.xml', 'sitemap.xml'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The sitemap publishes /about and /insights/foo for the routes the registry
// knows as /about.html and /insights/foo.html; both sides compare on this key.
const routeKey = (route) => String(route || '').replace(/\.html$/, '').replace(/\/+$/, '') || '/';

function sitemapLastmods() {
  const out = new Map();
  for (const rel of SITEMAPS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const xml = fs.readFileSync(abs, 'utf8');
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = (m[1].match(/<loc>(.*?)<\/loc>/) || [])[1];
      const lm = (m[1].match(/<lastmod>(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
      if (!loc) continue;
      let route;
      try { route = new URL(loc).pathname; } catch { continue; }
      const key = routeKey(route);
      if (!out.has(key)) out.set(key, { lastmod: lm, sitemap: rel });
    }
  }
  return out;
}

// The rule under test, proved on synthetic inputs before any record is graded.
function proveFreezeRule() {
  const cases = [
    { name: 'unchanged bytes keep their date', input: { previousLastmod: '2026-09-10', previousHash: 'a', nextHash: 'a', freezeDate: '2026-09-21' }, expect: '2026-09-10' },
    { name: 'changed bytes take the freeze date', input: { previousLastmod: '2026-06-19', previousHash: 'a', nextHash: 'b', freezeDate: '2026-09-21T00:00:00.000Z' }, expect: '2026-09-21' },
    { name: 'a declared on-page date beats an older registry date', input: { pageLastmod: '2026-06-19', previousLastmod: '2026-06-19', previousHash: 'a', nextHash: 'a', declaredDates: ['2026-08-24', '2026-08-26'] }, expect: '2026-08-26' },
    { name: 'the date never goes backwards', input: { pageLastmod: '2026-06-19', previousLastmod: '2026-09-10', previousHash: 'a', nextHash: 'a', declaredDates: ['2026-08-26'], freezeDate: '2026-09-21' }, expect: '2026-09-10' },
    { name: 'first freeze with no previous takes the freeze date', input: { previousHash: '', nextHash: 'b', freezeDate: '2026-09-21' }, expect: '2026-09-21' },
    { name: 'garbage is not a date', input: { pageLastmod: 'soon', previousLastmod: '', previousHash: 'a', nextHash: 'a' }, expect: '' },
  ];
  const failures = [];
  for (const c of cases) {
    const got = acceptedLastmodFor(c.input);
    if (got !== c.expect) failures.push(`${c.name}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  }
  // Negative half: the old rule (copy page.lastmod over everything) must be
  // distinguishable from the new one on the exact input that caused the outage.
  const outage = acceptedLastmodFor({ pageLastmod: '2026-06-19', previousLastmod: '2026-06-19', previousHash: 'a', nextHash: 'a', declaredDates: ['2026-08-26'] });
  if (outage === '2026-06-19') failures.push('outage input still yields the admission date: the freeze rule has regressed to copying page.lastmod');
  return { cases: cases.length, failures };
}

const registry = loadRegistry();
const frozen = (registry.pages || []).filter((p) => p.state === 'FROZEN');
const sitemap = sitemapLastmods();
const rule = proveFreezeRule();

const errors = [...rule.failures.map((f) => `freeze_rule:${f}`)];
let checked = 0;
let notInSitemap = 0;
for (const record of frozen) {
  const route = record.route;
  const lm = String(record.accepted_lastmod || '');
  if (!DATE.test(lm)) { errors.push(`${route}:accepted_lastmod_not_a_date:${JSON.stringify(record.accepted_lastmod)}`); continue; }
  const html = acceptedHtmlForRoute(route, registry);
  if (html === null) { errors.push(`${route}:accepted_bytes_unreadable`); continue; }
  checked += 1;
  const declared = declaredDatesInHtml(html);
  const newest = declared.at(-1) || '';
  if (newest && newest > lm) errors.push(`${route}:sitemap_older_than_page:sitemap=${lm}:page=${newest}`);
  const sm = sitemap.get(routeKey(route));
  if (!sm) { notInSitemap += 1; continue; }
  if (sm.lastmod !== lm) errors.push(`${route}:sitemap_disagrees_with_registry:${sm.sitemap}=${sm.lastmod || '(none)'}:registry=${lm}`);
}
if (!frozen.length) errors.push(`${REGISTRY_REL} holds no FROZEN records, so nothing was checked`);
if (!sitemap.size) errors.push(`no sitemap URLs found in ${SITEMAPS.join(', ')}, so the registry cannot be compared with what is published`);

const status = errors.length ? 'FAIL' : 'PASS';
fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'frozen-lastmod-currency',
  authority: 'docs/PAGE_RELEASE_LAW.md',
  status,
  frozen_route_count: frozen.length,
  routes_checked: checked,
  routes_not_in_sitemap: notInSitemap,
  sitemap_url_count: sitemap.size,
  freeze_rule_cases: rule.cases,
  error_count: errors.length,
  errors: errors.slice(0, 200),
}, null, 2)}\n`);

if (status === 'FAIL') {
  console.error(`FROZEN LASTMOD CURRENCY FAIL: ${errors.length} problem(s) across ${checked} of ${frozen.length} frozen route(s)`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  if (errors.length > 20) console.error(`  ...and ${errors.length - 20} more (see ${path.relative(ROOT, EVIDENCE)})`);
  console.error('  remedy: node scripts/release/reconcile_frozen_lastmod.js, then npm run build so the sitemap is regenerated from the registry');
  process.exit(1);
}
console.log(`FROZEN LASTMOD CURRENCY PASS: ${checked} frozen route(s) carry a sitemap date no older than the page declares; sitemap agrees with the registry on ${checked - notInSitemap}; freeze rule proved on ${rule.cases} case(s) positively and negatively`);
