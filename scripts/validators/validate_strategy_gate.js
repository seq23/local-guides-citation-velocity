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
for (const rel of ['data/strategy/citation_strategy_profile.json', '_citation_intelligence_contract.json', '_content_release_contract.json', 'artifacts/validation/citation-strategy-gate.json']) if (!exists(rel)) errors.push(`missing:${rel}`);
const profile = exists('data/strategy/citation_strategy_profile.json') ? readJson('data/strategy/citation_strategy_profile.json') : {};
const gate = exists('artifacts/validation/citation-strategy-gate.json') ? readJson('artifacts/validation/citation-strategy-gate.json') : {};
if (profile.repo !== 'seq23/local-guides-citation-velocity') errors.push('profile repo mismatch');
if (profile.primary_kpi?.target_value !== 100000) errors.push('100K target missing');
if (profile.primary_kpi?.validator_claim_allowed !== false) errors.push('validator claim boundary missing');
if (gate.status !== 'PASS') errors.push('strategy gate did not pass');
fail(errors, 'strategy-gate.json', { profile_repo: profile.repo, gate_status: gate.status });
