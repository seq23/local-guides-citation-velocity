#!/usr/bin/env node
// Query atlas: full-coverage taxonomy as a LOOKUP INDEX, publishing gated on evidence.
//
// Fanout permutations are tagged OPPORTUNITY_ONLY / NOT_EVALUATED. They are not
// rankable because they carry no demand evidence, and generating pages from them is
// the scaled-content-abuse pattern named by the March 2026 core update.
//
// The taxonomy is therefore inverted into a classifier: a real query arrives with
// measured or modelled demand and INHERITS its dimensions. Coverage stays complete;
// publishing is evidence-gated. The permutation reserve is a hypothesis pool,
// consulted only where a cluster has no T1-T3 evidence at all.
//
// Portable across repos: uses data/authority_scale/fanout_dimensions.json when it
// exists, and otherwise derives clusters from the evidence itself rather than
// pretending a taxonomy is present.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } };

const dims = readJson('data/authority_scale/fanout_dimensions.json', null);
const evidence = readJson('data/queries/evidence/evidence_queries.json', { queries: [] });
const reserveIndex = readJson('data/authority_scale/fanout_100k/index.json', null);

const EVIDENCE_WEIGHT = { T1: 1.0, T2a: 0.8, T2b: 0.6, T3: 0.35 };

// rank_score is only comparable WITHIN a band, because the demand term in the
// formula carries a different unit in each one.
const RANK_BANDS = {
  MARKET: 'measured_search_volume',   // demand term = monthly searches (keyword tool)
  OWN: 'own_impressions_only',        // demand term = this domain's own 90d impressions
  NONE: 'unscored'                    // no demand evidence in either unit
};

const RANK_FORMULA = {
  formula: 'rank_score = EVIDENCE_WEIGHT[evidence_tier] * max(demand_value, 1) * weak_incumbent_score',
  demand_value_by_band: {
    [RANK_BANDS.MARKET]: 'search_volume (monthly searches from a keyword tool)',
    [RANK_BANDS.OWN]: "impressions_90d (this domain's own impressions over 90 days)",
    [RANK_BANDS.NONE]: 'null - no demand evidence, rank_score is null'
  },
  comparability: 'rank_score is ONLY comparable within the same rank_band. The demand '
    + 'term carries a different unit per band, so a cross-band comparison is a unit error. '
    + 'Queries are ordered by band first, then by rank_score inside the band.',
  band_order: [RANK_BANDS.MARKET, RANK_BANDS.OWN, RANK_BANDS.NONE],
  why: 'Previously one field named `volume` held monthly search volume on semrush rows '
    + "and this domain's own 90-day impressions on GSC rows, and rank_score was computed "
    + 'from it directly. That made a 40/mo keyword-tool query score off a single impression. '
    + 'Splitting the field and banding the score removes the comparison entirely.'
};
const PUBLISHABLE_TIERS = new Set(Object.keys(EVIDENCE_WEIGHT));
const STOPWORDS = new Set(['a','an','the','of','for','to','in','on','and','or','with','your','my','is','are','how','what','do','does','vs','best']);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
const slug = (s) => norm(s).replace(/\s+/g, '-');

// Token weight by inverse document frequency. Plain overlap lets filler words
// outvote the one distinctive term in a query; IDF makes rare tokens decide.
function idfFor(candidates) {
  const df = new Map(); let n = 0;
  for (const cand of candidates || []) {
    n++;
    for (const t of tokens(cand)) if (!STOPWORDS.has(t)) df.set(t, (df.get(t) || 0) + 1);
  }
  return (t) => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;
}

function classify(queryTokens, candidates) {
  if (!candidates || !candidates.length) return { value: null, confidence: 0 };
  const idf = idfFor(candidates);
  let best = null, bestScore = 0;
  for (const cand of candidates) {
    const ct = [...tokens(cand)].filter((t) => !STOPWORDS.has(t));
    if (!ct.length) continue;
    let hit = 0, total = 0;
    for (const t of ct) { const w = idf(t); total += w; if (queryTokens.has(t)) hit += w; }
    if (!hit || !total) continue;
    const score = hit / total;
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return bestScore > 0 ? { value: best, confidence: Number(bestScore.toFixed(3)) } : { value: null, confidence: 0 };
}

// Without a declared taxonomy, cluster on the query's most distinctive tokens
// rather than inventing topic names. Reported honestly as query_derived.
function derivedCluster(q) {
  const t = [...tokens(q)].filter((x) => !STOPWORDS.has(x));
  return t.slice(0, 2).join('-') || null;
}

const taxonomySource = dims ? 'fanout_dimensions' : 'query_derived';
const classified = [];
const unmatched = [];

for (const q of evidence.queries || []) {
  const tier = q.evidence_tier;
  if (!tier) { unmatched.push({ query: q.query, reason: 'missing_evidence_tier' }); continue; }
  if (!PUBLISHABLE_TIERS.has(tier)) { unmatched.push({ query: q.query, reason: `non_publishable_tier:${tier}` }); continue; }

  const qt = tokens(q.query);
  const topic = dims ? classify(qt, dims.topics) : { value: null, confidence: 0 };
  const audience = dims ? classify(qt, dims.audiences) : { value: null, confidence: 0 };
  const modifier = dims ? classify(qt, dims.modifiers) : { value: null, confidence: 0 };
  const format = dims ? classify(qt, dims.formats) : { value: null, confidence: 0 };

  // Two incompatible quantities used to share one field named `volume`: modelled
  // monthly search volume on semrush rows, and this domain's own 90-day impression
  // count on GSC rows. rank_score was computed from it, so a 40/mo keyword-tool term
  // was scored off a single impression. The fields are now explicit and rank_score is
  // banded so the two units can never sort against each other as peers.
  const searchVolume = q.search_volume ?? null;
  const impressions90d = q.impressions_90d ?? null;
  const weakIncumbent = Number(q.weak_incumbent_score ?? 0.5);

  const demandBasis = searchVolume !== null ? 'search_volume'
    : impressions90d !== null ? 'impressions_90d'
    : 'none';
  const rankBand = demandBasis === 'search_volume' ? RANK_BANDS.MARKET
    : demandBasis === 'impressions_90d' ? RANK_BANDS.OWN
    : RANK_BANDS.NONE;

  // Same arithmetic, but a score is only ever meaningful against other scores in
  // its OWN band, because the demand term carries a different unit per band.
  const demandValue = demandBasis === 'search_volume' ? searchVolume
    : demandBasis === 'impressions_90d' ? impressions90d
    : null;
  const rank = demandValue === null
    ? null
    : Number((EVIDENCE_WEIGHT[tier] * Math.max(demandValue, 1) * weakIncumbent).toFixed(2));

  classified.push({
    query: q.query,
    evidence_tier: tier,
    source_type: q.source_type || null,
    search_volume: searchVolume,
    impressions_90d: impressions90d,
    demand_basis: demandBasis,
    search_volume_source: q.search_volume_source ?? null,
    volume_sources: q.volume_sources ?? null,
    volume_conflict: q.volume_conflict ?? false,
    kd_sources: q.kd_sources ?? null,
    kd_conflict: q.kd_conflict ?? false,
    keyword_difficulty: q.keyword_difficulty ?? null,
    weak_incumbent_score: weakIncumbent,
    intent: q.intent || null,
    intent_method: q.intent_method || null,
    target_domain: q.target_domain || null,
    inherited: {
      taxonomy_source: taxonomySource,
      topic: topic.value, topic_confidence: topic.confidence,
      audience: audience.value, modifier: modifier.value, format: format.value,
      semantic_cluster: topic.value ? slug(topic.value) : derivedCluster(q.query)
    },
    rank_score: rank,
    rank_band: rankBand,
    rank_score_comparable_within: rankBand,
    publishable: true
  });
}

// Band first, score second. Sorting on rank_score alone across bands would be the
// original defect: it would let one impression and 40 monthly searches sort as peers.
const BAND_ORDER = { [RANK_BANDS.MARKET]: 0, [RANK_BANDS.OWN]: 1, [RANK_BANDS.NONE]: 2 };
classified.sort((a, b) => {
  const band = BAND_ORDER[a.rank_band] - BAND_ORDER[b.rank_band];
  if (band !== 0) return band;
  return (b.rank_score ?? -1) - (a.rank_score ?? -1);
});

const covered = new Set(classified.map((c) => c.inherited.semantic_cluster).filter(Boolean));
const allClusters = dims ? (dims.topics || []).map(slug) : [...covered];
const reserveOnly = allClusters.filter((c) => !covered.has(c));

const atlas = {
  schema_version: '2.0',
  taxonomy_source: taxonomySource,
  policy: 'Full taxonomy coverage is an index, not a publishing queue. Pages may only be generated against evidence_tier T1-T3. T4 synthetic permutations are a hypothesis reserve consulted when a cluster has no evidence, and never publish on their own.',
  evidence_weights: EVIDENCE_WEIGHT,
  rank_scoring: RANK_FORMULA,
  unit_contract: {
    search_volume: 'Monthly searches reported by a keyword tool. null when unknown.',
    impressions_90d: "This domain's own impressions over the measured 90-day GSC window. null when unknown.",
    demand_basis: 'Which field rank_score used: search_volume | impressions_90d | none.',
    removed_field: '`volume` is removed. It previously held BOTH monthly search volume '
      + "(semrush rows) and this domain's own 90d impressions (gsc rows). A missing key "
      + 'throws; a wrong number does not.',
    never: 'Do not sum or compare across units. Disagreeing packet volumes are recorded '
      + 'in volume_sources with volume_conflict=true and are never averaged.',
    precedent: 'Follows portfolio_demand.json (portfolio-demand-v1), which separated '
      + 'volume_mo from demand_signal/demand_signal_unit for this same defect.'
  },
  taxonomy: {
    topics: dims ? (dims.topics || []).length : null,
    audiences: dims ? (dims.audiences || []).length : null,
    modifiers: dims ? (dims.modifiers || []).length : null,
    formats: dims ? (dims.formats || []).length : null,
    materialized_reserve: reserveIndex?.record_count ?? 0,
    reserve_path: reserveIndex ? 'data/authority_scale/fanout_100k' : null
  },
  coverage: {
    clusters_total: allClusters.length,
    clusters_with_evidence: covered.size,
    clusters_reserve_only: reserveOnly.length,
    reserve_only_clusters: reserveOnly.slice(0, 100)
  },
  evidence_backed_count: classified.length,
  unmatched_count: unmatched.length,
  unmatched,
  queries: classified
};

fs.mkdirSync(path.join(ROOT, 'data/authority_scale'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/authority_scale/query_atlas.json'), JSON.stringify(atlas, null, 2) + '\n');
console.log(`[query-atlas] taxonomy=${taxonomySource} evidence_backed=${classified.length} unmatched=${unmatched.length} clusters ${covered.size}/${allClusters.length} reserve=${atlas.taxonomy.materialized_reserve}`);
