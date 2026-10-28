#!/usr/bin/env node
'use strict';
/**
 * The served tree keeps the Search Readiness head and disclosure contract.
 *
 * Reads dist/ - the bytes the edge actually gets, after the publish-time passes -
 * and holds every page to the bands and tags the generators and
 * scripts/install_served_head_contract.js are supposed to have produced. The
 * validator and the installer share scripts/lib/served_head_contract.js, so the
 * rule has one definition and the two cannot disagree.
 *
 * Measured in dist/ on 2026-10-25, before the contract existed:
 *   414 titles over 65         1,327 descriptions over 160
 *   1,261 with no og:title     1,262 without twitter:card summary_large_image
 *   2,137 with no ownership line   2,137 with no Organization logo
 *
 * Severity is STRONG_WARNING by owner rule (no content blockers, 2026-09-23): a
 * head value is a search-quality defect, not a broken route. It still exits 1 on
 * a breach, and it refuses to pass having graded nothing (Rule 0).
 *
 * sameAs is reported, never failed: data/network/network_identity_registry.json
 * prohibits unverified sameAs URLs and data/authority/verified_same_as_registry.json
 * holds no records, so no page can carry one honestly yet. The count is printed
 * every run so the gap stays visible, and this becomes a failure the day a
 * verified profile is registered.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'artifacts', 'validation', 'served-head-contract.json');
const c = require('../lib/served_head_contract');
const { portfolioHosts } = require('../install_served_head_contract');
const { conversionPage, selfTest: claritySelfTest } = require('../lib/clarity_page');
const { fitTitle } = require('../lib/search_snippet');

// Measured 2026-10-25: 2,137 pages in dist/. The floor is far below that and far
// above what a truncated or unbuilt tree exposes.
const MIN_PAGES = 1500;

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const DIST = path.resolve(ROOT, process.env.PAGES_OUT_DIR || 'dist');
const stops = [];
const concentrationExempt = [];
if (!fs.existsSync(DIST)) stops.push(`${path.relative(ROOT, DIST)}/ does not exist; nothing was graded. Run npm run build first.`);

const errors = [];
// Different subjects and vertical qualifiers must survive the brand budget.
for (const pair of [
  ['What mistakes cause problems with dental insurance verification?', 'What mistakes cause problems with neuropsych evaluation costs?'],
  ['How to compare pricing without walking into the wrong fit — Dentistry: Cost & Insurance | Insight', 'How to compare pricing without walking into the wrong fit — TRT: Cost & Insurance | Insight'],
]) {
  if (fitTitle(pair[0]) === fitTitle(pair[1])) errors.push({ page: 'fixture', issue: 'title_topic_collision', detail: pair.join(' / ') });
}
const clarityProof = claritySelfTest();
for (const detail of clarityProof.errors) errors.push({ page: 'fixture', issue: 'clarity_regression', detail });
for (const original of [
  'Maryland Medicaid Dental Coverage Guide',
  'What Records Help Before An Autism Evaluation | Insight',
  'Is It Too Late To Switch Lawyers Before Settlement Or Trial',
  'Telehealth TRT Rules in Ohio | The Industry Guides',
  'A very long topic with many words that previously removed the site brand from the end | The Industry Guides',
  'The Industry Guides',
]) {
  const fitted = fitTitle(original);
  if (!fitted.includes(c.SITE_NAME) || fitted.length < c.MIN_TITLE_CHARS || fitted.length > c.MAX_TITLE_CHARS || fitTitle(fitted) !== fitted) {
    errors.push({ page: 'fixture', issue: 'title_brand_regression', detail: original });
  }
}

const hosts = new Set(portfolioHosts());
let graded = 0;
let sameAsMissing = 0;
let intakePages = 0;
let intakeTracked = 0;
const howToUnprovable = [];
const capExempt = [];
const governed = c.governedRoutes();
const pages = stops.length ? [] : walk(DIST);

for (const abs of pages) {
  const rel = path.relative(DIST, abs).replace(/\\/g, '/');
  // 404.html is not an indexable route and carries no canonical.
  if (rel === '404.html') continue;
  const html = fs.readFileSync(abs, 'utf8');
  if (!/<html/i.test(html)) continue;
  const route = rel === 'index.html' ? '/' : `/${rel.replace(/\/index\.html$/, '').replace(/\.html$/, '')}`;
  graded += 1;
  const add = (issue, detail) => errors.push({ page: `/${rel}`, issue, detail });

  // b1: title 30-65.
  const title = c.titleOf(html);
  if (!title) add('title_missing', 'no <title>');
  else if (title.length < c.MIN_TITLE_CHARS) add('title_below_floor', `${title.length} < ${c.MIN_TITLE_CHARS}: "${title}"`);
  else if (title.length > c.MAX_TITLE_CHARS) add('title_over_ceiling', `${title.length} > ${c.MAX_TITLE_CHARS}: "${title}"`);

  // b10 + e9: publication identity survives trimming; recording is scoped.
  if (title && !title.includes(c.SITE_NAME)) add('title_brand_missing', title);
  if (/data-clarity-loader|clarity\.ms\/tag\//i.test(html) && !conversionPage(html)) add('clarity_without_conversion', 'no form or purchase link');
  if (rel === 'index.html') {
    if (!/<form\b[^>]*data-provider-start\b/.test(html)) add('provider_start_missing', 'homepage has no provider routing form');
    if (!/data-clarity-loader/.test(html)) add('clarity_missing_on_conversion', 'homepage provider form has no consent-gated loader');
    for (const marker of ['data-analytics-allow', 'data-analytics-stop', 'data-clarity-mask']) {
      if (!html.includes(marker)) add('clarity_consent_missing', marker);
    }
  }

  // b2: exactly one description, 120-160.
  const descTags = (html.match(/<meta\b[^>]*>/gi) || []).filter((t) => /\bname=(["'])description\1/i.test(t));
  if (descTags.length !== 1) add('description_count', `${descTags.length} meta description tag(s)`);
  else {
    const d = c.descOf(html);
    if (d.length < c.MIN_DESCRIPTION_CHARS) add('description_below_floor', `${d.length} < ${c.MIN_DESCRIPTION_CHARS}: "${d}"`);
    else if (d.length > c.MAX_DESCRIPTION_CHARS) add('description_over_ceiling', `${d.length} > ${c.MAX_DESCRIPTION_CHARS}`);
  }

  // b6: the complete social set, on our own host, with a large card.
  for (const k of ['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name', 'og:image']) {
    if (!new RegExp(`property=(["'])${k}\\1`).test(html)) add('social_tag_missing', k);
  }
  if (!/name=(["'])twitter:card\1[^>]*content=(["'])summary_large_image\2/.test(html)) add('twitter_card', 'not summary_large_image');

  // c1: the first Organization-shaped node carries name, url and logo.
  const ORG = /^(Organization|LocalBusiness|Corporation|NewsMediaOrganization|ProfessionalService)$/;
  let org = null;
  for (const m of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { add('jsonld_unparseable', 'a JSON-LD block does not parse'); continue; }
    const look = (n) => {
      if (Array.isArray(n)) return n.forEach(look);
      if (!n || typeof n !== 'object') return;
      if (!org && [].concat(n['@type'] || []).some((t) => ORG.test(String(t)))) org = n;
      Object.values(n).forEach(look);
    };
    look(data);
    if (org) break;
  }
  if (!org) add('organization_missing', 'no Organization node in JSON-LD');
  else {
    for (const k of ['name', 'url', 'logo']) if (!org[k]) add('organization_field', `Organization lacks ${k}`);
    if (!org.sameAs || (Array.isArray(org.sameAs) && !org.sameAs.length)) sameAsMissing += 1;
  }

  // g4: the common-ownership line on a page that links a commonly owned site.
  const outbound = [...html.matchAll(/<a\b[^>]*\bhref=(["'])([^"']+)\1/gi)].map((m) => m[2]);
  const linksPortfolio = outbound.some((h) => {
    try { return hosts.has(new URL(h, c.SITE_BASE).hostname.replace(/^www\./, '')); } catch { return false; }
  });
  if (linksPortfolio && !html.includes(c.OWNERSHIP_MARKER)) add('ownership_disclosure_missing', 'links a commonly owned site with no disclosure');

  // g3: no portfolio domain over a quarter of a page's outbound links, and no
  // single target URL linked twice from the same page.
  const ext = [];
  for (const h of outbound) {
    let u;
    try { u = new URL(h, c.SITE_BASE); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const host = u.hostname.replace(/^www\./, '');
    if (host === c.SITE_HOST) continue;
    ext.push({ host, key: `${u.origin}${u.pathname.replace(/\/+$/, '')}` });
  }
  // The cap reaches every served route now. It used to reach only /insights/ and
  // /medium-articles/ pages that no routing contract governed - 206 of 1,068
  // graded pages - and the breach it exists to catch lived on the other 862.
  //
  // Two exemptions remain, each because another HARD_FAIL contract pins the
  // exact links and each named here rather than hidden:
  //   - the homepage and the eight senior-living guides (isCappableRoute);
  //   - the two dentistry safety-net guides, which velocity-canonical-anchor-links
  //     pins to SIX DISTINCT metro anchors on one canonical host. Six different
  //     destinations is what that page is FOR, so the concentration clause cannot
  //     apply to it; the per-URL clause still does, and still fails if one metro
  //     is linked twice.
  if (!c.isCappableRoute(route, governed)) {
    capExempt.push(`/${rel}`);
  } else {
    const multiTarget = c.isMultiTargetRoute(route);
    if (ext.length >= 4 && !multiTarget) {
      const by = {};
      for (const e of ext) by[e.host] = (by[e.host] || 0) + 1;
      for (const [host, n] of Object.entries(by)) {
        if (hosts.has(host) && n / ext.length > 0.25) add('link_concentration', `${host} has ${n} of ${ext.length} outbound links`);
      }
    }
    if (multiTarget) {
      concentrationExempt.push(`/${rel}`);
      const perKey = {};
      for (const e of ext) if (hosts.has(e.host)) perKey[e.key] = (perKey[e.key] || 0) + 1;
      for (const [k, n] of Object.entries(perKey)) if (n > 1) add('repeated_portfolio_url', `${k} linked ${n} times on one page; the cap is one per destination here`);
    } else {
      const perHost = {};
      for (const e of ext) if (hosts.has(e.host)) perHost[e.host] = (perHost[e.host] || 0) + 1;
      for (const [h, n] of Object.entries(perHost)) if (n > 1) add('repeated_portfolio_link', `${h} linked ${n} times on one page; the cap is one`);
    }
  }

  // j2: a companion piece that mentions a canonical intake must still LINK one,
  // and that link must be attributable.
  //
  // The link cap turned every intake href on seven insight pages into plain text
  // because the guide link happened to come first, so the piece named the lead
  // surface and gave the reader no way to reach it. Graded on the served bytes,
  // which is where the cap runs. The homepage is excluded: umbrella-homepage-shape
  // matches each card's intake href as a literal string and owns that shape.
  if (route !== '/' && /request-assistance/.test(html)) {
    intakePages += 1;
    const tracked = outbound.some((h) => {
      let u;
      try { u = new URL(h, c.SITE_BASE); } catch { return false; }
      return hosts.has(u.hostname.replace(/^www\./, '')) && c.INTAKE_PATH.test(u.pathname) && /(^|&)(utm_|ref=|src=|source=)/.test(u.search.slice(1));
    });
    if (tracked) intakeTracked += 1;
    else add('intake_not_linked_or_untracked', 'names a canonical intake but carries no <a> to one with tracking parameters');
  }

  // d2: a how-to carries an ordered list; an "X vs Y" carries a table.
  //
  // A how-to with no <ol> is a failure only where the steps are PROVABLE - the
  // page's own HowTo schema names three or more - because that is a generator
  // that claimed steps and did not print them. One page of the 270 how-to pages
  // is a narrative essay whose headings are not a procedure
  // (/medium-articles/dentistry/cosmetic-dentistry/, "Cosmetic Dentistry: How to
  // Choose the Right Treatment"); inventing steps for it would put words on the
  // page that its own content does not support, so it is counted and named here
  // instead, and becomes a failure the moment that article gains real steps.
  if (/\bhow to\b/i.test(title) && !/<ol\b/i.test(html)) {
    if (c.howToStepsFrom(html).length >= 3) add('howto_without_steps', 'title says how to and the page proves steps in its own HowTo schema; no <ol>');
    else howToUnprovable.push(`/${rel}`);
  }
  if (/\bvs\.?\b|\bversus\b/i.test(title) && !/<table\b/i.test(html)) add('comparison_without_table', 'title says vs; no <table>');
}

// Rule 0 for j2: a tree where no page names an intake would pass the clause above
// by inspecting nothing. Measured 2026-10-25: 1,969 of 2,137 served pages do.
const MIN_INTAKE_PAGES = 800;
if (!stops.length && intakePages < MIN_INTAKE_PAGES) {
  stops.push(`only ${intakePages} served page(s) name a canonical intake; expected at least ${MIN_INTAKE_PAGES}. The intake routing clause inspected nothing.`);
}
if (!stops.length && graded < MIN_PAGES) {
  stops.push(`only ${graded} page(s) graded; expected at least ${MIN_PAGES}. The tree is unbuilt or truncated, so nothing was proven.`);
}

const byIssue = {};
for (const e of errors) byIssue[e.issue] = (byIssue[e.issue] || 0) + 1;
const report = {
  validator: 'served-head-contract',
  ok: !errors.length && !stops.length,
  graded_pages: graded,
  intake_pages: intakePages,
  intake_pages_tracked: intakeTracked,
  bands: {
    title: [c.MIN_TITLE_CHARS, c.MAX_TITLE_CHARS],
    description: [c.MIN_DESCRIPTION_CHARS, c.MAX_DESCRIPTION_CHARS]
  },
  portfolio_hosts: [...hosts],
  reported_not_failed: {
    organization_sameAs_missing: sameAsMissing,
    howto_without_provable_steps: howToUnprovable.length,
    howto_without_provable_steps_pages: howToUnprovable,
    link_cap_exempt: capExempt.length,
    link_cap_exempt_pages: capExempt.slice(0, 40),
    link_cap_exempt_reason: 'The cap reaches every served route. Exempt: the homepage (umbrella-homepage-shape matches its six cards literally) and the eight senior-living guides (four intake links each is the owner\'s own rule). Before 2026-10-26 the cap reached only /insights/ and /medium-articles/ pages no routing contract governed, which was 206 of 1,068 graded pages, and 862 pages carried a portfolio host over a quarter of their outbound links - four copies of ONE intake URL per page, satisfying a count that asked for four links and got four of the same one. The count is replaced by a stricter served-page pin in velocity-canonical-anchor-links (exactly one followed, attributed outbound intake anchor, and every capped CTA must reach it in-page).',
    concentration_exempt: concentrationExempt,
    concentration_exempt_reason: 'The two dentistry safety-net guides are pinned by velocity-canonical-anchor-links to six DISTINCT metro anchors on dentistryguides.com - a reader in Houston needs the Houston one - so a quarter-of-outbound-links rule cannot apply to a page whose purpose is that directory. The per-URL clause still applies to them and still fails if one metro is linked twice.',
  },
  error_count: errors.length,
  errors_by_issue: byIssue,
  stops,
  errors: errors.slice(0, 400)
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

if (stops.length) {
  console.error('SERVED HEAD CONTRACT: STOP');
  for (const s of stops) console.error(`- ${s}`);
  process.exit(1);
}
if (errors.length) {
  console.error(`SERVED HEAD CONTRACT: ${errors.length} breach(es) across ${graded} served pages.`);
  for (const [k, v] of Object.entries(byIssue)) console.error(`- ${k}: ${v}`);
  for (const e of errors.slice(0, 25)) console.error(`  ${e.page}: ${e.issue} (${e.detail})`);
  console.error('Fix the generator or scripts/lib/served_head_contract.js, never the rendered page.');
  process.exit(1);
}
console.log(`SERVED HEAD CONTRACT PASS: ${graded} served pages; title ${c.MIN_TITLE_CHARS}-${c.MAX_TITLE_CHARS}, description ${c.MIN_DESCRIPTION_CHARS}-${c.MAX_DESCRIPTION_CHARS}, complete social set, Organization with logo, ownership disclosure where a commonly owned site is linked, no portfolio domain over a quarter of a page's outbound links (reported, not failed: ${sameAsMissing} page(s) with no verified Organization sameAs, ${howToUnprovable.length} how-to page(s) whose own content proves no steps, ${capExempt.length} page(s) exempt from the link cap by the canonical-anchor contract); ${intakeTracked}/${intakePages} page(s) naming a canonical intake carry a tracked link to one.`);
