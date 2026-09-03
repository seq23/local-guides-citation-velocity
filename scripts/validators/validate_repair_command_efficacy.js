#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A registered repair must actually change something when its validator is failing.
 *
 * The defect this exists to stop
 * -----------------------------
 * agent-fix-ledger-truthfulness can FAIL two structurally different ways: a fix
 * newly claims RELEASED status its page does not show (`newRows`), or a fix
 * ALREADY accepted into the ratchet baseline has become truthful and must be
 * pruned from it (`staleBaseline`). Its registered repair,
 * recover_fix_ledger_truthfulness.js, only ever demoted `newRows` - it never wrote
 * data/report_fixes/agent_fix_ledger_truthfulness_baseline.json at all. On
 * 2026-09-03 (run 33789831891) self-heal's attempt 1 demoted the newly-untruthful
 * rows that pass covered; attempt 2 found the validator still failing on 561
 * stale baseline entries alone, ran the repair again, and it exited 0 having
 * changed nothing - self-heal correctly refused to loop on that (Rule 0: a stage
 * exiting 0 having done nothing is a failure, not a pass), and the lane stayed
 * red with a registered repair that could never have cleared it.
 *
 * What this asserts
 * -----------------
 * For every ACTIVE validator declaring a repair_command: run the validator. If it
 * already passes, there is nothing to prove and this repair is not examined
 * further this run - a repair is only tested against a validator it needs to fix.
 * If it FAILS, snapshot every file the repair_command can write
 * (repair_writes, or its declared prepare/produces files as a fallback), run the
 * repair, and re-run the validator. A repair that leaves every one of those files
 * byte-identical AND the validator still failing is a no-op on a live failure -
 * exactly the defect above - and is a hard failure here, named by validator id.
 * A repair that changes at least one file, or clears the validator outright,
 * passes: this does not require full convergence in one pass (a repair whose
 * scope is deliberately partial, like a run-date-scoped demotion, is legitimate),
 * only that it did SOMETHING toward the failure it is registered against.
 *
 * Rule 0: hard-fails if zero ACTIVE validators declare a repair_command. It does
 * NOT require any of them to currently be failing - a clean tree where every
 * repair-bearing validator already passes is a real, valid, common state, and
 * this still examined all of them to reach that conclusion.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/repair-command-efficacy.json';

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } }
function readFileSafe(p) { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } }
function run(cmd) {
  const r = spawnSync(cmd, {
    cwd: ROOT, shell: true, encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' },
  });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const registry = readJson('_validation_registry.json', { validators: [] });
const candidates = (registry.validators || []).filter((v) => v.status === 'ACTIVE' && v.repair_command);

if (!candidates.length) {
  console.error('VALIDATION FAIL: zero_active_repair_commands_found - no ACTIVE validator in _validation_registry.json declares a repair_command. Either every repair was removed (delete this validator deliberately) or the derivation broke; it must not pass on an empty set.');
  process.exit(1);
}

const examined = [];
const fail = [];

for (const v of candidates) {
  const before = run(v.command);
  if (before.code === 0) {
    examined.push({ id: v.id, status: 'ALREADY_PASSING', repair_run: false });
    continue;
  }

  const watchPaths = (v.repair_writes && v.repair_writes.length) ? v.repair_writes
    : [...(v.produces_files || []), ...(v.prepare_produces_files || [])];
  if (!watchPaths.length) {
    // A repair with nothing declared for it to write cannot be proven to have
    // done anything by this method. That is itself worth naming rather than
    // silently skipping.
    fail.push(`no_declared_write_surface:${v.id} - its validator is failing and it declares repair_command "${v.repair_command}" but repair_writes/produces_files is empty, so no run of this check can tell whether the repair does anything. Declare repair_writes.`);
    examined.push({ id: v.id, status: 'UNVERIFIABLE_NO_WRITE_SURFACE', repair_run: false });
    continue;
  }
  const snapshotBefore = watchPaths.map((p) => readFileSafe(p));
  const repairResult = run(v.repair_command);
  const snapshotAfter = watchPaths.map((p) => readFileSafe(p));
  const anyChanged = snapshotBefore.some((content, i) => content !== snapshotAfter[i]);
  const after = run(v.command);

  const status = anyChanged || after.code === 0 ? 'REPAIR_EFFECTIVE' : 'REPAIR_NO_OP_ON_FAILURE';
  examined.push({
    id: v.id,
    status,
    repair_run: true,
    repair_exit_code: repairResult.code,
    watch_paths: watchPaths,
    any_path_changed: anyChanged,
    validator_passes_after_repair: after.code === 0,
  });

  if (status === 'REPAIR_NO_OP_ON_FAILURE') {
    fail.push(`repair_no_op_on_failure:${v.id} - "${v.command}" failed, "${v.repair_command}" ran (exit ${repairResult.code}) and changed none of ${watchPaths.join(', ')}, and the validator still fails afterward. The repair does not address the condition currently failing it.`);
  }
}

const report = {
  schema_version: '1.0',
  validator: 'repair-command-efficacy',
  status: fail.length ? 'FAIL' : 'PASS',
  candidates_examined: examined.length,
  examined,
  errors: fail,
};
const evAbs = path.join(ROOT, EVIDENCE);
fs.mkdirSync(path.dirname(evAbs), { recursive: true });
fs.writeFileSync(evAbs, `${JSON.stringify(report, null, 2)}\n`);

if (fail.length) {
  for (const f of fail) console.error(`VALIDATION FAIL: ${f}`);
  console.error(`  evidence: ${EVIDENCE}`);
  process.exit(1);
}

const ran = examined.filter((e) => e.repair_run).length;
console.log(`Repair command efficacy`);
console.log(`  ACTIVE validators with a repair_command : ${candidates.length}`);
console.log(`  already passing (repair not exercised)  : ${examined.length - ran}`);
console.log(`  failing, repair run against them         : ${ran}`);
console.log(`repair-command-efficacy PASS: ${candidates.length} repair_command(s) examined; every one that ran against a live failure changed something or cleared it.`);
