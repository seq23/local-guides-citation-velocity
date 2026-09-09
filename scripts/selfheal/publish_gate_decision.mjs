#!/usr/bin/env node
// The publish gate rule, in one place, applied at every gate.
//
// #100 stopped a repair-less validator holding the SELF-HEAL gate. It did not stop one
// holding the gate immediately after it: velocity-content-release.yml runs
//
//     npm run selfheal:release      <- #100 applies here
//     npm run validate:release      <- raw, and this is a second gate
//
// A raw `validate:release` exits non-zero on ANY HARD_FAIL, repair or no repair, and
// under `bash -e` that ends the step. So on 2026-09-09 run 34397693915,
// removal-directive-not-published - which has no registered repair and was therefore
// correctly excluded from the self-heal gate - failed the step anyway, three attempts in
// a row, and the publish did not land. The net had two openings and #100 closed one.
//
// This is the same rule, factored out so both call sites share it and a third cannot
// drift: after the unassisted re-validation, the run may publish only if every remaining
// failure is one no repair could ever have cleared. A failure with a repair still blocks,
// because the loop was supposed to have fixed it and did not.
//
// It is not a way to pass. It reads the summary the validators just wrote, it never runs
// them, and it never rewrites a verdict. Every failure it finds is printed by name.
//
// Usage: node scripts/selfheal/publish_gate_decision.mjs --profile release
// Exit 0 = publishable. Exit 1 = a repairable validator is still failing, or the summary
// could not be read, which is UNKNOWN and never a pass.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--profile');
const PROFILE = i >= 0 && argv[i + 1] ? argv[i + 1] : 'release';

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, '_validation_registry.json'), 'utf8'));
const repairFor = new Map(
  (registry.validators || []).filter((v) => v.repair_command).map((v) => [v.id, v.repair_command]),
);

function summary() {
  for (const rel of [`artifacts/validation/validation-summary-${PROFILE}.json`, 'artifacts/validation/validation-summary.json']) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { /* next */ }
  }
  return null;
}

const doc = summary();
if (!doc || !Array.isArray(doc.results)) {
  console.error(`PUBLISH GATE DECISION FAIL: no readable validation summary for profile "${PROFILE}", so which validators failed is UNKNOWN. Refusing to call this publishable.`);
  process.exit(1);
}

const failed = doc.results.filter((r) => r.status === 'FAIL').map((r) => r.id);
if (!failed.length) {
  console.log(`PUBLISH GATE DECISION: profile "${PROFILE}" has no failures; publishable.`);
  process.exit(0);
}

const blocking = failed.filter((id) => repairFor.has(id));
const reportOnly = failed.filter((id) => !repairFor.has(id));

console.error('');
for (const id of reportOnly) console.error(`  FAILING, NOT BLOCKING: ${id} - no registered repair, so no run could ever clear it here`);
for (const id of blocking) console.error(`  FAILING AND BLOCKING:  ${id} - repair "${repairFor.get(id)}" ran and did not clear it`);

if (blocking.length) {
  console.error(`PUBLISH GATE DECISION FAIL: ${blocking.length} repairable validator(s) still failing after their repairs ran. Not publishable.`);
  process.exit(1);
}
console.error(
  `PUBLISH GATE DECISION: ${reportOnly.length} validator(s) failed and none has a registered repair, so none could be `
  + 'cleared by this run. They remain HARD_FAIL in validate:release and block merges to main; what they no longer do is '
  + 'strand a publish they cannot unblock. Publishing.',
);
console.error('');
process.exit(0);
