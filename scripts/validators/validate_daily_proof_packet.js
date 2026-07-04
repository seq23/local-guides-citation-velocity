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
if ((packet?.signals_collected || 0) < 5) errors.push('proof packet signals_collected too low');
if ((packet?.signals_normalized || 0) < 5) errors.push('proof packet signals_normalized too low');
if ((packet?.release_units_planned || 0) < 5) errors.push('proof packet release_units_planned too low');
if ((packet?.blocked_units || 0) < 1) errors.push('proof packet must include blocked unit');
if (!String(packet?.status || '').includes('PASS')) errors.push('proof packet status must pass structurally');
fail(errors, 'daily-proof-packet-validation.json', { status: packet?.status || null, planned: packet?.release_units_planned || 0 });
