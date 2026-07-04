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
const registry = exists('data/signals/source_registry.json') ? readJson('data/signals/source_registry.json') : { sources: [] };
const ledger = exists('data/signals/firehose_ledger.json') ? readJson('data/signals/firehose_ledger.json') : { runs: [] };
const allowedTerms = new Set(['allowed', 'requires_review', 'requires_credentials', 'blocked']);
const requiredAdapters = new Set(['manual_import', 'agent_artifacts', 'forums_rss', 'reddit', 'bluesky', 'x', 'youtube', 'search_console']);
for (const adapter of requiredAdapters) if (!exists(`scripts/firehose/adapters/${adapter}.js`)) errors.push(`missing-adapter:${adapter}`);
for (const source of registry.sources || []) {
  if (!source.source_key || !source.adapter || !source.mode) errors.push(`invalid-source:${source.source_key || 'unknown'}`);
  if (!allowedTerms.has(source.terms_status)) errors.push(`invalid-terms:${source.source_key}`);
  if (source.terms_status !== 'allowed' && source.status === 'active') errors.push(`credential-or-review-gated-source-active:${source.source_key}`);
}
const latest = (ledger.runs || []).at(-1);
if (!latest) errors.push('missing-firehose-ledger-run');
for (const status of latest?.adapter_status || []) {
  if (['reddit_api', 'bluesky_firehose', 'x_filtered_stream', 'youtube_api', 'search_console_export'].includes(status.source) && status.record_count > 0) errors.push(`shadow-live-source-produced-records:${status.source}`);
}
fail(errors, 'firehose-source-contract.json', { source_count: (registry.sources || []).length, last_run: latest?.run_id || null });
