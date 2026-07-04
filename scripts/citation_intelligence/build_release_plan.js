#!/usr/bin/env node
'use strict';
const { readJson, writeJson, writeText, buildCandidates } = require('./pipeline_lib');
function loadCandidates() {
  const candidateFile = readJson('data/signals/release_candidates/latest.json', null);
  if (candidateFile && Array.isArray(candidateFile.candidates)) return candidateFile.candidates;
  const scored = readJson('data/signals/scores/latest.json', { records: [] }).records || [];
  return buildCandidates(scored);
}
function run() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', {});
  const contract = readJson('_content_release_contract.json', {});
  const candidates = loadCandidates();
  const selected = [];
  const blocked = [];
  const dailyLimit = Number(profile.cadence?.daily_target_units || 5);
  const eligible = [];
  for (const cand of candidates) {
    const allowed = (contract.allowed_release_unit_types || []).includes(cand.release_unit_type);
    if (!allowed || cand.status === 'blocked' || cand.release_unit_type === 'block' || cand.release_unit_type === 'quarantine') {
      blocked.push({ ...cand, planner_status: 'blocked', why_not_selected: cand.block_reason || 'Candidate blocked by release contract or source risk.' });
    } else {
      eligible.push(cand);
    }
  }
  for (const requiredType of ['create', 'repair', 'atom_update', 'internal_link_update']) {
    const match = eligible.find((cand) => cand.release_unit_type === requiredType && !selected.some((u) => u.candidate_id === cand.candidate_id));
    if (match && selected.length < dailyLimit) selected.push({ ...match, planner_status: 'selected', why_selected: `Required fixture trace coverage for ${requiredType}.` });
  }
  for (const cand of eligible) {
    if (selected.some((u) => u.candidate_id === cand.candidate_id)) continue;
    if (selected.length < dailyLimit) selected.push({ ...cand, planner_status: 'selected', why_selected: `Top ${cand.release_unit_type} opportunity for ${cand.traffic_intent} under shadow cadence.` });
    else blocked.push({ ...cand, planner_status: 'not_selected', why_not_selected: 'Daily target unit budget already filled.' });
  }
  const plan = {
    schema_version: '1.4',
    repo: 'local-guides-citation-velocity',
    run_id: `release_plan_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`,
    generated_at: new Date().toISOString(),
    mode: 'planner_preview_shadow',
    primary_kpi: profile.primary_kpi || null,
    external_telemetry_present: false,
    candidates_total: candidates.length,
    selected_count: selected.length,
    blocked_count: blocked.length,
    selected,
    blocked,
    status: selected.length && blocked.length ? 'PASS' : 'WARN'
  };
  writeJson('artifacts/validation/daily-citation-release-plan.json', plan);
  writeJson('reports/daily-citation-release-plan.json', plan);
  writeText('reports/daily-citation-release-plan.md', `# Daily Citation Release Plan\n\nStatus: ${plan.status}\n\nSelected units: ${selected.length}\nBlocked/not selected units: ${blocked.length}\n\nExternal telemetry present: false\n\nThis is a planner preview. It does not claim traffic, rankings, indexing, or LLM citations.\n`);
  console.log(`release plan: ${selected.length} selected, ${blocked.length} blocked/not selected`);
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.stack || err.message); process.exit(1); } }
module.exports = { run };
