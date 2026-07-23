#!/usr/bin/env node
'use strict';
const { readJson, writeJson } = require('../citation_intelligence/pipeline_lib');
function run() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', {});
  const growth = readJson('data/strategy/citation_growth_strategy.json', { target: {} });
  const scoreboard = readJson('data/measurement/citation_honesty_scoreboard.json', {});
  const intelligence = readJson('_citation_intelligence_contract.json', {});
  const release = readJson('_content_release_contract.json', {});
  const errors = [];
  if (profile.repo !== 'seq23/local-guides-citation-velocity') errors.push('profile repo mismatch');
  if (profile.primary_kpi?.name !== 'monthly_visitors') errors.push('primary KPI must be monthly_visitors');
  if (profile.primary_kpi?.validator_claim_allowed !== false) errors.push('validators must not claim external traffic');
  if ((growth.target?.citation_ready_opportunities_or_surfaces || 0) < 100000) errors.push('100K citation-ready target missing');
  if ((growth.target?.time_horizon_days || 9999) > 180) errors.push('citation-ready horizon must be 180 days or less');
  if (growth.target?.hard_guarantee !== false) errors.push('citation-ready target must not be a hard guarantee');
  if (growth.target?.target_is_external_citation_claim !== false) errors.push('target must not be labelled as an external citation claim');
  if ((scoreboard.generated_fanout_records || 0) < 100000) errors.push('100K fanout opportunity universe missing');
  if (scoreboard.buckets?.opportunities_are_not_wins !== true) errors.push('citation honesty bucket boundary missing');
  if (intelligence.live_firehose_enabled !== false) errors.push('live firehose must be disabled in this implementation');
  if (release.controlled_apply?.public_content_mutation_enabled !== false) errors.push('public content mutation must remain disabled for shadow apply');
  const gate = {
    schema_version: '2.0',
    repo: 'local-guides-citation-velocity',
    generated_at: new Date().toISOString(),
    status: errors.length ? 'FAIL' : 'PASS',
    gates: {
      strategy_profile_present: Boolean(profile.repo),
      traffic_target_labelled_business_objective: profile.primary_kpi?.validator_claim_allowed === false,
      citation_ready_100k_target_present: (growth.target?.citation_ready_opportunities_or_surfaces || 0) >= 100000,
      citation_ready_horizon_180_days_or_less: (growth.target?.time_horizon_days || 9999) <= 180,
      no_hard_guarantee: growth.target?.hard_guarantee === false,
      no_external_citation_claim: growth.target?.target_is_external_citation_claim === false,
      fanout_universe_present: (scoreboard.generated_fanout_records || 0) >= 100000,
      citation_honesty_boundaries_present: scoreboard.buckets?.opportunities_are_not_wins === true,
      contracts_installed: Boolean(intelligence.schema_version && release.schema_version),
      live_firehose_disabled: intelligence.live_firehose_enabled === false,
      public_content_shadow_apply_only: release.controlled_apply?.public_content_mutation_enabled === false
    },
    errors
  };
  writeJson('artifacts/validation/citation-strategy-gate.json', gate);
  if (errors.length) throw new Error(errors.join('; '));
  console.log('citation strategy gate PASS');
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.message); process.exit(1); } }
module.exports = { run };
