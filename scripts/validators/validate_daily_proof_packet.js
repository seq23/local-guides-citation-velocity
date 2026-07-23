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
const packet = exists('artifacts/validation/daily-proof-packet.json') ? readJson('artifacts/validation/daily-proof-packet.json') : null;
if (!packet) errors.push('missing proof packet');
if (packet?.external_telemetry_present !== false) errors.push('proof packet must label external telemetry absent');
if ((packet?.citation_ready_target || 0) < 100000) errors.push('proof packet missing 100K citation-ready target');
if ((packet?.citation_ready_time_horizon_days || 9999) > 180) errors.push('proof packet citation-ready horizon exceeds 180 days');
if (packet?.citation_ready_hard_guarantee !== false) errors.push('proof packet must label citation target as not guaranteed');
if ((packet?.citation_ready_fanout_opportunities || 0) < 100000) errors.push('proof packet missing 100K fanout opportunities');
if ((packet?.free_win_self_heal_candidates || 0) < 1) errors.push('proof packet missing free-win/self-heal candidates');
if ((packet?.signals_collected || 0) < 5) errors.push('proof packet signals_collected too low');
if ((packet?.signals_normalized || 0) < 5) errors.push('proof packet signals_normalized too low');
if ((packet?.release_units_planned || 0) < 5) errors.push('proof packet release_units_planned too low');
if ((packet?.blocked_units || 0) < 1) errors.push('proof packet must include blocked unit');
if (!String(packet?.status || '').includes('PASS')) errors.push('proof packet status must pass structurally');
fail(errors, 'daily-proof-packet-validation.json', { status: packet?.status || null, planned: packet?.release_units_planned || 0, fanout: packet?.citation_ready_fanout_opportunities || 0 });
