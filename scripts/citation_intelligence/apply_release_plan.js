#!/usr/bin/env node
'use strict';
const { readJson, writeJson } = require('./pipeline_lib');
function run() {
  const plan = readJson('artifacts/validation/daily-citation-release-plan.json', null);
  if (!plan) throw new Error('Missing daily citation release plan. Run npm run release:plan first.');
  const contract = readJson('_content_release_contract.json', {});
  const publicMutation = contract.controlled_apply?.public_content_mutation_enabled === true;
  const applied = (plan.selected || []).map((unit) => ({
    candidate_id: unit.candidate_id,
    release_unit_type: unit.release_unit_type,
    route_owner: unit.route_owner,
    status: publicMutation ? 'APPLIED_GENERATED_STATE' : 'NO_OP_SHADOW_RECORDED',
    no_op_reason: publicMutation ? null : 'Public content mutation disabled in container. Shadow apply records planner output only.',
    generated_state_path: 'data/signals/release_candidates/applied_shadow_ledger.json'
  }));
  const ledger = readJson('data/signals/release_candidates/applied_shadow_ledger.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', applications: [] });
  ledger.applications = [...(ledger.applications || []), { run_id: plan.run_id, generated_at: new Date().toISOString(), mode: publicMutation ? 'generated_state_apply' : 'shadow_noop', applied }].slice(-50);
  writeJson('data/signals/release_candidates/applied_shadow_ledger.json', ledger);
  writeJson('artifacts/validation/daily-citation-release-application.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', run_id: plan.run_id, generated_at: new Date().toISOString(), public_content_mutation_enabled: publicMutation, release_units_applied: publicMutation ? applied.length : 0, shadow_units_recorded: applied.length, applied, status: 'PASS' });
  console.log(`release apply: ${applied.length} shadow units recorded; public mutation enabled=${publicMutation}`);
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.stack || err.message); process.exit(1); } }
module.exports = { run };
