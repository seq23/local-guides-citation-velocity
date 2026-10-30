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
 *   definition         - exactly one 40-60 word "<Site> is ..." definition paragraph
 *                        (the registry's definition_marker) inside <main>, above the
 *                        footer - in the hero or an "About" block, placement is the
 *                        page's call (14 Oct 2026: the umbrella hero is H1 + one
 *                        subline, the definition sits in About) - and a
 *                        SpeakableSpecification whose selectors all resolve
 *   clarity            - the Clarity map holds the registered host -> id
 *   indexnow_key       - the key file is committed at the root and is a valid key file
 *   registration       - every registered build step still runs in `npm run build`
 *   zero_paid_llm      - no scheduled paid model call; $0-only routing; probes dispatch-only
 *   build_result_cache - the gate builds once per commit; the wrapper keeps its refusals
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
/**
 * The definition rule, as a pure function so its negative proofs replay every run.
 * Returns { words, errors }. The purpose is AEO entity clarity: one "<Site> is ..."
 * paragraph a reader and an answer engine can lift, inside <main> (never the
 * footer), and only one, so the speakable selector reads one definition.
 */
function checkDefinition(html, hp) {
  const errors = [];
  const main = String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!main) return { words: 0, errors: ['the homepage has no <main> to hold the definition'] };
  const marked = [...main[1].matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/gi)].filter((x) => x[1].includes(hp.definition_marker));
  const outside = (String(html).match(new RegExp(hp.definition_marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length - marked.length;
  if (outside > 0) errors.push(`${outside} definition marker(s) outside a <p> in <main>`);
  if (!marked.length) return { words: 0, errors: [...errors, 'no definition paragraph inside <main>'] };
  if (marked.length > 1) errors.push(`${marked.length} definition paragraphs, exactly one required`);
  const text = marked[0][2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').length;
  if (words < hp.definition_words[0] || words > hp.definition_words[1]) errors.push(`definition is ${words} words`);
  if (!text.startsWith(hp.definition_opens_with)) errors.push(`definition must open "${hp.definition_opens_with}"`);
  return { words, errors };
}
const defProof = (() => {
  const mk = (n) => `<p class="site-definition" ${hp.definition_marker}>${hp.definition_opens_with}${Array.from({ length: n }, () => 'word').join(' ')}.</p>`;
  const good = mk(hp.definition_words[0] + 5);
  const cases = [
    ['definition in an About block above the footer passes', `<main><section><h1>H</h1><p>Pick.</p></section><section><h2>About</h2>${good}</section></main><footer></footer>`, true],
    ['definition under the H1 passes', `<main><section><h1>H</h1>${good}</section></main>`, true],
    ['no definition fails', '<main><section><h1>H</h1><p>Pick.</p></section></main>', false],
    ['definition only in the footer fails', `<main><h1>H</h1></main><footer>${good}</footer>`, false],
    ['two definition paragraphs fail', `<main><h1>H</h1>${good}<section>${good}</section></main>`, false],
    ['a too-short definition fails', `<main><h1>H</h1>${mk(5)}</main>`, false],
    ['a definition that does not open with the site name fails', `<main><h1>H</h1><p ${hp.definition_marker}>${Array.from({ length: 50 }, () => 'word').join(' ')}</p></main>`, false],
  ];
  const missed = cases.filter(([, html, pass]) => (checkDefinition(html, hp).errors.length === 0) !== pass).map(([n]) => n);
  return { cases: cases.length, missed };
})();
for (const n of defProof.missed) fail('definition', `negative proof no longer holds: ${n}`);
const def = checkDefinition(home, hp);
const words = def.words;
for (const e of def.errors) fail('definition', e);
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

// h6: a build cache must be isolated by the full checkout, after source sync.
// Prefix restores would undo this boundary even with a correct primary key.
for (const workflow of ['velocity-content-release.yml', 'velocity-full-rebuild.yml']) {
  const text = read(`.github/workflows/${workflow}`);
  const cache = text.match(/      - name: Restore build-result cache[\s\S]*?(?=      - name:|$)/);
  if (!cache || !cache[0].includes("hashFiles('**', '!.github/workflows/**')") || /restore-keys:/.test(cache[0])) fail('build_cache_key', `${workflow} must hash the complete checkout without a fallback`);
  if (!cache || text.indexOf('git reset --hard origin/main') > cache.index) fail('build_cache_key', `${workflow} must synchronize before cache restore`);
}

// indexnow
const kf = reg.indexnow_key_file;
if (!fs.existsSync(path.join(ROOT, kf))) fail('indexnow_key', `${kf} not committed at the root`);
else if (read(kf).trim() !== kf.replace(/\.txt$/, '')) fail('indexnow_key', `${kf} content is not its key`);


// search intelligence (11 Oct 2026): registered files present and wired into the
// daily cycle, Search Console truth fresh and internally consistent, every target
// measured, the publishing freeze read by the release lane, ranked links installed.
{
  const si = reg.search_intelligence;
  if (!si) fail('search_intelligence', 'block missing from the registry');
  else {
    for (const f of si.files) if (!fs.existsSync(path.join(ROOT, f))) fail('search_intelligence', `${f} missing`);
    const wf = read(si.workflow);
    for (const r of si.workflow_runs) if (!wf.includes(r)) fail('search_intelligence', `${si.workflow} no longer runs ${r}`);
    for (const c of si.workflow_commits) if (!new RegExp(`git add -- \\$file_pattern[^\\n]*${c.replace(/[./]/g, '\\$&')}`).test(wf)) fail('search_intelligence', `${si.workflow} no longer commits ${c}`);
    if (Object.keys(failures).includes('search_intelligence') === false) {
      const j = (f) => JSON.parse(read(`data/search_intelligence/${f}`));
      const cov = j('index_coverage.json'); const gsc = j('gsc_search_analytics_export.json');
      for (const [n, at] of [['index_coverage.json', cov.collected_at], ['gsc_search_analytics_export.json', gsc.collected_at]]) {
        if (!(Date.now() - Date.parse(at) <= si.freshness_days * 86400000)) fail('search_intelligence', `${n} is stale (collected_at ${at}, limit ${si.freshness_days} days): the daily cycle stopped measuring`);
      }
      if (cov.site_url !== si.site || gsc.site_url !== si.site) fail('search_intelligence', `coverage/analytics are not for ${si.site}`);
      const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
      const n = cov.urls.length;
      if (sum(cov.summary.by_coverage_state) !== n || sum(cov.summary.buckets) !== n || cov.inspected_total !== n) fail('search_intelligence', `index_coverage.json counts disagree with its ${n} rows`);
      if (cov.inspected_total + cov.never_inspected !== cov.sitemap_url_count) fail('search_intelligence', 'index_coverage.json inspected + never_inspected != sitemap_url_count');
      if (cov.inspected_this_run > si.inspect_cap_per_day) fail('search_intelligence', `index_coverage.json inspected ${cov.inspected_this_run} > ${si.inspect_cap_per_day}`);
      const tq = j('target_query_set.json');
      if (!tq.targets.length || tq.count !== tq.targets.length) fail('search_intelligence', `target_query_set.json has ${tq.targets.length} targets (count ${tq.count})`);
      for (const t of tq.targets) if (!['gsc_export', 'measured_demand'].includes(t.source) || !(Number(t.measurement && t.measurement.value) > 0) || !t.owner_route) fail('search_intelligence', `target "${t.query}" has no measured number or owner`);
      const cc = j('consolidation_candidates.json');
      if (cc.status !== 'LEDGER_ONLY_NO_REDIRECTS' || cc.candidates.some((c) => !c.fold_into)) fail('search_intelligence', 'consolidation_candidates.json must be a ledger with fold_into per candidate');
      if (typeof j('publishing_freeze.json').enabled !== 'boolean') fail('search_intelligence', 'publishing_freeze.json enabled must be a boolean');
      for (const [file, needle] of Object.entries(si.freeze_readers)) if (!read(file).includes(needle)) fail('search_intelligence', `${file} no longer reads the publishing freeze (${needle})`);
      if (!read(si.ranked_links_installer).includes('installRankedLinks(outDir)')) fail('search_intelligence', `${si.ranked_links_installer} no longer installs the ranked links`);
      for (const p of j('strengthened_pages.json').pages) if (!fs.existsSync(path.join(ROOT, p.rendered_file))) fail('search_intelligence', `strengthened page ${p.route} has no rendered file ${p.rendered_file}`);
      if (source === 'dist' && !home.includes('data-search-ranked-links="true"')) fail('search_intelligence', 'dist homepage lacks the ranked-links block');
    }
  }
}

// zero paid LLM (owner policy 11 Oct 2026: "nothing should be paid ... cut the
// probes and make them free"): rules in scripts/lib/zero_paid_llm_check.js, block
// in the registry. Hostile fixtures replay every run, so a guard that stopped
// catching a scheduled paid call fails here rather than passing quietly.
{
  const zp = reg.zero_paid_llm;
  if (!zp) fail('zero_paid_llm', 'block missing from the registry');
  else {
    const { check, selfTest, repoIo } = require('../lib/zero_paid_llm_check.js');
    const r = check(repoIo(ROOT), { reg: zp });
    for (const f of r.failures) fail('zero_paid_llm', f);
    for (const w of r.warnings) console.log(`  !! SITE HYGIENE WARNING [zero_paid_llm]: ${w}`);
    const proof = selfTest(ROOT, zp);
    for (const m of proof.missed) fail('zero_paid_llm', `negative proof no longer caught: ${m}`);
    // Router behaviour (stubbed fetch): a per-model 403/404 falls through, only a
    // refused KEY stops the route, an empty/timed-out/no-choices answer is never an
    // answer, 429 Retry-After is bounded, and every $0 guarantee still throws.
    const rt = require('child_process').spawnSync(process.execPath, ['scripts/tests/test_free_llm_router.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' } });
    const pins = /free_llm_router: (\d+) behaviour pins pass/.exec(rt.stdout || '');
    if (rt.status !== 0 || !pins || Number(pins[1]) < 18) fail('zero_paid_llm', `router behaviour pins failed: ${((rt.stderr || '') + (rt.stdout || '')).trim().split('\n').slice(-6).join(' | ').slice(0, 600)}`);
    if (!r.failures.length && !proof.missed.length && rt.status === 0 && pins) console.log(`  zero_paid_llm: ${pins[1]} router behaviour pins; ${r.stats.scheduled_workflows} scheduled workflows reach no paid model; ${r.stats.probe_workflows} probe workflow dispatch-only behind confirm_paid; ${r.stats.models} $0 models; ${proof.cases} negative proofs caught`);
  }
}

// build-result cache (Search Readiness h5): the merge gate builds the site once
// per commit, which holds only while the lane goes through the wrapper, the
// wrapper keeps its two refusals, the gate keeps the store off the checkout and
// the generated ledgers stay out of the hashed input surface. Rules in
// scripts/lib/build_cache_contract_check.js, block in the registry; hostile
// fixtures replay every run. Folded in here for the same reason zero_paid_llm is:
// the release profile is capped at 40 blockers on purpose.
{
  const bc = reg.build_result_cache;
  if (!bc) fail('build_result_cache', 'block missing from the registry');
  else {
    const { check, selfTest } = require('../lib/build_cache_contract_check.js');
    const r = check(undefined, { reg: bc });
    for (const f of r.failures) fail('build_result_cache', f);
    for (const w of r.warnings) console.log(`  !! SITE HYGIENE WARNING [build_result_cache]: ${w}`);
    const proof = selfTest({ reg: bc });
    for (const m of proof.missed) fail('build_result_cache', `negative proof no longer caught: ${m}`);
    if (!r.failures.length && !proof.missed.length) console.log(`  build_result_cache: the lane builds through the wrapper, both refusals present, ${r.stats.workflows.length} workflows keep the store off the checkout (${r.stats.workflows.join(', ')}); ${proof.cases} negative proofs caught`);
  }
}

const report = { validator: 'site-hygiene', source, pages: pages.length, definition_words: words, ok: !Object.keys(failures).length, failures };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
if (!report.ok) {
  for (const [k, v] of Object.entries(failures)) console.error(`SITE HYGIENE FAIL [${k}]: ${v.join(' | ')}`);
  process.exit(1);
}
console.log(`SITE HYGIENE PASS (${host}; ${pages.length} pages via ${source}; definition ${words} words, ${defProof.cases} definition proofs; ${types.size} JSON-LD types)`);
