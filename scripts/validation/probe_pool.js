'use strict';
/**
 * Run validator probes concurrently without letting two probes write one file.
 *
 * The clock-independence guards (validate_clock_source_independence.js,
 * validate_store_clock_independence.js) re-run other validators - 28 and 51 of
 * them, two or three times each under different clocks - and did so strictly in
 * sequence: ~200 seconds each on a CI runner, more than half of the whole release
 * profile, and the floor under every shard of the merge gate.
 *
 * The probes of ONE item stay sequential (they write the same evidence file). Items
 * run concurrently only when their declared write sets - produces_files,
 * mutates_files, repair_writes from _validation_registry.json - are disjoint from
 * everything currently running, so the concurrency can never produce a torn or
 * interleaved file that a sequential run would not. An item with no declared
 * writes is treated as writing nothing; if it does write something undeclared, the
 * registry runner's mutation guard already fails it in the normal profile run.
 *
 * Concurrency defaults to the machine's parallelism minus one, capped at 4
 * (a probe is a whole node process), and can be pinned with PROBE_CONCURRENCY.
 */
const os = require('os');
const { spawn } = require('child_process');

function defaultConcurrency() {
  const pinned = Number(process.env.PROBE_CONCURRENCY);
  if (pinned >= 1) return Math.floor(pinned);
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : (os.cpus() || []).length || 2;
  return Math.max(1, Math.min(4, cpus - 1));
}

function runOnce(command, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => resolve({ status: null, signal: null, error, stdout, stderr }));
    child.on('close', (status, signal) => resolve({ status, signal, error: null, stdout, stderr }));
  });
}

/**
 * items: [{ key, writes: Iterable<string>, probes: [{ env }], command }]
 * Returns, in input order, [{ key, results: [{ status, signal, ... }] }].
 * `run(item, probe)` may be supplied to customise a single probe; it must return
 * a promise of the same shape as runOnce.
 */
async function runProbes(items, { cwd, concurrency = defaultConcurrency(), run = null } = {}) {
  const out = new Array(items.length);
  const pending = items.map((item, index) => ({ item, index }));
  const activeWrites = new Map(); // path -> count of running items that write it
  let active = 0;

  const canStart = ({ item }) => [...(item.writes || [])].every((p) => !activeWrites.has(p));
  const take = () => {
    const i = pending.findIndex(canStart);
    return i >= 0 ? pending.splice(i, 1)[0] : null;
  };

  await new Promise((resolve, reject) => {
    const launch = () => {
      while (active < concurrency) {
        const next = take();
        if (!next) break;
        active += 1;
        for (const p of next.item.writes || []) activeWrites.set(p, (activeWrites.get(p) || 0) + 1);
        (async () => {
          const results = [];
          for (const probe of next.item.probes) {
            const env = { ...probe.env };
            results.push(run ? await run(next.item, probe) : await runOnce(next.item.command, { cwd, env }));
          }
          out[next.index] = { key: next.item.key, results };
        })().then(() => {
          active -= 1;
          for (const p of next.item.writes || []) {
            const n = (activeWrites.get(p) || 1) - 1;
            if (n <= 0) activeWrites.delete(p); else activeWrites.set(p, n);
          }
          if (!pending.length && active === 0) resolve();
          else launch();
        }, reject);
      }
      // Nothing startable while something runs: wait for a completion. Nothing
      // startable and nothing running means every remaining item conflicts with
      // itself, which cannot happen (writes are released on completion).
      if (active === 0 && pending.length) reject(new Error('probe pool deadlock: items remain but none can start'));
    };
    if (!items.length) resolve(); else launch();
  });
  return out;
}

function writeSetOf(validator) {
  return new Set([
    ...(validator.produces_files || []),
    ...(validator.mutates_files || []),
    ...(validator.repair_writes || []),
    ...(validator.prepare_produces_files || []),
    ...(validator.prepare_mutates_files || []),
  ].map(String));
}

// THE POOL PROVES ITSELF BEFORE IT IS TRUSTED. Two items that declare one write path
// must never overlap; two with disjoint paths must. Each guard that probes through
// the pool calls this first (about a second), so a regression in the scheduling
// above fails the guard that relies on it rather than silently racing its probes.
async function assertPoolContract() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-pool-'));
  const log = path.join(dir, 'log');
  const script = path.join(dir, 'probe.js');
  fs.writeFileSync(script, `const fs=require('fs');const [log,key]=process.argv.slice(2);fs.appendFileSync(log,key+' start '+Date.now()+'\\n');setTimeout(()=>fs.appendFileSync(log,key+' end '+Date.now()+'\\n'),400);`);
  const item = (key, writes) => ({ key, writes, command: `node ${JSON.stringify(script)} ${JSON.stringify(log)} ${key}`, probes: [{ env: process.env }] });
  await runProbes([item('A', ['same.json']), item('B', ['same.json']), item('C', ['other.json'])], { cwd: dir, concurrency: 3 });
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' '));
  const at = (key, kind) => Number((lines.find((l) => l[0] === key && l[1] === kind) || [])[2]);
  const overlap = (x, y) => at(x, 'start') < at(y, 'end') && at(y, 'start') < at(x, 'end');
  fs.rmSync(dir, { recursive: true, force: true });
  if (overlap('A', 'B')) throw new Error('probe_pool_contract: two items declaring the same write path ran concurrently');
  if (!overlap('A', 'C')) throw new Error('probe_pool_contract: two items with disjoint write paths did not run concurrently');
  return true;
}

module.exports = { runProbes, writeSetOf, defaultConcurrency, assertPoolContract };
