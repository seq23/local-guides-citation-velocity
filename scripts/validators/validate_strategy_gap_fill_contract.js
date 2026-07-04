#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel, fallback=null) => { const abs=path.join(ROOT,rel); return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs,'utf8')) : fallback; };
const strategy = read('data/strategy/citation_strategy_profile.json', {});
const contract = read('data/strategy/strategy_gap_fill_contract.json', {});
const backlog = read('data/strategy/strategy_gap_fill_backlog.json', {candidates: []});
const errors = [];
const dailyTarget = Number(strategy.cadence?.daily_target_units || 5);
const horizon = Number(contract.time_horizon_days || strategy.primary_kpi?.time_horizon_days || 180);
const minimum = dailyTarget * horizon * Number(contract.minimum_backlog_multiplier || 1);
if ((backlog.candidates || []).length < minimum) errors.push(`backlog_under_floor:${(backlog.candidates || []).length}/${minimum}`);
const required = contract.required_candidate_fields || [];
const seenRoutes = new Set();
for (const [index, row] of (backlog.candidates || []).entries()) {
  for (const field of required) if (!(field in row)) errors.push(`candidate_${index}_missing:${field}`);
  if (row.admission_basis !== 'STRATEGY_GAP_FILL_NON_AGENT') errors.push(`candidate_${index}_bad_admission:${row.admission_basis}`);
  if (row.self_healing_required !== true || row.prevalidation_required !== true) errors.push(`candidate_${index}_missing_finish_flags`);
  if (seenRoutes.has(row.target_route)) errors.push(`duplicate_target_route:${row.target_route}`); else seenRoutes.add(row.target_route);
  if (!/^\/[a-z0-9-]+\/(guides|clusters)\/[a-z0-9-]+\/$/.test(String(row.target_route || ''))) errors.push(`candidate_${index}_bad_route:${row.target_route}`);
  if (index > 50 && errors.length) break;
}
const pkg = read('package.json', {scripts:{}});
for (const s of ['strategy:gap-fill:backlog','strategy:gap-fill:release-gap']) if (!pkg.scripts?.[s]) errors.push(`missing_script:${s}`);
const report = {schema_version:'1.0', validator:'strategy-gap-fill-contract', status:errors.length?'FAIL':'PASS', daily_target_units:dailyTarget, time_horizon_days:horizon, minimum_units:minimum, candidate_count:(backlog.candidates || []).length, errors};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/strategy-gap-fill-contract.json'), JSON.stringify(report,null,2)+'\n');
if (errors.length) { console.error(JSON.stringify(report,null,2)); process.exit(1); }
console.log(`STRATEGY GAP FILL CONTRACT PASS: candidates=${report.candidate_count}; minimum=${minimum}`);
