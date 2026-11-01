#!/usr/bin/env node
'use strict';
/**
 * Folds the search loop's pages into this repo's release law. Runs after every engine
 * run (post-build on proof runs, and in scripts/search_loop/commit.sh before the
 * default branch commits). Idempotent: running it twice changes nothing the second time.
 *
 * The engine (seq23/search-loop@v1) writes gated pages to questions/<slug>/index.html,
 * adds "Related questions" links to up to two existing pages, and keeps its ledger in
 * data/search-loop/. This repo serves only ADMITTED routes and restores FROZEN bytes on
 * every build, so without this step the pages would never reach dist/ and the related
 * links would be wiped by the next build. In order:
 *
 *   1. PI rules (spry brain, 1 Nov 2026) on accident pages: no "best / top / expert"
 *      wording, never "lawyer referral service" (any page), and the "we do not endorse
 *      or recommend any lawyer" line present. A new page that breaks one is dropped
 *      (file, related links and ledger entry -> ledger `dropped`, not retried for 28
 *      days, like an engine gate failure). Never published, never rewritten.
 *   2. Vertical + matching canonical guide for every live page. The page's one action
 *      is pointed at that guide on the canonical site; with no matching guide it points
 *      at the vertical's canonical home and the search goes on the missing-guide list
 *      (velocity.missing_guides_file) that local-guides-generator's agent reads.
 *   3. Related links placed on a host that cannot deliver them (not admitted, or a 301
 *      source in _redirects) are taken back out: a link no crawler is served is not one.
 *   4. The /questions/ hub (every live page, by vertical) is regenerated.
 *   5. The admission registry is rebuilt (its fourth corpus is this ledger), and every
 *      new page, the hub and every host the engine edited are frozen at their new bytes,
 *      so the build that follows advertises them (sitemap, feeds, dist) and restores
 *      them instead of wiping them.
 *   6. A live page that has since been merged by the engine (90 days, 301 in _redirects)
 *      leaves the frozen registry with an ACTIVE_301 retirement, per PAGE_RELEASE_LAW 2A.
 *
 * Prints one census line. Exit 0 = done (or nothing to do, said so); 1 = a problem.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CFG_REL = 'search-loop.config.json';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (rel, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fb; } };
const writeJson = (rel, v) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = () => (process.env.SOURCE_DATE || new Date().toISOString()).slice(0, 10);

const STOP = new Set('a an and are as at be by can do does for from how i in is it my of on or the to what when where which who why will with you your vs versus after before about'.split(' '));
const stem = (w) => w.replace(/(ing|ers|er|ed|es|s)$/, '');
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w));

// ---- PI rules (accident vertical), spry brain "Accident guides / PI law firms" ----
const PI_RANKING = /\b(best|top|top-rated|expert|experts)\b/i;
const REFERRAL_SERVICE = /\b(lawyer|attorney) referral service\b/i;
const NO_ENDORSE = /we do not endorse or recommend any lawyer/i;

function mainText(html) {
  const m = html.match(/<main\b[\s\S]*?<\/main>/i);
  const body = m ? m[0] : html;
  return body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function titleOf(html) { return ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim(); }

function piProblems(html, vertical) {
  const p = [];
  const text = `${titleOf(html)} ${mainText(html)}`;
  if (REFERRAL_SERVICE.test(text)) p.push(`pi: "${text.match(REFERRAL_SERVICE)[0]}" (never call anything a lawyer referral service)`);
  if (vertical === 'personal-injury') {
    if (PI_RANKING.test(text)) p.push(`pi: ranking word "${text.match(PI_RANKING)[0]}" on an accident page (no best/top/expert)`);
    if (!NO_ENDORSE.test(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))) p.push('pi: missing "we do not endorse or recommend any lawyer"');
  }
  return p;
}

// ---- vertical + canonical guide ----
function classify(query, verticals) {
  const q = new Set(words(query).map(stem));
  let best = null;
  for (const v of verticals) {
    const hits = (v.keywords || []).map((k) => stem(k.toLowerCase())).filter((k) => q.has(k)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { v, hits };
  }
  return best ? best.v : null;
}

function guidesFor(domain, snapshot) {
  return ((snapshot.domains || {})[domain] || []).filter((r) => /^\/guides\/[^/]+\/$/.test(r));
}

function matchGuide(query, vertical, snapshot) {
  // A guide matches when it shares at least two words with the search AND at least one
  // of them is not just the vertical's own vocabulary ("uscis medical exam" alone would
  // match every USCIS guide; the specific word - cost, vaccines, checklist - decides).
  const q = [...new Set(words(query).map(stem))];
  const vocab = new Set((vertical.keywords || []).map((k) => stem(k.toLowerCase())));
  let best = null;
  for (const route of guidesFor(vertical.canonical_domain, snapshot)) {
    const slug = new Set(words(route.replace(/^\/guides\//, '')).map(stem));
    const shared = q.filter((w) => slug.has(w)).length;
    const score = q.length ? shared / Math.min(q.length, Math.max(slug.size, 1)) : 0;
    const specific = q.filter((w) => slug.has(w) && !vocab.has(w)).length;
    if (shared >= 2 && specific >= 1 && score >= 0.5 && (!best || score > best.score || (score === best.score && route.length < best.route.length))) best = { route, score: Math.round(score * 100) / 100 };
  }
  return best;
}

function slugify(q) { return words(q).join('-').slice(0, 80); }

// ---- related-link removal (same markup the engine writes; src/render.mjs) ----
const RELATED_START = '<!-- search-loop:related -->';
const RELATED_END = '<!-- /search-loop:related -->';
function withoutRelatedLink(html, route) {
  const re = new RegExp(`<li><a href="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[\\s\\S]*?</a></li>`);
  let out = html.replace(re, '');
  out = out.replace(`${RELATED_START}<section class="search-loop-related"><h2>Related questions</h2><ul></ul></section>${RELATED_END}`, '');
  return out;
}

function setAction(html, href, label) {
  const re = /<p class="site-action"><a class="button" href="[^"]*">[\s\S]*?<\/a><\/p>/;
  if (!re.test(html)) return null;
  return html.replace(re, `<p class="site-action"><a class="button" href="${esc(href)}">${esc(label)}</a></p>`);
}

function redirectSources() {
  const s = new Map();
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const [from, to] = t.split(/\s+/);
      if (from && from.startsWith('/')) s.set(from.replace(/\/+$/, '/') || '/', to || '/');
    }
  } catch { /* no _redirects */ }
  return s;
}

// The site's Organization and WebSite nodes, read from a rendered vertical hub so
// there is one definition (build_site.js writes them); every served page must carry
// both @ids (validate_network_crawler_contract.js).
function siteEntityNodes(baseUrl) {
  const ids = [`${baseUrl}/#organization`, `${baseUrl}/#website`];
  try {
    const html = fs.readFileSync(path.join(ROOT, 'dentistry/index.html'), 'utf8');
    const nodes = [];
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let d; try { d = JSON.parse(m[1]); } catch { continue; }
      for (const n of (d['@graph'] || [d])) if (ids.includes(n['@id']) && !nodes.some((x) => x['@id'] === n['@id'])) nodes.push(n);
    }
    if (nodes.length === 2) return nodes;
  } catch { /* fall through to the minimal nodes */ }
  return [{ '@type': 'Organization', '@id': ids[0], name: 'The Industry Guides', url: `${baseUrl}/` }, { '@type': 'WebSite', '@id': ids[1], name: 'The Industry Guides', url: `${baseUrl}/`, publisher: { '@id': ids[0] } }];
}
function withSiteEntities(html, baseUrl) {
  if (html.includes(`${baseUrl}/#organization`) && html.includes(`${baseUrl}/#website`)) return html;
  const block = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': siteEntityNodes(baseUrl) })}</script>`;
  const i = html.indexOf('</head>');
  return i < 0 ? html : html.slice(0, i) + block + '\n' + html.slice(i);
}

// Every admitted page carries a visible editorial byline and, when self-canonical, a
// visible review date (validate_strategy_integrity_contract.js). The engine renders the
// dates as <p class="page-dates">; this marks it and adds the site's byline after it.
const BYLINE = '<p class="muted small editorial-byline" data-editorial-byline="true">Published by <a href="/about">The Industry Guides Editorial Team</a>.</p>';
function withEditorialMarks(html) {
  let out = html;
  if (!/data-review-date=["']true["']/.test(out)) out = out.replace('<p class="page-dates">', '<p class="page-dates review-date" data-review-date="true">');
  if (!/data-editorial-byline=["']true["']/.test(out)) {
    const m = out.match(/<p class="page-dates[^"]*"[^>]*>[\s\S]*?<\/p>/);
    if (m) out = out.replace(m[0], m[0] + BYLINE);
  }
  return out;
}

function routeToRel(route) { return route === '/' ? 'index.html' : `${route.replace(/^\/+|\/+$/g, '')}/index.html`; }
function relToRoute(rel) { return rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`; }

function hubHtml(cfg, groups, date) {
  const t = cfg.template || {};
  const url = `${cfg.base_url}/questions/`;
  const title = `Short answers to common questions — ${cfg.site_name}`;
  const desc = 'Short, source-backed answers to single questions about senior care, dental care, accidents, evaluations, hormones and the USCIS medical exam, each linked to its full guide.';
  const lists = groups.map((g) => `<section><h2>${esc(g.label)}</h2><ul>${g.pages.map((p) => `<li><a href="${esc(p.route)}">${esc(p.anchor)}</a></li>`).join('')}</ul></section>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta content="width=device-width,initial-scale=1" name="viewport"/>
<title>${esc(title)}</title>
<meta content="${esc(desc)}" name="description"/>
<meta content="index,follow" name="robots"/><link href="${url}" rel="canonical"/>
<meta content="${esc(title)}" property="og:title"/><meta content="${esc(desc)}" property="og:description"/><meta content="website" property="og:type"/><meta content="${url}" property="og:url"/><meta content="${esc(cfg.site_name)}" property="og:site_name"/><meta content="${esc((t.og_image || {}).url || `${cfg.base_url}/og.png`)}" property="og:image"/><meta content="${(t.og_image || {}).width || 1200}" property="og:image:width"/><meta content="${(t.og_image || {}).height || 630}" property="og:image:height"/>
<meta content="summary_large_image" name="twitter:card"/><meta content="${esc(title)}" name="twitter:title"/><meta content="${esc(desc)}" name="twitter:description"/><meta content="${esc((t.og_image || {}).url || `${cfg.base_url}/og.png`)}" name="twitter:image"/>
${(t.stylesheets || []).map((h) => `<link href="${esc(h)}" rel="stylesheet"/>`).join('')}
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, dateModified: date, isPartOf: { '@type': 'WebSite', name: cfg.site_name, url: cfg.base_url + '/' } })}</script>
</head><body>
${t.header_html || ''}
<main class="container">
<nav aria-label="Breadcrumb" class="breadcrumb"><a href="/">${esc(cfg.site_name)}</a> › <span>Questions</span></nav>
<h1>Short answers to common questions</h1>
<p class="page-dates">Updated <time datetime="${date}">${date}</time></p>
<p>Each page answers one question in plain words and links to the full guide on the matching canonical site.</p>
${lists}
</main>
${t.footer_html || ''}
</body></html>
`;
}

function run(opts = {}) {
  const cfg = readJson(CFG_REL, null);
  if (!cfg || !cfg.velocity) throw new Error(`${CFG_REL} missing or has no velocity block`);
  const V = cfg.velocity;
  const verticals = V.verticals || [];
  const ledgerRel = `${cfg.ledger_dir || 'data/search-loop'}/pages.json`;
  const book = readJson(ledgerRel, null);
  const census = { live: 0, pi_dropped: 0, matched: 0, missing: 0, unclassified: 0, hosts_unlinked: 0, frozen: 0, retired: 0 };
  if (!book || !Array.isArray(book.pages)) {
    console.log('search-loop fold-in: NAMED NOTE [NO_LEDGER] data/search-loop/pages.json does not exist yet; nothing to fold in');
    return census;
  }
  book.dropped ||= [];
  const snapshot = readJson('data/canonical_route_snapshot.json', { domains: {} });
  const { normalizeRoute, freezeRoute, loadRegistry, saveRegistry } = require('../lib/frozen_pages');
  const frozen = new Map((loadRegistry().pages || []).map((p) => [normalizeRoute(p.route), p]));
  const redirects = redirectSources();
  const admitted = new Set((readJson('data/content/page_admission_registry.json', { pages: [] }).pages || []).map((p) => normalizeRoute(p.path)));
  const date = today();
  const touched = new Set(); // rendered rels whose bytes this run (or the engine) changed

  // 1 + 2: PI rules, vertical, guide, action.
  const guideRows = [];
  const missingPrev = new Map((readJson(V.missing_guides_file, { items: [] }).items || []).map((i) => [i.query, i]));
  const missing = [];
  const keep = [];
  for (const page of book.pages) {
    if (page.status !== 'live') { keep.push(page); continue; }
    const file = path.join(ROOT, page.rel || routeToRel(page.route));
    if (!fs.existsSync(file)) { keep.push(page); continue; }
    let html = fs.readFileSync(file, 'utf8');
    const v = classify(page.query, verticals);
    const vid = v ? v.id : null;
    const problems = piProblems(html, vid);
    if (problems.length) {
      if (frozen.has(normalizeRoute(page.route))) {
        // Already accepted: never re-freeze bad bytes; the build restores the accepted copy.
        console.log(`NAMED NOTE [PI_RULE_ON_ACCEPTED_PAGE] ${page.route}: ${problems.join('; ')} - accepted bytes kept, this change is not frozen`);
        page._pi_blocked = true; keep.push(page); continue;
      }
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
      fs.rmSync(path.join(ROOT, cfg.ledger_dir || 'data/search-loop', 'drafts', `${page.slug}.json`), { force: true });
      for (const h of page.linked_from || []) {
        const hf = path.join(ROOT, h.rel);
        if (fs.existsSync(hf)) { const before = fs.readFileSync(hf, 'utf8'); const after = withoutRelatedLink(before, page.route); if (after !== before) fs.writeFileSync(hf, after); }
      }
      book.dropped.push({ query: page.query, at: date, reason: problems });
      census.pi_dropped += 1;
      continue;
    }
    const guide = v ? matchGuide(page.query, v, snapshot) : null;
    const href = v ? `https://${v.canonical_domain}${guide ? guide.route : '/'}` : `${cfg.base_url}/`;
    const label = v ? `Read the full guide on ${v.canonical_domain}` : cfg.action.label;
    const next = withEditorialMarks(withSiteEntities(setAction(html, href, label) || html, cfg.base_url));
    if (next && next !== html) { fs.writeFileSync(file, next); html = next; }
    page.hash = sha256(html);
    page.vertical = vid || 'global';
    page.guide_url = href;
    guideRows.push({ route: page.route, query: page.query, vertical: vid || 'global', canonical_domain: v ? v.canonical_domain : null, guide_url: href, matched: Boolean(guide), score: guide ? guide.score : 0 });
    if (!v) census.unclassified += 1;
    if (guide) census.matched += 1;
    else {
      const prev = missingPrev.get(page.query);
      missing.push({ query: page.query, vertical: vid || 'unclassified', canonical_domain: v ? v.canonical_domain : null, suggested_route: `/guides/${slugify(page.query)}/`, velocity_url: page.url || `${cfg.base_url}${page.route}`, first_seen: prev ? prev.first_seen : date, last_seen: date });
      census.missing += 1;
    }
    census.live += 1;
    keep.push(page);
  }
  book.pages = keep;

  // 3: related links on hosts that cannot deliver them.
  for (const page of book.pages) {
    if (page.status !== 'live' || !Array.isArray(page.linked_from)) continue;
    page.linked_from = page.linked_from.filter((h) => {
      const route = normalizeRoute(h.route || relToRoute(h.rel));
      const deliverable = admitted.has(route) && !redirects.has(route) && !route.startsWith('/questions/');
      if (deliverable || route.startsWith('/questions/')) { touched.add(h.rel); return true; }
      const hf = path.join(ROOT, h.rel);
      if (fs.existsSync(hf)) { const before = fs.readFileSync(hf, 'utf8'); const after = withoutRelatedLink(before, page.route); if (after !== before) fs.writeFileSync(hf, after); }
      census.hosts_unlinked += 1;
      return false;
    });
  }

  // 4: hub.
  const live = book.pages.filter((p) => p.status === 'live' && !p._pi_blocked && fs.existsSync(path.join(ROOT, p.rel || routeToRel(p.route))));
  const order = [...verticals.map((v) => ({ id: v.id, label: v.label })), { id: 'global', label: 'More questions' }];
  const groups = order.map((g) => ({ label: g.label, pages: live.filter((p) => (p.vertical || 'global') === g.id).map((p) => ({ route: p.route, anchor: titleOf(fs.readFileSync(path.join(ROOT, p.rel || routeToRel(p.route)), 'utf8')).split(' — ')[0] || p.query })).sort((a, b) => a.anchor.localeCompare(b.anchor)) })).filter((g) => g.pages.length);
  const hubRel = 'questions/index.html';
  if (live.length) {
    const hubDate = live.map((p) => p.modified_at || p.published_at).filter(Boolean).sort().at(-1) || date;
    const html = withEditorialMarks(withSiteEntities(hubHtml(cfg, groups, hubDate), cfg.base_url));
    const abs = path.join(ROOT, hubRel);
    if (!fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== html) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, html); }
  }

  writeJson(ledgerRel, Object.fromEntries(Object.entries(book).map(([k, val]) => [k, k === 'pages' ? val.map(({ _pi_blocked, ...rest }) => rest) : val])));
  writeJson(V.guide_map_file, { schema: 'velocity-search-loop-guides-v1', generated_by: 'scripts/search_loop/fold_in.js', pages: guideRows.sort((a, b) => a.route.localeCompare(b.route)) });
  writeJson(V.missing_guides_file, {
    schema: 'velocity-missing-guides-v1',
    reader: 'local-guides-generator (its search-loop agent builds one canonical guide per item, then the next velocity run points the page at it and drops the item)',
    url: 'https://raw.githubusercontent.com/seq23/local-guides-citation-velocity/main/data/search-loop/missing-guides.json',
    generated_by: 'scripts/search_loop/fold_in.js',
    count: missing.length,
    items: missing.sort((a, b) => a.vertical.localeCompare(b.vertical) || a.query.localeCompare(b.query))
  });

  // 5: admission, then freeze what changed.
  if (!opts.skipAdmission) cp.execFileSync(process.execPath, [path.join(ROOT, 'scripts/build_page_admission_registry_2026_06_19.js')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  const admittedNow = new Set((readJson('data/content/page_admission_registry.json', { pages: [] }).pages || []).map((p) => normalizeRoute(p.path)));
  const toFreeze = new Set([...live.map((p) => p.rel || routeToRel(p.route)), ...(live.length ? [hubRel] : []), ...touched]);
  for (const rel of toFreeze) {
    const route = normalizeRoute(relToRoute(rel));
    const abs = path.join(ROOT, rel);
    if (!admittedNow.has(route) || !fs.existsSync(abs)) continue;
    const rec = frozen.get(route);
    if (rec && rec.accepted_html_sha256 === sha256(fs.readFileSync(abs))) continue;
    if (rec && rec.state !== 'FROZEN') continue; // inside someone else's mutation transaction
    freezeRoute(route);
    census.frozen += 1;
  }

  // 6: merged pages leave the frozen registry with a recorded retirement.
  const gone = book.pages.filter((p) => p.status !== 'live' && p.route && redirects.has(normalizeRoute(p.route)) && frozen.has(normalizeRoute(p.route)));
  if (gone.length) {
    const reg = loadRegistry();
    const ret = readJson('data/release/route_retirements.json', { retirements: [] });
    const have = new Set((ret.retirements || []).map((r) => r.source_path));
    for (const p of gone) {
      const route = normalizeRoute(p.route);
      reg.pages = (reg.pages || []).filter((r) => normalizeRoute(r.route) !== route);
      if (!have.has(route)) ret.retirements.push({ source_path: route, target_path: redirects.get(route), status: 'ACTIVE_301', reason: 'Search loop consolidation: 90 days without impressions, merged into a stronger page (data/search-loop/consolidation-ledger.json).', evidence: ['_redirects', 'data/search-loop/consolidation-ledger.json'] });
      census.retired += 1;
    }
    saveRegistry(reg);
    writeJson('data/release/route_retirements.json', ret);
    const contractRel = 'data/overhaul/full_scope_overhaul_contract.json';
    const contract = readJson(contractRel, null);
    if (contract && contract.counts) { contract.counts.approved_route_retirements = ret.retirements.filter((r) => r.status === 'ACTIVE_301').length; writeJson(contractRel, contract); }
  }

  console.log(`search-loop fold-in: live=${census.live} pi_dropped=${census.pi_dropped} matched_guides=${census.matched} missing_guides=${census.missing} unclassified=${census.unclassified} hosts_unlinked=${census.hosts_unlinked} frozen=${census.frozen} retired=${census.retired}`);
  return census;
}

module.exports = { run, classify, matchGuide, piProblems, setAction, withoutRelatedLink };

if (require.main === module) {
  try { run({ skipAdmission: process.argv.includes('--skip-admission') }); }
  catch (e) { console.error(`search-loop fold-in: FAILED ${e.stack || e.message}`); process.exit(1); }
}
