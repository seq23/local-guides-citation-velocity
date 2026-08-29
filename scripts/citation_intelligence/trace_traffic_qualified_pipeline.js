#!/usr/bin/env node
'use strict';
const { run: collect } = require('../firehose/run_collect');
const { run: normalize } = require('../firehose/normalize_signals');
const { run: health } = require('../firehose/build_source_health');
const { run: plan } = require('./build_release_plan');
const { run: apply } = require('./apply_release_plan');
const { run: proof } = require('./build_daily_proof_packet');
const { run: runway } = require('./build_100k_citation_runway');
const { readJson, writeJson, writeText, latestNormalized, clusterSignals, scoreSignals, buildCandidates, citationPolicy } = require('./pipeline_lib');
const { readShardIndex } = require('../lib/sharded_json');
async function run() {
  await collect();
  normalize();
  health();
  runway();
  const normalized = latestNormalized();
  const clusters = clusterSignals(normalized);
  const scored = scoreSignals(normalized, clusters);
  const candidates = buildCandidates(scored);
  writeJson('data/signals/clusters/latest.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), clusters });
  writeJson('data/signals/scores/latest.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), records: scored });
  writeJson('data/signals/release_candidates/latest.json', { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), candidates });
  plan();
  apply();
  proof();
  const releasePlan = readJson('artifacts/validation/daily-citation-release-plan.json', { selected: [], blocked: [] });
  const citationRunway = readJson('artifacts/validation/citation-100k-runway.json', { fanout_records: 0, time_horizon_days: null });
  const required = ['create_distinct_page', 'repair_existing', 'content_atom_update', 'internal_link_update'];
  const present = new Set((releasePlan.selected || []).map((u) => u.release_unit_type));
  const blockedPresent = (releasePlan.blocked || []).some((u) => ['quarantine', 'skip_prohibited', 'skip_unsupported'].includes(u.release_unit_type));
  const errors = required.filter((t) => !present.has(t));
  if (!blockedPresent) errors.push('missing blocked/quarantined candidate');
  // This gate used to read artifacts/validation/citation-100k-runway.json and
  // assert `fanout_records >= 100000` / `time_horizon_days <= 180` - against a
  // file that `runway()` on line 15 of this same function had just written from
  // the constants 100000 and 180. No input could make it fail: perturbing the
  // artifact to fanout_records: 5, time_horizon_days: 9999, status: "FAIL" still
  // produced "fixture signal trace PASS", because the artifact was regenerated
  // before it was read.
  //
  // The measurement now comes from a prior stage's own output that this stage
  // did not author: the fanout shard index's record_count (the count of records
  // that actually reached disk), against the target DECLARED in
  // data/strategy/citation_strategy_profile.json. The runway artifact is still
  // read, but only to check it agrees with the dataset - a disagreement is a
  // failure rather than the thing being trusted.
  const policy = citationPolicy();
  let measuredFanout = null;
  try { measuredFanout = Number(readShardIndex('data/queries/citation_fanout_opportunities_100k').record_count); }
  catch (e) { errors.push(`fanout shard index unreadable: ${e.message}`); }
  if (measuredFanout !== null && !Number.isFinite(measuredFanout)) errors.push('fanout shard index carries no record_count');
  else if (measuredFanout === 0) errors.push('fanout dataset examined zero records');
  else if (measuredFanout !== null && measuredFanout < policy.citation_ready_target) errors.push(`fanout shortfall: ${measuredFanout} records on disk against a declared target of ${policy.citation_ready_target}`);
  if (measuredFanout !== null && Number(citationRunway.fanout_records) !== measuredFanout) errors.push(`citation runway artifact reports ${citationRunway.fanout_records} fanout records, dataset measures ${measuredFanout}`);
  if (citationRunway.status && citationRunway.status !== 'PASS') errors.push(`citation runway artifact status ${citationRunway.status}`);
  if ((citationRunway.time_horizon_days || 9999) > policy.time_horizon_days) errors.push(`citation runway horizon exceeds the declared ${policy.time_horizon_days} days`);
  const trace = { schema_version: '2.0', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), status: errors.length ? 'FAIL' : 'PASS', fixture_raw_signals: readJson('data/signals/fixtures/raw_signals.json', { records: [] }).records.length, normalized_signals: normalized.length, clusters_created: clusters.length, candidates_created: candidates.length, citation_ready_fanout_opportunities: Number.isFinite(measuredFanout) ? measuredFanout : 0, citation_ready_fanout_basis: 'measured_shard_index_record_count', citation_ready_declared_target: policy.citation_ready_target, citation_runway_time_horizon_days: citationRunway.time_horizon_days || null, required_candidate_types: required, selected_types: [...present].sort(), blocked_or_quarantined_present: blockedPresent, errors, citation_runway: 'artifacts/validation/citation-100k-runway.json', release_plan: 'artifacts/validation/daily-citation-release-plan.json', proof_packet: 'artifacts/validation/daily-proof-packet.json' };
  writeJson('artifacts/validation/fixture-signal-trace.json', trace);
  writeText('reports/fixture-signal-trace.md', `# Fixture Signal Trace\n\nStatus: ${trace.status}\n\nFixture raw signals: ${trace.fixture_raw_signals}\nNormalized signals: ${trace.normalized_signals}\nClusters: ${trace.clusters_created}\nCandidates: ${trace.candidates_created}\nSelected types: ${trace.selected_types.join(', ')}\nBlocked/quarantined present: ${trace.blocked_or_quarantined_present}\n`);
  if (errors.length) throw new Error(errors.join('; '));
  console.log('fixture signal trace PASS');
}
if (require.main === module) run().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
module.exports = { run };
