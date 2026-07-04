#!/usr/bin/env node
'use strict';
const { readJson, writeJson } = require('../citation_intelligence/pipeline_lib');
function run() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', {});
  const intelligence = readJson('_citation_intelligence_contract.json', {});
  const release = readJson('_content_release_contract.json', {});
  const errors = [];
  if (profile.repo !== 'seq23/local-guides-citation-velocity') errors.push('profile repo mismatch');
  if (profile.primary_kpi?.name !== 'monthly_visitors') errors.push('primary KPI must be monthly_visitors');
  if (profile.primary_kpi?.validator_claim_allowed !== false) errors.push('validators must not claim external traffic');
  if (intelligence.live_firehose_enabled !== false) errors.push('live firehose must be disabled in this implementation');
  if (release.controlled_apply?.public_content_mutation_enabled !== false) errors.push('public content mutation must remain disabled for shadow apply');
  const gate = {
    schema_version: '1.4',
    repo: 'local-guides-citation-velocity',
    generated_at: new Date().toISOString(),
    status: errors.length ? 'FAIL' : 'PASS',
    gates: {
      strategy_profile_present: Boolean(profile.repo),
      traffic_target_labelled_business_objective: profile.primary_kpi?.validator_claim_allowed === false,
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
