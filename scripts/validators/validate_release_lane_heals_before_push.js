#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Every push surface in the release lane heals first, then proves it unhealed.
 *
 * velocity-content-release.yml has FOUR release-profile gates: the absorption
 * checkpoint, two re-derives inside the absorption rebase loop, and the final Velocity
 * push. On 2026-09-03 the fourth was changed from a raw `npm run validate:release` to
 * `npm run selfheal:release` because a raw gate HARD_FAILed on a healthy publish three
 * separate times in one day, each on a validator that DECLARES a repair the lane simply
 * never ran. The other three were left as they were.
 *
 * That is the defect this guard exists for, and it duly recurred. On 2026-09-04 the
 * absorption checkpoint - gate one, the one that runs first and most often - died on
 * agent-run-delivery-coverage: normalizing the landed run wrote 51 recommendations into
 * the ledger, 3 of them were not yet shown by the page they named, and a run with no
 * entry in that shrink-only ratchet must have zero gaps. Its repair
 * (recover:run-delivery-coverage-ratchet) was registered and unreachable, because the
 * step that would have delivered those 3 recommendations runs AFTER the gate that
 * refused to let the lane get there. The lane could not reach the work that closes its
 * own gate, and nothing retried: this workflow triggers on a new manifest and that
 * manifest had already landed. Four consecutive red runs, one per attempt.
 *
 * "Fixed in one of N places" is the recurring shape, so this guard holds all N. For
 * every `git push` in the lane it requires, in the executable text before it and with
 * comments stripped:
 *
 *   - `npm run selfheal:release` - so a failure with a registered repair is repaired
 *     rather than paging a human; and
 *   - `npm run validate:release` AFTER it - an unassisted release-profile pass on the
 *     healed tree, so "self-heal said it was fine" is never the last word, and so
 *     workflow-data-trace's push gate is satisfied by code rather than by the words
 *     appearing in a comment.
 *
 * Neither is a weakening. Self-heal runs the same release profile, every validator
 * still blocks, and it exits non-zero when a failure has no repair or the repair does
 * not clear it - proved by self-heal-repair-contract and repair-command-efficacy.
 *
 * Rule 0: a lane with no push surface, or with no gates, is a FAILURE here. This
 * validator examining zero pushes means the arrangement is UNKNOWN, not correct.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LANE_REL = '.github/workflows/velocity-content-release.yml';
const OUT_REL = 'artifacts/validation/release-lane-heals-before-push.json';
const HEAL = 'npm run selfheal:release';
const PROVE = 'npm run validate:release';

/**
 * The workflow with every YAML comment removed.
 *
 * This lane documents its own history in prose, and that prose quotes the very command
 * names asserted here. A guard that reads comments can be satisfied by writing about
 * the fix instead of making it - which is how the final push step passed
 * workflow-data-trace while three sibling gates were unhealed.
 */
function executableText(raw) {
  return raw
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line))
    .join('\n');
}

const abs = path.join(ROOT, LANE_REL);
if (!fs.existsSync(abs)) {
  console.error(`RELEASE LANE HEALS BEFORE PUSH FAIL: ${LANE_REL} does not exist. The lane this guard governs is missing; its arrangement is UNKNOWN, not correct.`);
  process.exit(1);
}
const raw = fs.readFileSync(abs, 'utf8');
const text = executableText(raw);

const pushes = [];
let idx = text.indexOf('git push');
while (idx >= 0) {
  pushes.push(idx);
  idx = text.indexOf('git push', idx + 1);
}

if (!pushes.length) {
  console.error(`RELEASE LANE HEALS BEFORE PUSH FAIL: ${LANE_REL} contains no executable \`git push\`, so this validator examined zero push surfaces. Either the lane no longer publishes - in which case this guard and the lane's contract both need rewriting deliberately - or the push is hidden behind an action this guard cannot read.`);
  process.exit(1);
}

const errors = [];

// Every gate, not just the nearest one to a push.
//
// The first draft of this guard asked "is there a selfheal before this push", which is
// satisfied by ONE healed gate out of four - the exact state that shipped on 2026-09-03
// and failed on 2026-09-04. A guard that passes while three of the gates it exists to
// hold are still raw is inert. So the lane's gates are read as an ordered sequence and
// must alternate strictly: heal, prove, heal, prove. A raw gate anywhere in the lane is
// an unpaired `validate:release`, and a heal whose result is never proved unassisted is
// an unpaired `selfheal:release`. Both are failures.
const gates = [];
for (const [token, kind] of [[HEAL, 'HEAL'], [PROVE, 'PROVE']]) {
  let at = text.indexOf(token);
  while (at >= 0) {
    // `npm run selfheal:release` contains no occurrence of `npm run validate:release`,
    // so the two scans cannot double-count the same characters.
    gates.push({ kind, at, line: text.slice(0, at).split('\n').length });
    at = text.indexOf(token, at + token.length);
  }
}
gates.sort((a, b) => a.at - b.at);

if (!gates.length) {
  console.error(`RELEASE LANE HEALS BEFORE PUSH FAIL: ${LANE_REL} runs no release-profile gate at all (neither \`${HEAL}\` nor \`${PROVE}\`), so this validator examined zero gates. An ungated lane is not a passing lane.`);
  process.exit(1);
}

for (let i = 0; i < gates.length; i += 1) {
  const expected = i % 2 === 0 ? 'HEAL' : 'PROVE';
  if (gates[i].kind !== expected) {
    if (expected === 'HEAL') {
      errors.push(`raw_gate:line_${gates[i].line}: \`${PROVE}\` runs with no \`${HEAL}\` before it. A release-profile validator that declares a repair stops this lane instead of being repaired - the 2026-09-04 absorption-checkpoint failure - so every gate heals first.`);
    } else {
      errors.push(`unproven_heal:line_${gates[i].line}: \`${HEAL}\` is not followed by an unassisted \`${PROVE}\`. Self-heal's own re-validation is the one it just repaired into passing; the tree reaching main needs a pass nobody helped.`);
    }
  }
}
if (gates.length % 2 !== 0) {
  const last = gates[gates.length - 1];
  errors.push(`unpaired_final_gate:line_${last.line}:kind=${last.kind}: the lane's gates must come in heal-then-prove pairs; this one has no partner.`);
}

const surfaces = [];
for (const pushPos of pushes) {
  const pairsBefore = gates.filter((g) => g.at < pushPos);
  const healsBefore = pairsBefore.filter((g) => g.kind === 'HEAL').length;
  const provesBefore = pairsBefore.filter((g) => g.kind === 'PROVE').length;
  const surface = {
    push_at_line: text.slice(0, pushPos).split('\n').length,
    heals_before: healsBefore,
    unassisted_proofs_before: provesBefore,
  };
  surfaces.push(surface);
  if (!healsBefore || !provesBefore) {
    errors.push(`push_without_gate:line_${surface.push_at_line}: reached with ${healsBefore} heal(s) and ${provesBefore} unassisted proof(s) before it. Nothing may reach main through this lane ungated.`);
  }
}

const report = {
  schema_version: '1.0',
  validator: 'release-lane-heals-before-push',
  status: errors.length ? 'FAIL' : 'PASS',
  lane: LANE_REL,
  gates_examined: gates.length,
  gates,
  push_surfaces_examined: surfaces.length,
  surfaces,
  errors,
};
fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  for (const e of errors) console.error(`RELEASE LANE HEALS BEFORE PUSH FAIL: ${e}`);
  console.error(`RELEASE LANE HEALS BEFORE PUSH: FAIL - ${gates.length} gate(s) and ${surfaces.length} push surface(s) examined in ${LANE_REL}. Report: ${OUT_REL}`);
  process.exit(1);
}
console.log(`RELEASE LANE HEALS BEFORE PUSH PASS: ${gates.length / 2} heal-then-prove gate pair(s) guarding ${surfaces.length} push surface(s) in ${LANE_REL}; no raw \`${PROVE}\` and no unproven \`${HEAL}\`.`);
