#!/usr/bin/env node
// Run the self-heal loop inside the scheduled evidence lane, and refuse to let
// that lane commit a tree it did not validate.
//
// The lane used to run `npm run selfheal` directly and then commit a fixed list
// of evidence files. Every path a repair rewrites was outside that list, so a
// run that actually repaired something validated the healed tree and committed
// a different, still-broken one. This wrapper closes that gap from both ends:
//
//   - the commit pattern is derived from the registry's repair_writes, so what a
//     repair rewrites is committed with the evidence, and
//   - anything the self-heal changed that the lane cannot commit is a hard stop,
//     named file by file, instead of a silent partial commit.
//
// A rebuild-shaped repair (npm run build re-emitting rendered HTML) lands in the
// second case on purpose: publishing rendered content is velocity-content-release's
// job, not a 30-minute evidence refresh's. The lane says so and fails.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import contract from './lane_commit_contract.js';

const { ROOT, committablePatterns, isCommittable } = contract;

const run = (cmd) =>
  spawnSync(cmd, {
    cwd: ROOT, shell: true, stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' },
  });

// Paths git reports as changed, including untracked, quoting disabled so unusual
// names stay readable.
function changedPaths() {
  const r = spawnSync('git -c core.quotepath=false status --porcelain --untracked-files=all', {
    cwd: ROOT, shell: true, encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error('LANE SELF-HEAL FAIL: git status did not answer; refusing to guess what changed');
    process.exit(1);
  }
  return new Set(
    (r.stdout || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      // a rename reports "old -> new"; the new path is what would be committed
      .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
      .filter(Boolean),
  );
}

const patterns = committablePatterns();
const before = changedPaths();

// The dry pass is a preview of what would be repaired. It reports NOT_CLEAN and
// exits non-zero whenever anything needs repair, because it deliberately repairs
// nothing - so it is exactly the runs that need healing that it fails on. The
// lane previously ran it as a bare command under bash -e, which aborted the step
// before the real pass could run: the loop could only ever complete when there
// was nothing for it to do. Its exit code is informational here, never fatal.
const dry = run('npm run selfheal:dry');
console.log(`[lane self-heal] preview pass exited ${dry.status} (non-zero simply means it found work; the real pass decides)`);
const heal = run('npm run selfheal');
if (heal.status !== 0) {
  console.error(`LANE SELF-HEAL FAIL: the self-heal loop could not make the tree publishable (exit ${heal.status}); see artifacts/validation/self-heal-loop.json`);
  process.exit(heal.status || 1);
}

const after = changedPaths();
const touched = [...after].filter((p) => !before.has(p)).sort();
const uncommittable = touched.filter((p) => !isCommittable(p, patterns));

// What the loop itself says it did, so the step reports repairs rather than the
// validation receipts every run writes regardless.
let repairedIds = [];
try {
  const loop = JSON.parse(fs.readFileSync(`${ROOT}/artifacts/validation/self-heal-loop.json`, 'utf8'));
  repairedIds = (loop.attempts || []).flatMap((a) => (a.repaired || []).filter((r) => r.code === 0 && !r.no_op).map((r) => r.id));
} catch { /* the loop always writes this; if it did not, say nothing rather than guess */ }

const report = {
  schema_version: '1.0',
  committable_patterns: patterns,
  repaired_validators: repairedIds,
  step_changed_paths: touched,
  uncommittable_paths: uncommittable,
  status: uncommittable.length ? 'FAIL' : 'PASS',
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(`${ROOT}/artifacts/validation`, { recursive: true });
fs.writeFileSync(`${ROOT}/artifacts/validation/lane-self-heal.json`, `${JSON.stringify(report, null, 2)}\n`);

// The lane must state what it did either way. "Nothing to repair" is a result;
// exiting 0 in silence is what let the discarded-repair defect hide.
if (!repairedIds.length) {
  console.log('[lane self-heal] no validator needed repair; this step changed only validation receipts');
} else {
  console.log(`[lane self-heal] repaired ${repairedIds.length} validator(s): ${repairedIds.join(', ')}`);
}
console.log(`[lane self-heal] ${touched.length} path(s) changed by this step:`);
for (const p of touched) console.log(`  ${p}`);

if (uncommittable.length) {
  console.error(`LANE SELF-HEAL FAIL: ${uncommittable.length} repaired path(s) are outside this lane's commit surface, so committing now would publish a tree this run never validated:`);
  for (const p of uncommittable) console.error(`  ${p}`);
  console.error('This lane refreshes evidence; publishing rendered content is velocity-content-release.yml. Run that lane rather than widening this one.');
  process.exit(1);
}

// Hand the derived pattern to the commit step so the YAML cannot drift from the
// registry.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `file_pattern=${patterns.join(' ')}\n`);
}
console.log(`[lane self-heal] commit surface: ${patterns.join(' ')}`);
