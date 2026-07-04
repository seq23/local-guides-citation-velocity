#!/usr/bin/env node
'use strict';
const { run: collect } = require('../firehose/run_collect');
const { run: normalize } = require('../firehose/normalize_signals');
const { run: health } = require('../firehose/build_source_health');
const { run: plan } = require('./build_release_plan');
const { run: apply } = require('./apply_release_plan');
const { run: proof } = require('./build_daily_proof_packet');
const { readJson, writeJson, writeText, latestNormalized, clusterSignals, scoreSignals, buildCandidates } = require('./pipeline_lib');
async function run() {
  await collect();
  normalize();
  health();
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
  const required = ['create', 'repair', 'atom_update', 'internal_link_update'];
  const present = new Set((releasePlan.selected || []).map((u) => u.release_unit_type));
  const blockedPresent = (releasePlan.blocked || []).some((u) => ['block', 'quarantine'].includes(u.release_unit_type));
  const errors = required.filter((t) => !present.has(t));
  if (!blockedPresent) errors.push('missing blocked/quarantined candidate');
  const trace = { schema_version: '1.4', repo: 'local-guides-citation-velocity', generated_at: new Date().toISOString(), status: errors.length ? 'FAIL' : 'PASS', fixture_raw_signals: readJson('data/signals/fixtures/raw_signals.json', { records: [] }).records.length, normalized_signals: normalized.length, clusters_created: clusters.length, candidates_created: candidates.length, required_candidate_types: required, selected_types: [...present].sort(), blocked_or_quarantined_present: blockedPresent, errors, release_plan: 'artifacts/validation/daily-citation-release-plan.json', proof_packet: 'artifacts/validation/daily-proof-packet.json' };
  writeJson('artifacts/validation/fixture-signal-trace.json', trace);
  writeText('reports/fixture-signal-trace.md', `# Fixture Signal Trace\n\nStatus: ${trace.status}\n\nFixture raw signals: ${trace.fixture_raw_signals}\nNormalized signals: ${trace.normalized_signals}\nClusters: ${trace.clusters_created}\nCandidates: ${trace.candidates_created}\nSelected types: ${trace.selected_types.join(', ')}\nBlocked/quarantined present: ${trace.blocked_or_quarantined_present}\n`);
  if (errors.length) throw new Error(errors.join('; '));
  console.log('fixture signal trace PASS');
}
if (require.main === module) run().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
module.exports = { run };
