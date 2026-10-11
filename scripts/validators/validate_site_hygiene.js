#!/usr/bin/env node
'use strict';
/**
 * Site hygiene (one blocker for six items, read from
 * data/seo/site_hygiene_registry.json):
 *   favicon_manifest   - favicon.ico, touch icons and site.webmanifest are committed,
 *                        valid, and published by build_pages_dist.js
 *   og_image           - og.png is a 1200x630 PNG and every page gets og:image +
 *                        width/height + twitter:image from the publish-time installer
 *   jsonld_types       - the homepage carries every registered JSON-LD type
 *   definition         - a 40-60 word "<Site> is ..." paragraph directly under the H1,
 *                        and a SpeakableSpecification whose selectors all resolve
 *   clarity            - the Clarity map holds the registered host -> id
 *   indexnow_key       - the key file is committed at the root and is a valid key file
 *   registration       - every registered build step still runs in `npm run build`
 * Pages: dist/ when present (what ships), else every admitted rendered page passed
 * through the installer in memory, so CI without a dist still proves the tags land.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'artifacts', 'validation', 'site-hygiene.json');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const failures = {};
const fail = (item, msg) => { (failures[item] = failures[item] || []).push(msg); };

const reg = JSON.parse(read('data/seo/site_hygiene_registry.json'));
const brand = JSON.parse(read(reg.brand_config));
const host = reg.host;
const b = brand.hosts[host];
if (!b) fail('favicon_manifest', `no brand set for ${host}`);

// registration
const pkg = JSON.parse(read('package.json'));
let at = -1;
for (const step of reg.build_chain) {
  const i = pkg.scripts.build.indexOf(step);
  if (i < 0) fail('registration', `npm run build no longer runs ${step}`);
  else if (i < at) fail('registration', `${step} runs out of order in npm run build`);
  at = Math.max(at, i);
}
if (!read('scripts/build_pages_dist.js').includes("'seo', 'site_brand_assets.json'")) fail('registration', 'build_pages_dist.js no longer publishes the brand files');

// favicon / manifest
for (const f of brand.files) if (!fs.existsSync(path.join(ROOT, f))) fail('favicon_manifest', `${f} missing at repo root`);
if (fs.existsSync(path.join(ROOT, 'favicon.ico'))) {
  const ico = fs.readFileSync(path.join(ROOT, 'favicon.ico'));
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) fail('favicon_manifest', 'favicon.ico is not an ICO file');
}
try {
  const man = JSON.parse(read('site.webmanifest'));
  if (!(man.icons || []).length) fail('favicon_manifest', 'site.webmanifest lists no icons');
  for (const i of man.icons || []) if (!fs.existsSync(path.join(ROOT, i.src.replace(/^\//, '')))) fail('favicon_manifest', `manifest icon ${i.src} missing`);
} catch (e) { fail('favicon_manifest', `site.webmanifest: ${e.message}`); }

// og image file
const ogFile = path.join(ROOT, brand.og.path.replace(/^\//, ''));
if (fs.existsSync(ogFile)) {
  const png = fs.readFileSync(ogFile);
  const w = png.readUInt32BE(16); const h = png.readUInt32BE(20);
  if (png.toString('ascii', 1, 4) !== 'PNG' || w !== brand.og.width || h !== brand.og.height) fail('og_image', `og.png is not a ${brand.og.width}x${brand.og.height} PNG`);
}

// pages: head tags
const { install, headBlock } = require('../install_site_head_assets');
const DIST = path.join(ROOT, 'dist');
let pages = [];
let source;
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  source = 'dist';
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) pages.push({ file: path.relative(DIST, p), html: fs.readFileSync(p, 'utf8') }); });
  walk(DIST);
} else {
  source = 'rendered+installer';
  const frozen = JSON.parse(read('data/release/frozen_page_registry.json')).pages || [];
  const block = headBlock(host, b, brand.og);
  pages = frozen.map((p) => p.rendered_file).filter((f) => f && fs.existsSync(path.join(ROOT, f)))
    .map((f) => { const html = read(f); return { file: f, html: install(html, block) || html }; });
}
pages = pages.filter((p) => /<\/head>/i.test(p.html));
if (!pages.length) fail('og_image', 'no pages found to check');
const want = `https://${host}${brand.og.path}`;
const meta = (hd, attr, name) => ((hd.match(new RegExp(`<meta[^>]+${attr}="${name}"[^>]*>`, 'i')) || [''])[0].match(/content="([^"]*)"/) || [])[1];
let badOg = []; let badIcon = [];
for (const p of pages) {
  const hd = p.html.slice(0, p.html.search(/<\/head>/i));
  if (meta(hd, 'property', 'og:image') !== want || meta(hd, 'property', 'og:image:width') !== String(brand.og.width) || meta(hd, 'property', 'og:image:height') !== String(brand.og.height) || meta(hd, 'name', 'twitter:image') !== want) badOg.push(p.file);
  if (!/<link rel="icon" href="\/favicon\.ico"/.test(hd) || !/<link rel="manifest" href="\/site\.webmanifest"/.test(hd) || !/rel="apple-touch-icon"/.test(hd)) badIcon.push(p.file);
}
if (badOg.length) fail('og_image', `${badOg.length}/${pages.length} pages lack og:image/size/twitter:image, e.g. ${badOg.slice(0, 3).join(', ')}`);
if (badIcon.length) fail('favicon_manifest', `${badIcon.length}/${pages.length} pages lack icon/manifest links, e.g. ${badIcon.slice(0, 3).join(', ')}`);

// homepage
const hp = reg.homepage;
const home = (source === 'dist' && fs.existsSync(path.join(DIST, hp.rendered_file))) ? fs.readFileSync(path.join(DIST, hp.rendered_file), 'utf8') : read(hp.rendered_file);
const m = home.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*(<p[^>]*>)([\s\S]*?)<\/p>/i);
let words = 0;
if (!m || !m[1].includes(hp.definition_marker)) fail('definition', 'the element directly under the H1 is not the definition paragraph');
else {
  const text = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  words = text.split(' ').length;
  if (words < hp.definition_words[0] || words > hp.definition_words[1]) fail('definition', `definition is ${words} words`);
  if (!text.startsWith(hp.definition_opens_with)) fail('definition', `definition must open "${hp.definition_opens_with}"`);
}
const nodes = [];
for (const s of home.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
  try { const v = JSON.parse(s[1]); const add = (x) => { if (Array.isArray(x)) x.forEach(add); else if (x && x['@graph']) add(x['@graph']); else if (x) nodes.push(x); }; add(v); }
  catch (e) { fail('jsonld_types', `invalid JSON-LD: ${e.message}`); }
}
const types = new Set(nodes.flatMap((n) => [].concat(n['@type'] || [])));
for (const t of hp.jsonld_types) if (!types.has(t)) fail('jsonld_types', `homepage lacks ${t}`);
const wp = nodes.find((n) => [].concat(n['@type']).includes('WebPage'));
const sels = wp && wp.speakable ? [].concat(wp.speakable.cssSelector || []) : [];
for (const s of hp.speakable_selectors) if (!sels.includes(s)) fail('definition', `WebPage speakable lacks ${s}`);
for (const s of sels) {
  let ok = false; let mm;
  if ((mm = s.match(/^\.([\w-]+)$/))) ok = new RegExp(`class="[^"]*\\b${mm[1]}\\b`).test(home);
  else if ((mm = s.match(/^\[([\w-]+)="([^"]*)"\]$/))) ok = home.includes(`${mm[1]}="${mm[2]}"`);
  if (!ok) fail('definition', `speakable selector ${s} does not resolve on the homepage`);
}

// clarity
const clarity = (JSON.parse(read('data/clarity_projects.json')).projects) || {};
for (const [h, id] of Object.entries(reg.clarity_projects)) if (clarity[h] !== id) fail('clarity', `${h} maps to ${clarity[h]}, registered ${id}`);

// indexnow
const kf = reg.indexnow_key_file;
if (!fs.existsSync(path.join(ROOT, kf))) fail('indexnow_key', `${kf} not committed at the root`);
else if (read(kf).trim() !== kf.replace(/\.txt$/, '')) fail('indexnow_key', `${kf} content is not its key`);

const report = { validator: 'site-hygiene', source, pages: pages.length, definition_words: words, ok: !Object.keys(failures).length, failures };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
if (!report.ok) {
  for (const [k, v] of Object.entries(failures)) console.error(`SITE HYGIENE FAIL [${k}]: ${v.join(' | ')}`);
  process.exit(1);
}
console.log(`SITE HYGIENE PASS (${host}; ${pages.length} pages via ${source}; definition ${words} words; ${types.size} JSON-LD types)`);
