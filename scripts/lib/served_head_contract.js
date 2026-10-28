'use strict';
/**
 * The head and disclosure contract for the bytes the edge actually serves.
 *
 * Why this is a publish-time layer and not a generator change alone:
 * 2,116 of the 2,136 admitted routes are physically frozen accepted HTML
 * (data/release/frozen_page_registry.json). A generator fix governs what a NEW
 * page is born with, and the freeze restores the old bytes for everything else,
 * so a generator-only fix leaves the live site exactly as it was. Measured in
 * dist/ on 2026-10-25, before this module existed:
 *
 *   414 titles over 65 characters        1,327 descriptions over 160
 *   1,261 pages with no og:title         1,262 without twitter:card large
 *   2,137 pages with no ownership line   2,137 with no Organization logo
 *
 * Those are the Search Readiness failures b1, b2, b6, c1, g3 and g4 for
 * theindustryguides.com. They are fixed here, over dist/, in the same position
 * and on the same reasoning as scripts/install_site_head_assets.js ("a
 * publish-time layer over frozen bytes"), and the generators are fixed too so a
 * page is born correct.
 *
 * Every function is pure (html in, html out) so scripts/validators/
 * validate_served_head_contract.js can hold the served tree to the same
 * definitions instead of keeping a second idea of the rule.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { fitTitle, fitDescription, factsFromBody, MIN_TITLE_CHARS, MAX_TITLE_CHARS, MIN_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS } = require('./search_snippet');

const SITE_HOST = 'theindustryguides.com';
const SITE_NAME = 'The Industry Guides';
const SITE_BASE = `https://${SITE_HOST}`;

// The disclosure must read as a sentence to a person AND satisfy the audit's
// phrase test (/commonly owned|common ownership|same owner|under common|
// affiliated|we own|our own (sites|publications)/i).
const OWNERSHIP_MARKER = 'data-common-ownership="true"';
const OWNERSHIP_TEXT = `${SITE_NAME} and the guide sites it routes you to are commonly owned. We say so wherever we link one, because a recommendation between commonly owned sites should carry a label.`;
const OWNERSHIP_HTML = `<p class="muted small ownership-disclosure" ${OWNERSHIP_MARKER}>${OWNERSHIP_TEXT}</p>`;

// One on-site page carries the list of guide domains. The footer linked all five
// on all 2,137 pages, which is 2,137 links to each target: the exact footprint
// Search Readiness g3 caps ("no URL more than ten" across a sample).
const GUIDES_INDEX_ROUTE = '/about';
const FOOTER_GUIDES_HTML = `          <div class="footer-title">Our Guides</div>
          <p class="muted"><a href="${GUIDES_INDEX_ROUTE}">The guide sites we publish and route to</a></p>
          ${OWNERSHIP_HTML}`;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function headOf(html) {
  const end = html.search(/<\/head>/i);
  return end < 0 ? null : { head: html.slice(0, end), rest: html.slice(end) };
}
function titleOf(html) { return decodeEntities((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]); }
function descTagOf(html) {
  return (html.match(/<meta\b[^>]*>/gi) || []).find((t) => /\bname=(["'])description\1/i.test(t)) || '';
}
function descOf(html) {
  return decodeEntities((descTagOf(html).match(/\bcontent=(["'])([\s\S]*?)\1/i) || [])[2]);
}
function canonicalOf(html) {
  const m = html.match(/<link\b[^>]*rel=(["'])canonical\1[^>]*>/i);
  return m ? decodeEntities((m[0].match(/\bhref=(["'])([\s\S]*?)\1/i) || [])[2]) : '';
}
function bodyOf(html) {
  const m = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : html;
}

/**
 * b1 + b2: the title into [MIN_TITLE_CHARS, MAX_TITLE_CHARS] and the description
 * into [MIN_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS], using the one definition
 * the generators use (scripts/lib/search_snippet.js). A short description is
 * lengthened from the page's OWN accordion questions, never a shared sentence.
 */
function normalizeSnippet(html) {
  const parts = headOf(html);
  if (!parts) return html;
  const current = titleOf(html);
  const wanted = current ? fitTitle(current) : current;
  let out = html;
  if (wanted && wanted !== current) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escAttr(wanted)}</title>`);
  }
  const tag = descTagOf(out);
  const currentDesc = descOf(out);
  if (tag && currentDesc) {
    const wantedDesc = fitDescription(currentDesc, { facts: factsFromBody(bodyOf(out)), subject: wanted || current });
    if (wantedDesc && wantedDesc !== currentDesc) {
      // A replacement STRING would read "$1,500" in a description as a
      // backreference: /personal-injury/.../should-i-go-through-my-own-insurance-
      // with-a-1-500-deductible/ came out as 'with a content=",500 deductible'.
      const next = tag.replace(/(\bcontent=(["']))[\s\S]*?\2/i, (m, lead, q) => `${lead}${escAttr(wantedDesc)}${q}`);
      out = out.replace(tag, () => next);
    }
  }
  return out;
}

/**
 * b6: og:title, og:description, og:type, og:url, og:site_name and
 * twitter:card=summary_large_image. The 1,245 insight pages are rendered by
 * scripts/lib/publish_contract.js, whose head carried an og:image (added by
 * install_site_head_assets.js) and none of these.
 */
function ensureSocialTags(html) {
  const parts = headOf(html);
  if (!parts) return html;
  let { head, rest } = parts;
  const title = titleOf(html);
  const desc = descOf(html);
  const canonical = canonicalOf(html) || SITE_BASE + '/';
  // An insight or article route is og:type article; everything else is a website.
  const type = /\/(insights|medium-articles|medium)\//.test(canonical) ? 'article' : 'website';
  const add = [];
  const has = (re) => re.test(head);
  if (!has(/property=(["'])og:title\1/i) && title) add.push(`<meta property="og:title" content="${escAttr(title)}" />`);
  if (!has(/property=(["'])og:description\1/i) && desc) add.push(`<meta property="og:description" content="${escAttr(desc)}" />`);
  if (!has(/property=(["'])og:type\1/i)) add.push(`<meta property="og:type" content="${type}" />`);
  if (!has(/property=(["'])og:url\1/i)) add.push(`<meta property="og:url" content="${escAttr(canonical)}" />`);
  if (!has(/property=(["'])og:site_name\1/i)) add.push(`<meta property="og:site_name" content="${SITE_NAME}" />`);
  // og:title and og:description must track a title or description this module
  // just trimmed, or a share card would quote the old, over-length value.
  head = head
    .replace(/(<meta\s+property=(["'])og:title\2\s+content=(["']))[\s\S]*?\3/i, (m, p1, q, q2) => title ? `${p1}${escAttr(title)}${q2}` : m)
    .replace(/(<meta\s+property=(["'])og:description\2\s+content=(["']))[\s\S]*?\3/i, (m, p1, q, q2) => desc ? `${p1}${escAttr(desc)}${q2}` : m);
  // Attribute order is not guaranteed: a page may carry content= before name=.
  if (has(/name=(["'])twitter:card\1/i)) {
    head = head.replace(/<meta\b[^>]*name=(["'])twitter:card\1[^>]*>/i, () => '<meta name="twitter:card" content="summary_large_image" />');
  } else {
    add.push('<meta name="twitter:card" content="summary_large_image" />');
  }
  if (add.length) head += `${add.join('\n')}\n`;
  return head + rest;
}

/**
 * c1: the Organization node carries name, url, logo and sameAs.
 *
 * The audit reads the FIRST Organization-shaped node in the graph. On an insight
 * page that was the Article's inline `publisher` ({name, url} only), so the fully
 * described network Organization further down the graph was never reached. One
 * node is now described and the publisher refers to it by @id.
 *
 * sameAs is still not invented here, and now it does not have to be: it comes
 * from the published node like every other field. data/authority/
 * verified_same_as_registry.json carries two FIRST_PARTY_ENTITY_PAGE records
 * verified live on 26 Oct 2026 (/about, /methodology), and
 * validate_network_crawler_contract.js hard-fails a published URL that is not a
 * VERIFIED record satisfying its declared basis - so an invented profile still
 * cannot reach a page, and an empty sameAs can no longer sit here as a safe
 * default. The entity publishes no social profile; that search, and its result,
 * are recorded in the registry rather than left to be redone.
 */
function organizationNode() {
  // The same node build_site.js publishes, including any VERIFIED sameAs, so the
  // publish-time layer and the generators cannot disagree about the entity.
  return require('./network_schema').networkSchemaNodes()[0];
}
function consolidateOrganization(html, org) {
  const node = org || organizationNode();
  const ORG_TYPES = /^(Organization|LocalBusiness|Corporation|NewsMediaOrganization|ProfessionalService)$/;
  return html.replace(/<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi, (whole, q, body) => {
    let data;
    try { data = JSON.parse(body); } catch { return whole; }
    let touched = false;
    const isOrg = (n) => n && typeof n === 'object' && [].concat(n['@type'] || []).some((t) => ORG_TYPES.test(String(t)));
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (isOrg(n)) {
        for (const key of ['name', 'url', 'logo', 'sameAs']) {
          if (node[key] && (n[key] === undefined || (Array.isArray(n[key]) && !n[key].length))) { n[key] = node[key]; touched = true; }
        }
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(data);
    if (!touched) return whole;
    const next = JSON.stringify(data);
    return whole.replace(body, () => next);
  });
}

/**
 * g4: the common-ownership line, and g3's per-URL cap, both of which live in the
 * same footer block. The footer linked five commonly owned domains on every page
 * (2,137 links to each). It now links one on-site page that lists them and
 * carries the disclosure.
 */
function ensureOwnershipDisclosure(html) {
  if (html.includes(OWNERSHIP_MARKER)) return html;
  let out = html;
  const footerBlock = /(\s*)<div class="footer-title">Canonical Domains<\/div>\s*<ul class="muted">[\s\S]*?<\/ul>/i;
  if (footerBlock.test(out)) return out.replace(footerBlock, () => `\n${FOOTER_GUIDES_HTML}`);
  // A page rendered outside templates/layout.html (the insight head in
  // publish_contract.js has its own markup) gets the line before </main>.
  const at = out.search(/<\/main>/i);
  if (at >= 0) return out.slice(0, at) + `<section class="card ownership-disclosure-block">${OWNERSHIP_HTML}</section>` + out.slice(at);
  const bodyEnd = out.search(/<\/body>/i);
  if (bodyEnd >= 0) return out.slice(0, bodyEnd) + OWNERSHIP_HTML + out.slice(bodyEnd);
  return out;
}

/**
 * g3: no portfolio domain over a quarter of a page's outbound links.
 *
 * Measured 2026-10-25: /insights/dentistry-q003-... linked ONE canonical URL
 * eight times (8 of 11 outbound links, 73%), and the community-question pages
 * linked three or four different pages on the same guide domain out of four or
 * five outbound links. Deduplicating URLs alone was not enough, because the
 * repeats were different paths on the same host.
 *
 * So the cap is per HOST: the FIRST link to a given portfolio host stays a link
 * and later links to that same host become plain text. The page keeps exactly one
 * clear route to the guide that owns the topic - the first one, which is the one
 * highest on the page - and loses the footprint. One portfolio link out of four
 * outbound is 25%, which is inside the cap; pages with fewer than four outbound
 * links are not graded at all.
 */
/**
 * j2: a companion piece's link to a canonical intake says where the reader came from.
 *
 * Search Readiness j2 wants the canonical intake reachable from every companion
 * piece AND attributable - the canonical is where the lead is captured, and a bare
 * https://dentistryguides.com/request-assistance/ arrives with no idea which piece
 * sent it, so nothing on the canonical side can tell a working route from a dead one.
 *
 * Only an intake URL that carries NO query of its own is stamped. The senior-living
 * contract builds its own intake URLs with vertical/src/page_slug parameters that
 * velocity-canonical-anchor-links matches exactly; appending to those would be
 * rewriting another contract's links. The homepage is left alone for the same
 * reason - umbrella-homepage-shape matches each card's intake href as a literal.
 */
const INTAKE_PATH = /^\/request-assistance\/?$/;

function stampIntakeTracking(html, portfolioHosts, route) {
  const hosts = new Set(portfolioHosts || []);
  const r = String(route || '').replace(/\/+$/, '');
  if (!hosts.size || !r || r === '/') return html;
  const content = r.replace(/^\/+/, '');
  return html.replace(/<a\b([^>]*)>/gi, (whole, attrs) => {
    const m = attrs.match(/\bhref=(["'])([\s\S]*?)\1/i);
    if (!m) return whole;
    const raw = decodeEntities(m[2]);
    let u;
    try { u = new URL(raw, SITE_BASE); } catch { return whole; }
    if (!hosts.has(u.hostname.replace(/^www\./, '')) || !INTAKE_PATH.test(u.pathname)) return whole;
    if (u.search || u.hash) return whole;
    const stamped = `${raw}?utm_source=${SITE_HOST}&utm_medium=referral&utm_campaign=companion&utm_content=${encodeURIComponent(content)}`;
    return whole.replace(m[0], `href=${m[1]}${escAttr(stamped)}${m[1]}`);
  });
}

/** A portfolio host's intake link, if the page has one: what the cap must keep. */
function preferredLinkPerHost(html, hosts) {
  const pick = new Map();
  for (const m of html.matchAll(/<a\b([^>]*)>/gi)) {
    const href = (m[1].match(/\bhref=(["'])([\s\S]*?)\1/i) || [])[2];
    if (!href) continue;
    let u;
    try { u = new URL(decodeEntities(href), SITE_BASE); } catch { continue; }
    const host = u.hostname.replace(/^www\./, '');
    if (!hosts.has(host)) continue;
    if (!pick.has(host)) pick.set(host, href);
    else if (INTAKE_PATH.test(u.pathname) && !INTAKE_PATH.test(new URL(decodeEntities(pick.get(host)), SITE_BASE).pathname)) pick.set(host, href);
  }
  return pick;
}

function capPortfolioLinks(html, portfolioHosts, { exempt = false, perUrl = false } = {}) {
  const hosts = new Set(portfolioHosts || []);
  if (!hosts.size || exempt) return html;
  // Which link survives per host is chosen BEFORE any is capped: the intake, if
  // the page has one. Keeping the first link instead left seven insight pages
  // with the guide link and every intake link turned into plain text, so the
  // pieces had no route to the lead surface at all (Search Readiness j2,
  // measured 2026-10-25 on /insights/trt-006-..., three capped intake links).
  const keep = preferredLinkPerHost(html, hosts);
  const linked = new Set();
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs, inner) => {
    const href = (attrs.match(/\bhref=(["'])([\s\S]*?)\1/i) || [])[2];
    if (!href) return whole;
    let u;
    try { u = new URL(decodeEntities(href), SITE_BASE); } catch { return whole; }
    const host = u.hostname.replace(/^www\./, '');
    if (!hosts.has(host)) return whole;
    // Per-URL mode keys on the destination, so a second DISTINCT url on the same
    // host survives and only a repeat of one url is capped.
    const key = perUrl ? `${u.origin}${u.pathname}` : host;
    const anchorId = `find-a-provider-${String(key).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '')}`;
    if (!linked.has(key) && (perUrl || href === keep.get(host))) {
      linked.add(key);
      // The surviving anchor is the jump target for every copy capped below it,
      // so a capped CTA stays something a reader can click.
      return /\bid=/i.test(attrs) ? whole : whole.replace(/^<a\b/i, `<a id="${anchorId}"`);
    }
    const cls = (attrs.match(/\bclass=(["'])([\s\S]*?)\1/i) || [])[2] || '';
    // An in-page href, not a <span>: `links()` ignores a bare #fragment, so this
    // costs the page nothing in outbound links, and the reader who scrolled to
    // the closing CTA still gets to the live one instead of a dead button. When
    // the kept link comes LATER in the document than this copy (preferredLinkPerHost
    // picks the intake wherever it is), the jump still resolves - the id is on the
    // kept anchor either way.
    return `<a class="${escAttr(cls)}" href="#${anchorId}" data-link-capped="true">${inner}</a>`;
  });
}

/**
 * Where the cap applies, and why it is not everywhere.
 *
 * This repository's architecture is to route a reader to a canonical
 * destination's intake REPEATEDLY, and three HARD_FAIL validators enforce it:
 *   - velocity-canonical-anchor-links: every piece matched to a canonical guide
 *     carries at least FOUR /request-assistance/ links (845 pages), and a
 *     senior-living guide also needs a directory-home, topic-guide and city link;
 *   - umbrella-homepage-shape: the homepage's six vertical cards each link the
 *     canonical home, its intake and three question pages;
 *   - the senior-living contract above, which enforces its own per-URL rule.
 *
 * Search Readiness g3 caps a portfolio domain at a quarter of a page's outbound
 * links. On a state page with 16 outbound links that allows three, and the
 * contract requires four. Measured 2026-10-25: all four state pages the audit
 * flagged for g3 are governed pages. The two rules do not fit on the same page,
 * and dismantling the lead funnel to satisfy a footprint heuristic is an owner's
 * decision, not this pass's.
 *
 * So the cap applies only where no routing contract governs the page AND the
 * route is an insight or article page - 0 of the 1,357 governed routes are under
 * /insights/ or /medium-articles/, and those are exactly the pages whose
 * footprint was worst: /insights/dentistry-q003-... linked ONE canonical URL
 * eight times, 8 of 11 outbound links, 73%.
 *
 * g3 therefore stays reported for the governed pages, with that reason, rather
 * than silently "fixed" by breaking three contracts.
 */
function governedRoutes() {
  const routes = new Set();
  const addRoute = (slug) => {
    const r = String(slug || '').replace(/\/+$/, '') || '/';
    if (r) routes.add(r);
  };
  // 1. The spec pages that carry canonical_anchor_links (the senior-living and
  //    dentistry guides with a required directory/topic/city routing block).
  const specs = path.join(ROOT, 'data', 'page_families', 'velocity_page_specs.json');
  if (fs.existsSync(specs)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(specs, 'utf8'));
      for (const x of parsed.pages || []) {
        if (Array.isArray(x.canonical_anchor_links) && x.canonical_anchor_links.length) addRoute(x.slug);
      }
    } catch { /* an unreadable spec file is that validator's finding, not this pass's */ }
  }
  // 2. Every piece matched to a canonical guide, from the SAME planner that
  //    validator uses, so the governed set has one definition. 845 of these
  //    require four intake links each.
  try {
    const plan = require('./canonical_guide_links').planPieceGuides(ROOT);
    for (const route of plan.keys()) addRoute(route);
  } catch { /* planner unavailable: fall back to the spec pages above */ }
  return routes;
}

function isGovernedRoute(route, governed) {
  const r = String(route || '').replace(/\/+$/, '') || '/';
  return governed.has(r);
}

/**
 * The cap's scope: every served route but two named exemptions.
 *
 * It used to be /insights/ and /medium-articles/ only, and not even all of
 * those - any route a canonical-guide match governed was skipped, which was 845
 * pieces plus every state page. Measured on the built tree, 862 of 1,068 graded
 * pages had a portfolio host over a quarter of their outbound links, so the
 * guard that exists to catch exactly that reached 206 pages and the breach lived
 * on the other 862. The reason given on 2026-10-25 was that
 * velocity-canonical-anchor-links required FOUR /request-assistance/ links per
 * matched piece and a quarter of a page's links cannot hold four to one host -
 * true, and the conclusion drawn from it ("changing the lead funnel is an owner
 * decision") left the item permanently reported and never fixed.
 *
 * It is decided here instead, from what the page actually does. The four links
 * were four copies of ONE url: /trt/states/oregon/trt-legality/ shipped five
 * identical "Find a Provider" anchors to hormonesivhair.com/request-assistance/
 * and two identical guide links. Four copies of one destination add no route a
 * reader did not already have and no reachability the first copy did not give;
 * they add the footprint g3 names. So the page keeps ONE followed outbound
 * anchor per portfolio host - the intake, chosen by preferredLinkPerHost - and
 * every later copy becomes an in-page jump to it, so no CTA goes dead and the
 * reader can still act from the bottom of the page. MIN_INTAKE_LINKS moves with
 * it, to a pin that asserts more than a count (see
 * validate_velocity_canonical_anchor_links.js).
 *
 * Two exemptions, each because another contract pins the exact links:
 *   - The senior-living guides. Four intake links each is the owner's own rule,
 *     stated in priority order in validate_velocity_canonical_anchor_links.js,
 *     and theirs is the one funnel an agent does not redesign.
 *   - The homepage, whose six cards umbrella-homepage-shape matches literally.
 */
const SENIOR_FAMILY = 'SENIOR-LIVING-GUIDES';
// The two safety-net guides velocity-canonical-anchor-links pins to SIX DISTINCT
// metro anchors on dentistryguides.com. Six different destinations is not the
// footprint g3 describes - it is the page's whole purpose, a reader in Houston
// needs the Houston anchor - so these two cap per URL instead of per host: a
// repeated link to the SAME metro is still capped, a second metro is not.
const MULTI_TARGET_ROUTES = new Set(['/dentistry/free-dental-clinics', '/dentistry/dental-school-clinics']);
function isMultiTargetRoute(route) {
  return MULTI_TARGET_ROUTES.has(String(route || '').replace(/\/+$/, '') || '/');
}
let seniorRoutesCache = null;
function seniorLivingRoutes() {
  if (seniorRoutesCache) return seniorRoutesCache;
  const out = new Set();
  const specs = path.join(ROOT, 'data', 'page_families', 'velocity_page_specs.json');
  try {
    for (const x of (JSON.parse(fs.readFileSync(specs, 'utf8')).pages || [])) {
      if (x.page_family === SENIOR_FAMILY) out.add(String(x.slug || '').replace(/\/+$/, '') || '/');
    }
  } catch { /* an unreadable spec file is that validator's finding, not this pass's */ }
  seniorRoutesCache = out;
  return out;
}
function isCappableRoute(route /* , governed */) {
  const r = String(route || '').replace(/\/+$/, '') || '/';
  if (r === '/') return false;
  return !seniorLivingRoutes().has(r);
}

/**
 * d2: a page whose title says "how to" carries an ordered list.
 *
 * These pages already PROVE three to eight steps in their own HowTo JSON-LD -
 * the insight template refuses to render without them - and then printed the
 * decision artifact as a table or a <ul>, so the steps a list snippet is
 * extracted from were never on the page. The visible list is built from the
 * page's own schema, so nothing is invented and the schema stops claiming
 * something a reader cannot see.
 */
function howToStepsFrom(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[2]); } catch { continue; }
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if ([].concat(n['@type'] || []).includes('HowTo') && Array.isArray(n.step)) {
        for (const st of n.step) {
          const name = String((st && st.name) || '').trim();
          const text = String((st && st.text) || '').trim();
          if (name || text) out.push({ name, text });
        }
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(data);
    if (out.length) break;
  }
  return out;
}

const STEPS_MARKER = 'data-howto-steps="true"';

function ensureOrderedSteps(html) {
  if (!/\bhow to\b/i.test(titleOf(html)) || /<ol\b/i.test(html)) return html;
  // A list the page itself marks as its steps is promoted in place.
  const stepList = /<ul\b([^>]*\bdata-(?:howto|steps)\b[^>]*)>([\s\S]*?)<\/ul>/i;
  if (stepList.test(html)) return html.replace(stepList, (m, a, inner) => `<ol${a}>${inner}</ol>`);
  const steps = howToStepsFrom(html);
  if (steps.length < 3) return html;
  // A HowToStep's name is often a title-cased restatement of its own text
  // ("Right Specialty Adult Child Adhd" / "Right specialty (adult/child/ADHD)").
  // Printing both reads as a stutter, so the name shows only when it adds words.
  const bare = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const items = steps.map((st) => {
    const nameWords = bare(st.name).split(' ').filter(Boolean);
    const textWords = new Set(bare(st.text).split(' ').filter(Boolean));
    // Same thing when the name adds no word the text does not already have.
    const sameThing = !st.name || !st.text || (nameWords.length > 0 && nameWords.every((w) => textWords.has(w)));
    const label = sameThing ? escAttr(st.text || st.name) : `<strong>${escAttr(st.name)}</strong> ${escAttr(st.text)}`;
    return `<li>${label}</li>`;
  }).join('');
  const block = `<section class="card howto-steps" ${STEPS_MARKER}><h2>Steps</h2><ol>${items}</ol></section>`;
  const at = html.search(/<\/main>/i);
  if (at >= 0) return html.slice(0, at) + block + html.slice(at);
  const bodyEnd = html.search(/<\/body>/i);
  return bodyEnd >= 0 ? html.slice(0, bodyEnd) + block + html.slice(bodyEnd) : html;
}

function applyAll(html, { portfolioHosts = [], org = null, exemptFromCap = false, route = null } = {}) {
  if (!/<html/i.test(html)) return html;
  let out = html;
  out = normalizeSnippet(out);
  out = ensureSocialTags(out);
  out = consolidateOrganization(out, org);
  out = ensureOwnershipDisclosure(out);
  // Stamp before capping: the cap picks the surviving link by path, and a stamped
  // intake must still read as the intake when it does.
  out = stampIntakeTracking(out, portfolioHosts, route);
  out = capPortfolioLinks(out, portfolioHosts, { exempt: exemptFromCap, perUrl: isMultiTargetRoute(route) });
  out = ensureOrderedSteps(out);
  return out;
}

module.exports = {
  SITE_HOST, SITE_NAME, SITE_BASE,
  OWNERSHIP_MARKER, OWNERSHIP_TEXT, OWNERSHIP_HTML, GUIDES_INDEX_ROUTE,
  MIN_TITLE_CHARS, MAX_TITLE_CHARS, MIN_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS,
  titleOf, descOf, canonicalOf, bodyOf, decodeEntities,
  normalizeSnippet, ensureSocialTags, consolidateOrganization, ensureOwnershipDisclosure,
  capPortfolioLinks, stampIntakeTracking, preferredLinkPerHost, INTAKE_PATH, governedRoutes, isGovernedRoute, isCappableRoute, SENIOR_FAMILY, seniorLivingRoutes, MULTI_TARGET_ROUTES, isMultiTargetRoute, ensureOrderedSteps, howToStepsFrom, STEPS_MARKER, organizationNode, applyAll
};
