#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The governor must not be reasoning from a snapshot nobody took.
 *
 * `data/authority_scale/velocity_health.json` decides whether the publication ceiling
 * may rise. It was created on 2026-08-10 with every gate UNKNOWN and NOTHING EVER WROTE
 * IT AGAIN - three scripts read it, zero produced it. Because "UNKNOWN never means
 * PASS", the upshift branch of evaluate_velocity.mjs was unreachable by construction,
 * and the ceiling sat at 2 new URLs/day for seven weeks while cleared pages were
 * released one per day. The ladder had no rung reachable from below.
 *
 * A file that only one script writes, and that nothing checks, silently reverts to that
 * state the first time someone forgets to run the measurer. So this asserts, on every
 * release:
 *
 *   1. the snapshot was actually MEASURED - `measured_by` names the producer, and
 *      `as_of` is a real timestamp. A hand-edited file with no producer is refused.
 *   2. it is FRESH. A snapshot older than MAX_AGE_DAYS is stale evidence, and stale
 *      evidence must not move a publication ceiling.
 *   3. every gate that reads UNKNOWN says WHY, in gates_still_unknown. An unexplained
 *      UNKNOWN is indistinguishable from a measurement that never ran - which is
 *      precisely how this file came to sit untouched for seven weeks.
 *   4. every gate carries an evidence_sources entry naming what was read.
 *
 * It deliberately does NOT require any gate to be green. UNKNOWN holding the tier is
 * correct behaviour; what is not correct is UNKNOWN because nobody looked.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HEALTH = 'data/authority_scale/velocity_health.json';
const PRODUCER = 'scripts/authority_scale/measure_velocity_health.mjs';
const MAX_AGE_DAYS = 14;
const GATES = [
  'validation_status',
  'semantic_duplicate_status',
  'distribution_status',
  'indexation_status',
  'observed_yield_trend',
  'source_claim_status',
];

const errors = [];
let health;
try { health = JSON.parse(fs.readFileSync(path.join(ROOT, HEALTH), 'utf8')); }
catch (e) {
  console.error(`VELOCITY HEALTH FAIL: ${HEALTH} could not be read (${e.message}). The governor cannot reason about a snapshot that is not there.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, PRODUCER))) {
  errors.push(`producer_missing: ${PRODUCER} does not exist, so nothing can measure this file. That is the state this validator exists to prevent.`);
}
if (health.measured_by !== PRODUCER) {
  errors.push(`not_measured: measured_by is ${JSON.stringify(health.measured_by)}, expected ${PRODUCER}. A snapshot with no named producer is a hand-edit, and a hand-edited health file can move a publication ceiling on nobody's evidence.`);
}

const asOf = Date.parse(health.as_of || '');
if (!Number.isFinite(asOf)) {
  errors.push('no_as_of: as_of is missing or unparseable. A snapshot with no timestamp cannot be shown to describe the current tree.');
} else {
  const ageDays = (Date.now() - asOf) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS) {
    errors.push(`stale_snapshot: as_of is ${Math.round(ageDays)} day(s) old (limit ${MAX_AGE_DAYS}). Stale evidence must not move a publication ceiling. Run \`npm run measure:velocity-health\`.`);
  }
}

const sources = health.evidence_sources || {};
const unknownNotes = Array.isArray(health.gates_still_unknown) ? health.gates_still_unknown.join('\n').toLowerCase() : '';
let measured = 0;
let unknown = 0;
for (const gate of GATES) {
  const value = health[gate];
  if (value === undefined) { errors.push(`gate_missing: ${gate} is absent from the snapshot.`); continue; }
  if (!sources[gate]) {
    errors.push(`gate_has_no_evidence_source: ${gate} reads ${value} but evidence_sources names nothing that was read for it.`);
  }
  if (String(value).toUpperCase() === 'UNKNOWN') {
    unknown += 1;
    if (!unknownNotes.includes(gate)) {
      errors.push(`unexplained_unknown: ${gate} is UNKNOWN and gates_still_unknown does not say why. An unexplained UNKNOWN is indistinguishable from a measurement that never ran.`);
    }
  } else measured += 1;
}

// Rule 0: examining zero gates is a failure, not a pass.
if (measured + unknown === 0) {
  errors.push('zero_gates_examined: the snapshot declares no gates at all, so this check proved nothing.');
}

if (errors.length) {
  console.error(`VELOCITY HEALTH FAIL (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `VELOCITY HEALTH MEASURED PASS: ${GATES.length} gate(s) declared, ${measured} carrying real evidence and `
  + `${unknown} UNKNOWN with a stated reason; snapshot taken ${health.as_of} by ${health.measured_by}. `
  + 'UNKNOWN holding the tier is correct; UNKNOWN because nobody looked is what this refuses.',
);
