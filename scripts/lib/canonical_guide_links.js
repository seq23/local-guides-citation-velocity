'use strict';
/**
 * Canonical guide links for Velocity pieces (2026-10-13).
 *
 * The owner's routing rule, in priority order: (1) drive the reader to the
 * canonical lead tool - the existing /request-assistance/ and home links stay
 * exactly as they are; (2) link a specific canonical guide ONLY where the
 * piece's topic matches that guide. The guide inventories are committed per
 * canonical in data/contracts/canonical_guides/<vertical>.json, built from the
 * live /guides/ hubs (fetched_at, http_status per guide). A guide is linked
 * when one of its topic_terms matches the piece's title, slug or cluster title;
 * a piece that matches nothing gets no guide link. Senior-living pieces pick
 * their guides by hand in the spec and are not matched here.
 *
 * validate_velocity_canonical_anchor_links.js reads the same inventories and
 * fails any rendered canonical /guides/ link whose path is not in them.
 */
const fs = require('fs');
const path = require('path');

const INVENTORY_DIR = path.join('data', 'contracts', 'canonical_guides');
const VERTICALS = ['uscis-medical', 'dentistry', 'neuro', 'trt', 'personal-injury', 'senior-living'];
const MAX_GUIDES_PER_PIECE = 2;

const verticalKey = (v) => (String(v || '') === 'personal_injury' ? 'personal-injury' : String(v || ''));
const normalize = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

function loadInventories(root) {
  const out = new Map();
  for (const v of VERTICALS) {
    const file = path.join(root, INVENTORY_DIR, `${v}.json`);
    if (!fs.existsSync(file)) throw new Error(`canonical guide inventory missing: ${path.relative(root, file)}`);
    const inv = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (inv.vertical !== v) throw new Error(`${path.relative(root, file)}: vertical ${inv.vertical} != ${v}`);
    if (!Array.isArray(inv.guides) || !inv.guides.length) throw new Error(`${path.relative(root, file)}: zero guides`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(inv.fetched_at || ''))) throw new Error(`${path.relative(root, file)}: fetched_at missing`);
    const origin = new URL(inv.canonical_origin).origin;
    const paths = new Set(inv.guides.map((g) => g.path));
    out.set(v, { ...inv, origin, paths });
  }
  return out;
}

/** Guides whose topic terms match the piece, best first, at most MAX_GUIDES_PER_PIECE. */
function matchGuides(inventories, vertical, texts) {
  const inv = inventories.get(verticalKey(vertical));
  if (!inv || verticalKey(vertical) === 'senior-living') return [];
  const hay = normalize((texts || []).join(' '));
  const scored = [];
  inv.guides.forEach((g, order) => {
    let score = 0;
    for (const term of g.topic_terms || []) {
      const parts = String(term).split('+').map((p) => normalize(p)).filter((p) => p.trim());
      if (parts.length && parts.every((p) => hay.includes(p))) score += parts.length;
    }
    if (score > 0) scored.push({ score, order, url: `${inv.origin}${g.path}`, title: g.title });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, MAX_GUIDES_PER_PIECE).map(({ url, title }) => ({ url, title }));
}

/** The text a piece is matched on: title, slug without its vertical directory, cluster title. */
function pieceTopicTexts({ slug, title, clusterTitle }) {
  const segs = String(slug || '').split('/').filter(Boolean);
  return [title, (segs.length > 1 ? segs.slice(1) : segs).join(' '), clusterTitle].filter(Boolean);
}

/** Contextual sentence, placed under the direct answer where the piece states its topic. */
function renderGuideInline(guides, siteLabel, esc) {
  if (!guides.length) return '';
  const links = guides.map((g) => `<a href="${esc(g.url)}" data-canonical-guide="true">${esc(g.title)}</a>`);
  return `<p class="canonical-guide-inline" data-canonical-guide-inline="${guides.length}">${esc(siteLabel)} covers this topic in full: ${links.join(' and ')}.</p>`;
}

/** "Read the full guide" line, placed directly above the closing provider CTA. */
function renderGuideClosing(guides, siteLabel, esc) {
  if (!guides.length) return '';
  const g = guides[0];
  return `<section class="card canonical-guide-closing" data-canonical-guide-closing="true"><p><strong>Read the full guide:</strong> <a href="${esc(g.url)}" data-canonical-guide="true">${esc(g.title)}</a> on ${esc(siteLabel)}.</p></section>`;
}

const INLINE_RE = /<p class="canonical-guide-inline"[^>]*>[\s\S]*?<\/p>/g;
const CLOSING_RE = /<section class="card canonical-guide-closing"[^>]*>[\s\S]*?<\/section>/g;
const BOTTOM_MARKER = '<section class="card canon-warning canon-warning-bottom';

/**
 * Put the two guide elements into already-rendered page HTML exactly where the
 * renderers emit them: the sentence at the end of the direct-answer card, the
 * "Read the full guide" line directly above the closing provider CTA. Idempotent
 * (existing elements are removed first). Throws when either anchor point is
 * missing, so a page is never half-linked.
 */
function injectIntoHtml(html, guides, siteLabel, esc, context) {
  let out = String(html).replace(INLINE_RE, '').replace(CLOSING_RE, '');
  if (!guides.length) return out;
  const da = out.indexOf('data-direct-answer="true"');
  const daEnd = da < 0 ? -1 : out.indexOf('</section>', da);
  if (daEnd < 0) throw new Error(`${context}: direct-answer card not found`);
  out = out.slice(0, daEnd) + renderGuideInline(guides, siteLabel, esc) + out.slice(daEnd);
  const bottom = out.indexOf(BOTTOM_MARKER);
  if (bottom < 0) throw new Error(`${context}: closing provider CTA (data-canon-block="bottom") not found`);
  // Keep the whitespace that already precedes the bottom CTA; the closing line goes before it.
  let at = bottom;
  while (at > 0 && /\s/.test(out[at - 1])) at -= 1;
  return out.slice(0, at) + renderGuideClosing(guides, siteLabel, esc) + out.slice(at);
}

/**
 * Every Velocity piece of the five older verticals and the guides it links:
 * route -> { vertical, site, guides }. Same inputs and rules as the renderers.
 */
function planPieceGuides(root) {
  const inventories = loadInventories(root);
  const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  const clusters = readJson('content/_shared/query_cluster_registry.json');
  const hubs = new Set(['/personal-injury/', '/dentistry/', '/trt/', '/neuro/', '/uscis-medical/', '/senior-living/']);
  const plan = new Map();
  const pieces = [];
  for (const p of readJson('content/_live/pages.json').pages || []) {
    const c = p.cluster && clusters[p.vertical] && clusters[p.vertical].clusters ? clusters[p.vertical].clusters[p.cluster] : null;
    pieces.push({ vertical: p.vertical, slug: p.slug, title: p.title, clusterTitle: c ? c.title : '' });
  }
  for (const p of readJson('data/page_families/velocity_page_specs.json').pages || []) {
    if (p.page_family !== 'SENIOR-LIVING-GUIDES') pieces.push({ vertical: p.vertical, slug: p.slug, title: p.title, clusterTitle: '' });
  }
  for (const piece of pieces) {
    const v = verticalKey(piece.vertical);
    if (v === 'senior-living' || hubs.has(piece.slug)) continue;
    const route = `/${String(piece.slug).replace(/^\/+|\/+$/g, '')}/`;
    const guides = matchGuides(inventories, v, pieceTopicTexts(piece));
    const inv = inventories.get(v);
    if (!inv) continue;
    if (!plan.has(route)) plan.set(route, { vertical: v, site: new URL(inv.origin).hostname, guides });
  }
  return plan;
}

module.exports = { injectIntoHtml, planPieceGuides, INLINE_RE, CLOSING_RE, INVENTORY_DIR, VERTICALS, MAX_GUIDES_PER_PIECE, verticalKey, loadInventories, matchGuides, pieceTopicTexts, renderGuideInline, renderGuideClosing };
