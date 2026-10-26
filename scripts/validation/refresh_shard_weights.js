#!/usr/bin/env node
'use strict';
/**
 * Refresh `estimated_runtime_seconds` in _validation_registry.json from a real run.
 *
 * The defect this exists to stop
 * -----------------------------
 * The merge gate shards the release profile by weight, and the weights are the
 * registry's `estimated_runtime_seconds`. They were placeholders: 217 of 222
 * validators carried a flat 60, which is not an estimate of anything. The
 * balancer cannot balance on a constant, so on 2026-10-25 run 40258366849 it
 * gave shard 0 two validators worth 0.4 seconds and shard 1 two validators worth
 * 69.1 seconds. The gate's wall clock is the SLOWEST shard, so three runners sat
 * idle while one carried the whole profile, and the gate ran 7-8 minutes against
 * a five-minute target (Search Readiness h5).
 *
 * Usage:  node scripts/validation/refresh_shard_weights.js <github-run-id>
 *         node scripts/validation/refresh_shard_weights.js --from <dir>
 *
 * It reads every validation-summary-shard-*.json a run produced (downloading the
 * run's artifacts with `gh` when given a run id), takes the longest measured
 * duration per validator id, and writes it back as whole seconds, floor 1.
 *
 * Rule 0: it refuses to write when it read no summaries, measured no validator,
 * or would change nothing - a refresher that silently does nothing is the defect.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = path.join(ROOT, '_validation_registry.json');

function summariesIn(dir) {
  const out = [];
  const go = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (/^validation-summary-shard-\d+-of-\d+\.json$/.test(e.name)) out.push(p);
    }
  };
  go(dir);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  let dir = null;
  const fromAt = args.indexOf('--from');
  if (fromAt >= 0) dir = path.resolve(args[fromAt + 1] || '');
  else {
    const runId = args.find((a) => /^\d+$/.test(a));
    if (!runId) { console.error('usage: refresh_shard_weights.js <github-run-id> | --from <dir>'); process.exit(2); }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-weights-'));
    const r = spawnSync('gh', ['run', 'download', runId, '-p', 'validation-shard-*', '-D', dir], { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`gh run download ${runId} failed`); process.exit(1); }
  }
  if (!fs.existsSync(dir)) { console.error(`${dir} does not exist`); process.exit(1); }

  const files = summariesIn(dir);
  if (!files.length) { console.error(`no validation-summary-shard-*.json under ${dir}; nothing was measured`); process.exit(1); }

  const measured = new Map();
  for (const f of files) {
    let s;
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const r of s.results || []) {
      const ms = Number(r && r.duration_ms);
      if (!r || !r.id || !(ms > 0)) continue;
      measured.set(r.id, Math.max(measured.get(r.id) || 0, ms));
    }
  }
  if (!measured.size) { console.error(`${files.length} summary file(s) held no measured duration`); process.exit(1); }

  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const changes = [];
  for (const v of reg.validators) {
    const ms = measured.get(v.id);
    if (ms === undefined) continue;
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (v.estimated_runtime_seconds === seconds) continue;
    changes.push(`${v.id}: ${v.estimated_runtime_seconds} -> ${seconds}s`);
    v.estimated_runtime_seconds = seconds;
  }
  if (!changes.length) {
    console.error(`${measured.size} validator(s) measured and every weight already matches; nothing refreshed`);
    process.exit(1);
  }
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
  console.log(`SHARD WEIGHTS REFRESHED: ${changes.length} of ${measured.size} measured validator(s) from ${files.length} shard summary file(s)`);
  for (const c of changes.slice(0, 30)) console.log(`  ${c}`);
  if (changes.length > 30) console.log(`  ... and ${changes.length - 30} more`);
}

main();
