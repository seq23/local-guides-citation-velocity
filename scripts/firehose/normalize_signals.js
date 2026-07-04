#!/usr/bin/env node
'use strict';
const { TODAY, latestRawRecords, normalizeRecord, writeJson } = require('../citation_intelligence/pipeline_lib');
function run() {
  const raw = latestRawRecords();
  const records = raw.map((record, idx) => normalizeRecord(record, idx));
  const out = { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), raw_count: raw.length, normalized_count: records.length, records };
  writeJson(`data/signals/normalized/${TODAY}.json`, out);
  writeJson('data/signals/normalized/latest.json', out);
  console.log(`normalized signals: ${raw.length} raw -> ${records.length} normalized`);
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.stack || err.message); process.exit(1); } }
module.exports = { run };
