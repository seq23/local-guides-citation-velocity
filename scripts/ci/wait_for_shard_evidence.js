#!/usr/bin/env node
'use strict';
/**
 * Shard 0 of the merge gate runs the aggregate itself (Search Readiness h5).
 *
 * The gate used to be SHARD_COUNT shard jobs plus a separate `validate` job with
 * `needs: shard`. The work was short (slowest shard ~2.5 min, aggregate ~1 min),
 * but every job has to win a hosted runner from the account's shared pool, and
 * the dependent job had to win one AFTER every shard finished: measured on runs
 * 45061119735 and 45033168692, the aggregate sat queued 2.5 and 4 minutes on the
 * critical path, and the median PR check was 6.8 minutes against a target of 5.
 *
 * So shard 0, which already holds a runner and carries the heaviest validator,
 * waits here for every shard's evidence artifact, then merges in place. No job
 * queues after the shards. It fails closed: a sibling shard that ends in anything
 * but success fails this wait at once, and so does the deadline.
 *
 * Reads GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_TOKEN (the job
 * needs `actions: read`), SHARD_COUNT and SHARD_WAIT_SECONDS (default 600).
 */

const BAD = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

/** Pure: given the run's artifacts and jobs, is every shard's evidence in, or has one failed? */
function decide({ artifacts, jobs, count, runId, self = 0 }) {
  const want = new RegExp(`^validation-shard-(\\d+)-${runId}$`);
  const have = new Set();
  for (const a of artifacts || []) {
    const m = !a.expired && String(a.name).match(want);
    if (m && Number(m[1]) < count) have.add(Number(m[1]));
  }
  const failed = (jobs || [])
    .map((j) => ({ j, m: String(j.name).match(/^shard (\d+)$/) }))
    .filter(({ j, m }) => m && Number(m[1]) !== self && BAD.has(j.conclusion))
    .map(({ j }) => `${j.name} ${j.conclusion}`);
  if (failed.length) return { state: 'failed', have: [...have].sort(), failed };
  if (have.size === count) return { state: 'ready', have: [...have].sort(), failed };
  return { state: 'waiting', have: [...have].sort(), failed };
}

async function api(rel) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const url = `${base}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/${rel}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const count = Number(process.env.SHARD_COUNT);
  if (!(count >= 1)) throw new Error(`SHARD_COUNT must be >= 1 (got ${process.env.SHARD_COUNT})`);
  for (const k of ['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_TOKEN']) if (!process.env[k]) throw new Error(`${k} is not set`);
  const deadline = Date.now() + Number(process.env.SHARD_WAIT_SECONDS || 600) * 1000;
  const started = Date.now();
  let last = '';
  for (;;) {
    let d;
    try {
      const [a, j] = await Promise.all([api('artifacts?per_page=100'), api('jobs?filter=latest&per_page=100')]);
      d = decide({ artifacts: a.artifacts, jobs: j.jobs, count, runId: process.env.GITHUB_RUN_ID });
    } catch (e) {
      // A transient API error is "not known yet", never "ready": keep waiting until the deadline.
      d = { state: 'waiting', have: [], failed: [], error: e.message };
    }
    const line = `${d.state}: shard evidence ${d.have.length}/${count} [${d.have.join(',')}]${d.error ? ` (api: ${d.error})` : ''}`;
    if (line !== last) { console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${line}`); last = line; }
    if (d.state === 'ready') return;
    if (d.state === 'failed') { console.error(`::error::a sibling shard did not pass (${d.failed.join('; ')}); the gate is not whole`); process.exit(1); }
    if (Date.now() > deadline) { console.error(`::error::timed out waiting for shard evidence (${d.have.length}/${count})`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

module.exports = { decide };
if (require.main === module) main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
