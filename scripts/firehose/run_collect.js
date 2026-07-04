#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, TODAY, readJson, writeJson } = require('../citation_intelligence/pipeline_lib');
async function run() {
  const registry = readJson('data/signals/source_registry.json', { sources: [] });
  const ledger = readJson('data/signals/firehose_ledger.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', runs: [] });
  const results = [];
  const records = [];
  for (const source of registry.sources || []) {
    const adapterPath = path.join(ROOT, 'scripts/firehose/adapters', `${source.adapter}.js`);
    if (!fs.existsSync(adapterPath)) {
      results.push({ adapter: source.adapter, source: source.source_key, mode: source.mode, terms_status: source.terms_status, collected_at: new Date().toISOString(), records: [], errors: [`Missing adapter ${source.adapter}`], warnings: [], status: 'FAIL' });
      continue;
    }
    const adapter = require(adapterPath);
    const result = await adapter.collect(source);
    results.push(result);
    for (const record of result.records || []) records.push({ ...record, adapter: result.adapter, source_key: record.source_key || result.source });
  }
  const out = { schema_version: '1.4', repo: 'local-guides-citation-velocity', run_id: `firehose_${TODAY}_${process.pid}`, generated_at: new Date().toISOString(), mode: 'shadow_fixture_safe', records, adapter_results: results.map((r) => ({ ...r, records: undefined, record_count: (r.records || []).length })) };
  writeJson(`data/signals/raw/${TODAY}.json`, out);
  writeJson('data/signals/raw/latest.json', out);
  ledger.runs = [...(ledger.runs || []), { run_id: out.run_id, generated_at: out.generated_at, mode: out.mode, records_collected: records.length, adapter_status: out.adapter_results.map((r) => ({ source: r.source, status: r.status, terms_status: r.terms_status, record_count: r.record_count })) }].slice(-50);
  writeJson('data/signals/firehose_ledger.json', ledger);
  console.log(`firehose collect: ${records.length} records across ${results.length} source adapters`);
}
if (require.main === module) run().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
module.exports = { run };
