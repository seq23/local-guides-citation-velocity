#!/usr/bin/env node
// Validate -> repair -> re-validate, until clean or out of attempts.
//
// The repo already had this shape, but only around one check:
// run_source_self_heal_loop.js repairs substance and re-runs the substance
// validator. Everything else in the 43-validator chain was validate-only, so
// any other failure stopped the release and waited for a human - even when a
// repair for exactly that defect existed in package.json and had simply never
// been wired to the validator that detects it.
//
// This runs the full profile, reads which validators failed, runs the repair
// each one declares in _validation_registry.json (`repair_command`), and
// re-validates. It stops early when clean, and stops when a pass produces no
// repairable failures - looping again would just repeat the same result.
//
//   node scripts/selfheal/heal_until_clean.mjs [--profile core] [--max 3] [--dry-run]
//
// Exit 0 means the chain is green and it is safe to push. Non-zero means it is
// not, and the report names what could not be healed and why.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PROFILE = arg('--profile', 'core');
const MAX = Math.max(1, Math.min(5, Number(arg('--max', '3'))));
const DRY = argv.includes('--dry-run');

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, '_validation_registry.json'), 'utf8'));
const repairFor = new Map(
  (registry.validators || [])
    .filter((v) => v.repair_command)
    .map((v) => [v.id, v.repair_command]),
);

const run = (cmd) => {
  const started = Date.now();
  const r = spawnSync(cmd, {
    cwd: ROOT, shell: true, encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' },
  });
  return { cmd, code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`, ms: Date.now() - started };
};

// Fingerprint of every tracked change in the working tree, used to tell a
// repair that did work from one that exited 0 having done nothing. Returns null
// when git cannot answer, in which case no-op detection stays silent rather
// than guessing.
function treeState() {
  const r = spawnSync('git status --porcelain', { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout;
}

// The registry runner writes a machine-readable summary; prefer it over parsing
// console output, which changes shape between validators.
function failedValidators() {
  const summary = path.join(ROOT, `artifacts/validation/validation-summary-${PROFILE}.json`);
  const fallback = path.join(ROOT, 'artifacts/validation/validation-summary.json');
  for (const p of [summary, fallback]) {
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      return (doc.results || []).filter((r) => r.status === 'FAIL').map((r) => r.id);
    } catch { /* try the next one */ }
  }
  return [];
}

const attempts = [];
let clean = false;

for (let attempt = 1; attempt <= MAX; attempt += 1) {
  const validate = run(`node scripts/validation/run_validation_registry.js --profile ${PROFILE} --collect-all`);
  const failed = validate.code === 0 ? [] : failedValidators();
  if (validate.code === 0) {
    attempts.push({ attempt, failed: [], repaired: [], result: 'CLEAN' });
    clean = true;
    console.log(`[self-heal] clean on attempt ${attempt}`);
    break;
  }

  const repairable = failed.filter((id) => repairFor.has(id));
  const unrepairable = failed.filter((id) => !repairFor.has(id));
  console.log(`[self-heal] attempt ${attempt}: ${failed.length} failing (${repairable.length} repairable)`);
  for (const id of unrepairable) console.log(`  no registered repair: ${id}`);

  if (!repairable.length) {
    // Nothing to change, so another pass would fail identically. Stop and say so
    // rather than burning attempts to reach the same place.
    attempts.push({ attempt, failed, repaired: [], result: 'NO_REPAIR_AVAILABLE' });
    break;
  }

  const repaired = [];
  for (const id of repairable) {
    const cmd = repairFor.get(id);
    if (DRY) { console.log(`  would repair ${id}: ${cmd}`); repaired.push({ id, cmd, code: 0, dry: true }); continue; }
    console.log(`  repairing ${id}: ${cmd}`);
    const before = treeState();
    const r = run(cmd);
    const after = treeState();
    // A repair that exits 0 without touching a single file has done nothing.
    // Left unnamed it reads as success, and the loop burns every remaining
    // attempt re-running it to reach the same failure. Say so instead.
    const noOp = r.code === 0 && before !== null && after !== null && before === after;
    if (r.code !== 0) console.log(`  repair FAILED for ${id} (exit ${r.code})`);
    else if (noOp) console.log(`  repair NO-OP for ${id}: "${cmd}" exited 0 but changed no file, so ${id} cannot clear on a retry`);
    repaired.push({ id, cmd, code: r.code, no_op: noOp });
  }

  // Every repair this pass either failed or changed nothing, so the next pass
  // would validate an identical tree. Stop and name it rather than looping.
  if (repaired.length && repaired.every((x) => x.code !== 0 || x.no_op)) {
    attempts.push({ attempt, failed, repaired, result: 'REPAIRS_CHANGED_NOTHING' });
    console.log('[self-heal] no repair changed the tree this pass; retrying would validate the identical tree');
    break;
  }

  attempts.push({ attempt, failed, repaired, result: 'REPAIRED_RETRYING' });
  if (DRY) break;
}

const report = {
  schema_version: '1.0',
  profile: PROFILE,
  max_attempts: MAX,
  dry_run: DRY,
  status: clean ? 'CLEAN' : 'NOT_CLEAN',
  safe_to_push: clean,
  attempts,
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/self-heal-loop.json'), `${JSON.stringify(report, null, 2)}\n`);

if (!clean) {
  console.error(`[self-heal] NOT CLEAN after ${attempts.length} attempt(s) - refusing to declare the tree publishable.`);
  console.error('  see artifacts/validation/self-heal-loop.json');
  process.exit(1);
}
console.log('[self-heal] safe to push');
