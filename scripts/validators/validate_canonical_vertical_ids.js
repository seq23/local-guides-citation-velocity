#!/usr/bin/env node
'use strict';
// Every `vertical` this repo EMITS is a canonical id, and no published route
// doubles a vertical slug.
//
// Why this exists (13 Oct 2026)
// -----------------------------
// The same vertical left this repo under several spellings: "uscis",
// "uscis_medical" and "uscis-medical"; "pi", "personal_injury" and
// "personal-injury". local-guides-generator reads what this repo emits and kept
// its own alias table; any spelling it did not know was dropped on the floor
// (all 9 candidates it never ingested were personal_injury). The canonical ids
// are in data/contracts/velocity_vertical_aliases.json (mirrored from the
// generator), every emitter resolves through scripts/lib/canonical_vertical.js,
// and this validator reads the files those emitters write.
//
// It also absorbs the retired no-double-vertical-slugs check ("dentistry-
// dentistry-..." in a route), now for every canonical id and alias, without
// that check's brittle 3,000-file floor: here a sweep that finds zero emitted
// vertical values or zero route-bearing files is the failure.
//
// Emitted files governed (and the writer that produces each):
//   feeds/*.json                                  scripts/feeds/build_promotion_candidates_feed.js
//   releases/fanout_query_clusters.<v>.json       scripts/build_site.js (file name AND contents)
//   data/signals/{release_candidates,scores,clusters}/latest.json
//                                                 scripts/citation_intelligence/pipeline_lib.js
//   data/measurement/free_win_self_heal_queue.json,
//   artifacts/validation/citation-100k-runway.json,
//   data/queries/citation_fanout_opportunities_100k/*.json.gz
//                                                 scripts/citation_intelligence/build_100k_citation_runway.js
//   .build/fanout_manifest.json (when built)      scripts/build_site.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TABLE_REL = 'data/contracts/velocity_vertical_aliases.json';
const FILE_BUCKETS_ALLOWED = new Set(['generic']); // releases bucket for pages with no vertical (home, tools)
const SLUG_SWEEP_FILES = ['sitemap.xml', 'llms.txt', 'content/_live/published_urls.json', 'content/_live/insights.json', 'content/_shared/query_to_cluster_map.json', 'content/_shared/atlas_registry.json'];
const SLUG_SWEEP_DIRS = ['sitemaps', 'insights', 'atlas'];

function readTable(root) {
  const abs = path.join(root, TABLE_REL);
  if (!fs.existsSync(abs)) return { error: `${TABLE_REL} is missing` };
  const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const ids = new Set(doc.canonical_ids || []);
  if (!ids.size) return { error: `${TABLE_REL} lists no canonical_ids` };
  return { ids, aliases: Object.keys(doc.aliases || {}) };
}

function emittedFiles(root) {
  const out = [];
  const add = (rel) => { if (fs.existsSync(path.join(root, rel))) out.push(rel); };
  const listDir = (rel, re) => { const abs = path.join(root, rel); return fs.existsSync(abs) ? fs.readdirSync(abs).filter((n) => re.test(n)).map((n) => `${rel}/${n}`) : []; };
  listDir('feeds', /\.json$/).forEach(add);
  listDir('releases', /^fanout_query_clusters\..+\.json$/).forEach(add);
  ['data/signals/release_candidates/latest.json', 'data/signals/scores/latest.json', 'data/signals/clusters/latest.json',
    'data/measurement/free_win_self_heal_queue.json', 'artifacts/validation/citation-100k-runway.json', '.build/fanout_manifest.json'].forEach(add);
  listDir('data/queries/citation_fanout_opportunities_100k', /\.json(\.gz)?$/).forEach(add);
  return out;
}

function readJsonMaybeGz(abs) {
  const buf = fs.readFileSync(abs);
  const text = abs.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
}

function collectVerticals(node, sink, at) {
  if (Array.isArray(node)) { node.forEach((v, i) => collectVerticals(v, sink, `${at}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'vertical') { if (v !== null && v !== undefined) sink.push({ value: v, at: `${at}.${k}` }); }
    else collectVerticals(v, sink, `${at}.${k}`);
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function checkTree(root) {
  const errors = [];
  const table = readTable(root);
  if (table.error) return { errors: [table.error], files: 0, values: 0, slugFiles: 0 };
  const files = emittedFiles(root);
  let values = 0;
  for (const rel of files) {
    const m = /^releases\/fanout_query_clusters\.(.+)\.json$/.exec(rel);
    if (m && !table.ids.has(m[1]) && !FILE_BUCKETS_ALLOWED.has(m[1])) errors.push(`${rel}: file name carries non-canonical vertical "${m[1]}"`);
    if (m && table.ids.has(m[1])) values += 1;
    let doc;
    try { doc = readJsonMaybeGz(path.join(root, rel)); } catch (e) { errors.push(`${rel}: unreadable (${e.message})`); continue; }
    const found = [];
    collectVerticals(doc, found, rel);
    values += found.length;
    const bad = found.filter((f) => typeof f.value !== 'string' || !table.ids.has(f.value));
    const byValue = new Map();
    for (const b of bad) byValue.set(String(b.value), (byValue.get(String(b.value)) || []).concat(b.at));
    for (const [v, ats] of byValue) errors.push(`${rel}: ${ats.length} non-canonical vertical value(s) "${v}" (first at ${ats[0]})`);
  }
  if (!files.length) errors.push('no emitted file was found to check; the governed emitters wrote nothing');
  if (!values) errors.push('emitted files carry zero vertical values; a check that reads nothing proves nothing');

  // Doubled vertical slugs ("dentistry-dentistry-") in any published route list.
  const spellings = [...new Set([...table.ids, ...table.aliases.filter((a) => /^[a-z0-9_-]+$/.test(a))])];
  const doubled = new RegExp(`(?:^|[/"'\\s])(${spellings.map((s) => s.replace(/[-]/g, '\\-')).join('|')})-\\1-`);
  const sweep = [...SLUG_SWEEP_FILES.map((r) => path.join(root, r)).filter((p) => fs.existsSync(p)),
    ...SLUG_SWEEP_DIRS.flatMap((d) => walk(path.join(root, d)).filter((p) => /\.(xml|json|txt)$/.test(p) || p.endsWith('.html')))];
  let slugFiles = 0;
  for (const abs of sweep) {
    slugFiles += 1;
    const rel = path.relative(root, abs);
    if (doubled.test(rel)) { errors.push(`${rel}: doubled vertical slug in file path`); continue; }
    if (abs.endsWith('.html')) continue; // rendered pages are covered by their path; their routes are in the sitemaps
    const text = fs.readFileSync(abs, 'utf8');
    const hit = doubled.exec(text);
    if (hit) errors.push(`${rel}: doubled vertical slug "${hit[1]}-${hit[1]}-"`);
  }
  if (!slugFiles) errors.push('no sitemap, route list or rendered route was found for the doubled-slug sweep');
  return { errors, files: files.length, values, slugFiles };
}

// Self-test on synthetic trees: runs every time, so the guard cannot rot into
// a check that passes everything. scripts/tests/test_canonical_vertical_ids.js
// runs the same cases standalone.
function selfTest() {
  const os = require('os');
  const table = fs.readFileSync(path.join(process.cwd(), TABLE_REL), 'utf8');
  const make = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-vertical-'));
    for (const [rel, text] of Object.entries({ [TABLE_REL]: table, ...files })) {
      if (text === undefined) continue;
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
  };
  const feed = (v) => JSON.stringify({ candidates: [{ id: 'a', vertical: v }] });
  const clean = { 'feeds/promotion-candidates.json': feed('personal-injury'), 'releases/fanout_query_clusters.uscis-medical.json': '[]', 'sitemap.xml': '<loc>https://theindustryguides.com/dentistry/x/</loc>' };
  const cases = [
    ['clean tree passes', clean, true],
    ['"pi" in the feed fails', { ...clean, 'feeds/promotion-candidates.json': feed('pi') }, false],
    ['"personal_injury" in release candidates fails', { ...clean, 'data/signals/release_candidates/latest.json': JSON.stringify({ candidates: [{ vertical: 'personal_injury' }] }) }, false],
    ['"uscis" fanout file name fails', { ...clean, 'releases/fanout_query_clusters.uscis.json': '[]' }, false],
    ['doubled slug in the sitemap fails', { ...clean, 'sitemap.xml': '<loc>https://theindustryguides.com/insights/dentistry-dentistry-q1.html</loc>' }, false],
    ['zero emitted files fails', { 'sitemap.xml': clean['sitemap.xml'] }, false],
    ['zero route files fails', { ...clean, 'sitemap.xml': undefined }, false],
  ];
  const failures = [];
  for (const [name, files, shouldPass] of cases) {
    const root = make(files);
    const r = checkTree(root);
    fs.rmSync(root, { recursive: true, force: true });
    if ((r.errors.length === 0) !== shouldPass) failures.push(`${name}: expected ${shouldPass ? 'pass' : 'fail'}, got ${r.errors.length ? r.errors.join('; ') : 'pass'}`);
  }
  return { cases: cases.length, failures };
}

module.exports = { checkTree, selfTest, TABLE_REL };

if (require.main === module) {
  const root = process.cwd();
  const st = selfTest();
  const r = checkTree(root);
  const errors = [...st.failures.map((f) => `self-test: ${f}`), ...r.errors];
  const report = { validator: 'canonical-vertical-ids', ok: errors.length === 0, emitted_files: r.files, vertical_values: r.values, slug_files_swept: r.slugFiles, self_test_cases: st.cases, errors };
  fs.mkdirSync(path.join(root, 'artifacts/validation'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/validation/canonical-vertical-ids.json'), JSON.stringify(report, null, 2) + '\n');
  if (errors.length) {
    console.error(`CANONICAL VERTICAL IDS FAIL (${errors.length}):\n- ${errors.slice(0, 25).join('\n- ')}\nFix the emitter (resolve through scripts/lib/canonical_vertical.js), not the file.`);
    process.exit(1);
  }
  console.log(`CANONICAL VERTICAL IDS PASS: ${r.values} emitted vertical value(s) across ${r.files} file(s) are canonical; ${r.slugFiles} route file(s) carry no doubled vertical slug; self-test ${st.cases}/${st.cases}.`);
}
