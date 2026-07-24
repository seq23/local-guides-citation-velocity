#!/usr/bin/env node
'use strict';
const { readJson, writeJson } = require('./pipeline_lib');
function run() {
  const plan = readJson('artifacts/validation/daily-citation-release-plan.json', null);
  if (!plan) throw new Error('Missing daily citation release plan. Run npm run release:plan first.');
  const contract = readJson('_content_release_contract.json', {});
  const governedReleaseMutation = contract.controlled_apply?.public_content_mutation_enabled === true;
  const applied = (plan.selected || []).map((unit) => ({
    candidate_id: unit.candidate_id,
    release_unit_type: unit.release_unit_type,
    route_owner: unit.route_owner,
    status: 'PLANNING_ONLY_RECORDED',
    no_op_reason: 'Citation-intelligence preview records governed planner output only; public mutation occurs only in release:velocity-intake.',
    generated_state_path: 'data/signals/release_candidates/applied_shadow_ledger.json'
  }));
  const ledger = readJson('data/signals/release_candidates/applied_shadow_ledger.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', applications: [] });
  ledger.applications = [...(ledger.applications || []), { run_id: plan.run_id, generated_at: new Date().toISOString(), mode: 'planning_only', applied }].slice(-50);
  writeJson('data/signals/release_candidates/applied_shadow_ledger.json', ledger);
  writeJson('artifacts/validation/daily-citation-release-application.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', run_id: plan.run_id, generated_at: new Date().toISOString(), application_mode: 'PLANNING_ONLY', public_content_mutation_enabled: false, governed_release_public_mutation_enabled: governedReleaseMutation, release_units_applied: 0, shadow_units_recorded: applied.length, applied, status: 'PASS' });
  console.log(`release apply: ${applied.length} planning-only units recorded; planning public mutation=false; governed release mutation capability=${governedReleaseMutation}`);
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.stack || err.message); process.exit(1); } }
module.exports = { run };
