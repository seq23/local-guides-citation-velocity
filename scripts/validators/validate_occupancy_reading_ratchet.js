#!/usr/bin/env node
'use strict';
/**
 * The occupancy measurement file may not shrink.
 *
 * On 2026-08-29 a scheduled run rewrote data/signals/query_class_occupancy.json
 * without --merge. 205 recorded readings became 36. The run exited 0 and
 * reported success; 170 grounded provider calls were deleted. The missing
 * --merge was fixed hours later, but the file itself stayed at 36 for the rest
 * of the day, because nothing in the repo knew how many readings there were
 * supposed to be. A rolling-window file whose only record of its own depth is
 * the file itself cannot notice that it has been truncated.
 *
 * So the expected depth lives outside the file, in
 * data/signals/query_class_occupancy_highwater.json, it only ratchets upward,
 * and this validator hard-fails when the measurement file falls below it or
 * when a query that once had a reading no longer does.
 *
 * A query may legitimately leave the panel. That is a human decision, recorded
 * in `retired_queries` with a reason. An unexplained disappearance is a
 * destroyed paid measurement and fails here.
 *
 * Rule 0: it hard-fails if it examines zero readings or has no mark to check
 * against. A ratchet that passes because there was nothing to compare is the
 * defect it is hunting.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SIGNAL_REL = 'data/signals/query_class_occupancy.json';
const RATCHET_REL = 'data/signals/query_class_occupancy_highwater.json';

const problems = [];
const read = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { problems.push(`missing ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { problems.push(`unreadable JSON: ${rel} (${e.message})`); return null; }
};

const doc = read(SIGNAL_REL);
const mark = read(RATCHET_REL);

const probes = (doc && Array.isArray(doc.probes)) ? doc.probes : [];
const current = new Set(probes.map((p) => p && p.query).filter(Boolean));

// ------------------------------------------------------------------- Rule 0
if (!probes.length) {
  problems.push(`${SIGNAL_REL} holds zero probes. This validator examined nothing and must not pass on an empty loop - an emptied measurement file is exactly the failure it exists to catch.`);
}
if (mark && !Array.isArray(mark.high_water_queries)) {
  problems.push(`${RATCHET_REL} carries no high_water_queries array, so there is no mark to check the measurement file against.`);
}
if (mark && Array.isArray(mark.high_water_queries) && mark.high_water_queries.length === 0) {
  problems.push(`${RATCHET_REL} records a high water of zero queries. A ratchet that expects nothing can never catch a truncation; run "npm run occupancy:ratchet" to record the readings that exist.`);
}

let expected = [];
let retiredSet = new Set();
if (mark && Array.isArray(mark.high_water_queries)) {
  const retiredRaw = Array.isArray(mark.retired_queries) ? mark.retired_queries : [];
  for (const r of retiredRaw) {
    if (typeof r === 'string') {
      problems.push(`${RATCHET_REL}: retired query "${r}" carries no reason. Retiring a measured query is a decision a human takes and names; a bare string is an unexplained drop wearing a permission slip. Use {"query": "...", "reason": "..."}.`);
      retiredSet.add(r);
      continue;
    }
    if (!r || !r.query) { problems.push(`${RATCHET_REL}: a retired_queries entry has no query field.`); continue; }
    if (!r.reason) problems.push(`${RATCHET_REL}: retired query "${r.query}" carries no reason.`);
    retiredSet.add(r.query);
  }
  expected = mark.high_water_queries.filter((q) => !retiredSet.has(q));
}

// ------------------------------------------- the ratchet itself
const missing = expected.filter((q) => !current.has(q));
if (missing.length) {
  problems.push(
    `${SIGNAL_REL} has lost ${missing.length} reading(s) that it previously held and that were never retired. Each one is a grounded provider call that has been deleted, not a query that was skipped. ` +
    `First 5: ${missing.slice(0, 5).map((q) => JSON.stringify(q)).join(', ')}. ` +
    `If a run truncated the file, restore it (the readings are re-derivable from a prior commit with --rescore-only, without paying again) - do not advance the mark to match the damage. ` +
    `If these queries were deliberately dropped, record each in ${RATCHET_REL} retired_queries with a reason.`
  );
}

if (mark && typeof mark.high_water_probes === 'number') {
  const floor = mark.high_water_probes - retiredSet.size;
  if (probes.length < floor) {
    problems.push(`${SIGNAL_REL} holds ${probes.length} probes against a high-water mark of ${mark.high_water_probes} (${retiredSet.size} retired, so the floor is ${floor}). The measurement file has shrunk.`);
  }
} else if (mark) {
  problems.push(`${RATCHET_REL} carries no numeric high_water_probes.`);
}

const report = {
  schema_version: '1.0',
  validator: 'occupancy-reading-ratchet',
  status: problems.length ? 'FAIL' : 'PASS',
  probes_examined: probes.length,
  high_water_probes: mark ? mark.high_water_probes : null,
  expected_queries: expected.length,
  retired_queries: retiredSet.size,
  missing_readings: missing.length,
  problems,
  checked_at: new Date().toISOString()
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/occupancy-reading-ratchet.json'), JSON.stringify(report, null, 2) + '\n');

if (problems.length) {
  console.error('OCCUPANCY READING RATCHET FAIL:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OCCUPANCY READING RATCHET PASS: ${probes.length} readings held against a high-water mark of ${mark.high_water_probes}; ${expected.length} quer(y|ies) expected to carry a reading, all present; ${retiredSet.size} retired by explicit named decision.`);
