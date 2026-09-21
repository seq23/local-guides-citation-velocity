#!/usr/bin/env node
'use strict';
/**
 * Merge N shard summaries of one validation profile into the one summary the rest
 * of the pipeline reads, and prove the shards together were the whole profile.
 *
 * Validate Repo runs `run_validation_registry.js --profile release --shard I/N` on N
 * parallel runners. Each writes artifacts/validation/validation-summary-shard-I-of-N.json
 * carrying `shard.assigned_ids` (what it was responsible for), `profile_validator_ids`
 * (what the whole profile is) and `results` for everything it ran, dependencies
 * included. This script is the aggregate job's gate. It fails when:
 *
 *   - any shard file is missing, or its shard.count / profile differ from the rest
 *   - the union of assigned ids is not exactly the profile (an id assigned to no shard
 *     is a validator that never ran; assigned twice is a weight disagreement, which is
 *     the same defect one step earlier)
 *   - any result for an assigned validator is missing, or blocks release
 *   - the profile's validator list in the registry now differs from what the shards
 *     saw (a registry edit between shard and merge)
 *
 * The merged report keeps one result per validator: the one from the shard it was
 * assigned to. A dependency that ran on several shards is recorded once, and its
 * other runs are kept under `dependency_runs` so nothing observed is thrown away.
 *
 * Usage: node scripts/validation/merge_validation_shards.js --count N [--profile release]
 */
const fs = require('fs');
const path = require('path');
const { ROOT, readRegistry, topologicalValidators } = require('./registry_lib');
// classifyResult (policy.js) emits exactly these for a validator that ran and did not block.
const ACCEPTED_STATUSES = new Set(['PASS', 'PASS_WITH_WARNINGS', 'STRONG_WARNING', 'SOFT_WARNING', 'INFO_FINDING']);

function parseArgs(argv) {
  const out = { count: 0, profile: 'release' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') out.count = Number(argv[++i]);
    else if (a === '--profile') out.profile = String(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!(out.count >= 1)) throw new Error('--count N is required (N >= 1)');
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reg = readRegistry();
  const profileIds = topologicalValidators(reg, reg.validators.filter((v) => v.profiles.includes(args.profile) && v.status !== 'RETIRED').map((v) => v.id)).map((v) => v.id);
  const errors = [];
  const shards = [];
  for (let i = 0; i < args.count; i++) {
    const rel = `artifacts/validation/validation-summary-shard-${i}-of-${args.count}.json`;
    let summary = null;
    try { summary = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (e) { errors.push(`shard_missing:${rel}:${e.message}`); continue; }
    if (!summary.shard || summary.shard.index !== i || summary.shard.count !== args.count) errors.push(`shard_header_mismatch:${rel}: expected index ${i} of ${args.count}, found ${JSON.stringify(summary.shard && { index: summary.shard.index, count: summary.shard.count })}`);
    if (!(summary.profiles || []).includes(args.profile)) errors.push(`shard_profile_mismatch:${rel}: profiles=${JSON.stringify(summary.profiles)} lacks ${args.profile}`);
    shards.push({ rel, summary });
  }
  if (errors.length) return finish(errors, { shards: shards.length, count: args.count });

  // Coverage: every profile validator assigned exactly once, and the shards agreed
  // on what the profile was.
  const assignedBy = new Map();
  for (const { rel, summary } of shards) {
    for (const id of summary.shard.assigned_ids || []) {
      if (!assignedBy.has(id)) assignedBy.set(id, []);
      assignedBy.get(id).push(rel);
    }
    const seenProfile = [...(summary.profile_validator_ids || [])].sort().join('|');
    if (seenProfile !== [...profileIds].sort().join('|')) errors.push(`profile_drift:${rel}: the profile this shard saw is not the registry's ${args.profile} profile now (${(summary.profile_validator_ids || []).length} vs ${profileIds.length}) - registry edited between shard and merge`);
  }
  const weightSources = new Set(shards.map(({ summary }) => String(summary.shard.weights_source || '')));
  if (weightSources.size > 1) errors.push(`weights_source_disagreement: ${[...weightSources].join(' | ')} - shards must read the same committed summary`);
  for (const id of profileIds) {
    const where = assignedBy.get(id) || [];
    if (!where.length) errors.push(`unassigned:${id} - no shard was responsible for it, so it never ran as the profile's own result`);
    if (where.length > 1) errors.push(`assigned_twice:${id} - shards disagreed on weights: ${where.join(', ')}`);
  }
  for (const id of assignedBy.keys()) if (!profileIds.includes(id)) errors.push(`assigned_outside_profile:${id}`);

  // Results: one per validator from its assigned shard; must exist and must not block.
  const results = [];
  const dependencyRuns = [];
  const byShardResult = new Map(shards.map(({ rel, summary }) => [rel, new Map((summary.results || []).map((r) => [r.id, r]))]));
  for (const id of profileIds) {
    const home = (assignedBy.get(id) || [])[0];
    const r = home ? byShardResult.get(home).get(id) : null;
    if (!r) { errors.push(`result_missing:${id}${home ? ` in ${home}` : ''}`); continue; }
    if (r.blocks_release) errors.push(`blocking:${id}:${r.status} (${home})`);
    // A merged result must be a REAL outcome of running the validator. The runner's
    // bookkeeping statuses (DRY_RUN, NOT_RUN_AFTER_BLOCK, DEFERRED_LOCAL_ONLY,
    // PREREQUISITE_MISSING, PREPARE_FAILED) are not passes, whatever blocks_release says.
    if (!ACCEPTED_STATUSES.has(r.status)) errors.push(`not_a_run_outcome:${id}:${r.status} (${home}) - only ${[...ACCEPTED_STATUSES].join('/')} may merge as the profile's result`);
    results.push({ ...r, shard: home });
    for (const { rel } of shards) {
      if (rel === home) continue;
      const other = byShardResult.get(rel).get(id);
      if (other) dependencyRuns.push({ id, shard: rel, status: other.status, duration_ms: other.duration_ms, blocks_release: other.blocks_release });
      if (other && other.blocks_release) errors.push(`blocking_dependency_run:${id}:${other.status} (${rel})`);
    }
  }
  return finish(errors, { shards: shards.length, count: args.count, profileIds, results, dependencyRuns, shardSummaries: shards.map((s) => s.summary) });
}

function finish(errors, ctx) {
  const counts = {};
  for (const r of ctx.results || []) counts[r.status] = (counts[r.status] || 0) + 1;
  const first = (ctx.shardSummaries || [])[0] || {};
  const report = {
    schema_version: '3.0',
    generated_at: first.generated_at || new Date().toISOString(),
    profiles: first.profiles || ['release'],
    validator_ids: ctx.profileIds || [],
    execution_order: ctx.profileIds || [],
    profile_validator_ids: ctx.profileIds || [],
    collect_all: Boolean(first.collect_all),
    strict_warnings: Boolean(first.strict_warnings),
    include_local: Boolean(first.include_local),
    status: errors.length ? 'FAIL' : 'PASS',
    counts,
    merged_from_shards: {
      count: ctx.count,
      present: ctx.shards,
      loads_ms: (ctx.shardSummaries || []).map((s) => s.shard && s.shard.assigned_weight_ms),
      wall_ms: (ctx.shardSummaries || []).map((s) => (s.results || []).reduce((a, r) => a + (Number(r.duration_ms) || 0), 0)),
      dependency_runs: ctx.dependencyRuns || []
    },
    errors,
    results: ctx.results || []
  };
  fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
  // The merge report always lands here. The profile summaries are rewritten ONLY on a
  // pass: validation-summary-release.json is the weights source every shard reads, and
  // a failed merge that overwrote it with an empty result set made the next shard run
  // assign from registry estimates while its siblings had measured weights - which is
  // the disagreement this script then fails on. A failure leaves the committed file.
  fs.writeFileSync(path.join(ROOT, 'artifacts/validation/validation-summary-shard-merge.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!errors.length) {
    fs.writeFileSync(path.join(ROOT, 'artifacts/validation/validation-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(ROOT, `artifacts/validation/validation-summary-${(report.profiles || ['release']).join('-')}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (errors.length) {
    console.error(`VALIDATION SHARD MERGE FAIL: ${errors.length} error(s)`);
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }
  const wall = report.merged_from_shards.wall_ms.map((ms) => Math.round(ms / 1000));
  console.log(`VALIDATION SHARD MERGE PASS: ${ctx.count} shard(s); ${report.results.length} validator(s) each assigned exactly once and PASS; shard validator seconds ${JSON.stringify(wall)}; ${report.merged_from_shards.dependency_runs.length} dependency re-run(s) recorded`);
  console.log(`\nVALIDATION SUMMARY: PASS ${JSON.stringify(counts)}`);
}

try { main(); } catch (err) { console.error(`VALIDATION SHARD MERGE ERROR: ${err.stack || err.message}`); process.exit(1); }
