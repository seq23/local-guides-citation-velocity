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
 *
 * THE OBSERVATION IS DURABLE, BECAUSE THE FAILURE IS NOT
 * ------------------------------------------------------
 * A no-op is only visible while its validator is actually failing, and some
 * validators fail on BUILD OUTPUT rather than on committed state. On 2026-09-09
 * Velocity Content Release run 34416882965 caught exactly that:
 *
 *   repair NO-OP for rendered-output-shrink-guard: "npm run measure:historic-page-maximum"
 *   exited 0 but changed no file, so rendered-output-shrink-guard cannot clear on a retry
 *
 * The repair writes data/release/historic_page_maximum.json; the verdict that was
 * failing - unjustified_shrinks - is computed from data/release/rendered_size_baseline.json,
 * which that command never touches. self-heal-repair-contract could not see it,
 * because the guard DOES read the historic store for its ratchet section, so the
 * declared file overlap was satisfied while the repair remained unable to clear
 * the failure. File overlap is not efficacy.
 *
 * That finding then evaporated: on a clean tree the four pages sit exactly at
 * their floor, the guard passes, the repair is never exercised, and this
 * validator printed PASS over the identical broken registration. A defect that is
 * only observable inside a release run, and is forgotten by the next local run,
 * is a defect nobody can be held to.
 *
 * So every REPAIR_NO_OP_ON_FAILURE is written to
 * data/release/repair_efficacy_observations.json and keeps failing this validator
 * until the REGISTRATION CHANGES - the repair_command is repointed, or removed
 * because no command can supply the judgment the failure needs. An observation
 * cannot be cleared by the failure going away, only by fixing what was claimed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/repair-command-efficacy.json';
const OBSERVATIONS = 'data/release/repair_efficacy_observations.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

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
const observed = [];

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
    observed.push({ validator_id: v.id, repair_command: v.repair_command, watch_paths: watchPaths, first_observed_at: DATE, note: 'Recorded so this survives the failure ceasing to reproduce. It clears only when the registration changes.' });
  }
}

// EVERY NO-OP EVER OBSERVED, STILL CLAIMED, STILL FAILS.
//
// An observation names a validator AND the exact repair_command that no-opped
// against it. It is resolved by the registry no longer making that claim - the
// command repointed, or removed because no command can supply the judgment the
// failure needs. It is NOT resolved by the underlying failure going quiet, which
// is the only way this defect used to disappear.
const observationDoc = readJson(OBSERVATIONS, { schema_version: '1.0', observations: [] });
const priorObservations = observationDoc.observations || [];
const repairById = new Map(candidates.map((v) => [v.id, v.repair_command]));
const stillClaimed = [];
const resolved = [];
for (const row of priorObservations) {
  if (!row || !row.validator_id) continue;
  const current = repairById.get(row.validator_id);
  if (current && current === row.repair_command) stillClaimed.push(row);
  else resolved.push({ ...row, resolved_at: DATE, resolved_because: current ? `repair_command repointed to "${current}"` : 'the validator no longer declares a repair_command' });
}
for (const row of stillClaimed) {
  fail.push(`unresolved_repair_no_op:${row.validator_id} - "${row.repair_command}" was observed on ${row.first_observed_at} to run against a live failure of this validator and change nothing. The registry still claims it. Repoint it at what the failing verdict is actually computed from, or remove it because no command can supply the judgment this failure needs - do not wait for the failure to stop reproducing.`);
}
// Newly observed no-ops join the durable record; resolved ones leave it, and the
// leaving is reported rather than silent.
const nextObservations = [...stillClaimed];
for (const row of observed) {
  if (!nextObservations.some((x) => x.validator_id === row.validator_id && x.repair_command === row.repair_command)) nextObservations.push(row);
}
if (JSON.stringify(priorObservations) !== JSON.stringify(nextObservations)) {
  const obsAbs = path.join(ROOT, OBSERVATIONS);
  fs.mkdirSync(path.dirname(obsAbs), { recursive: true });
  fs.writeFileSync(obsAbs, `${JSON.stringify({
    schema_version: '1.0',
    store: 'repair-efficacy-observations',
    policy: 'A repair observed to run against a live failure and change nothing is recorded here and keeps repair-command-efficacy failing until the REGISTRATION changes. The failure ceasing to reproduce does not clear it.',
    updated_at: DATE,
    observations: nextObservations
  }, null, 2)}\n`);
}
for (const row of resolved) console.log(`  RESOLVED: ${row.validator_id} - ${row.resolved_because}`);

const report = {
  schema_version: '1.0',
  validator: 'repair-command-efficacy',
  status: fail.length ? 'FAIL' : 'PASS',
  candidates_examined: examined.length,
  durable_observations: nextObservations.length,
  observations_resolved_this_run: resolved.length,
  observations: nextObservations,
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
