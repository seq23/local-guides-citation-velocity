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
 * c1: the Organization node carries name, url and logo.
 *
 * The audit reads the FIRST Organization-shaped node in the graph. On an insight
 * page that was the Article's inline `publisher` ({name, url} only), so the fully
 * described network Organization further down the graph was never reached. One
 * node is now described and the publisher refers to it by @id.
 *
 * sameAs is deliberately not invented here: data/network/
 * network_identity_registry.json prohibits "unverified sameAs URLs" and
 * data/authority/verified_same_as_registry.json holds no records, so any value
 * added would be a claim this repository forbids. It is added the moment a
 * verified profile is registered.
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
function capPortfolioLinks(html, portfolioHosts) {
  const hosts = new Set(portfolioHosts || []);
  if (!hosts.size) return html;
  const linked = new Set();
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs, inner) => {
    const href = (attrs.match(/\bhref=(["'])([\s\S]*?)\1/i) || [])[2];
    if (!href) return whole;
    let u;
    try { u = new URL(decodeEntities(href), SITE_BASE); } catch { return whole; }
    const host = u.hostname.replace(/^www\./, '');
    if (!hosts.has(host)) return whole;
    if (!linked.has(host)) { linked.add(host); return whole; }
    const cls = (attrs.match(/\bclass=(["'])([\s\S]*?)\1/i) || [])[2] || '';
    return `<span class="${escAttr(cls)}" data-link-capped="true">${inner}</span>`;
  });
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

function applyAll(html, { portfolioHosts = [], org = null } = {}) {
  if (!/<html/i.test(html)) return html;
  let out = html;
  out = normalizeSnippet(out);
  out = ensureSocialTags(out);
  out = consolidateOrganization(out, org);
  out = ensureOwnershipDisclosure(out);
  out = capPortfolioLinks(out, portfolioHosts);
  out = ensureOrderedSteps(out);
  return out;
}

module.exports = {
  SITE_HOST, SITE_NAME, SITE_BASE,
  OWNERSHIP_MARKER, OWNERSHIP_TEXT, OWNERSHIP_HTML, GUIDES_INDEX_ROUTE,
  MIN_TITLE_CHARS, MAX_TITLE_CHARS, MIN_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS,
  titleOf, descOf, canonicalOf, bodyOf, decodeEntities,
  normalizeSnippet, ensureSocialTags, consolidateOrganization, ensureOwnershipDisclosure,
  capPortfolioLinks, ensureOrderedSteps, howToStepsFrom, STEPS_MARKER, organizationNode, applyAll
};
