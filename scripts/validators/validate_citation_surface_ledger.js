#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function writeReport(name, report) { fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'artifacts/validation', name), JSON.stringify(report, null, 2) + '\n'); }
function fail(errors, name, extra = {}) { const report = { validator: name.replace(/\.json$/, ''), ok: errors.length === 0, errors, ...extra }; writeReport(name, report); if (errors.length) { console.error(errors.join('\n')); process.exit(1); } console.log(`${report.validator} PASS`); }

/**
 * This gate used to assert `>= 100000` against fields that were assigned the
 * constant 100000 by the generator. Nothing measured anything: patching the
 * generator loop to 20,000 left 20,000 records on disk, the scoreboard still
 * said 100,000, and this file still said PASS. An 80% shortfall was invisible.
 *
 * Two changes make it a real gate:
 *   1. The target is READ FROM POLICY (citation_strategy_profile.json), not
 *      restated as a literal here. A policy change now moves the gate.
 *   2. The measured side is the fanout shard index's own record_count - the
 *      count of records that reached disk - and the reported figures must agree
 *      with it. A report that disagrees with the dataset is a failure, not a
 *      rounding difference.
 */
const errors = [];
const trace = exists('artifacts/validation/fixture-signal-trace.json') ? readJson('artifacts/validation/fixture-signal-trace.json') : null;
const packet = exists('artifacts/validation/daily-proof-packet.json') ? readJson('artifacts/validation/daily-proof-packet.json') : null;

const PROFILE = 'data/strategy/citation_strategy_profile.json';
const SHARD_INDEX = 'data/queries/citation_fanout_opportunities_100k/index.json';
let declaredTarget = null;
let measuredFanout = null;
if (!exists(PROFILE)) errors.push(`missing:${PROFILE} - the citation-ready target cannot be defaulted`);
else {
  const t = Number(readJson(PROFILE).citation_strategy?.citation_ready_target);
  if (!Number.isFinite(t)) errors.push('policy value missing or not finite: citation_strategy.citation_ready_target');
  else declaredTarget = t;
}
if (!exists(SHARD_INDEX)) errors.push(`missing:${SHARD_INDEX} - no fanout dataset to measure`);
else {
  const c = Number(readJson(SHARD_INDEX).record_count);
  if (!Number.isFinite(c)) errors.push('fanout shard index carries no record_count');
  else measuredFanout = c;
}
if (measuredFanout === 0) errors.push('fanout dataset examined zero records');

if (trace?.status !== 'PASS') errors.push('fixture trace not pass');
if (declaredTarget !== null && measuredFanout !== null && measuredFanout < declaredTarget) {
  errors.push(`fanout shortfall: ${measuredFanout} records on disk against a declared target of ${declaredTarget}`);
}
if (measuredFanout !== null && Number(trace?.citation_ready_fanout_opportunities) !== measuredFanout) {
  errors.push(`fixture trace fanout figure ${trace?.citation_ready_fanout_opportunities} disagrees with the measured dataset (${measuredFanout})`);
}
if (measuredFanout !== null && Number(packet?.citation_ready_fanout_opportunities) !== measuredFanout) {
  errors.push(`proof packet fanout figure ${packet?.citation_ready_fanout_opportunities} disagrees with the measured dataset (${measuredFanout})`);
}
if ((packet?.citation_surfaces_total || 0) < 1) errors.push('citation surface count missing');
if ((packet?.sitemap_urls_total || 0) < 1) errors.push('sitemap url count missing');
if ((packet?.llms_entries_total || 0) < 1) errors.push('llms entry count missing');
fail(errors, 'citation-surface-ledger.json', { citation_surfaces_total: packet?.citation_surfaces_total || 0, declared_citation_ready_target: declaredTarget, measured_fanout_records: measuredFanout, fanout_opportunities: packet?.citation_ready_fanout_opportunities || 0, sitemap_urls_total: packet?.sitemap_urls_total || 0, llms_entries_total: packet?.llms_entries_total || 0 });
