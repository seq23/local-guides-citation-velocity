#!/usr/bin/env node
'use strict';
/**
 * A validation pass whose result nobody reads is not coverage - it is the job
 * budget.
 *
 * `Query Evidence Refresh` was CANCELLED at exactly 30m00s on 2026-09-11 (run
 * 34571184690) and again on 2026-09-12 (run 34678719009), both times inside a
 * release-profile validation. Nothing in the tree was wrong. The lane was
 * running the FULL validation suite four times in the normal path:
 *
 *   1. `npm run selfheal:dry`      - core profile, repairs nothing, ~478s
 *   2. `npm run selfheal`          - core profile, repairs, ~438s
 *   3. `npm run validate:release`  - release profile, standalone step, ~260-520s
 *   4. `npm run validate:release`  - release profile, after the rebase, ~265s
 *
 * Two of those four could not affect what reached main. (1) was a preview whose
 * exit code was spent on a console.log. (3) proved a tree taken BEFORE the
 * fetch/rebase, which validate_push_after_rebase_revalidates.js already declares
 * insufficient: "a rebase that applies WITHOUT conflict is not a rebase that
 * changes nothing... the result is a combination of two separately-validated
 * trees, which is not itself a validated tree." (4) proves the bytes actually
 * pushed. So the lane now heals once and proves once, where it matters.
 *
 * Raising timeout-minutes would have hidden all of this. This validator exists
 * so the arrangement cannot silently drift back:
 *
 *   A. the lane self-heal runner may not invoke a dry/preview pass - a full
 *      profile run whose only consumer is a log line;
 *   B. in a lane that runs that runner, every `npm run validate:release` must
 *      live in the step that pushes to main. A release-profile pass in a step
 *      with no push is a pass on a tree the lane is about to rebase away.
 *   C. that pushing step must actually contain one, so removing the standalone
 *      step can never leave the lane with no unassisted proof at all.
 *
 * This does NOT say "check less". Profile membership, tiers and the release
 * profile's 145 validators are untouched; the same ground is covered, twice
 * instead of four times.
 *
 * Rule 0: hard-fails if it examines zero workflows, or finds zero lanes running
 * the self-heal runner, or finds that lane has no push surface. A guard that
 * passes because it found nothing to govern is the defect this repo keeps
 * finding.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');
const RUNNER_REL = 'scripts/selfheal/run_lane_selfheal.mjs';
const OUT_REL = 'artifacts/validation/lane-validation-pass-budget.json';
const PROVE = 'npm run validate:release';
const PUSH = /git\s+push\s+origin\s+HEAD:main/;
// A step body is the text between one `- name:`/`- uses:`/`- id:` marker and the
// next at the same depth - the same split validate_push_after_rebase_revalidates.js
// uses, so the two guards read the lane the same way.
const STEP_SPLIT = /\n(?=\s{6,}- (?:name|uses|id):)/;

const errors = [];

/** The file with every YAML/JS comment line removed, so prose about a fix cannot satisfy a check for the fix. */
function executableText(raw, commentPrefix) {
  const re = commentPrefix === '#' ? /^\s*#/ : /^\s*(\/\/|\*|\/\*)/;
  return raw
    .split('\n')
    .map((line) => (re.test(line) ? '' : line))
    .join('\n');
}

// --- A. the runner may not rehearse -----------------------------------------
const runnerAbs = path.join(ROOT, RUNNER_REL);
if (!fs.existsSync(runnerAbs)) {
  console.error(`LANE VALIDATION PASS BUDGET FAIL: ${RUNNER_REL} does not exist, so the arrangement this guard governs is UNKNOWN, not correct.`);
  process.exit(1);
}
const runnerText = executableText(fs.readFileSync(runnerAbs, 'utf8'), '//');
const previewPasses = [];
for (const token of ['selfheal:dry', '--dry-run', 'heal_until_clean.mjs --dry']) {
  let at = runnerText.indexOf(token);
  while (at >= 0) {
    previewPasses.push({ token, line: runnerText.slice(0, at).split('\n').length });
    at = runnerText.indexOf(token, at + token.length);
  }
}
for (const p of previewPasses) {
  errors.push(
    `preview_pass:${RUNNER_REL}:line_${p.line}: invokes \`${p.token}\`. A dry pass runs the whole profile and repairs nothing, ` +
    'so its only possible product is a preview - and the real pass one line later re-derives the same failure list from scratch. ' +
    'On 2026-09-12 the preview cost 478s of a 1800s job budget and disagreed with the pass it was previewing. Delete it; ' +
    '`npm run selfheal:dry` remains available to a human who wants a preview before letting the loop write.'
  );
}

// --- B/C. the release proof belongs where the push is ------------------------
if (!fs.existsSync(WORKFLOW_DIR)) {
  console.error('LANE VALIDATION PASS BUDGET FAIL: .github/workflows does not exist; nothing could be checked.');
  process.exit(1);
}
const files = fs.readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
if (!files.length) {
  console.error('LANE VALIDATION PASS BUDGET FAIL: no workflow files found; refusing to pass on an empty loop.');
  process.exit(1);
}

const lanes = [];
for (const file of files) {
  const raw = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
  const text = executableText(raw, '#');
  if (!text.includes(RUNNER_REL)) continue; // not a self-heal lane; other guards govern it

  const steps = text.split(STEP_SPLIT);
  const pushingSteps = steps.filter((s) => PUSH.test(s));
  const provesOutsidePush = [];
  let provesInsidePush = 0;

  for (const step of steps) {
    const count = step.split(PROVE).length - 1;
    if (!count) continue;
    if (PUSH.test(step)) { provesInsidePush += count; continue; }
    const label = (step.match(/-\s*(?:name|id):\s*(.+)/) || [, 'unnamed step'])[1].trim();
    provesOutsidePush.push({ label, count });
  }

  lanes.push({
    file,
    pushing_steps: pushingSteps.length,
    release_proofs_in_pushing_step: provesInsidePush,
    release_proofs_outside_pushing_step: provesOutsidePush,
  });

  if (!pushingSteps.length) {
    errors.push(
      `${file}:no_push_surface: runs ${RUNNER_REL} but contains no executable \`git push origin HEAD:main\`. ` +
      'This guard budgets validation passes against the push they protect and found no push to protect, so the lane is UNKNOWN, not correct.'
    );
    continue;
  }
  for (const p of provesOutsidePush) {
    errors.push(
      `${file}:discarded_proof:${p.label}: runs \`${PROVE}\` in a step that does not push. ` +
      'The pushing step fetches and rebases onto origin/main after this, so - by the rule push-after-rebase-revalidates already enforces - ' +
      'this pass proves a tree that is not the tree reaching main, and the pushing step has to prove it again anyway. ' +
      'Two release-profile passes is how this lane hit timeout-minutes: 30 on 2026-09-11 and 2026-09-12. Keep the one at the push.'
    );
  }
  if (!provesInsidePush) {
    errors.push(
      `${file}:unproven_push: its pushing step never runs \`${PROVE}\`. Trimming passes may not cost the lane its unassisted ` +
      'release-profile proof; the tree that reaches main must be proven by the step that pushes it.'
    );
  }
}

if (!lanes.length) {
  errors.push(
    `found zero workflows invoking ${RUNNER_REL} across ${files.length} workflow file(s). This guard exists to budget the ` +
    'validation passes of the self-heal lane; examining none of them is not a pass.'
  );
}

const report = {
  schema_version: '1.0',
  validator: 'lane-validation-pass-budget',
  status: errors.length ? 'FAIL' : 'PASS',
  workflows_examined: files.length,
  selfheal_lanes_examined: lanes.length,
  runner: RUNNER_REL,
  runner_preview_passes: previewPasses,
  lanes,
  errors,
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  for (const e of errors) console.error(`LANE VALIDATION PASS BUDGET FAIL: ${e}`);
  console.error(`LANE VALIDATION PASS BUDGET: FAIL - ${lanes.length} self-heal lane(s) in ${files.length} workflow(s). Report: ${OUT_REL}`);
  process.exit(1);
}
console.log(
  `LANE VALIDATION PASS BUDGET PASS: ${lanes.length} self-heal lane(s) across ${files.length} workflow(s); ` +
  `no preview pass in ${RUNNER_REL}, and every \`${PROVE}\` runs in the step that pushes the tree it proves.`
);
