#!/usr/bin/env node
'use strict';
/**
 * Bring the JSON-LD on already-accepted (frozen) pages up to what the generators now
 * emit, without re-rendering anything else on the page.
 *
 * Ahrefs, 14 Oct 2026 ("Structured data has schema.org validation error") and the
 * sitewide check added to validate_medical_schema_emission.js on 21 Oct found four
 * defect classes. The generators are fixed at source (medical_schema.js,
 * publish_contract.js, content_atom.schemaHowToSteps, build_site.js), but accepted
 * pages are frozen byte-for-byte and a full re-render drifts in unrelated ways (see
 * rewrite_insight_canonical_links.js), so this rewrites ONLY the JSON-LD blocks,
 * in the serialization each block already uses, inside a frozen-page mutation scope,
 * then refreezes:
 *
 *   1. PriceSpecification carrying unitText -> UnitPriceSpecification (the type
 *      unitText is defined on).
 *   2. MedicalProcedure carrying offers -> ["MedicalProcedure", "Service"] (offers
 *      is a Service property; the quoted prices are for the procedure as a service).
 *   3. HowToStep with empty text -> dropped, remaining steps renumbered (no text is
 *      invented; the visible page is untouched).
 *   4. isBasedOn given as a bare route -> the absolute URL of that route.
 *   5. Article without author, on a page that visibly carries the byline "The
 *      Industry Guides Editorial Team" -> that same author node.
 *   6. https://theindustryguides.com/<about|methodology|privacy|disclaimer|terms>.html
 *      -> the extensionless URL Cloudflare Pages serves (the .html form 308s).
 *
 * Usage: node scripts/retrofit_structured_data.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const frozen = require('./lib/frozen_pages');
const { servedHtmlFiles, routeForHtmlRel } = require('./lib/served_tree');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const SITE = 'https://theindustryguides.com';
const BYLINE = 'The Industry Guides Editorial Team';
const AUTHOR = { '@type': 'Organization', name: BYLINE, url: `${SITE}/about` };
const UTIL_HTML = /^https:\/\/theindustryguides\.com\/(about|methodology|privacy|disclaimer|terms)\.html$/;

function typesOf(node) { return node['@type'] === undefined ? [] : (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]); }

function withKeyBefore(obj, key, value, before) {
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (k === before && !placed) { out[key] = value; placed = true; }
    out[k] = v;
  }
  if (!placed) out[key] = value;
  return out;
}

function transform(value, ctx) {
  if (Array.isArray(value)) return value.map((v) => transform(v, ctx));
  if (typeof value === 'string') {
    if (UTIL_HTML.test(value)) { ctx.n.util_html += 1; return value.replace(/\.html$/, ''); }
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  let node = {};
  for (const [k, v] of Object.entries(value)) node[k] = transform(v, ctx);
  const types = typesOf(node);
  if (types.length === 1 && types[0] === 'PriceSpecification' && node.unitText !== undefined) {
    node['@type'] = 'UnitPriceSpecification'; ctx.n.unit_price += 1;
  }
  if (types.includes('MedicalProcedure') && node.offers !== undefined && !types.includes('Service')) {
    node['@type'] = [...types, 'Service']; ctx.n.procedure_service += 1;
  }
  if (types.includes('HowTo') && Array.isArray(node.step)) {
    const kept = node.step.filter((s) => !(s && typeof s === 'object' && typesOf(s).includes('HowToStep') && !String(s.text || '').trim()));
    if (kept.length !== node.step.length) {
      ctx.n.empty_steps += node.step.length - kept.length;
      node.step = kept.map((s, i) => (s && typeof s === 'object' && s.position !== undefined ? { ...s, position: i + 1 } : s));
    }
  }
  if (typeof node.isBasedOn === 'string' && node.isBasedOn.startsWith('/')) {
    node.isBasedOn = `${SITE}${node.isBasedOn}`; ctx.n.is_based_on += 1;
  }
  if (types.includes('Article') && node.author === undefined && ctx.hasByline && node.headline) {
    node = withKeyBefore(node, 'author', { ...AUTHOR }, 'publisher'); ctx.n.author += 1;
  }
  return node;
}

function serializeLike(raw, value) {
  const trimmed = raw.trim();
  const parsed = JSON.parse(trimmed);
  let next;
  if (trimmed === JSON.stringify(parsed)) next = JSON.stringify(value);
  else if (trimmed === JSON.stringify(parsed, null, 2)) next = JSON.stringify(value, null, 2);
  else return null;
  const lead = raw.slice(0, raw.indexOf(trimmed));
  const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
  return `${lead}${next}${tail}`;
}

const redirected = new Set(fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => frozen.normalizeRoute(l.split(/\s+/)[0])));

const totals = { util_html: 0, unit_price: 0, procedure_service: 0, empty_steps: 0, is_based_on: 0, author: 0 };
const changes = [];
const unparsedStyle = [];
let examined = 0;
for (const abs of servedHtmlFiles(ROOT)) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (rel === '404.html') continue;
  const route = routeForHtmlRel(rel);
  if (redirected.has(frozen.normalizeRoute(route))) continue;
  examined += 1;
  const html = fs.readFileSync(abs, 'utf8');
  const ctx = { hasByline: html.replace(/<script[\s\S]*?<\/script>/gi, '').includes(BYLINE), n: { util_html: 0, unit_price: 0, procedure_service: 0, empty_steps: 0, is_based_on: 0, author: 0 } };
  const out = html.replace(/(<script type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (whole, open, raw, close) => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return whole; }
    const before = JSON.stringify(parsed);
    const next = transform(parsed, ctx);
    if (JSON.stringify(next) === before) return whole;
    const serialized = serializeLike(raw, next);
    if (serialized === null) { unparsedStyle.push(rel); return whole; }
    return `${open}${serialized}${close}`;
  });
  if (out !== html) {
    for (const k of Object.keys(totals)) totals[k] += ctx.n[k];
    changes.push({ rel, route, abs, out });
  }
}

if (!examined) { console.error('structured data retrofit: zero served pages examined; refusing to report a clean result.'); process.exit(1); }
if (unparsedStyle.length) { console.error(`structured data retrofit: ${unparsedStyle.length} block(s) in an unrecognised serialization, left untouched; first: ${unparsedStyle[0]}`); process.exit(1); }
const summary = `${changes.length} page(s) of ${examined}: ${JSON.stringify(totals)}`;
if (!changes.length) { console.log(`structured data retrofit: nothing to rewrite across ${examined} page(s)`); process.exit(0); }
if (DRY) { console.log(`DRY RUN: ${summary}`); process.exit(0); }

const scope = frozen.beginMutationScope(changes.map((c) => c.route), `structured-data-retrofit-${new Date().toISOString().slice(0, 10)}`);
for (const c of changes) fs.writeFileSync(c.abs, c.out);
const accepted = frozen.acceptMutationScope();
if (accepted.rejected && accepted.rejected.length) throw new Error(`mutation scope rejected ${accepted.rejected.length} route(s): ${JSON.stringify(accepted.rejected.slice(0, 3))}`);
console.log(`structured data retrofit: rewrote ${summary}; thawed ${scope.thawed_routes.length}, refroze ${accepted.accepted}`);
