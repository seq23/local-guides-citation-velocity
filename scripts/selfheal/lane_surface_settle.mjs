// What a lane does with paths it changed but may not commit.
//
// 2026-10-14, Query Evidence Refresh run 38524268332: the self-heal step made ZERO
// repairs and still changed 298 paths, 282 of them rendered HTML, so the lane
// exited 1 and committed nothing - not even the evidence it exists to refresh.
// The writer was not a repair. The core profile's canonical-domains validator
// prepares with `npm run build`, which re-renders the site; on a403cdf the build
// re-emitted 282 pages whose committed bytes (a frozen retrofit) differed from the
// generator's by whitespace. A validator's prepare step rendering pages is
// legitimate; publishing them from this lane is not.
//
// So the paths are split by WHO wrote them:
//   - written by a non-repair step (a validator's prepare, a build) -> restored to
//     the committed bytes. Nothing anyone chose to publish is lost, and the tree
//     that is committed is the tree that was checked out plus the lane's evidence.
//   - written by a repair, outside the commit surface -> the repair cannot be
//     published by this lane. Every path that repair wrote is restored (a half-
//     published repair is worse than none) and the lane records a NAMED STOP in
//     artifacts/validation/publish-blocked-state.json, which is inside the commit
//     surface, so the stop is visible on main and clears itself on the next run
//     that has nothing left over. The evidence still commits; the lane is green.
// Rule 0: the stop is printed as a ::warning:: and written to the step summary
// and the committed state file - never a silent exit 0.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// git status as a Map(path -> two-letter code), untracked included, renames
// reported under their new path.
export function statusMap(root) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'], {
    cwd: root, encoding: 'utf8', maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`git status did not answer in ${root}; refusing to guess what changed`);
  const out = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2);
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    if (p) out.set(p, code);
  }
  return out;
}

// Put paths back exactly as HEAD has them: tracked files are checked out, files
// HEAD does not know are removed. Throws if git refuses, so a failed restore can
// never be reported as a clean one.
export function restorePaths(root, paths, codes) {
  const untracked = paths.filter((p) => codes.get(p) === '??');
  const tracked = paths.filter((p) => codes.get(p) !== '??');
  for (let i = 0; i < tracked.length; i += 200) {
    const chunk = tracked.slice(i, i + 200);
    const r = spawnSync('git', ['checkout', 'HEAD', '--', ...chunk], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git checkout could not restore ${chunk.length} path(s): ${(r.stderr || '').slice(0, 400)}`);
  }
  for (const p of untracked) fs.rmSync(path.join(root, p), { force: true, recursive: true });
  return { restored_tracked: tracked.length, removed_untracked: untracked.length };
}

// touched: paths this step changed. repairWrote: Map(validator id -> paths that
// repair wrote). Returns what was restored and the named stop, if any.
export function settleOutOfSurface({ root, touched, codes, repairWrote, isCommittable }) {
  const outside = touched.filter((p) => !isCommittable(p));
  const byRepair = new Map();
  for (const [id, paths] of repairWrote) for (const p of paths) {
    if (!byRepair.has(p)) byRepair.set(p, new Set());
    byRepair.get(p).add(id);
  }
  const rendered = outside.filter((p) => !byRepair.has(p));
  const leftovers = outside.filter((p) => byRepair.has(p));
  const strandedRepairs = [...new Set(leftovers.flatMap((p) => [...byRepair.get(p)]))].sort();
  // A repair that cannot be published here is withdrawn whole.
  const withdrawn = [...new Set(strandedRepairs.flatMap((id) => repairWrote.get(id) || []))]
    .filter((p) => codes.has(p) && !rendered.includes(p));
  const toRestore = [...new Set([...rendered, ...withdrawn])].sort();
  const restore = toRestore.length ? restorePaths(root, toRestore, codes) : { restored_tracked: 0, removed_untracked: 0 };
  const namedStop = strandedRepairs.length ? {
    code: 'REPAIR_OUTSIDE_LANE_SURFACE',
    stranded_repairs: strandedRepairs,
    paths_outside_surface: leftovers.sort(),
    withdrawn_paths: withdrawn.sort(),
    meaning: `Repair(s) ${strandedRepairs.join(', ')} rewrote ${leftovers.length} path(s) this lane may not commit (rendered content belongs to velocity-content-release.yml). The repair was withdrawn whole and NOT published; the evidence was. This clears itself on the next run with nothing left over.`,
  } : null;
  return {
    rendered_by_non_repair_steps: rendered.sort(),
    restored: toRestore,
    ...restore,
    named_stop: namedStop,
  };
}

// Record the stop (or its absence) in the committed state file the self-heal loop
// already writes, so "blocked" and "clear" both reach main.
export function recordLaneStop(root, settled) {
  const rel = 'artifacts/validation/publish-blocked-state.json';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { /* first write */ }
  state.lane_named_stop = settled.named_stop;
  state.lane_restored_non_repair_paths = settled.rendered_by_non_repair_steps.length;
  fs.mkdirSync(path.join(root, 'artifacts/validation'), { recursive: true });
  fs.writeFileSync(path.join(root, rel), `${JSON.stringify(state, null, 2)}\n`);
  return rel;
}
