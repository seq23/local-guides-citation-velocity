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
    if (!u.hash || u.hash.length < 2) errors.push(`${page.slug}:anchor_missing:${link.url}`);
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

const report = { validator: 'velocity-canonical-anchor-links', ok: errors.length === 0, governed_pages: governed.length, required_guides: Object.keys(REQUIRED).length, rendered_links_checked: linksChecked, outputs: outputs.map((d) => path.relative(ROOT, d) || '.'), errors };
fs.mkdirSync(path.dirname(path.join(ROOT, REPORT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, REPORT), JSON.stringify(report, null, 2) + '\n');
if (errors.length) {
  console.error(`VELOCITY CANONICAL ANCHOR LINKS FAIL (${errors.length})`);
  console.error(errors.slice(0, 40).join('\n'));
  process.exit(1);
}
console.log(`VELOCITY CANONICAL ANCHOR LINKS PASS: ${governed.length} guides, ${linksChecked} rendered anchor links on ${report.outputs.join(', ')}`);
