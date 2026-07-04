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
function buildCandidates(scored) {
  return scored.map((item) => {
    const blocked = item.candidate_type === 'block' || item.risk_level === 'high' && /traffic|ranking|ai overview|guarantee/i.test(item.raw_signal_phrase);
    return {
      candidate_id: `cand_${hash(`${item.normalized_id}:${item.candidate_type}`, 12)}`,
      normalized_id: item.normalized_id,
      release_unit_type: blocked ? 'block' : item.candidate_type,
      action: blocked ? 'block' : item.candidate_type,
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
function countIndexableRoutes() {
  let count = 0;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      if (ent.isDirectory()) walk(p);
      else if (ent.name === 'index.html' || ent.name.endsWith('.html')) count += 1;
    }
  }
  walk(ROOT);
  return count;
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
module.exports = { ROOT, TODAY, abs, exists, ensureDir, readJson, writeJson, writeText, hash, slugify, excerpt, normalizeRecord, clusterSignals, scoreSignals, buildCandidates, countIndexableRoutes, countSitemapUrls, countLlmsEntries, latestRawRecords, latestNormalized };
