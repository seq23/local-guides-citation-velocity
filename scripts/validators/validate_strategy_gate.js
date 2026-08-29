#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function writeReport(name, report) { fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'artifacts/validation', name), JSON.stringify(report, null, 2) + '\n'); }
function fail(errors, name, extra = {}) { const report = { validator: name.replace(/\.json$/, ''), ok: errors.length === 0, errors, ...extra }; writeReport(name, report); if (errors.length) { console.error(errors.join('\n')); process.exit(1); } console.log(`${report.validator} PASS`); }

const errors = [];
for (const rel of ['data/strategy/citation_strategy_profile.json', 'data/strategy/citation_growth_strategy.json', 'data/measurement/citation_honesty_scoreboard.json', '_citation_intelligence_contract.json', '_content_release_contract.json', 'artifacts/validation/citation-strategy-gate.json']) if (!exists(rel)) errors.push(`missing:${rel}`);
const profile = exists('data/strategy/citation_strategy_profile.json') ? readJson('data/strategy/citation_strategy_profile.json') : {};
const growth = exists('data/strategy/citation_growth_strategy.json') ? readJson('data/strategy/citation_growth_strategy.json') : {};
const scoreboard = exists('data/measurement/citation_honesty_scoreboard.json') ? readJson('data/measurement/citation_honesty_scoreboard.json') : {};
const gate = exists('artifacts/validation/citation-strategy-gate.json') ? readJson('artifacts/validation/citation-strategy-gate.json') : {};
if (profile.repo !== 'seq23/local-guides-citation-velocity') errors.push('profile repo mismatch');
if (profile.primary_kpi?.target_value !== 100000) errors.push('100K target missing');
if (profile.primary_kpi?.validator_claim_allowed !== false) errors.push('validator claim boundary missing');
/**
 * `generated_fanout_records` used to be asserted `>= 100000` against a field
 * the generator assigned the constant 100000. The gate could not fail: it was
 * comparing the goal to itself. Generating only 20,000 records left 20,000 on
 * disk and this still printed PASS.
 *
 * The target now comes from policy (citation_strategy_profile.json) rather than
 * being restated here, and the measured side is the fanout shard index's own
 * record_count. So a real shortfall fails, AND a future target change that the
 * pipeline has not caught up with fails, instead of both passing quietly.
 */
const declaredTarget = Number(profile.citation_strategy?.citation_ready_target);
const declaredHorizon = Number(profile.citation_strategy?.citation_ready_time_horizon_days);
if (!Number.isFinite(declaredTarget)) errors.push('policy value missing or not finite: citation_strategy.citation_ready_target');
if (!Number.isFinite(declaredHorizon)) errors.push('policy value missing or not finite: citation_strategy.citation_ready_time_horizon_days');
const shardIndexRel = 'data/queries/citation_fanout_opportunities_100k/index.json';
let measuredFanout = null;
if (!exists(shardIndexRel)) errors.push(`missing:${shardIndexRel} - no fanout dataset to measure`);
else {
  const c = Number(readJson(shardIndexRel).record_count);
  if (!Number.isFinite(c)) errors.push('fanout shard index carries no record_count');
  else measuredFanout = c;
}
if (measuredFanout === 0) errors.push('fanout dataset examined zero records');
if (Number.isFinite(declaredTarget) && Number(growth.target?.citation_ready_opportunities_or_surfaces) !== declaredTarget) errors.push(`growth strategy target ${growth.target?.citation_ready_opportunities_or_surfaces} does not match the declared policy target ${declaredTarget}`);
if (Number.isFinite(declaredHorizon) && (growth.target?.time_horizon_days || 9999) > declaredHorizon) errors.push(`citation-ready horizon exceeds the declared ${declaredHorizon} days`);
if (growth.target?.hard_guarantee !== false) errors.push('citation-ready hard guarantee boundary missing');
if (growth.target?.target_is_external_citation_claim !== false) errors.push('citation-ready target mislabeled as external citation claim');
if (measuredFanout !== null && Number.isFinite(declaredTarget) && measuredFanout < declaredTarget) errors.push(`fanout shortfall: ${measuredFanout} records on disk against a declared target of ${declaredTarget}`);
if (measuredFanout !== null && Number(scoreboard.generated_fanout_records) !== measuredFanout) errors.push(`scoreboard generated_fanout_records ${scoreboard.generated_fanout_records} disagrees with the measured dataset (${measuredFanout})`);
if (scoreboard.buckets?.owned_surfaces_are_not_external_citations !== true) errors.push('owned/external citation boundary missing');
if (scoreboard.buckets?.opportunities_are_not_wins !== true) errors.push('opportunity/win boundary missing');
if (gate.status !== 'PASS') errors.push('strategy gate did not pass');
fail(errors, 'strategy-gate.json', { profile_repo: profile.repo, gate_status: gate.status, citation_ready_target: growth.target?.citation_ready_opportunities_or_surfaces || 0, declared_policy_target: Number.isFinite(declaredTarget) ? declaredTarget : null, measured_fanout_records: measuredFanout, fanout_records: scoreboard.generated_fanout_records || 0 });
