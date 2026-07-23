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
if ((growth.target?.citation_ready_opportunities_or_surfaces || 0) < 100000) errors.push('citation-ready 100K target missing');
if ((growth.target?.time_horizon_days || 9999) > 180) errors.push('citation-ready horizon exceeds 180 days');
if (growth.target?.hard_guarantee !== false) errors.push('citation-ready hard guarantee boundary missing');
if (growth.target?.target_is_external_citation_claim !== false) errors.push('citation-ready target mislabeled as external citation claim');
if ((scoreboard.generated_fanout_records || 0) < 100000) errors.push('100K fanout universe missing');
if (scoreboard.buckets?.owned_surfaces_are_not_external_citations !== true) errors.push('owned/external citation boundary missing');
if (scoreboard.buckets?.opportunities_are_not_wins !== true) errors.push('opportunity/win boundary missing');
if (gate.status !== 'PASS') errors.push('strategy gate did not pass');
fail(errors, 'strategy-gate.json', { profile_repo: profile.repo, gate_status: gate.status, citation_ready_target: growth.target?.citation_ready_opportunities_or_surfaces || 0, fanout_records: scoreboard.generated_fanout_records || 0 });
