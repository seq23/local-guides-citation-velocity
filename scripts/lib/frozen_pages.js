'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const REGISTRY_REL = 'data/release/frozen_page_registry.json';
const REGISTRY_PATH = path.join(ROOT, REGISTRY_REL);
const CACHE_DIR_REL = 'data/release/frozen_html_cache';
const CACHE_DIR = path.join(ROOT, CACHE_DIR_REL);
const ADMISSION_PATH = path.join(ROOT, 'data/content/page_admission_registry.json');
const ACTIVE_SCOPE_REL = 'data/release/active_mutation_scope.json';
const ACTIVE_SCOPE_PATH = path.join(ROOT, ACTIVE_SCOPE_REL);
const PENDING_SCOPE_REL = 'data/release/pending_mutation_routes.json';
const PENDING_SCOPE_PATH = path.join(ROOT, PENDING_SCOPE_REL);

function stableNow() {
  const d = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
  return `${d}T00:00:00.000Z`;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function readJson(abs, fallback) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(abs, value) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, abs);
}
function normalizeRoute(route) {
  let out = String(route || '').trim();
  if (!out) return '';
  try { if (/^https?:\/\//i.test(out)) out = new URL(out).pathname; } catch {}
  out = out.split('?')[0].split('#')[0];
  if (!out.startsWith('/')) out = `/${out}`;
  out = out.replace(/\/{2,}/g, '/');
  // Canonical static routes use directory form for index documents. Agent reports
  // commonly name the rendered implementation path (`/foo/index.html`); normalize
  // that to the same `/foo/` identity used by admission and frozen-page registries.
  if (out.endsWith('/index.html')) out = out.slice(0, -'index.html'.length);
  if (!out.endsWith('/') && !out.endsWith('.html')) out += '/';
  return out;
}
function implementationPathToRoute(value) {
  let p = String(value || '').trim().replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').split('?')[0].split('#')[0];
  if (!p) return '';
  if (p.endsWith('/index.html')) return normalizeRoute(`/${p.slice(0, -'index.html'.length)}`);
  if (p.endsWith('.html')) return normalizeRoute(`/${p}`);
  return normalizeRoute(`/${p}`);
}
function routeToRenderedRel(route) {
  const r = normalizeRoute(route);
  if (r === '/') return 'index.html';
  if (r.endsWith('.html')) return r.slice(1);
  return `${r.slice(1).replace(/\/$/, '')}/index.html`;
}
function cacheRelForHash(hash) { return `${CACHE_DIR_REL}/${hash.slice(0, 2)}/${hash}.html.gz`; }
function loadRegistry() { return readJson(REGISTRY_PATH, { schema_version: '2.0', authority: 'docs/PAGE_RELEASE_LAW.md', generated_at: stableNow(), count: 0, pages: [] }); }
function saveRegistry(registry) {
  registry.schema_version = '2.0';
  registry.authority = 'docs/PAGE_RELEASE_LAW.md';
  registry.count = (registry.pages || []).length;
  registry.updated_at = stableNow();
  registry.pages = (registry.pages || []).slice().sort((a, b) => a.route.localeCompare(b.route));
  writeJsonAtomic(REGISTRY_PATH, registry);
}
function admissionPages() { return readJson(ADMISSION_PATH, { pages: [] }).pages || []; }
function admissionByRoute() { return new Map(admissionPages().map((p) => [normalizeRoute(p.path), p])); }
function writeCache(buffer) {
  const htmlHash = sha256(buffer);
  const rel = cacheRelForHash(htmlHash);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const gz = zlib.gzipSync(buffer, { level: 9, mtime: 0 });
    fs.writeFileSync(abs, gz);
  }
  return { htmlHash, rel, cacheHash: sha256(fs.readFileSync(abs)) };
}
function recordForPage(page, previous = null) {
  const route = normalizeRoute(page.path);
  const renderedRel = routeToRenderedRel(route);
  const renderedAbs = path.join(ROOT, renderedRel);
  if (!fs.existsSync(renderedAbs)) throw new Error(`Cannot freeze missing rendered route ${route} -> ${renderedRel}`);
  const buffer = fs.readFileSync(renderedAbs);
  const cache = writeCache(buffer);
  return {
    route,
    state: 'FROZEN',
    rendered_file: renderedRel,
    accepted_html_sha256: cache.htmlHash,
    cache_file: cache.rel,
    cache_sha256: cache.cacheHash,
    accepted_lastmod: String(page.lastmod || previous?.accepted_lastmod || '').slice(0, 10),
    admission_basis: page.admission_basis || previous?.admission_basis || '',
    source_owner: page.source_owner || previous?.source_owner || '',
    source_file: page.source_file || previous?.source_file || '',
    generator: page.generator || previous?.generator || '',
    source_fingerprint: sha256(Buffer.from(JSON.stringify({ path: route, source_file: page.source_file, generator: page.generator, admission_basis: page.admission_basis }), 'utf8')),
    frozen_at: previous?.frozen_at || stableNow(),
    refrozen_at: previous ? stableNow() : null,
    transaction: null
  };
}
function seedAcceptedPages({ onlyMissing = false } = {}) {
  const registry = loadRegistry();
  const prior = new Map((registry.pages || []).map((p) => [normalizeRoute(p.route), p]));
  const out = [];
  let added = 0, refreshed = 0;
  for (const page of admissionPages()) {
    const route = normalizeRoute(page.path);
    const previous = prior.get(route) || null;
    if (onlyMissing && previous) { out.push(previous); continue; }
    const next = recordForPage(page, previous);
    out.push(next);
    if (previous) refreshed += 1; else added += 1;
  }
  registry.pages = out;
  registry.baseline_source = registry.baseline_source || 'uploaded approved baseline artifact';
  saveRegistry(registry);
  return { count: out.length, added, refreshed };
}
function freezeRoute(route) {
  const r = normalizeRoute(route);
  const admission = admissionByRoute().get(r);
  if (!admission) throw new Error(`Cannot freeze non-admitted route: ${r}`);
  const registry = loadRegistry();
  const idx = (registry.pages || []).findIndex((p) => normalizeRoute(p.route) === r);
  const previous = idx >= 0 ? registry.pages[idx] : null;
  const next = recordForPage(admission, previous);
  if (idx >= 0) registry.pages[idx] = next; else registry.pages.push(next);
  saveRegistry(registry);
  return next;
}
function freezeNewAdmitted() {
  const registry = loadRegistry();
  const known = new Set((registry.pages || []).map((p) => normalizeRoute(p.route)));
  const added = [];
  for (const page of admissionPages()) {
    const route = normalizeRoute(page.path);
    if (known.has(route)) continue;
    const next = recordForPage(page, null);
    registry.pages.push(next); known.add(route); added.push(route);
  }
  saveRegistry(registry);
  return { added_count: added.length, routes: added };
}
function mutableRouteSet() {
  const set = new Set();
  const active = readJson(ACTIVE_SCOPE_PATH, { routes: [] });
  for (const route of active.routes || []) set.add(normalizeRoute(route));
  const raw = process.env.VELOCITY_MUTABLE_ROUTES || '';
  if (raw) {
    let values = [];
    try { values = JSON.parse(raw); } catch { values = raw.split(','); }
    for (const route of values || []) set.add(normalizeRoute(route));
  }
  return set;
}
function restoreFrozenPages() {
  const registry = loadRegistry();
  const mutable = mutableRouteSet();
  let restored = 0, already = 0, skipped = 0;
  for (const record of registry.pages || []) {
    const route = normalizeRoute(record.route);
    if (mutable.has(route) || record.state === 'TRANSACTIONALLY_THAWED' || record.state === 'UNLOCKED_FOR_REBUILD') { skipped += 1; continue; }
    if (record.state !== 'FROZEN') continue;
    const cacheAbs = path.join(ROOT, record.cache_file);
    if (!fs.existsSync(cacheAbs)) throw new Error(`Missing frozen cache blob for ${route}: ${record.cache_file}`);
    const gz = fs.readFileSync(cacheAbs);
    if (sha256(gz) !== record.cache_sha256) throw new Error(`Frozen cache hash mismatch for ${route}`);
    const html = zlib.gunzipSync(gz);
    if (sha256(html) !== record.accepted_html_sha256) throw new Error(`Frozen HTML hash mismatch for ${route}`);
    const renderedAbs = path.join(ROOT, record.rendered_file || routeToRenderedRel(route));
    const current = fs.existsSync(renderedAbs) ? fs.readFileSync(renderedAbs) : null;
    if (current && sha256(current) === record.accepted_html_sha256) { already += 1; continue; }
    fs.mkdirSync(path.dirname(renderedAbs), { recursive: true });
    fs.writeFileSync(renderedAbs, html);
    restored += 1;
  }
  return { restored, already, skipped, frozen_count: (registry.pages || []).filter((p) => p.state === 'FROZEN').length };
}
function verifyFrozenPages({ requireRenderedMatch = true } = {}) {
  const registry = loadRegistry();
  const errors = [];
  for (const record of registry.pages || []) {
    if (record.state !== 'FROZEN') continue;
    const route = normalizeRoute(record.route);
    const cacheAbs = path.join(ROOT, record.cache_file || '');
    if (!fs.existsSync(cacheAbs)) { errors.push(`${route}:cache_missing`); continue; }
    const gz = fs.readFileSync(cacheAbs);
    if (sha256(gz) !== record.cache_sha256) errors.push(`${route}:cache_hash_mismatch`);
    let html;
    try { html = zlib.gunzipSync(gz); } catch { errors.push(`${route}:cache_gzip_invalid`); continue; }
    if (sha256(html) !== record.accepted_html_sha256) errors.push(`${route}:accepted_hash_mismatch`);
    if (requireRenderedMatch) {
      const rendered = path.join(ROOT, record.rendered_file || routeToRenderedRel(route));
      if (!fs.existsSync(rendered)) errors.push(`${route}:rendered_missing`);
      else if (sha256(fs.readFileSync(rendered)) !== record.accepted_html_sha256) errors.push(`${route}:rendered_not_frozen`);
    }
  }
  return { ok: errors.length === 0, errors, count: (registry.pages || []).length };
}
function pruneFrozenCache({ dryRun = false } = {}) {
  // The cache is content-addressed, so every refreeze writes new blobs and the
  // superseded ones stay on disk forever. After one full-portfolio refreeze the
  // cache held 7,764 blobs for 2,325 accepted routes - 5,439 orphans, 28.8 MB.
  //
  // Keeps anything the registry points at, plus the prior bytes of any route
  // currently mid-transaction: rollbackMutationScope restores from those, so
  // deleting them would strip the undo out of an open repair.
  const registry = loadRegistry();
  const keep = new Set();
  for (const page of registry.pages || []) {
    if (page.cache_file) keep.add(path.join(ROOT, page.cache_file));
    const prior = page.transaction && page.transaction.prior_html_sha256;
    if (prior) keep.add(path.join(ROOT, cacheRelForHash(prior)));
  }
  const removed = [];
  let bytes = 0;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.html.gz')) continue;
      if (keep.has(abs)) continue;
      bytes += fs.statSync(abs).size;
      removed.push(path.relative(ROOT, abs));
      if (!dryRun) fs.rmSync(abs, { force: true });
    }
  };
  walk(CACHE_DIR);
  return { dry_run: dryRun, kept: keep.size, removed: removed.length, freed_bytes: bytes };
}

function beginMutationScope(routes, releaseId = `release-${Date.now()}`) {
  const normalized = [...new Set((routes || []).map(normalizeRoute).filter(Boolean))];
  const registry = loadRegistry();
  const byRoute = new Map((registry.pages || []).map((p, i) => [normalizeRoute(p.route), i]));
  const thawed = [];
  for (const route of normalized) {
    const idx = byRoute.get(route);
    if (idx === undefined) continue; // New route: no prior frozen output to thaw.
    const record = registry.pages[idx];
    if (record.state !== 'FROZEN' && record.state !== 'UNLOCKED_FOR_REBUILD') throw new Error(`Route is not safely thawable: ${route}:${record.state}`);
    registry.pages[idx] = { ...record, state: 'TRANSACTIONALLY_THAWED', transaction: { release_id: releaseId, started_at: stableNow(), prior_html_sha256: record.accepted_html_sha256 } };
    thawed.push(route);
  }
  saveRegistry(registry);
  writeJsonAtomic(ACTIVE_SCOPE_PATH, { schema_version: '1.0', release_id: releaseId, created_at: stableNow(), routes: normalized, thawed_routes: thawed });
  return { release_id: releaseId, routes: normalized, thawed_routes: thawed };
}
function acceptMutationScope() {
  const scope = readJson(ACTIVE_SCOPE_PATH, null);
  if (!scope) return { accepted: 0, routes: [] };
  const accepted = [];
  for (const route of scope.thawed_routes || []) { freezeRoute(route); accepted.push(route); }
  fs.rmSync(ACTIVE_SCOPE_PATH, { force: true });
  return { accepted: accepted.length, routes: accepted };
}
function rollbackMutationScope() {
  const scope = readJson(ACTIVE_SCOPE_PATH, null);
  if (!scope) return { rolled_back: 0, routes: [] };
  const registry = loadRegistry();
  for (const record of registry.pages || []) {
    if ((scope.thawed_routes || []).includes(normalizeRoute(record.route))) {
      record.state = 'FROZEN'; record.transaction = null;
    }
  }
  saveRegistry(registry);
  // Clear the active scope before restoration. Otherwise mutableRouteSet() still
  // sees the just-rolled-back routes and incorrectly skips restoring their accepted bytes.
  fs.rmSync(ACTIVE_SCOPE_PATH, { force: true });
  const restored = restoreFrozenPages();
  return { rolled_back: (scope.thawed_routes || []).length, routes: scope.thawed_routes || [], restored };
}
function queueMutationRoutes(routes, source = 'runtime') {
  const current = readJson(PENDING_SCOPE_PATH, { schema_version: '1.0', routes: [], sources: [] });
  const merged = [...new Set([...(current.routes || []), ...(routes || []).map(normalizeRoute)].filter(Boolean))].sort();
  current.routes = merged;
  current.sources = [...(current.sources || []), { source, queued_at: stableNow(), routes: (routes || []).map(normalizeRoute).filter(Boolean) }];
  current.updated_at = stableNow();
  writeJsonAtomic(PENDING_SCOPE_PATH, current);
  return current;
}
function consumePendingMutationRoutes() {
  const current = readJson(PENDING_SCOPE_PATH, { routes: [] });
  fs.rmSync(PENDING_SCOPE_PATH, { force: true });
  return current.routes || [];
}
function frozenMetadataMap() { return new Map((loadRegistry().pages || []).map((p) => [normalizeRoute(p.route), p])); }
function applyFrozenMetadataToEntries(entries) {
  const map = frozenMetadataMap();
  for (const entry of entries || []) {
    const record = map.get(normalizeRoute(entry.slug || entry.path));
    if (record?.state === 'FROZEN' && record.accepted_lastmod) entry.lastmod = record.accepted_lastmod;
  }
  return entries;
}
function ensureFrozenInventoryEntries(entries, siteBase) {
  const seen = new Set((entries || []).map((e) => normalizeRoute(e.slug || e.path)));
  const admission = admissionByRoute();
  for (const record of loadRegistry().pages || []) {
    const route = normalizeRoute(record.route);
    if (record.state !== 'FROZEN' || seen.has(route)) continue;
    const page = admission.get(route) || {};
    entries.push({
      slug: route,
      url: new URL(route, siteBase).toString(),
      title: page.primary_query || page.page_type || route,
      description: 'Accepted frozen Listings editorial route.',
      lastmod: record.accepted_lastmod || page.lastmod || '',
      surface: 'frozen-accepted',
      canonical_domain: page.canonical_domain || 'theindustryguides.com'
    });
    seen.add(route);
  }
  return entries;
}

module.exports = {
  ROOT, REGISTRY_REL, ACTIVE_SCOPE_REL, PENDING_SCOPE_REL,
  normalizeRoute, implementationPathToRoute, routeToRenderedRel,
  loadRegistry, saveRegistry, seedAcceptedPages, freezeRoute, freezeNewAdmitted,
  restoreFrozenPages, verifyFrozenPages, pruneFrozenCache, beginMutationScope, acceptMutationScope,
  rollbackMutationScope, queueMutationRoutes, consumePendingMutationRoutes, mutableRouteSet,
  applyFrozenMetadataToEntries, ensureFrozenInventoryEntries
};
