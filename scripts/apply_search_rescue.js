#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const rescue = require('./lib/search_rescue');
const frozen = require('./lib/frozen_pages');
const { shape, withOpeningDefinition } = require('./lib/rescue_page_shape');
const ROOT = path.resolve(__dirname, '..');
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const SITE = 'https://theindustryguides.com';

/**
 * The six verticals this umbrella routes to, and what each one actually covers.
 *
 * Search Readiness b9, c2 and j2, all measured on /insights/ 3 Nov 2026. The
 * rescue directory was a title, one 34-word paragraph and a list of links: 214
 * words of visible text, no BreadcrumbList, and not one link to a canonical
 * intake. A directory page that only links its own children tells a reader (and
 * an answer engine) nothing about what the site knows, and it ends the visit on
 * the wrong host - the canonical sites are where the lead is captured.
 *
 * `covers` is not decoration. It is the only place on the page that says which
 * question belongs to which vertical, which is what a directory is for. Each row
 * carries the canonical home AND the canonical intake, so a reader who already
 * knows their lane can act without reading a guide first.
 */
/**
 * Domains whose bare home URL has no sitewide link budget left.
 *
 * velocity-canonical-anchor-links caps any ONE memphisseniorcarehomes.com URL at
 * ten links across the served tree (its own g3 guard), and
 * https://memphisseniorcarehomes.com/ sits at exactly ten already: the homepage
 * card, the senior-living hub, and the eight senior guides, each of which fails
 * `directory_home_link_missing` without it. Adding a home link to both directory
 * hubs took it to twelve and turned the merge gate red - the guard working, not a
 * false alarm.
 *
 * So for a saturated domain these two pages name it in text and route the reader
 * through its intake instead, which is the link that captures the lead anyway.
 * The other five homes are nowhere near the cap and stay linked.
 */
const HOME_LINK_SATURATED = new Set(['memphisseniorcarehomes.com']);

const VERTICALS = [
  {
    label: 'Senior living and memory care',
    domain: 'memphisseniorcarehomes.com',
    covers: 'assisted living, memory care and the levels of care in between, what a residency agreement commits a family to, and how families pay for a place across Memphis, Germantown, Collierville, Bartlett and the nearby Tennessee and Mississippi towns.'
  },
  {
    label: 'Dentistry',
    domain: 'dentistryguides.com',
    covers: 'choosing a dentist and confirming they take your plan, how implants, bridges and dentures differ, when a root canal and an extraction are each on the table, and what a written quote should itemise before you agree to it.'
  },
  {
    label: 'Personal injury',
    domain: 'theaccidentguides.com',
    covers: 'what happens in the days after a crash, how a claim moves from report to settlement, the filing deadline in your state, how comparative negligence changes a number, and how a contingency fee is actually calculated.'
  },
  {
    label: 'Neuropsychological evaluations',
    domain: 'neuroevalguides.com',
    covers: 'what an ADHD, autism or memory evaluation includes, how it differs from a school IEP evaluation or a plain IQ test, how many sessions to expect, and what the hospital and private routes each cost.'
  },
  {
    label: 'Testosterone, hormone and hair-loss care',
    domain: 'hormonesivhair.com',
    covers: 'the symptoms and lab work behind a low-testosterone question, how telehealth and in-person programmes differ in monitoring, how TRT compares with clomiphene and enclomiphene, and the questions to ask before joining any programme.'
  },
  {
    label: 'USCIS medical exams',
    domain: 'uscisexam.com',
    covers: 'the Form I-693 exam itself, how to find a civil surgeon rather than a panel physician, which vaccination records to bring, and what separates a rejection from a denial or a request for evidence.'
  }
];

function directory(html, page, pages) {
  const entries = pages.filter(p => p.path !== page.path && (page.path !== '/insights/' || p.page_type === 'Insight'));
  if (!entries.length) throw new Error(`Search rescue: empty directory ${page.path}`);
  const isInsights = page.path === '/insights/';
  const title = isInsights ? 'Questions and practical decision guides' : 'Guide directory by topic';
  // The intake URL carries no query of its own, so install_served_head_contract.js
  // stamps the j2 utm attribution onto it (see stampIntakeTracking). Adding the
  // parameters here instead would make this page the one place they are hand-built.
  const coverage = VERTICALS.map(v => {
    const site = HOME_LINK_SATURATED.has(v.domain)
      ? `The canonical guide site is ${escapeHtml(v.domain)}; use its request form below.`
      : `The canonical guide site is <a href="https://${v.domain}/">${escapeHtml(v.domain)}</a>.`;
    return `<li><strong>${escapeHtml(v.label)}</strong> — ${escapeHtml(v.covers)} ${site}</li>`;
  }).join('');
  const intake = VERTICALS.map(v => `<li>${escapeHtml(v.label)}: <a href="https://${v.domain}/request-assistance/">ask ${escapeHtml(v.domain)} for local help</a></li>`).join('');
  const body = `<main id="main-content" class="container"><h1>${title}</h1>`
    + `<p>This directory lists the reviewed guides currently published by The Industry Guides. Choose a specific question or a topic hub. Each editorial guide links its evidence and the appropriate next step.</p>`
    + `<p>The Industry Guides is the umbrella publisher for six separate guide sites, one per field. A page here explains a decision in plain terms and shows the sources behind it; the canonical guide site for that field holds the full local workflow and the form you use to ask for help. If you already know which field your question sits in, skip the reading and go straight to that site below.</p>`
    + `<h2>Which guide answers my question?</h2><ul>${entries.map(p => `<li><a href="${escapeHtml(p.path.replace(/\.html$/, ''))}">${escapeHtml(p.primary_query || p.path)}</a></li>`).join('')}</ul>`
    + `<h2>What each field covers</h2><ul>${coverage}</ul>`
    + `<h2>Where to ask for local help</h2><p>Every request goes to the canonical guide site for that field, which is the only place that can answer about providers, availability and timing in your area.</p><ul>${intake}</ul>`
    + `<h2>How these guides are written</h2><p>Each guide states its answer first, then the facts it rests on, with the primary source named and dated next to the claim. Government and regulator pages come before trade bodies, and trade bodies before anything a provider publishes about itself. Nothing here is advice about your own case, no guide ranks or endorses a named provider, and no page quotes a price, an outcome or a timeline unless a cited source states it. Where a source has been updated since a guide was reviewed, the review date on the page is the date to trust.</p>`
    + `<p data-editorial-byline="true">By <a href="/about">The Industry Guides</a> · Updated <time data-review-date="true" datetime="2026-11-02">2026-11-02</time></p></main>`;
  const next = html.replace(/<main\b[^>]*>[\s\S]*?<\/main>/i, body);
  // c2: an inner page needs a BreadcrumbList. The rescue directory replaced the
  // built page's <main> but never its schema, so /insights/ and /atlas/ were the
  // two inner pages on the site with no breadcrumb at all.
  const crumbs = {
    '@type': 'BreadcrumbList',
    '@id': `${SITE}${page.path}#breadcrumbs`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'The Industry Guides', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: title, item: `${SITE}${page.path}` }
    ]
  };
  let crumbsPlaced = false;
  return next.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (all, start, raw, end) => {
    let data; try { data = JSON.parse(raw); } catch { return all; }
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if ([].concat(node['@type'] || []).includes('ItemList')) node.itemListElement = entries.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: 'https://theindustryguides.com' + p.path.replace(/\.html$/, ''), name: p.primary_query || p.path }));
      Object.values(node).forEach(v => Array.isArray(v) ? v.forEach(visit) : visit(v));
    }
    visit(data);
    // One breadcrumb, in the graph that already describes this page. Appending to
    // every ld+json block would ship the node twice and make the two copies drift.
    if (!crumbsPlaced && Array.isArray(data['@graph'])) {
      const has = node => [].concat((node || {})['@type'] || []).includes('BreadcrumbList');
      if (!data['@graph'].some(has)) data['@graph'].push(crumbs);
      crumbsPlaced = true;
    }
    return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
  });
}
function apply() {
  const admission = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content/page_admission_registry.json'), 'utf8'));
  const sources = new Map();
  for (const file of ['content/_live/pages.json', 'data/page_families/velocity_page_specs.json']) {
    for (const row of JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).pages) sources.set(row.slug || row.path, row);
  }
  const candidates = [];
  for (const page of admission.pages) {
    if (!rescue.allowed(page.path)) throw new Error(`Search rescue: unreviewed admission ${page.path}`);
    const file = path.join(ROOT, frozen.routeToRenderedRel(page.path));
    if (!fs.existsSync(file)) throw new Error(`Search rescue: missing survivor ${page.path}`);
    const current = fs.readFileSync(file, 'utf8');
    const source = sources.get(page.path);
    const description = source?.description || (current.match(/<meta\b[^>]*name="description"[^>]*content="([^"]+)"/) || [])[1];
    const published = source?.date_published || (current.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})[^\"]*"/) || [])[1];
    const isContent = page.vertical !== 'global' || page.page_type === 'Insight';
    const html = ['/insights/', '/atlas/'].includes(page.path) ? rescue.resolveLinks(directory(current, page, admission.pages)) : isContent ? shape(current, { route: page.path, description: description || page.primary_query, date: '2026-11-02', published, title: source?.title || page.primary_query }) : rescue.resolveLinks(withOpeningDefinition(current, page.path));
    candidates.push({ file, html, route: page.path });
  }
  // Whole-set preflight: no partial content update if a survivor is missing.
  for (const row of candidates) fs.writeFileSync(row.file, row.html);
  for (const row of candidates) frozen.freezeRoute(row.route);
  console.log(`Search rescue page shape: ${candidates.length} survivors; retained source facts and FAQ.`);
}
module.exports = { apply, directory, VERTICALS, HOME_LINK_SATURATED };
if (require.main === module) { rescue.prepare(); apply(); }
