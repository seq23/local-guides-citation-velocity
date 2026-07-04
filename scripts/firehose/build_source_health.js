#!/usr/bin/env node
'use strict';
const { readJson, writeJson } = require('../citation_intelligence/pipeline_lib');
function run() {
  const registry = readJson('data/signals/source_registry.json', { sources: [] });
  const ledger = readJson('data/signals/firehose_ledger.json', { runs: [] });
  const latest = (ledger.runs || []).at(-1) || { adapter_status: [] };
  const statusBySource = new Map((latest.adapter_status || []).map((s) => [s.source, s]));
  const sources = (registry.sources || []).map((source) => {
    const status = statusBySource.get(source.source_key) || {};
    return {
      source_key: source.source_key,
      adapter: source.adapter,
      mode: source.mode,
      terms_status: source.terms_status,
      configured_status: source.status,
      last_run_status: status.status || 'NOT_RUN',
      last_record_count: status.record_count || 0,
      health: source.terms_status === 'allowed' && source.status === 'active' ? 'active_shadow_safe' : source.terms_status,
      live_enabled: false
    };
  });
  const summary = {
    active_allowed: sources.filter((s) => s.terms_status === 'allowed' && s.configured_status === 'active').length,
    shadow_or_blocked: sources.filter((s) => s.configured_status !== 'active' || s.terms_status !== 'allowed').length,
    requires_credentials: sources.filter((s) => s.terms_status === 'requires_credentials').length,
    requires_review: sources.filter((s) => s.terms_status === 'requires_review').length
  };
  writeJson('data/signals/source_health.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), sources, summary });
  console.log(`source health: ${summary.active_allowed} active allowed, ${summary.shadow_or_blocked} shadow/blocked`);
}
if (require.main === module) { try { run(); } catch (err) { console.error(err.stack || err.message); process.exit(1); } }
module.exports = { run };
