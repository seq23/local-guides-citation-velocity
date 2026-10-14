#!/usr/bin/env node
// The last thing a page-publishing lane runs before `git push`: the shrink guard,
// on the exact commit about to be pushed.
//
// 2026-10-14, Velocity Content Release run 38524703457: the publish loop's own
// validate:release FAILED rendered-output-shrink-guard on the tree it then pushed,
// and publish_gate_decision.mjs waved it through - the guard has no repair_command,
// so it was "FAILING, NOT BLOCKING". The lane pushed 77d1472 and Validate Repo
// (run 38525995326) turned main red on it. Content loss is not something a run can
// publish around and let main absorb.
//
// Exit 0 = the guard passed on this tree; push.
// Exit 3 = NAMED STOP RENDERED_CONTENT_LOST: do not push. The lane exits green, the
//          stop is a ::warning:: annotation, a step-summary entry and
//          artifacts/validation/publish-blocked-state.json (uploaded with the run's
//          diagnostics). Nothing reached main, so it clears itself on the next run
//          whose tree keeps every block.
// Exit 1 = the guard could not give an answer (crash, no evidence); the lane fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = 'artifacts/validation/rendered-output-shrink-guard.json';
const STATE = 'artifacts/validation/publish-blocked-state.json';

const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
try { fs.rmSync(path.join(ROOT, EVIDENCE), { force: true }); } catch { /* absent */ }
const r = spawnSync(process.execPath, ['scripts/validators/validate_rendered_output_shrink_guard.js'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
let doc = null;
try { doc = JSON.parse(fs.readFileSync(path.join(ROOT, EVIDENCE), 'utf8')); } catch { /* below */ }

if (r.status === 0 && doc && doc.status === 'PASS') {
  console.log(`[push gate] rendered-output-shrink-guard PASS on ${head.slice(0, 9)}, the exact commit being pushed.`);
  process.exit(0);
}
const lost = doc && Array.isArray(doc.unjustified_shrinks) ? doc.unjustified_shrinks : [];
const selfProofFailed = doc && Array.isArray(doc.self_proof_cases) && doc.self_proof_cases.some((c) => !c.pass);
if (!doc || !lost.length || selfProofFailed) {
  console.error(`[push gate] FAIL: the shrink guard exited ${r.status} on ${head.slice(0, 9)} without naming a lost page (evidence ${doc ? 'unreadable as a content loss' : 'missing'}); its answer is UNKNOWN, so this lane fails rather than push.`);
  process.exit(1);
}
const stop = {
  code: 'RENDERED_CONTENT_LOST',
  commit: head,
  pages: lost.map((s) => ({ implementation_path: s.implementation_path, lost_kinds: s.lost_kinds })),
  meaning: `${lost.length} page(s) in this release lost delivered blocks with no named reason. Nothing was pushed; main keeps its last validated tree. Recover the blocks at source (or name the shrink in data/release/rendered_size_baseline.json justified_shrinks) and the next run publishes.`,
};
let state = {};
try { state = JSON.parse(fs.readFileSync(path.join(ROOT, STATE), 'utf8')); } catch { /* first write */ }
state.push_named_stop = stop;
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, STATE), `${JSON.stringify(state, null, 2)}\n`);
const line = `NAMED STOP ${stop.code}: ${stop.meaning} Pages: ${lost.slice(0, 5).map((s) => s.implementation_path).join(', ')}${lost.length > 5 ? ', ...' : ''}`;
console.log(`::warning title=NAMED STOP ${stop.code}::${line}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n\nRecorded in \`${STATE}\` (run diagnostics).\n`);
process.exit(3);
