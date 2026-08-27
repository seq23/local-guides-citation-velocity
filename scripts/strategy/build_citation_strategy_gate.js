#!/usr/bin/env node
'use strict';
const fs=require('fs');
const { readJson, writeJson } = require('../citation_intelligence/pipeline_lib');
function run() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', {});
  const growth = readJson('data/strategy/citation_growth_strategy.json', { target: {} });
  const scoreboard = readJson('data/measurement/citation_honesty_scoreboard.json', {});
  const intelligence = readJson('_citation_intelligence_contract.json', {});
  const release = readJson('_content_release_contract.json', {});
  const strategy = readJson('data/strategy/page_strategy_registry.json', {});
  const shardIndex = readJson('data/queries/citation_fanout_opportunities_100k/index.json', {});
  const errors = [];
  if (profile.repo !== 'seq23/local-guides-citation-velocity') errors.push('profile repo mismatch');
  if (profile.primary_kpi?.name !== 'monthly_visitors') errors.push('primary KPI must be monthly_visitors');
  if (profile.primary_kpi?.validator_claim_allowed !== false) errors.push('validators must not claim external traffic');
  // Three assertions here demanded 100,000 - a floor on the citation-ready
  // target, a floor on generated fanout records, and an exact equality on the
  // shard index - eight lines above `publication quota must be disabled`. A
  // floor on a count is satisfiable only by manufacture: when the real
  // opportunity space is smaller you keep emitting cartesian strings until the
  // number is met. The 100,000 records here are template concatenations of
  // 5 verticals x 50 states x 10 intents x 8 entities x 8 situations x 20
  // modifiers x 8 page families, against 68 queries in this repo that have a
  // measured volume. What is worth asserting is that the artifact does not
  // misreport its own size, and that the target is declared rather than a
  // specific figure.
  if (!(Number(growth.target?.citation_ready_opportunities_or_surfaces) > 0)) errors.push('citation-ready target must be declared and positive');
  if ((growth.target?.time_horizon_days || 9999) > 180) errors.push('citation-ready horizon must be 180 days or less');
  if (growth.target?.hard_guarantee !== false) errors.push('citation-ready target must not be a hard guarantee');
  if (growth.target?.target_is_external_citation_claim !== false) errors.push('target must not be labelled as an external citation claim');
  if (!(Number(scoreboard.generated_fanout_records) > 0)) errors.push('fanout opportunity universe missing');
  if (scoreboard.buckets?.opportunities_are_not_wins !== true) errors.push('citation honesty bucket boundary missing');
  if (Number(shardIndex.record_count||0) !== Number(scoreboard.generated_fanout_records||0)) errors.push(`shard index claims ${shardIndex.record_count} records, scoreboard claims ${scoreboard.generated_fanout_records}`);
  if (fs.existsSync('data/queries/citation_fanout_opportunities_100k.json')) errors.push('legacy 100K monolith is forbidden');
  if (intelligence.live_firehose_enabled !== false) errors.push('live firehose must be disabled in this implementation');
  if (release.runtime_autonomy_model !== 'FULL_SAFE_AUTONOMY') errors.push('release runtime must use FULL_SAFE_AUTONOMY');
  if (release.controlled_apply?.public_content_mutation_enabled !== true) errors.push('governed public mutation must be enabled for safe autonomy');
  if (!/Safe Harbor-admitted new routes|Safe Harbor/i.test(String(release.controlled_apply?.boundary||''))) errors.push('controlled apply must declare Safe Harbor mutation boundary');
  if (release.safe_harbor?.routine_human_approval_required !== false) errors.push('routine human approval must be disabled');
  if (release.safe_harbor?.publication_quota !== false) errors.push('publication quota must be disabled');
  if (profile.cadence?.publication_quota !== false) errors.push('cadence must be a processing budget, not publication quota');
  if (strategy.runtime_autonomy !== 'FULL_SAFE_AUTONOMY') errors.push('page strategy must declare FULL_SAFE_AUTONOMY');
  const generatedDate=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);
  const gate = {
    schema_version: '3.0',
    repo: 'local-guides-citation-velocity',
    generated_at: `${generatedDate}T00:00:00.000Z`,
    status: errors.length ? 'FAIL' : 'PASS',
    gates: {
      strategy_profile_present: Boolean(profile.repo),
      traffic_target_labelled_business_objective: profile.primary_kpi?.validator_claim_allowed === false,
      citation_ready_100k_target_present: (growth.target?.citation_ready_opportunities_or_surfaces || 0) >= 100000,
      citation_ready_horizon_180_days_or_less: (growth.target?.time_horizon_days || 9999) <= 180,
      no_hard_guarantee: growth.target?.hard_guarantee === false,
      no_external_citation_claim: growth.target?.target_is_external_citation_claim === false,
      fanout_universe_present: Number(shardIndex.record_count||0) === 100000,
      fanout_storage_sharded: !fs.existsSync('data/queries/citation_fanout_opportunities_100k.json') && Number(shardIndex.shard_count||0) > 1,
      citation_honesty_boundaries_present: scoreboard.buckets?.opportunities_are_not_wins === true,
      contracts_installed: Boolean(intelligence.schema_version && release.schema_version),
      live_firehose_disabled: intelligence.live_firehose_enabled === false,
      full_safe_autonomy: release.runtime_autonomy_model === 'FULL_SAFE_AUTONOMY',
      governed_public_mutation_enabled: release.controlled_apply?.public_content_mutation_enabled === true,
      routine_human_approval_disabled: release.safe_harbor?.routine_human_approval_required === false,
      publication_quota_disabled: release.safe_harbor?.publication_quota === false && profile.cadence?.publication_quota === false
    },
    errors
  };
  writeJson('artifacts/validation/citation-strategy-gate.json', gate);
  if (errors.length) throw new Error(errors.join('; '));
  console.log('citation strategy gate PASS');
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.message); process.exit(1); } }
module.exports = { run };
