#!/usr/bin/env node
/**
 * Join measured query demand to the publishing decision.
 *
 * The gap this closes
 * -------------------
 * data/authority_scale/query_atlas.json is built on a schedule from real Search
 * Console evidence, and it was read by NOBODY. Every row in
 * data/release/page_release_queue.json carried source="twin_agent_artifact", and
 * Velocity Content Release only fired when a human pushed an agent-run manifest:
 * 5 runs and 8 pages since June. Measured demand and the publishing decision were
 * two systems that never touched.
 *
 * This is the edge between them. It reads the atlas, admits only queries whose
 * citation occupancy has actually been MEASURED, ranks them by that occupancy,
 * and writes page candidates that data/community/approval_queue.json feeds to
 * scripts/content/build_page_release_queue.js - the same gate every other
 * candidate passes through. Nothing here bypasses the release law; it supplies
 * input to it.
 *
 * What it deliberately does not do
 * --------------------------------
 *   - It does not publish. It produces candidates. The release queue still
 *     decides eligibility, and every existing gate - topic fit, distinct route,
 *     source records, neutrality - still runs downstream and can still refuse.
 *   - It does not invent a vertical. A query that matches no governed vertical's
 *     topic terms, or matches two equally, is HELD with a stated reason.
 *   - It does not treat an unmeasured query as winnable. The atlas ranks
 *     unmeasured rows with a neutral factor so ordering is not distorted; this
 *     script requires an actual citation-occupancy reading before a query may
 *     become a page. Ranking is not admission.
 *
 * Rule: it never exits 0 having done nothing silently. Every query is either a
 * candidate or a held row with a named reason, and the run prints its stop.
 *
 * Usage: node join_atlas_to_release_queue.mjs [--limit N] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const DRY = argv.includes('--dry-run');

const readJson = (rel, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fb; } };

const CONTRACT = 'data/queries/atlas_release_join_contract.json';
const OUT = 'data/queries/measured_demand_candidates.json';

const contract = readJson(CONTRACT, null);
if (!contract) { console.error(`atlas join: missing ${CONTRACT} - the join has no declared admission rules and refuses to guess them`); process.exit(1); }
const rules = contract.admission_rules || {};

const atlas = readJson('data/authority_scale/query_atlas.json', null);
if (!atlas || !Array.isArray(atlas.queries)) { console.error('atlas join: data/authority_scale/query_atlas.json is missing or has no queries - run npm run atlas:build first'); process.exit(1); }

const strategy = readJson('data/strategy/page_strategy_registry.json', {});
const admission = readJson('data/content/page_admission_registry.json', { pages: [] });
const live = readJson('content/_live/pages.json', { pages: [] });
const sourceRegistry = new Set((readJson('data/evidence/source_registry.json', { sources: [] }).sources || []).map((s) => s.source_id));

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
const admittedRoutes = new Set((admission.pages || []).map((p) => p.path));
const liveRoutes = new Set((live.pages || []).map((p) => p.path || p.slug).filter(Boolean));
const liveTitles = new Set((live.pages || []).map((p) => norm(p.title || p.visible_q || '')).filter(Boolean));

// Vertical is matched on the governed topic terms, never on the atlas row's
// target_domain. New query pages belong to the Velocity site by standing rule,
// and the canonical portfolio domains are not a routing authority for it.
const VERTICALS = Object.entries(strategy.allowed_verticals || {});
function matchVertical(query) {
  const lower = norm(query);
  const scored = [];
  const seenCanonical = new Set();
  for (const [key, cfg] of VERTICALS) {
    if (seenCanonical.has(cfg.canonical)) continue;
    const hits = (cfg.topic_terms || []).filter((t) => lower.includes(t));
    if (hits.length) { scored.push({ key, cfg, hits: hits.length, terms: hits }); seenCanonical.add(cfg.canonical); }
  }
  scored.sort((a, b) => b.hits - a.hits);
  if (!scored.length) return { ok: false, reason: 'no_governed_vertical_matches_query_terms' };
  if (scored.length > 1 && scored[0].hits === scored[1].hits) {
    return { ok: false, reason: `ambiguous_vertical:${scored[0].cfg.canonical}|${scored[1].cfg.canonical}` };
  }
  return { ok: true, ...scored[0] };
}

const held = [];
const eligible = [];

for (const q of atlas.queries) {
  const reasons = [];
  const query = String(q.query || '').trim();
  const record = { query, evidence_tier: q.evidence_tier, rank_score: q.rank_score, rank_band: q.rank_band, citation_occupancy: q.citation_occupancy ?? null, winnability_basis: q.winnability_basis || null };

  if (!(rules.allowed_evidence_tiers || []).includes(q.evidence_tier)) reasons.push(`tier_not_admitted:${q.evidence_tier}`);
  // Demand evidence is required except for tiers the contract exempts. T3 is
  // "real phrasing, no volume" - a query observed verbatim against a live answer
  // engine, for which no volume figure exists or can be obtained. Exempting it
  // resolves a contradiction where query_atlas.json's policy and
  // validate_query_atlas.js both admitted T3 while this join silently refused it.
  const demandExemptTiers = rules.demand_evidence_exempt_tiers || [];
  const demandExempt = demandExemptTiers.includes(q.evidence_tier);
  if (rules.require_demand_evidence && !demandExempt && q.demand_basis === 'none') reasons.push('no_demand_evidence');

  // The gate that replaced the placebo. An unmeasured row ranks; it does not publish.
  if (q.winnability_basis !== rules.required_winnability_basis) {
    reasons.push(`winnability_not_measured:${q.winnability_basis || 'none'}`);
  } else if (typeof q.citation_occupancy !== 'number') {
    reasons.push('citation_occupancy_missing');
  } else {
    // A demand-exempt row carries no volume corroboration, so it clears a higher
    // winnability floor than a row that does. Falls back to the base floor when the
    // contract declares no separate one.
    const floor = demandExempt && rules.minimum_citation_occupancy_for_demand_exempt_tiers != null
      ? Number(rules.minimum_citation_occupancy_for_demand_exempt_tiers)
      : Number(rules.minimum_citation_occupancy);
    if (q.citation_occupancy < floor) {
      reasons.push(`citation_occupancy_below_floor:${q.citation_occupancy}<${floor}`);
    }
  }

  if (query.length < Number(rules.minimum_query_characters || 20)) reasons.push('query_too_short');

  const v = query ? matchVertical(query) : { ok: false, reason: 'empty_query' };
  if (!v.ok) reasons.push(v.reason);

  let route = null;
  let sourceRecords = [];
  if (v.ok) {
    route = `/${v.cfg.canonical}/guides/${slugify(query)}/`;
    if (!(v.cfg.route_prefixes || []).some((p) => route.startsWith(p))) reasons.push('route_outside_vertical');
    if (admittedRoutes.has(route) || liveRoutes.has(route)) reasons.push('route_already_exists');
    if (liveTitles.has(norm(query))) reasons.push('equivalent_title_already_live');
    sourceRecords = (contract.vertical_source_records?.[v.cfg.canonical] || contract.vertical_source_records?.[v.key] || [])
      .filter((id) => sourceRegistry.has(id));
    if (!sourceRecords.length) reasons.push(`no_registered_source_records_for_vertical:${v.cfg.canonical}`);
  }

  for (const raw of strategy.new_page_gate?.forbidden_patterns || []) {
    if (new RegExp(raw, 'i').test(query)) reasons.push(`prohibited_language:${raw}`);
  }
  for (const phrase of strategy.vertical_exclusions?.[v.ok ? v.cfg.canonical : ''] || []) {
    if (norm(query).includes(phrase)) reasons.push(`off_topic:${phrase}`);
  }

  if (reasons.length) { held.push({ ...record, held_reasons: reasons }); continue; }
  eligible.push({ ...record, vertical: v.cfg.canonical, matched_terms: v.terms, target_route: route, source_records: sourceRecords });
}

// Ranked by measured citation occupancy first, then by the atlas rank_score
// within the same band. Occupancy leads because it is the thing that decides
// whether a slot can be taken at all; demand only sizes the prize.
eligible.sort((a, b) => (b.citation_occupancy - a.citation_occupancy) || ((b.rank_score ?? 0) - (a.rank_score ?? 0)));

// "A wording variation is not a distinct page intent" - page_strategy_registry.json.
// The downstream duplicate gate compares routes and titles, so two orderings of
// the same words ("dallas dental implant cost" / "dental implants cost dallas tx")
// slip through it as two pages. Collapse them here, on the content-word set, and
// keep the higher-ranked one. The loser is held with the query it duplicates
// named, so the decision is reviewable rather than invisible.
const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'with', 'my', 'is', 'are', 'do', 'does', 'i', 'it', 'near', 'me', 'best', 'vs']);
const intentKey = (q) => [...new Set(norm(q).split(/[^a-z0-9]+/)
  .filter(Boolean)
  .filter((t) => !STOP.has(t))
  .map((t) => t.replace(/(ies)$/, 'y').replace(/([a-z]{3,})s$/, '$1')))].sort().join(' ');

// Exact content-word equality catches reorderings. It does not catch a variation
// that adds one throwaway token - "dallas dental implant cost" against "dental
// implants cost dallas tx" - so overlap is also measured. The threshold is
// declared in the contract rather than tuned here, and it is deliberately high:
// "dental implant cost" vs "dental implant cost medicaid" is 0.75 and stays two
// pages, because a qualifier that changes the answer is a different intent.
const NEAR_DUPLICATE_JACCARD = Number(rules.near_duplicate_jaccard ?? 0.8);
const overlap = (a, b) => {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  return hit / (A.size + B.size - hit);
};

const deduped = [];
const keptKeys = [];
for (const e of eligible) {
  const key = intentKey(e.query);
  const clash = keptKeys.find((k) => k.key === key || overlap(k.key, key) >= NEAR_DUPLICATE_JACCARD);
  if (clash) {
    held.push({ ...e, held_reasons: [`wording_variation_of:${clash.query}`] });
    continue;
  }
  keptKeys.push({ key, query: e.query });
  deduped.push(e);
}

const limit = Number(arg('--limit', rules.maximum_candidates_per_run || 5));
const selected = deduped.slice(0, limit);
for (const e of deduped.slice(limit)) held.push({ ...e, held_reasons: [`over_batch_cap:${limit}`] });

const now = new Date();
const stamp = process.env.SOURCE_DATE || now.toISOString().slice(0, 10);

const candidates = selected.map((e) => ({
  id: `atlas_${Buffer.from(`${e.query}|${e.vertical}`).toString('hex').slice(0, 16)}`,
  status: 'APPROVED',
  source: contract.candidate_source,
  source_run_id: `query_atlas_${stamp}`,
  vertical: e.vertical,
  query: e.query,
  normalized_query: norm(e.query),
  llm_bait_phrase: e.query,
  operation: 'CREATE_NEW_TARGET_PAGE',
  target_route: e.target_route,
  renderedPath: `${e.target_route.replace(/^\//, '').replace(/\/$/, '')}/index.html`,
  route_family: contract.route_shape.route_family,
  route_reason: 'measured_query_demand_with_measured_citation_occupancy',
  route_shape: 'guide_directory',
  route_authority: 'query_atlas_measured_evidence',
  admission_basis: 'MEASURED_QUERY_ATLAS_CANDIDATE',
  source_records: e.source_records,
  source_signal_ids: [`query_atlas:${stamp}:${slugify(e.query)}`],
  citation_velocity: true,
  evidence_tier: e.evidence_tier,
  rank_band: e.rank_band,
  rank_score: e.rank_score,
  citation_occupancy: e.citation_occupancy,
  winnability_basis: e.winnability_basis,
  status_reason: 'selected_from_measured_query_atlas_by_citation_occupancy',
}));

// A stop is only legitimate if it is named. "Nothing today" with no reason is the
// failure mode this repo keeps finding; it is not available here.
const stopReason = candidates.length
  ? null
  : (!atlas.queries.length ? 'atlas_empty'
    : held.every((h) => h.held_reasons.some((r) => r.startsWith('winnability_not_measured')))
      ? 'no_query_has_a_measured_citation_occupancy_reading_yet - run npm run probe:occupancy with OPENROUTER_API_KEY, then rebuild the atlas'
      : 'every_atlas_query_was_held_by_a_named_admission_rule');

const payload = {
  $schema: 'lkg-measured-demand-candidates-v1',
  generated_at: `${stamp}T00:00:00.000Z`,
  authority: CONTRACT,
  input: {
    atlas: 'data/authority_scale/query_atlas.json',
    atlas_rows: atlas.queries.length,
    occupancy_signal: 'data/signals/query_class_occupancy.json',
  },
  admission_rules: rules,
  ranked_by: 'measured citation occupancy (unbranded share of answer-engine citation slots), then atlas rank_score within band',
  eligible_count: eligible.length,
  distinct_intent_count: deduped.length,
  candidate_count: candidates.length,
  held_count: held.length,
  stop_reason: stopReason,
  candidates,
  held,
};

if (DRY) {
  console.log(`atlas join [dry-run]: ${eligible.length} eligible, ${candidates.length} would be emitted, ${held.length} held. stop_reason=${stopReason ?? 'none'}`);
  process.exit(0);
}

fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(payload, null, 2) + '\n');

const byReason = {};
for (const h of held) for (const r of h.held_reasons) { const k = r.split(':')[0]; byReason[k] = (byReason[k] || 0) + 1; }
console.log(`atlas join: ${atlas.queries.length} atlas rows -> ${eligible.length} eligible -> ${candidates.length} candidates, ${held.length} held ${JSON.stringify(byReason)} -> ${OUT}`);
if (stopReason) console.log(`atlas join: NAMED STOP - ${stopReason}`);
for (const c of candidates) console.log(`  CANDIDATE occ=${c.citation_occupancy} ${c.vertical} ${c.target_route}`);
