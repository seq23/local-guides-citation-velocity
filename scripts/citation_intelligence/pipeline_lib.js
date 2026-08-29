'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const TODAY = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

function abs(rel) { return path.join(ROOT, rel); }
function exists(rel) { return fs.existsSync(abs(rel)); }
function ensureDir(rel) { fs.mkdirSync(abs(rel), { recursive: true }); }
function readJson(rel, fallback = null) {
  const file = abs(rel);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(rel, data) {
  const file = abs(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function writeText(rel, value) {
  const file = abs(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(value));
}
function hash(value, len = 12) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len);
}
function slugify(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function stripPII(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[phone removed]')
    .replace(/@[a-z0-9_.-]+/gi, '[username removed]')
    .replace(/\bu\/[a-z0-9_-]+\b/gi, '[username removed]')
    .replace(/\b\d{1,5}\s+[A-Z][A-Za-z0-9.\s]{2,}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd)\b/g, '[address removed]');
}
function excerpt(value, limit = 280) {
  return stripPII(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}
function inferVertical(text, explicit) {
  if (explicit && explicit !== 'general') return explicit;
  const v = String(text || '').toLowerCase();
  if (/dentist|dental|tooth|teeth|implant|invisalign|oral surgeon/.test(v)) return 'dentistry';
  if (/injury|accident|settlement|lawyer|insurance claim/.test(v)) return 'personal-injury';
  if (/autism|adhd|neuro|evaluation|assessment|aba|speech therapy/.test(v)) return 'neuro';
  if (/uscis|i-693|civil surgeon|green card|rfe|immigration medical/.test(v)) return 'uscis';
  if (/trt|testosterone|hormone|hair loss|hair transplant/.test(v)) return 'trt';
  return 'general';
}
function inferCandidateType(record) {
  if (record.candidate_type) return record.candidate_type;
  const text = `${record.raw_title || ''} ${record.raw_signal_phrase || ''} ${record.short_excerpt || ''}`.toLowerCase();
  if (/claim.*already|thousands of visits|ai overview|without telemetry|guarantee/.test(text)) return 'block';
  if (/red flag|checklist|framework/.test(text)) return 'atom_update';
  if (/versus| vs |internal link|rfe/.test(text)) return 'internal_link_update';
  if (/settlement|fix|outdated|repair/.test(text)) return 'repair';
  return 'create';
}
function inferRisk(record) {
  const text = `${record.raw_title || ''} ${record.short_excerpt || ''}`.toLowerCase();
  if (/claim.*already|traffic|ranking|indexing|ai overview|guarantee|medical advice|legal advice/.test(text)) return 'high';
  if (/settlement|diagnosis|denial|rfe|insurance|provider/.test(text)) return 'medium';
  return 'low';
}
function normalizeRecord(record, idx) {
  const title = excerpt(record.raw_signal_phrase || record.raw_title || record.title || '', 240);
  const vertical = inferVertical(`${title} ${record.short_excerpt || ''}`, record.vertical);
  const candidateType = inferCandidateType(record);
  const routeOwner = record.route_owner || (candidateType === 'block' ? 'no_public_route' : `/insights/${slugify(`${vertical}-${title}`).slice(0, 82)}.html`);
  const normalizedQuery = /\?$/.test(title) ? title : `${title}?`;
  const riskLevel = inferRisk(record);
  return {
    normalized_id: `tq_${String(idx + 1).padStart(4, '0')}_${hash(`${record.signal_id || idx}:${title}`, 10)}`,
    source_signal_ids: [record.signal_id || `raw_${idx}`],
    source_key: record.source_key || 'unknown',
    source_url: record.source_url || null,
    raw_signal_phrase: title,
    normalized_query: normalizedQuery,
    vertical,
    intent: record.intent || (candidateType === 'block' ? 'unsupported_claim' : 'decision_support'),
    candidate_type: candidateType,
    page_family: record.page_family || (candidateType === 'create' ? 'literal_question' : 'guide'),
    route_owner: routeOwner,
    source_basis: record.source_basis || 'metadata_and_short_excerpt_only',
    traffic_intent: trafficIntent(title, record.short_excerpt),
    risk_level: riskLevel,
    compliance_status: candidateType === 'block' || candidateType === 'quarantine' ? 'blocked' : 'eligible_shadow',
    status: 'normalized'
  };
}
function trafficIntent(title, body) {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  if (/cost|price|how much|insurance|fee/.test(text)) return 'cost';
  if (/what to ask|questions|compare|choosing|provider/.test(text)) return 'comparison';
  if (/timeline|what happens|next|rfe|denial/.test(text)) return 'process';
  if (/red flag|scam|verify|credential/.test(text)) return 'risk_reduction';
  return 'answer_extraction';
}
function clusterSignals(normalized) {
  const map = new Map();
  for (const item of normalized) {
    const key = `${item.vertical}:${item.traffic_intent}:${item.page_family}`;
    const bucket = map.get(key) || { cluster_id: `cluster_${hash(key, 10)}`, key, vertical: item.vertical, traffic_intent: item.traffic_intent, page_family: item.page_family, normalized_ids: [], candidate_types: new Set(), score: 0 };
    bucket.normalized_ids.push(item.normalized_id);
    bucket.candidate_types.add(item.candidate_type);
    bucket.score += item.risk_level === 'high' ? 0.5 : item.risk_level === 'medium' ? 1.5 : 2;
    map.set(key, bucket);
  }
  return [...map.values()].map((c) => ({ ...c, candidate_types: [...c.candidate_types].sort(), score: Number(c.score.toFixed(2)) }));
}
function scoreSignals(normalized, clusters) {
  const clusterByKey = new Map(clusters.map((c) => [c.key, c]));
  return normalized.map((item) => {
    const key = `${item.vertical}:${item.traffic_intent}:${item.page_family}`;
    const base = item.candidate_type === 'block' || item.candidate_type === 'quarantine' ? 0 : 10;
    const riskPenalty = item.risk_level === 'high' ? 8 : item.risk_level === 'medium' ? 2 : 0;
    const typeBoost = { create: 3, repair: 4, atom_update: 5, internal_link_update: 4, answer_block_update: 4, entity_context_update: 4, schema_update: 3, source_update: 3, distribution_update: 2, block: -10, quarantine: -8 }[item.candidate_type] || 1;
    const clusterScore = clusterByKey.get(key)?.score || 0;
    const opportunity_score = Number(Math.max(0, base + typeBoost + clusterScore - riskPenalty).toFixed(2));
    return { ...item, cluster_id: clusterByKey.get(key)?.cluster_id || null, opportunity_score };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score || a.normalized_id.localeCompare(b.normalized_id));
}

function canonicalReleaseUnitType(candidateType) {
  return ({
    create: 'create_distinct_page',
    repair: 'repair_existing',
    atom_update: 'content_atom_update',
    internal_link_update: 'internal_link_update',
    answer_block_update: 'content_atom_update',
    entity_context_update: 'content_atom_update',
    schema_update: 'source_update',
    source_update: 'source_update',
    distribution_update: 'internal_link_update',
    block: 'quarantine',
    quarantine: 'quarantine'
  })[String(candidateType || '')] || String(candidateType || 'skip_unsupported');
}

function buildCandidates(scored) {
  return scored.map((item) => {
    const blocked = item.candidate_type === 'block' || item.risk_level === 'high' && /traffic|ranking|ai overview|guarantee/i.test(item.raw_signal_phrase);
    return {
      candidate_id: `cand_${hash(`${item.normalized_id}:${item.candidate_type}`, 12)}`,
      normalized_id: item.normalized_id,
      release_unit_type: blocked ? 'quarantine' : canonicalReleaseUnitType(item.candidate_type),
      action: blocked ? 'quarantine' : canonicalReleaseUnitType(item.candidate_type),
      legacy_candidate_type: item.candidate_type,
      route_owner: item.route_owner,
      page_family: item.page_family,
      vertical: item.vertical,
      expected_aeo_geo_seo_role: roleFor(item),
      traffic_intent: item.traffic_intent,
      source_basis: item.source_basis,
      risk_level: item.risk_level,
      opportunity_score: item.opportunity_score,
      validation_requirements: requirementsFor(item, blocked),
      status: blocked ? 'blocked' : 'candidate',
      block_reason: blocked ? 'Unsupported external outcome or high-risk claim without telemetry.' : null
    };
  });
}
function roleFor(item) {
  if (item.candidate_type === 'atom_update') return 'AEO reusable answer atom and GEO framework clarity';
  if (item.candidate_type === 'internal_link_update') return 'SEO internal-link graph and answer-path reinforcement';
  if (item.candidate_type === 'repair') return 'SEO winner repair and AEO answer freshness';
  if (item.candidate_type === 'block') return 'Trust boundary enforcement';
  return 'SEO route coverage plus AEO direct answer capture';
}
function requirementsFor(item, blocked) {
  if (blocked) return ['proof-packet telemetry boundary', 'content-safety boundary'];
  const out = ['source contract', 'signal normalization', 'release-plan integrity'];
  if (item.candidate_type === 'atom_update') out.push('atom contract');
  if (item.candidate_type === 'internal_link_update') out.push('structural graph live policy');
  return out;
}
/**
 * The public citation-surface inventory.
 *
 * This used to count every .html file under the repo root - 4,556 of them -
 * and publish that number as `citation_surfaces_total`, `indexable_routes_total`
 * and `owned_surfaces_current`. It was a file count wearing the name of a
 * surface count. It included the `dist/` render mirror (every admitted page a
 * second time), plus ~48 files under staging/, templates/, artifacts/,
 * data/report_fixes/ and docs/ that are not public routes at all, plus the 188
 * personal-injury pages that render to disk and are admitted nowhere. None of
 * those is a surface anything could cite.
 *
 * There is exactly one definition of "this route is public" in the repo
 * (scripts/lib/page_admission.js) and this now uses it, deduplicated by route
 * so the dist/ mirror cannot count a page twice. Today: 2,151, which is the
 * admission registry's size, not a coincidence - every admitted route has a
 * file behind it.
 */
function publicRouteFiles() {
  const { admittedRoutes, normalizeRoute } = require('../lib/page_admission');
  const admitted = admittedRoutes();
  if (!admitted.size) {
    // A missing or empty admission registry is a stop, not an empty inventory:
    // reporting zero public surfaces as if measured would be a fabrication.
    throw new Error('page admission registry is missing or empty; refusing to report a public-surface count derived from no admitted routes');
  }
  const byRoute = new Map();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.name.endsWith('.html')) continue;
      let rel = path.relative(ROOT, p).replace(/\\/g, '/');
      // dist/ is the rendered mirror of the same routes, not a second surface.
      if (rel.startsWith('dist/')) rel = rel.slice('dist/'.length);
      const route = normalizeRoute(`/${rel}`);
      if (!admitted.has(route)) continue;
      if (!byRoute.has(route)) byRoute.set(route, p);
    }
  }
  walk(ROOT);
  return byRoute;
}
function countIndexableRoutes() {
  return publicRouteFiles().size;
}
/**
 * Counts admitted public routes whose page carries a robots noindex directive.
 * The proof packet used to publish `noindex_routes_total: 0` as a hardcoded
 * literal sitting beside genuinely-counted totals, while noindex appears in the
 * tree. A fabricated zero is worse than no field: it reads as a measurement.
 */
function countNoindexRoutes() {
  let count = 0;
  for (const abs of publicRouteFiles().values()) {
    let html;
    try { html = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (/<meta[^>]+name=["']?robots["']?[^>]*content=["'][^"']*noindex/i.test(html)) count += 1;
  }
  return count;
}
/**
 * The declared 100K governor, read from policy rather than restated in code.
 * Every consumer that needs the target must get it from here so that changing
 * the policy file moves every gate at once instead of silently disagreeing with
 * a literal someone typed into a generator.
 */
function requirePolicyNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`policy value missing or not finite: ${name}. A missing governor is a stop, not a default.`);
  return n;
}
function citationPolicy() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', null);
  if (!profile) throw new Error('data/strategy/citation_strategy_profile.json is missing; the 100K governor cannot be defaulted');
  return {
    citation_ready_target: requirePolicyNumber(profile.citation_strategy?.citation_ready_target, 'citation_strategy.citation_ready_target'),
    time_horizon_days: requirePolicyNumber(profile.citation_strategy?.citation_ready_time_horizon_days, 'citation_strategy.citation_ready_time_horizon_days'),
    primary_kpi_target: requirePolicyNumber(profile.primary_kpi?.target_value, 'primary_kpi.target_value'),
    primary_kpi_time_horizon_days: requirePolicyNumber(profile.primary_kpi?.time_horizon_days, 'primary_kpi.time_horizon_days')
  };
}
function countSitemapUrls() {
  let total = 0;
  const files = [];
  const rootSitemap = abs('sitemap.xml');
  if (fs.existsSync(rootSitemap)) files.push(rootSitemap);
  const dir = abs('sitemaps');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.xml')) files.push(path.join(dir, name));
  }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    total += (text.match(/<url>/g) || []).length;
    total += (text.match(/<sitemap>/g) || []).length;
  }
  return total;
}
function countLlmsEntries() {
  const file = abs('llms.txt');
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => /^-\s+/.test(line) || /^https?:/.test(line)).length;
}
function latestRawRecords() {
  const latest = readJson('data/signals/raw/latest.json', null);
  if (latest && Array.isArray(latest.records)) return latest.records;
  const fixture = readJson('data/signals/fixtures/raw_signals.json', { records: [] });
  return fixture.records || [];
}
function latestNormalized() {
  const latest = readJson('data/signals/normalized/latest.json', null);
  return latest && Array.isArray(latest.records) ? latest.records : [];
}
module.exports = { ROOT, TODAY, abs, exists, ensureDir, readJson, writeJson, writeText, hash, slugify, excerpt, normalizeRecord, clusterSignals, scoreSignals, canonicalReleaseUnitType, buildCandidates, publicRouteFiles, countIndexableRoutes, countNoindexRoutes, requirePolicyNumber, citationPolicy, countSitemapUrls, countLlmsEntries, latestRawRecords, latestNormalized };
