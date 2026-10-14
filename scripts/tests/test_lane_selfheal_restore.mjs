#!/usr/bin/env node
// Lane self-heal restore contract, run by workflow-contract-registry (a registered
// HARD_FAIL) on every validate: the evidence lane never carries HTML a
// non-repair step rendered, and never goes red for it.
//
// 2026-10-14, Query Evidence Refresh run 38524268332: zero repairs, 282 rendered
// pages changed by canonical-domains' `npm run build` prepare, exit 1, no evidence
// committed. This builds a throwaway git repo and drives the same settle code the
// lane runs (scripts/selfheal/lane_surface_settle.mjs):
//   1. a non-repair step rewrites a committed page and renders a new one, and the
//      lane writes evidence -> both pages are back to HEAD, the evidence is kept, no
//      named stop, nothing uncommittable left;
//   2. a repair writes a page outside the surface plus a committable file -> the
//      repair is withdrawn whole, a NAMED STOP names it, and the stop is written to
//      the committed state file (visible, self-clearing - not an exit 1);
//   3. the live runner is wired to settle BEFORE its surface check and no longer
//      exits non-zero for a re-render.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusMap, settleOutOfSurface, recordLaneStop } from '../selfheal/lane_surface_settle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'artifacts/validation/lane-selfheal-restores-rendered.json');
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);
const isCommittable = (p) => p.startsWith('artifacts/validation/') && p.endsWith('.json');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-selfheal-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'user.name', 't');
  write(dir, 'guides/a/index.html', '<main><section>A</section></main>\n');
  write(dir, 'guides/c/index.html', '<main><section>C</section></main>\n');
  write(dir, 'artifacts/validation/evidence.json', '{"n":1}\n');
  write(dir, 'data/repair_target.json', '{"fixed":false}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

const cases = [];
const tmp = [];
try {
  // 1. non-repair render
  {
    const dir = fixture(); tmp.push(dir);
    write(dir, 'guides/a/index.html', '<main><section>A</section>\n\n</main>\n');
    write(dir, 'guides/new/index.html', '<main>rendered</main>\n');
    write(dir, 'artifacts/validation/evidence.json', '{"n":2}\n');
    const codes = statusMap(dir);
    const touched = [...codes.keys()].sort();
    const settled = settleOutOfSurface({ root: dir, touched, codes, repairWrote: new Map(), isCommittable });
    const left = [...statusMap(dir).keys()];
    const htmlLeft = left.filter((p) => p.endsWith('.html'));
    cases.push({
      name: 'non_repair_render_is_restored_and_evidence_kept',
      pass: htmlLeft.length === 0
        && read(dir, 'guides/a/index.html') === '<main><section>A</section></main>\n'
        && read(dir, 'guides/new/index.html') === null
        && read(dir, 'artifacts/validation/evidence.json') === '{"n":2}\n'
        && settled.named_stop === null
        && settled.rendered_by_non_repair_steps.length === 2
        && left.every(isCommittable),
      observed: { left, restored: settled.restored, named_stop: settled.named_stop },
    });
  }
  // 2. repair outside the surface
  {
    const dir = fixture(); tmp.push(dir);
    write(dir, 'guides/c/index.html', '<main><section>C repaired</section></main>\n');
    write(dir, 'data/repair_target.json', '{"fixed":true}\n');
    write(dir, 'guides/a/index.html', '<main>re-rendered</main>\n');
    write(dir, 'artifacts/validation/publish-blocked-state.json', '{"status":"PUBLISHABLE"}\n');
    const codes = statusMap(dir);
    const touched = [...codes.keys()].sort();
    const repairWrote = new Map([['some-validator', ['guides/c/index.html', 'data/repair_target.json']]]);
    const settled = settleOutOfSurface({ root: dir, touched, codes, repairWrote, isCommittable: (p) => isCommittable(p) || p === 'data/repair_target.json' });
    recordLaneStop(dir, settled);
    const state = JSON.parse(read(dir, 'artifacts/validation/publish-blocked-state.json'));
    const left = [...statusMap(dir).keys()];
    cases.push({
      name: 'repair_outside_surface_is_withdrawn_whole_and_named',
      pass: Boolean(settled.named_stop)
        && settled.named_stop.code === 'REPAIR_OUTSIDE_LANE_SURFACE'
        && JSON.stringify(settled.named_stop.stranded_repairs) === '["some-validator"]'
        && JSON.stringify(settled.named_stop.paths_outside_surface) === '["guides/c/index.html"]'
        && read(dir, 'guides/c/index.html') === '<main><section>C</section></main>\n'
        && read(dir, 'data/repair_target.json') === '{"fixed":false}\n'
        && read(dir, 'guides/a/index.html') === '<main><section>A</section></main>\n'
        && state.lane_named_stop && state.lane_named_stop.code === 'REPAIR_OUTSIDE_LANE_SURFACE'
        && state.status === 'PUBLISHABLE'
        && left.every(isCommittable),
      observed: { named_stop: settled.named_stop, left },
    });
    // and it clears itself on the next run with nothing left over
    const clear = settleOutOfSurface({ root: dir, touched: [], codes: statusMap(dir), repairWrote: new Map(), isCommittable });
    recordLaneStop(dir, clear);
    const after = JSON.parse(read(dir, 'artifacts/validation/publish-blocked-state.json'));
    cases.push({ name: 'named_stop_self_clears', pass: after.lane_named_stop === null, observed: { lane_named_stop: after.lane_named_stop } });
  }
  // 3. the live runner settles before its surface check
  {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/selfheal/run_lane_selfheal.mjs'), 'utf8');
    const settleAt = src.indexOf('settleOutOfSurface(');
    const checkAt = src.indexOf('if (uncommittable.length)');
    const recordAt = src.indexOf('recordLaneStop(');
    cases.push({
      name: 'live_runner_settles_before_the_surface_check',
      pass: settleAt > 0 && recordAt > settleAt && checkAt > recordAt
        && /const uncommittable = \[\.\.\.left\.keys\(\)\]/.test(src),
      observed: { settleAt, recordAt, checkAt },
    });
  }
} finally {
  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
}

const failed = cases.filter((c) => !c.pass);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify({ schema_version: '1.0', guard: 'lane-selfheal-restores-rendered', status: failed.length || !cases.length ? 'FAIL' : 'PASS', cases }, null, 2)}\n`);
if (!cases.length) { console.error('LANE SELF-HEAL RESTORE FAIL: zero cases examined.'); process.exit(1); }
if (failed.length) {
  console.error(`LANE SELF-HEAL RESTORE FAIL: ${failed.length} of ${cases.length} case(s):`);
  for (const c of failed) console.error(`  ${c.name}: ${JSON.stringify(c.observed).slice(0, 400)}`);
  process.exit(1);
}
console.log(`LANE SELF-HEAL RESTORE PASS: ${cases.length} cases - non-repair renders restored, evidence kept, an out-of-surface repair withdrawn whole and named, the stop self-clears, the live runner is wired.`);
