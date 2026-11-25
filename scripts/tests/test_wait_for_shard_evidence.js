#!/usr/bin/env node
'use strict';
// The merge gate's shard 0 merges only when every shard's evidence is in, and
// fails closed when a sibling did not pass (scripts/ci/wait_for_shard_evidence.js).
const assert = require('assert');
const { decide } = require('../ci/wait_for_shard_evidence.js');

const runId = '42';
const art = (n, extra = {}) => ({ name: `validation-shard-${n}-${runId}`, expired: false, ...extra });
const job = (n, conclusion = null) => ({ name: `shard ${n}`, conclusion });

assert.strictEqual(decide({ artifacts: [art(0)], jobs: [job(0), job(1)], count: 2, runId }).state, 'waiting', 'one of two shards is not whole');
assert.strictEqual(decide({ artifacts: [art(0), art(1)], jobs: [job(0), job(1, 'success')], count: 2, runId }).state, 'ready', 'both shards in');
assert.strictEqual(decide({ artifacts: [art(0)], jobs: [job(0), job(1, 'failure')], count: 2, runId }).state, 'failed', 'a failed sibling fails the wait');
assert.strictEqual(decide({ artifacts: [art(0)], jobs: [job(0), job(1, 'cancelled')], count: 2, runId }).state, 'failed', 'a cancelled sibling fails the wait');
assert.strictEqual(decide({ artifacts: [art(0), art(1)], jobs: [job(0), job(1, 'failure')], count: 2, runId }).state, 'failed', 'evidence from a failed shard is never merged');
assert.strictEqual(decide({ artifacts: [art(0), art(1, { expired: true })], jobs: [], count: 2, runId }).state, 'waiting', 'expired evidence does not count');
assert.strictEqual(decide({ artifacts: [art(0), { name: 'validation-shard-1-41' }], jobs: [], count: 2, runId }).state, 'waiting', 'another run\'s evidence does not count');
assert.strictEqual(decide({ artifacts: [art(0), art(5)], jobs: [], count: 2, runId }).state, 'waiting', 'an out-of-range shard does not count');
assert.strictEqual(decide({ artifacts: [art(0), { name: `validation-shard-1-${runId}-diag` }], jobs: [], count: 2, runId }).state, 'waiting', 'a look-alike name does not count');
assert.strictEqual(decide({ artifacts: [art(0)], jobs: [job(0, 'failure')], count: 2, runId, self: 0 }).state, 'waiting', 'its own job is not a sibling');
console.log('wait_for_shard_evidence: 10 cases pass');
