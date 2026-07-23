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
const trace = exists('artifacts/validation/fixture-signal-trace.json') ? readJson('artifacts/validation/fixture-signal-trace.json') : null;
const packet = exists('artifacts/validation/daily-proof-packet.json') ? readJson('artifacts/validation/daily-proof-packet.json') : null;
if (trace?.status !== 'PASS') errors.push('fixture trace not pass');
if ((trace?.citation_ready_fanout_opportunities || 0) < 100000) errors.push('fixture trace missing 100K fanout opportunity proof');
if ((packet?.citation_surfaces_total || 0) < 1) errors.push('citation surface count missing');
if ((packet?.citation_ready_fanout_opportunities || 0) < 100000) errors.push('proof packet missing 100K fanout opportunity proof');
if ((packet?.sitemap_urls_total || 0) < 1) errors.push('sitemap url count missing');
if ((packet?.llms_entries_total || 0) < 1) errors.push('llms entry count missing');
fail(errors, 'citation-surface-ledger.json', { citation_surfaces_total: packet?.citation_surfaces_total || 0, fanout_opportunities: packet?.citation_ready_fanout_opportunities || 0, sitemap_urls_total: packet?.sitemap_urls_total || 0, llms_entries_total: packet?.llms_entries_total || 0 });
