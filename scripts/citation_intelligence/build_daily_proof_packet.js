#!/usr/bin/env node
'use strict';
const { readJson, writeJson, writeText, countIndexableRoutes, countNoindexRoutes, countSitemapUrls, countLlmsEntries, requirePolicyNumber } = require('./pipeline_lib');
function run() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', null);
  if (!profile) throw new Error('data/strategy/citation_strategy_profile.json is missing; the proof packet will not invent its governors');
  const raw = readJson('data/signals/raw/latest.json', { records: [] });
  const normalized = readJson('data/signals/normalized/latest.json', { records: [] });
  const clusters = readJson('data/signals/clusters/latest.json', { clusters: [] });
  const plan = readJson('artifacts/validation/daily-citation-release-plan.json', { selected: [], blocked: [] });
  const application = readJson('artifacts/validation/daily-citation-release-application.json', { release_units_applied: 0, shadow_units_recorded: 0 });
  const health = readJson('data/signals/source_health.json', {});
  const growth = readJson('data/strategy/citation_growth_strategy.json', { target: {} });
  const scoreboard = readJson('data/measurement/citation_honesty_scoreboard.json', {});
  const zeroDollar = readJson('data/measurement/zero_dollar_citation_test_ledger.json', { tests: [] });
  const freeWinQueue = readJson('data/measurement/free_win_self_heal_queue.json', { queue: [] });
  // Policy governors are read, never defaulted. These four used to be written
  // `profile.primary_kpi?.target_value || 100000` and so on: the policy literal
  // restated in code, so a policy change would be silently absorbed by the
  // fallback and the packet would keep publishing the old number as if measured.
  // A missing governor is a stop.
  const primaryTarget = requirePolicyNumber(profile.primary_kpi?.target_value, 'primary_kpi.target_value');
  const primaryHorizon = requirePolicyNumber(profile.primary_kpi?.time_horizon_days, 'primary_kpi.time_horizon_days');
  const citationReadyTarget = requirePolicyNumber(growth.target?.citation_ready_opportunities_or_surfaces, 'citation_growth_strategy.target.citation_ready_opportunities_or_surfaces');
  const citationReadyHorizon = requirePolicyNumber(growth.target?.time_horizon_days, 'citation_growth_strategy.target.time_horizon_days');
  // `scoreboard.owned_surfaces_current || countIndexableRoutes()` let a
  // legitimate measured ZERO spring to a computed default. The scoreboard is
  // produced by build_100k_citation_runway.js earlier in the same pipeline; if
  // it is absent or carries no number, that is a pipeline-order failure to
  // report, not a figure to substitute.
  const ownedSurfaces = Number(scoreboard.owned_surfaces_current);
  if (!Number.isFinite(ownedSurfaces)) throw new Error('data/measurement/citation_honesty_scoreboard.json has no owned_surfaces_current; run the 100K runway builder first. This value is not substituted.');
  const publicRouteCount = countIndexableRoutes();
  const noindexRoutes = countNoindexRoutes();
  const packet = {
    schema_version: '2.0',
    run_id: plan.run_id || `proof_${Date.now()}`,
    repo: 'local-guides-citation-velocity',
    date: new Date().toISOString().slice(0, 10),
    primary_kpi: 'monthly_visitors',
    primary_target: primaryTarget,
    primary_target_time_horizon_days: primaryHorizon,
    citation_ready_target: citationReadyTarget,
    citation_ready_time_horizon_days: citationReadyHorizon,
    citation_ready_hard_guarantee: growth.target?.hard_guarantee === true,
    citation_ready_fanout_opportunities: scoreboard.generated_fanout_records || 0,
    citation_ready_opportunities_current: scoreboard.citation_ready_opportunities_current || 0,
    owned_surfaces_current: ownedSurfaces,
    submitted_urls_current: scoreboard.submitted_urls_current || 0,
    indexed_urls_current: scoreboard.indexed_urls_current || 0,
    observed_wins_current: scoreboard.observed_wins_current || 0,
    observed_external_citations_current: scoreboard.observed_external_citations_current || 0,
    observed_external_citations_new_this_run: scoreboard.observed_external_citations_new_this_run || 0,
    zero_dollar_tests_total: (zeroDollar.tests || []).length,
    zero_dollar_tests_passing: (zeroDollar.tests || []).filter((t) => t.status === 'PASS').length,
    free_win_self_heal_candidates: (freeWinQueue.queue || []).length,
    external_telemetry_present: false,
    signals_collected: (raw.records || []).length,
    signals_normalized: (normalized.records || []).length,
    source_health: health.summary || {},
    clusters_created: (clusters.clusters || []).length,
    release_units_planned: (plan.selected || []).length + (plan.blocked || []).length,
    release_units_applied: application.release_units_applied || 0,
    shadow_units_recorded: application.shadow_units_recorded || 0,
    new_pages: (plan.selected || []).filter((u) => u.release_unit_type === 'create_distinct_page').length,
    repairs: (plan.selected || []).filter((u) => u.release_unit_type === 'repair_existing').length,
    atom_updates: (plan.selected || []).filter((u) => u.release_unit_type === 'content_atom_update').length,
    answer_block_updates: (plan.selected || []).filter((u) => u.release_unit_type === 'answer_block_update').length,
    entity_context_updates: (plan.selected || []).filter((u) => u.release_unit_type === 'entity_context_update').length,
    internal_link_updates: (plan.selected || []).filter((u) => u.release_unit_type === 'internal_link_update').length,
    blocked_units: (plan.blocked || []).filter((u) => u.planner_status === 'blocked').length,
    // Both of these came from a walk that counted every .html file under the
    // repo root - 4,556, including the dist/ render mirror and files under
    // staging/, templates/, artifacts/, data/ and docs/ that are not public
    // routes. That is a file count labelled as a citation-surface total. It is
    // now the admitted public route set (scripts/lib/page_admission.js), one
    // entry per route.
    citation_surfaces_total: publicRouteCount,
    citation_surfaces_basis: 'admitted_public_routes_only',
    indexable_routes_total: publicRouteCount - noindexRoutes,
    // `noindex_routes_total: 0` was a hardcoded literal sitting among genuinely
    // counted totals while noindex appears in the tree. Now measured.
    noindex_routes_total: noindexRoutes,
    sitemap_urls_total: countSitemapUrls(),
    llms_entries_total: countLlmsEntries(),
    validators: {
      strategy_gate: 'artifacts/validation/citation-strategy-gate.json',
      fixture_trace: 'artifacts/validation/fixture-signal-trace.json',
      release_plan: 'artifacts/validation/daily-citation-release-plan.json'
    },
    postdeploy: { status: 'NOT_RUN_IN_CONTAINER', reason: 'Requires deployed URL and local/GitHub runtime.' },
    status: 'PASS_SHADOW_STRUCTURAL'
  };
  writeJson('artifacts/validation/daily-proof-packet.json', packet);
  writeText('reports/daily-proof-packet.md', `# Daily Proof Packet\n\nStatus: ${packet.status}\n\nCitation-ready target: ${packet.citation_ready_target} opportunities/surfaces in ${packet.citation_ready_time_horizon_days} days or less.\nCitation-ready fanout opportunities: ${packet.citation_ready_fanout_opportunities}\nFree-win/self-heal candidates: ${packet.free_win_self_heal_candidates}\nObserved external citation/win records: ${packet.observed_external_citations_current}\n\nSignals collected: ${packet.signals_collected}\nSignals normalized: ${packet.signals_normalized}\nRelease units planned: ${packet.release_units_planned}\nRelease units applied to public content: ${packet.release_units_applied}\nShadow units recorded: ${packet.shadow_units_recorded}\nExternal telemetry present: false\n\nNo traffic, ranking, indexing, backlink, conversion, AI Overview, or LLM-citation outcome is claimed unless evidence appears in the observed external citation evidence ledger.\n`);
  console.log(`proof packet: ${packet.status}; telemetry=false; planned=${packet.release_units_planned}`);
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.stack || err.message); process.exit(1); } }
module.exports = { run };
