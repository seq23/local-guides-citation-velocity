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
//   - anything outside that surface is settled before the surface check
//     (lane_surface_settle.mjs): what a non-repair step re-rendered (a validator's
//     `npm run build` prepare) is restored to HEAD; a repair that wrote outside the
//     surface is withdrawn whole and recorded as a NAMED STOP in
//     artifacts/validation/publish-blocked-state.json, committed with the evidence
//     and self-clearing. Only a path git could not put back is a hard stop.
//
// Publishing rendered content is velocity-content-release's job, not a 30-minute
// evidence refresh's. Until 2026-10-14 a re-render with zero repairs (run
// 38524268332: 282 pages from canonical-domains' build prepare) exited 1 here and
// the lane committed no evidence at all.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import contract from './lane_commit_contract.js';
import { statusMap, settleOutOfSurface, recordLaneStop } from './lane_surface_settle.mjs';

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

// There is no dry pass here any more, and that is the point.
//
// This runner used to call `npm run selfheal:dry` before `npm run selfheal`. The
// dry pass runs the WHOLE core profile - every validator, once - and then
// deliberately repairs nothing, so the only thing it can produce is a preview.
// Nothing consumed that preview: its exit code was caught into a local and spent
// on a single console.log that said the exit code "simply means it found work",
// and the real pass immediately re-derived the same failure list from scratch.
// It was a rehearsal whose only output was time.
//
// Measured, on the scheduled lane: 478s of run 34678719009's 918s self-heal step
// (06:46 -> 06:54:18) and ~490s of run 34571184690's 974s. Both runs were then
// CANCELLED at timeout-minutes: 30 inside `npm run validate:release`. A full
// profile pass in this repo now costs ~450-500s on a runner, so the preview was
// roughly a quarter of the entire job budget. On 2026-09-12 it also disagreed
// with the pass it was previewing - the dry pass reported "1 failing (0
// repairable)" and the real pass came back "clean on attempt 1" - which is the
// clearest possible demonstration that its reading was never load-bearing.
//
// `npm run selfheal:dry` still exists for a human who wants a preview before
// letting the loop write. A scheduled lane that is going to run the real pass
// one second later is not that human.
const heal = run('npm run selfheal');
if (heal.status !== 0) {
  console.error(`LANE SELF-HEAL FAIL: the self-heal loop could not make the tree publishable (exit ${heal.status}); see artifacts/validation/self-heal-loop.json`);
  process.exit(heal.status || 1);
}

const codes = statusMap(ROOT);
const touched = [...codes.keys()].filter((p) => !before.has(p)).sort();

// What the loop itself says it did, so the step reports repairs rather than the
// validation receipts every run writes regardless - and which paths each repair
// wrote, so a repair's writes are never mistaken for a re-render.
let repairedIds = [];
const repairWrote = new Map();
try {
  const loop = JSON.parse(fs.readFileSync(`${ROOT}/artifacts/validation/self-heal-loop.json`, 'utf8'));
  for (const r of (loop.attempts || []).flatMap((a) => a.repaired || [])) {
    if (r.code !== 0 || r.no_op) continue;
    repairedIds.push(r.id);
    // A repair whose writes could not be measured is charged with every path the
    // step changed: unknown attribution may never be restored as a mere re-render.
    const wrote = Array.isArray(r.wrote_paths) ? r.wrote_paths : touched;
    repairWrote.set(r.id, [...new Set([...(repairWrote.get(r.id) || []), ...wrote])]);
  }
} catch { /* the loop always writes this; if it did not, say nothing rather than guess */ }
repairedIds = [...new Set(repairedIds)];

// Restore what non-repair steps rendered outside the surface; withdraw (and name)
// any repair that wrote outside it. See lane_surface_settle.mjs for why.
const settled = settleOutOfSurface({ root: ROOT, touched, codes, repairWrote, isCommittable: (p) => isCommittable(p, patterns) });
const stateRel = recordLaneStop(ROOT, settled);

const left = statusMap(ROOT);
const uncommittable = [...left.keys()].filter((p) => !before.has(p) && !isCommittable(p, patterns)).sort();

const report = {
  schema_version: '1.1',
  committable_patterns: patterns,
  repaired_validators: repairedIds,
  step_changed_paths: touched,
  restored_non_repair_paths: settled.rendered_by_non_repair_steps,
  withdrawn_repair_paths: settled.named_stop ? settled.named_stop.withdrawn_paths : [],
  named_stop: settled.named_stop,
  uncommittable_paths: uncommittable,
  status: uncommittable.length ? 'FAIL' : (settled.named_stop ? 'NAMED_STOP' : 'PASS'),
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(`${ROOT}/artifacts/validation`, { recursive: true });
fs.writeFileSync(`${ROOT}/artifacts/validation/lane-self-heal.json`, `${JSON.stringify(report, null, 2)}\n`);

// The lane must state what it did either way. "Nothing to repair" is a result;
// exiting 0 in silence is what let the discarded-repair defect hide.
if (!repairedIds.length) {
  console.log('[lane self-heal] no validator needed repair');
} else {
  console.log(`[lane self-heal] repaired ${repairedIds.length} validator(s): ${repairedIds.join(', ')}`);
}
console.log(`[lane self-heal] ${touched.length} path(s) changed by this step; ${settled.rendered_by_non_repair_steps.length} re-rendered by non-repair steps (validator prepares) outside the commit surface were restored to HEAD:`);
for (const p of settled.rendered_by_non_repair_steps.slice(0, 20)) console.log(`  restored ${p}`);
if (settled.rendered_by_non_repair_steps.length > 20) console.log(`  ... and ${settled.rendered_by_non_repair_steps.length - 20} more (artifacts/validation/lane-self-heal.json)`);

if (settled.named_stop) {
  const ns = settled.named_stop;
  const line = `NAMED STOP ${ns.code}: ${ns.meaning}`;
  console.log(`::warning title=NAMED STOP ${ns.code}::${line}`);
  for (const p of ns.paths_outside_surface.slice(0, 20)) console.log(`  outside surface: ${p}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n\nRecorded in \`${stateRel}\` (committed with the evidence; clears on the next run with nothing left over).\n`);
}

// After the restore nothing outside the surface may remain. If git could not put
// something back, committing would publish a tree this run never validated.
if (uncommittable.length) {
  console.error(`LANE SELF-HEAL FAIL: ${uncommittable.length} path(s) are still outside this lane's commit surface after the restore, so committing now would publish a tree this run never validated:`);
  for (const p of uncommittable.slice(0, 50)) console.error(`  ${p}`);
  process.exit(1);
}

// Hand the derived pattern to the commit step so the YAML cannot drift from the
// registry.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `file_pattern=${patterns.join(' ')}\n`);
}
console.log(`[lane self-heal] commit surface: ${patterns.join(' ')}`);
