#!/usr/bin/env node
'use strict';
/**
 * Velocity guides that route a local query class to the canonical site's
 * verified metro sections must actually link to those sections.
 *
 * 2026-10-09: dentistryguides.com published free/low-cost and dental-school
 * clinic sections for six metros (local-guides-generator #54). The Velocity
 * guides for "free dental clinic near me" and "dental school clinic near me"
 * exist to send that demand to those anchors. A guide that renders without the
 * links, links off the vertical's canonical domain, drops the #anchor, or
 * loses a metro is a broken public route: the page claims a verified local
 * list and does not lead to it.
 *
 * Reads the durable source (data/page_families/velocity_page_specs.json) and
 * the rendered page, so a renderer regression and a source regression both fail.
 * Hard-fails on zero governed pages: an empty set means the guard reached nothing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SPECS = 'data/page_families/velocity_page_specs.json';
const CANON_MAP = 'content/_shared/canonical_map.json';
const REPORT = 'artifacts/validation/velocity-canonical-anchor-links.json';
const METROS = ['atlanta-ga', 'chicago-il', 'dallas-tx', 'houston-tx', 'los-angeles-ca', 'miami-fl'];
// Pinned: the two safety-net guides and the anchor each must reach in all six metros.
const REQUIRED = {
  '/dentistry/free-dental-clinics/': 'free-low-cost-dental-clinics',
  '/dentistry/dental-school-clinics/': 'dental-school-clinics'
};

// Senior-living (2026-10-13): the eight Memphis Tri-State guides route to
// memphisseniorcarehomes.com. The owner's rule, in priority order: (1) drive
// the reader to the canonical intake - at least four /request-assistance/
// links carrying the routing query, plus the directory home link; (2) link
// the canonical guide that matches the piece's topic, and a city page; (3) a
// canonical link inside the first 150 words; (4) a closing CTA to the canonical
// site. Followed links only. Their city links are city PAGES (no #anchor), so
// they are checked against the pinned city list below instead of the anchor rule.
const SENIOR_FAMILY = 'SENIOR-LIVING-GUIDES';
const SENIOR_ORIGIN = 'https://memphisseniorcarehomes.com';
// City routes exactly as the canonical site builds them (state-suffixed slugs).
const SENIOR_CITIES = ['memphis-tn', 'east-memphis-tn', 'germantown-tn', 'collierville-tn', 'bartlett-tn', 'cordova-tn', 'arlington-tn', 'lakeland-tn', 'millington-tn', 'southaven-ms', 'olive-branch-ms', 'horn-lake-ms', 'hernando-ms', 'west-memphis-ar', 'marion-ar'];
const SENIOR_ROUTES_REL = 'data/contracts/senior_living_canonical_routes.json';
const SENIOR_FANOUT_REL = 'data/queries/senior_living_fanout_compiled.json';
const SENIOR_LOCALITIES = ['memphis', 'east memphis', 'midtown', 'downtown', 'germantown', 'collierville', 'bartlett', 'cordova', 'arlington', 'lakeland', 'millington', 'southaven', 'olive branch', 'horn lake', 'hernando', 'west memphis', 'marion'];
const MIN_COMPILED_QUERIES = 400;
const MIN_RENDERED_QUESTIONS = 20;
const MAX_LINKS_PER_URL_SITEWIDE = 10;
const MAX_OUTBOUND_SHARE = 0.25;
const MIN_SOURCES_PER_PIECE = 3;
const SENIOR_GUIDES = ['how-to-choose-a-senior-care-home-memphis', 'levels-of-care-tennessee', 'assisted-living-cost-memphis', 'how-families-pay-for-assisted-living', 'memory-care-when-is-it-time', 'activities-of-daily-living-care-levels', 'questions-to-ask-on-a-tour', 'tennessee-assisted-living-inspection-records', 'residency-agreement-fees-and-rules', 'hospital-discharge-to-assisted-living-memphis', 'when-a-parent-refuses-to-move', 'when-the-money-runs-out-tenncare-choices'];
// Pinned: each guide and the canonical guide that matches its topic.
const SENIOR_REQUIRED = {
  '/senior-living/assisted-living-vs-memory-care-vs-senior-care-home-tennessee/': 'levels-of-care-tennessee',
  '/senior-living/assisted-living-cost-memphis-germantown-collierville-bartlett-southaven/': 'assisted-living-cost-memphis',
  '/senior-living/moving-a-parent-from-memphis-to-olive-branch-or-southaven/': 'residency-agreement-fees-and-rules',
  '/senior-living/tenncare-choices-vs-mississippi-medicaid-vs-private-pay/': 'how-families-pay-for-assisted-living',
  '/senior-living/west-tennessee-vs-east-arkansas-senior-living-licensing/': 'levels-of-care-tennessee',
  '/senior-living/va-aid-and-attendance-assisted-living-tennessee/': 'how-families-pay-for-assisted-living',
  '/senior-living/hospital-discharge-to-assisted-living-memphis/': 'hospital-discharge-to-assisted-living-memphis',
  '/senior-living/private-pay-vs-medicaid-beds-memphis/': 'when-the-money-runs-out-tenncare-choices'
};
const SENIOR_INTAKE_PARAMS = { pt: 'Senior Living Community', intent: 'direct_match', button: 'primary_cta', vertical: 'senior-living', page_kind: 'velocity', market: 'velocity' };
const MIN_INTAKE_LINKS = 4;
// Search Readiness g3, 2026-10-26. The senior-living family keeps MIN_INTAKE_LINKS
// (four is the owner's own rule, stated in priority order above). The other 845
// matched pieces do not, and the count was never what mattered: /trt/states/oregon/
// trt-legality/ satisfied it with FIVE identical anchors to one URL, which is the
// footprint g3 names and no extra route for a reader. Measured on the built tree,
// 862 of 1,068 graded pages had a portfolio host over a quarter of their outbound
// links because of it.
//
// What replaces the count is stricter, not looser - it asserts properties the
// count never did:
//   1. The SERVED page carries EXACTLY ONE followed outbound anchor to the
//      canonical intake. Not "at least": a second one is now a failure, because
//      the second one is the defect.
//   2. That anchor carries the utm attribution (j2), so the canonical side can
//      tell a working route from a dead one.
//   3. It is the jump target for every CTA capped below it, so no capped CTA is
//      a dead button - the count permitted five live buttons and would equally
//      have permitted five dead ones.
// The COMMITTED tree is not capped (the cap is a publish-time pass over dist/),
// so it is held to "at least one" - the floor the served page then sharpens.
const SERVED_INTAKE_ANCHORS = 1;
const FIRST_WORDS = 150;

const errors = [];
const read = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing required file ${rel}`);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
};
const verticalKey = (v) => String(v || '').replace('-', '_') === 'personal_injury' ? 'personal_injury' : String(v || '');
const renderedFile = (dir, slug) => path.join(dir, slug.replace(/^\//, ''), 'index.html');
const escapeAttr = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;');

let specs, canon;
try { specs = read(SPECS); canon = read(CANON_MAP).canon || {}; } catch (e) { errors.push(e.message); }

const governed = (specs?.pages || []).filter((p) => Array.isArray(p.canonical_anchor_links) && p.canonical_anchor_links.length);
if (specs && !governed.length) errors.push('zero_governed_pages: no Velocity spec page carries canonical_anchor_links; the guard reaches nothing');

const bySlug = new Map((specs?.pages || []).map((p) => [p.slug, p]));
for (const [slug, anchor] of Object.entries(REQUIRED)) {
  const page = bySlug.get(slug);
  if (!page) { errors.push(`${slug}:required_guide_missing_from_specs`); continue; }
  const urls = new Set((page.canonical_anchor_links || []).map((l) => l.url));
  for (const metro of METROS) {
    const want = `https://dentistryguides.com/${metro}/#${anchor}`;
    if (!urls.has(want)) errors.push(`${slug}:missing_required_anchor:${want}`);
  }
  if (!/request-assistance\/$/.test(page.canonical_target_url || '')) errors.push(`${slug}:lead_path_missing:canonical_target_url must end /request-assistance/`);
}

const distDir = path.join(ROOT, 'dist');
const outputs = [ROOT, ...(fs.existsSync(distDir) ? [distDir] : [])];
let linksChecked = 0;
for (const page of governed) {
  const home = canon[verticalKey(page.vertical)]?.home;
  if (!home) { errors.push(`${page.slug}:no_canonical_domain_for_vertical:${page.vertical}`); continue; }
  const origin = new URL(home).origin;
  const seen = new Set();
  for (const link of page.canonical_anchor_links) {
    let u;
    try { u = new URL(link.url); } catch { errors.push(`${page.slug}:unparseable_url:${link.url}`); continue; }
    if (u.origin !== origin) errors.push(`${page.slug}:off_canonical_domain:${link.url} (expected ${origin})`);
    if (page.page_family === SENIOR_FAMILY) {
      const city = u.pathname.replace(/^\/|\/$/g, '');
      if (!SENIOR_CITIES.includes(city) || u.hash || u.search) errors.push(`${page.slug}:not_a_pinned_city_page:${link.url}`);
    } else if (!u.hash || u.hash.length < 2) errors.push(`${page.slug}:anchor_missing:${link.url}`);
    if (/request-assistance/.test(u.pathname)) errors.push(`${page.slug}:anchor_link_is_lead_path:${link.url}`);
    if (seen.has(link.url)) errors.push(`${page.slug}:duplicate_anchor_link:${link.url}`);
    seen.add(link.url);
    if (!String(link.label || '').trim()) errors.push(`${page.slug}:empty_label:${link.url}`);
  }
  for (const dir of outputs) {
    const file = renderedFile(dir, page.slug);
    const rel = path.relative(ROOT, file);
    if (!fs.existsSync(file)) { errors.push(`${page.slug}:rendered_page_missing:${rel}`); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const card = html.match(/<section class="card canonical-anchor-links" data-canonical-anchor-links="(\d+)">([\s\S]*?)<\/section>/);
    if (!card) { errors.push(`${page.slug}:rendered_anchor_card_missing:${rel}`); continue; }
    if (Number(card[1]) !== page.canonical_anchor_links.length) errors.push(`${page.slug}:rendered_anchor_count_mismatch:${card[1]}!=${page.canonical_anchor_links.length}:${rel}`);
    for (const link of page.canonical_anchor_links) {
      if (!card[2].includes(`href="${escapeAttr(link.url)}"`)) errors.push(`${page.slug}:rendered_anchor_link_missing:${link.url}:${rel}`);
      else linksChecked++;
    }
  }
}

// ---- senior-living routing contract ------------------------------------------
const seniorPages = (specs?.pages || []).filter((p) => p.page_family === SENIOR_FAMILY);
if (specs && !seniorPages.length) errors.push('senior_living:zero_governed_pages');
for (const slug of Object.keys(SENIOR_REQUIRED)) if (specs && !bySlug.has(slug)) errors.push(`${slug}:required_senior_guide_missing_from_specs`);
let seniorIntakeLinks = 0;
// ---- compiled query fan-out: query -> piece -> canonical route ----------------
let compiled = null; let routeList = null;
try { compiled = read(SENIOR_FANOUT_REL); routeList = new Set(read(SENIOR_ROUTES_REL).routes || []); } catch (e) { errors.push(`senior_fanout:${e.message}`); }
const perPieceRendered = {};
if (compiled && routeList) {
  const qs = compiled.queries || [];
  if (qs.length < MIN_COMPILED_QUERIES) errors.push(`senior_fanout:compiled_queries_below_${MIN_COMPILED_QUERIES}:${qs.length}`);
  if (!routeList.size) errors.push('senior_fanout:canonical_route_list_empty');
  const off = qs.filter((q) => !routeList.has(q.canonical_route));
  if (off.length) errors.push(`senior_fanout:${off.length}_queries_route_outside_canonical_route_list:e.g. ${off[0].query} -> ${off[0].canonical_route}`);
  for (const l of SENIOR_LOCALITIES) if (!qs.some((q) => q.locality === l)) errors.push(`senior_fanout:locality_without_queries:${l}`);
  for (const slug of Object.keys(SENIOR_REQUIRED)) if (!qs.some((q) => q.velocity_piece === slug)) errors.push(`senior_fanout:piece_without_queries:${slug}`);
  const unknownPiece = qs.filter((q) => !SENIOR_REQUIRED[q.velocity_piece]);
  if (unknownPiece.length) errors.push(`senior_fanout:${unknownPiece.length}_queries_assigned_to_no_pinned_piece`);
}
const renderedLocalities = new Set();
const decode = (t) => t.replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z#0-9]+;/gi, ' ');
const textWords = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean);
for (const page of seniorPages) {
  const want = SENIOR_REQUIRED[page.slug];
  if (!want) { errors.push(`${page.slug}:senior_guide_not_pinned (add it to SENIOR_REQUIRED with its topic guide)`); continue; }
  let intake;
  try { intake = new URL(page.provider_destination_url); } catch { errors.push(`${page.slug}:provider_destination_url_missing`); continue; }
  if (intake.origin !== SENIOR_ORIGIN || intake.pathname !== '/request-assistance/') errors.push(`${page.slug}:provider_destination_not_canonical_intake:${page.provider_destination_url}`);
  for (const [k, v] of Object.entries(SENIOR_INTAKE_PARAMS)) if (intake.searchParams.get(k) !== v) errors.push(`${page.slug}:intake_param_${k}_wrong:${intake.searchParams.get(k)}`);
  if (intake.searchParams.get('src') !== page.slug) errors.push(`${page.slug}:intake_src_not_page_path`);
  if (intake.searchParams.get('page_slug') !== page.slug.replace(/\/$/, '').split('/').pop()) errors.push(`${page.slug}:intake_page_slug_wrong`);
  // D3: at least three registered primary or survey sources behind the piece's facts.
  if ((page.source_records || []).length < MIN_SOURCES_PER_PIECE) errors.push(`${page.slug}:fewer_than_${MIN_SOURCES_PER_PIECE}_source_records`);
  if (!/\b20\d\d\b/.test(page.dated_primary_fact || '')) errors.push(`${page.slug}:dated_primary_fact_without_a_date`);
  for (const dir of outputs) {
    const file = renderedFile(dir, page.slug);
    const rel = path.relative(ROOT, file);
    if (!fs.existsSync(file)) { errors.push(`${page.slug}:rendered_page_missing:${rel}`); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const anchors = [...html.matchAll(/<a\s+([^>]*?)href="(https:\/\/memphisseniorcarehomes\.com[^"]*)"([^>]*)>/g)].map((m) => ({ attrs: `${m[1]} ${m[3]}`, href: m[2].replaceAll('&amp;', '&') }));
    for (const a of anchors) if (/rel="[^"]*(nofollow|sponsored|ugc)/.test(a.attrs)) errors.push(`${page.slug}:canonical_link_not_followed:${a.href}:${rel}`);
    const intakeLinks = anchors.filter((a) => { try { const u = new URL(a.href); return u.pathname === '/request-assistance/' && u.searchParams.get('vertical') === 'senior-living' && u.searchParams.get('src') === page.slug; } catch { return false; } });
    if (intakeLinks.length < MIN_INTAKE_LINKS) errors.push(`${page.slug}:intake_links_below_${MIN_INTAKE_LINKS}:${intakeLinks.length}:${rel}`);
    seniorIntakeLinks += intakeLinks.length;
    if (!anchors.some((a) => a.href === `${SENIOR_ORIGIN}/`)) errors.push(`${page.slug}:directory_home_link_missing:${rel}`);
    const guideLinks = new Set(anchors.map((a) => (/^https:\/\/memphisseniorcarehomes\.com\/guides\/([a-z0-9-]+)\/$/.exec(a.href) || [])[1]).filter(Boolean));
    for (const g of guideLinks) if (!SENIOR_GUIDES.includes(g)) errors.push(`${page.slug}:unknown_canonical_guide:${g}:${rel}`);
    if (!guideLinks.has(want)) errors.push(`${page.slug}:topic_guide_link_missing:/guides/${want}/:${rel}`);
    const cityLinks = anchors.filter((a) => SENIOR_CITIES.some((c) => a.href === `${SENIOR_ORIGIN}/${c}/`));
    if (!cityLinks.length) errors.push(`${page.slug}:city_page_link_missing:${rel}`);
    const article = html.indexOf('<article id="guide-content">');
    if (article < 0) { errors.push(`${page.slug}:article_missing:${rel}`); continue; }
    const body = html.slice(article);
    const first = body.search(/<a\s[^>]*href="https:\/\/memphisseniorcarehomes\.com\/(guides\/[a-z0-9-]+|[a-z-]+)\/"/);
    if (first < 0 || textWords(body.slice(0, first)).length > FIRST_WORDS) errors.push(`${page.slug}:no_canonical_guide_or_city_link_in_first_${FIRST_WORDS}_words:${rel}`);
    const closing = body.match(/<section class="card provider-cta closing-cta"[^>]*data-closing-cta="true">([\s\S]*?)<\/section>/);
    if (!closing) errors.push(`${page.slug}:closing_cta_missing:${rel}`);
    else {
      if (!/href="https:\/\/memphisseniorcarehomes\.com\/request-assistance\/\?/.test(closing[1])) errors.push(`${page.slug}:closing_cta_not_to_intake:${rel}`);
      if (!closing[1].includes(`href="${SENIOR_ORIGIN}/"`)) errors.push(`${page.slug}:closing_cta_directory_link_missing:${rel}`);
    }
    // G3 per page: a canonical URL other than the page's own intake is linked at most
    // twice (the definition may repeat the 'Read the full guide' box's topic guide).
    const counts = new Map();
    for (const a of anchors) if (!a.href.includes('/request-assistance/')) counts.set(a.href, (counts.get(a.href) || 0) + 1);
    for (const [u, n] of counts) if (n > 2) errors.push(`${page.slug}:canonical_url_linked_${n}_times_on_page:${u}:${rel}`);
    // B4: a 40-60 word "X is/are ..." definition directly under the H1.
    const def = body.match(/<\/h1><p class="muted" data-definition="true">([\s\S]*?)<\/p>/);
    if (!def) errors.push(`${page.slug}:definition_under_h1_missing:${rel}`);
    else {
      const words = textWords(def[1]);
      if (words.length < 40 || words.length > 60) errors.push(`${page.slug}:definition_${words.length}_words_not_40_60:${rel}`);
      if (!/^[^.;:]{3,140}?\b(is|are)\b/.test(def[1].replace(/<[^>]+>/g, ''))) errors.push(`${page.slug}:definition_not_X_is_form:${rel}`);
    }
    // D2: a literal comparison table.
    if (!/<table[\s>]/.test(body)) errors.push(`${page.slug}:comparison_table_missing:${rel}`);
    if (!/<ol[\s>]/.test(body)) errors.push(`${page.slug}:ordered_list_missing:${rel}`);
    // B7: homepage -> /senior-living/ hub -> piece (two clicks).
    const hubFile = path.join(dir, 'senior-living', 'index.html');
    const homeFile = path.join(dir, 'index.html');
    if (!fs.existsSync(hubFile) || !fs.readFileSync(hubFile, 'utf8').includes(`href="${page.slug}"`)) errors.push(`${page.slug}:not_linked_from_senior_living_hub:${path.relative(ROOT, hubFile)}`);
    if (!fs.existsSync(homeFile) || !fs.readFileSync(homeFile, 'utf8').includes('href="/senior-living/"')) errors.push(`${page.slug}:homepage_does_not_link_senior_living_hub:${path.relative(ROOT, homeFile)}`);
    // B5: at most one FAQPage, and every schema question is visible.
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    const faqCount = (ld.match(/"@type"\s*:\s*"FAQPage"/g) || []).length;
    if (faqCount > 1) errors.push(`${page.slug}:faqpage_schema_count_${faqCount}:${rel}`);
    const visible = textWords(body).join(' ');
    for (const m of ld.matchAll(/"@type"\s*:\s*"Question"\s*,\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const qn = JSON.parse(`"${m[1]}"`).replace(/\s+/g, ' ').trim();
      if (qn && !visible.includes(textWords(qn).join(' '))) errors.push(`${page.slug}:schema_question_not_visible:${qn.slice(0, 60)}:${rel}`);
    }
    // Fan-out question set rendered from the compiled universe.
    const fan = body.match(/<section class="card fanout-questions" data-fanout-questions="(\d+)">([\s\S]*?)<\/section>/);
    const owned = compiled ? (compiled.queries || []).filter((q) => q.velocity_piece === page.slug) : [];
    if (!fan) errors.push(`${page.slug}:fanout_question_set_missing:${rel}`);
    else {
      const shown = [...fan[2].matchAll(/data-fanout-query="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"'));
      perPieceRendered[page.slug] = shown.length;
      if (shown.length < Math.min(MIN_RENDERED_QUESTIONS, owned.length)) errors.push(`${page.slug}:fanout_questions_rendered_${shown.length}_below_${Math.min(MIN_RENDERED_QUESTIONS, owned.length)}:${rel}`);
      const ownedKeys = new Map(owned.map((q) => [q.normalized_query, q]));
      for (const k of shown) { const q = ownedKeys.get(k); if (!q) errors.push(`${page.slug}:rendered_question_not_compiled_for_piece:${k}:${rel}`); else if (q.locality) renderedLocalities.add(q.locality); }
    }
  }
}

if (seniorPages.length) for (const l of SENIOR_LOCALITIES) if (!renderedLocalities.has(l)) errors.push(`senior_fanout:locality_never_rendered_on_a_piece:${l}`);
// G3 sitewide: memphisseniorcarehomes.com stays under a quarter of all outbound
// links and no single URL of it is linked more than ten times across the site.
// Sitewide counts read THE SERVED TREE, from the repo root, in every environment
// (scripts/lib/served_tree.js - the same admitted-route set build_pages_dist.js copies
// into dist). This used to read dist when present and the whole repo root otherwise, so
// Validate Repo (with dist) counted 9 links to one URL and Query Evidence Refresh (no
// dist) counted 18 against a cap of 10 - same commit, two answers (run 38524268332).
// served-tree-count-parity runs this validator with and without dist and fails if the
// two counts ever differ again.
const servedFiles = require(path.join(ROOT, 'scripts', 'lib', 'served_tree.js')).servedHtmlFiles(ROOT);
if (!servedFiles.length) errors.push('served_tree:zero_served_html_files');
let outbound = 0; let seniorOutbound = 0; const perUrl = new Map();
for (const f of servedFiles) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/g)) {
    let u; try { u = new URL(m[1].replaceAll('&amp;', '&')); } catch { continue; }
    if (/(^|\.)theindustryguides\.com$/.test(u.hostname)) continue;
    outbound++;
    if (u.hostname === 'memphisseniorcarehomes.com') { seniorOutbound++; perUrl.set(u.href, (perUrl.get(u.href) || 0) + 1); }
  }
}
const seniorShare = outbound ? seniorOutbound / outbound : 0;
if (seniorPages.length && !outbound) errors.push('senior_concentration:zero_outbound_links_counted');
if (seniorShare > MAX_OUTBOUND_SHARE) errors.push(`senior_concentration:share_${(seniorShare * 100).toFixed(1)}pct_over_${MAX_OUTBOUND_SHARE * 100}pct`);
for (const [u, n] of perUrl) if (n > MAX_LINKS_PER_URL_SITEWIDE) errors.push(`senior_concentration:${u}_linked_${n}_times_sitewide`);

// ---- canonical guide links, all verticals (2026-10-13) --------------------------
// Owner's rule: the canonical lead tool first (every piece keeps >= 4 followed
// /request-assistance/ links), then a canonical guide ONLY where the piece's topic
// matches it. Every canonical /guides/ link anywhere on the site must resolve to a
// path in the committed inventory for that canonical (data/contracts/canonical_guides/,
// built from the live hubs), and every topic-matched piece must render exactly its
// matched guides - the sentence under the direct answer and the "Read the full
// guide" line above the closing CTA. Hard-fails when no piece matches a guide.
const guideLib = require(path.join(ROOT, 'scripts', 'lib', 'canonical_guide_links.js'));
let inventories = null; let guidePlan = null;
try { inventories = guideLib.loadInventories(ROOT); guidePlan = guideLib.planPieceGuides(ROOT); } catch (e) { errors.push(`canonical_guides:${e.message}`); }
const hostToInventory = new Map();
if (inventories) for (const inv of inventories.values()) hostToInventory.set(new URL(inv.origin).hostname, inv);
const guideLinkStats = { rendered_guide_links: 0, unknown_guide_links: 0, pieces: 0, pieces_with_guides: 0, pieces_without_match: 0, guide_links_on_pieces: 0, per_vertical: {} };
if (inventories) {
  for (const f of servedFiles) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/g)) {
      let u; try { u = new URL(m[1].replaceAll('&amp;', '&')); } catch { continue; }
      const inv = hostToInventory.get(u.hostname.replace(/^www\./, ''));
      if (!inv || !/^\/guides\/[^/]/.test(u.pathname)) continue;
      guideLinkStats.rendered_guide_links++;
      if (!inv.paths.has(u.pathname)) { guideLinkStats.unknown_guide_links++; errors.push(`guide_link_not_in_inventory:${u.origin}${u.pathname}:${path.relative(ROOT, f)}`); }
    }
  }
  if (!guideLinkStats.rendered_guide_links) errors.push('canonical_guides:zero_rendered_guide_links_counted');
}
if (guidePlan) {
  const matched = [...guidePlan.values()].filter((p) => p.guides.length).length;
  if (!matched) errors.push('canonical_guides:zero_pieces_match_a_guide (the guard reaches nothing)');
  for (const [route, piece] of guidePlan) {
    for (const dir of outputs) {
      const file = renderedFile(dir, route);
      if (!fs.existsSync(file)) continue; // unrendered spec rows are admission's concern, not routing's
      const rel = path.relative(ROOT, file);
      const html = fs.readFileSync(file, 'utf8');
      const host = piece.site.replace(/\./g, '\\.');
      const anchors = [...html.matchAll(new RegExp(`<a\\s+([^>]*?)href="(https://${host}[^"]*)"([^>]*)>`, 'g'))].map((m) => ({ attrs: `${m[1]} ${m[3]}`, href: m[2].replaceAll('&amp;', '&') }));
      for (const a of anchors) if (/rel="[^"]*(nofollow|sponsored|ugc)/.test(a.attrs)) errors.push(`${route}:canonical_link_not_followed:${a.href}:${rel}`);
      const intakeAnchors = anchors.filter((a) => { try { return new URL(a.href).pathname === '/request-assistance/'; } catch { return false; } });
      const intake = intakeAnchors.length;
      const served = dir !== ROOT;
      if (served) {
        if (intake !== SERVED_INTAKE_ANCHORS) errors.push(`${route}:served_intake_anchors_not_${SERVED_INTAKE_ANCHORS}:${intake}:${rel}`);
        for (const a of intakeAnchors) {
          if (!/[?&]utm_source=/.test(a.href)) errors.push(`${route}:served_intake_anchor_not_attributed:${a.href}:${rel}`);
        }
        // Every CTA the cap turned into an in-page jump must reach an id that is
        // really on the page. A jump to a missing anchor is a dead button wearing
        // a link, which is what this pin exists to stop.
        for (const m of html.matchAll(/<a\b[^>]*\bhref="#([^"]+)"[^>]*\bdata-link-capped="true"/g)) {
          if (!new RegExp(`\\bid="${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html)) {
            errors.push(`${route}:capped_cta_jumps_to_missing_anchor:#${m[1]}:${rel}`);
          }
        }
      } else if (intake < 1) {
        errors.push(`${route}:intake_links_below_1:${intake}:${rel}`);
      }
      const inline = html.match(/<p class="canonical-guide-inline" data-canonical-guide-inline="(\d+)">([\s\S]*?)<\/p>/);
      const closing = html.match(/<section class="card canonical-guide-closing"[^>]*>([\s\S]*?)<\/section>/);
      if (dir !== ROOT) continue; // the counts below are reported once, from the committed output
      const v = piece.vertical;
      const st = (guideLinkStats.per_vertical[v] = guideLinkStats.per_vertical[v] || { pieces: 0, pieces_with_guides: 0, guide_links: 0, pieces_without_match: 0 });
      st.pieces++; guideLinkStats.pieces++;
      if (!piece.guides.length) {
        st.pieces_without_match++; guideLinkStats.pieces_without_match++;
        if (inline || closing) errors.push(`${route}:guide_link_without_topic_match:${rel}`);
        continue;
      }
      st.pieces_with_guides++; guideLinkStats.pieces_with_guides++;
      if (!inline) { errors.push(`${route}:matched_guide_sentence_missing:${rel}`); continue; }
      const shown = [...inline[2].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      const want = piece.guides.map((g) => g.url);
      if (shown.join(' ') !== want.join(' ')) errors.push(`${route}:guide_sentence_links_${shown.join(',')}_expected_${want.join(',')}:${rel}`);
      if (!closing || !closing[1].includes(`href="${want[0]}"`)) errors.push(`${route}:read_the_full_guide_line_missing:${rel}`);
      const bottom = html.indexOf('data-canon-block="bottom"');
      if (closing && bottom >= 0 && html.indexOf(closing[0]) > bottom) errors.push(`${route}:read_the_full_guide_line_after_closing_cta:${rel}`);
      st.guide_links += shown.length + (closing ? 1 : 0); guideLinkStats.guide_links_on_pieces += shown.length + (closing ? 1 : 0);
    }
  }
  if (!guideLinkStats.pieces) errors.push('canonical_guides:zero_rendered_pieces');
}
// G3 for every canonical: no canonical domain above a quarter of all outbound links.
const perCanonicalShare = {};
{
  const counts = new Map(); let total = 0;
  for (const f of servedFiles) for (const m of fs.readFileSync(f, 'utf8').matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/g)) {
    let u; try { u = new URL(m[1].replaceAll('&amp;', '&')); } catch { continue; }
    if (/(^|\.)theindustryguides\.com$/.test(u.hostname)) continue;
    total++;
    const h = u.hostname.replace(/^www\./, '');
    if (hostToInventory.has(h)) counts.set(h, (counts.get(h) || 0) + 1);
  }
  for (const [h, n] of counts) {
    perCanonicalShare[h] = Number((n / total).toFixed(4));
    if (n / total > MAX_OUTBOUND_SHARE) errors.push(`canonical_concentration:${h}_share_${((n / total) * 100).toFixed(1)}pct_over_${MAX_OUTBOUND_SHARE * 100}pct`);
  }
  if (hostToInventory.size && !total) errors.push('canonical_concentration:zero_outbound_links_counted');
}

// Self-proof (2026-10-14): one commit, one answer. scripts/tests/test_served_tree_count_parity.js
// re-runs this validator with a 40-link decoy inside dist/ and again with dist/ moved
// aside, and fails if the sitewide counts differ or are zero. The child runs carry
// SERVED_TREE_PARITY_CHILD so they do not recurse.
let servedTreeParity = 'skipped_in_child';
if (!process.env.SERVED_TREE_PARITY_CHILD) {
  const t = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/tests/test_served_tree_count_parity.js')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SERVED_TREE_PARITY_CHILD: '1' } });
  servedTreeParity = t.status === 0 ? 'PASS' : 'FAIL';
  if (t.status !== 0) errors.push(`served_tree_parity:${`${t.stdout}${t.stderr}`.trim().split('\n').slice(0, 3).join(' | ')}`);
}
const report = { validator: 'velocity-canonical-anchor-links', ok: errors.length === 0, served_tree_parity: servedTreeParity, sitewide: { served_html_files: servedFiles.length, outbound_links: outbound, senior_outbound_links: seniorOutbound, senior_links_per_url: Object.fromEntries([...perUrl].sort()) }, governed_pages: governed.length, senior_living_pages: seniorPages.length, senior_living_intake_links: seniorIntakeLinks, senior_compiled_queries: compiled ? (compiled.queries || []).length : 0, senior_questions_rendered_per_piece: perPieceRendered, senior_outbound_share: Number(seniorShare.toFixed(4)), senior_outbound_links: seniorOutbound, outbound_links_total: outbound, senior_max_links_per_url: Math.max(0, ...perUrl.values()), required_guides: Object.keys(REQUIRED).length, rendered_links_checked: linksChecked, canonical_guide_links: guideLinkStats, canonical_outbound_share: perCanonicalShare, outputs: outputs.map((d) => path.relative(ROOT, d) || '.'), errors };
fs.mkdirSync(path.dirname(path.join(ROOT, REPORT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, REPORT), JSON.stringify(report, null, 2) + '\n');
if (errors.length) {
  console.error(`VELOCITY CANONICAL ANCHOR LINKS FAIL (${errors.length})`);
  console.error(errors.slice(0, 40).join('\n'));
  process.exit(1);
}
console.log(`VELOCITY CANONICAL ANCHOR LINKS PASS: ${governed.length} guides, ${linksChecked} rendered anchor links on ${report.outputs.join(', ')}; senior-living ${seniorPages.length} guides, ${seniorIntakeLinks} intake links, ${report.senior_compiled_queries} compiled queries, outbound share ${(seniorShare * 100).toFixed(1)}%; canonical guides: ${guideLinkStats.pieces_with_guides}/${guideLinkStats.pieces} pieces matched, ${guideLinkStats.guide_links_on_pieces} guide links, ${guideLinkStats.rendered_guide_links} sitewide all in inventory; max canonical share ${(Math.max(0, ...Object.values(perCanonicalShare)) * 100).toFixed(1)}%`);
