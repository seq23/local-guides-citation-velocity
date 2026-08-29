#!/usr/bin/env node
'use strict';
/**
 * Advance the occupancy reading high-water mark. It only ever goes up.
 *
 * Why this exists
 * ---------------
 * data/signals/query_class_occupancy.json is a rolling-window measurement file.
 * Every row in it cost a grounded provider call, and the file is the only place
 * those calls survive. On 2026-08-29 a scheduled run rewrote it without --merge
 * and 205 recorded readings became 36: 170 paid measurements deleted by a run
 * that exited 0 and reported success. The missing --merge was fixed the same
 * day, and the file was NOT rehydrated - the code stopped bleeding and nobody
 * noticed the blood was already gone, because nothing in the repo knew how many
 * readings there were supposed to be.
 *
 * That is the gap this closes. A count that is only ever implied by the file
 * itself cannot detect the file shrinking. So the count is recorded separately,
 * it only ratchets upward, and validate_occupancy_reading_ratchet.js hard-fails
 * when the measurement file falls below it.
 *
 * A query may legitimately leave the panel. That is a decision a human makes and
 * records, not something a run does quietly: drop it into `retired_queries` with
 * a reason and the ratchet stops expecting it. An unexplained disappearance
 * stays a failure.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SIGNAL = path.join(ROOT, 'data/signals/query_class_occupancy.json');
const RATCHET = path.join(ROOT, 'data/signals/query_class_occupancy_highwater.json');

if (!fs.existsSync(SIGNAL)) {
  console.error(`occupancy ratchet: ${path.relative(ROOT, SIGNAL)} is missing. Refusing to advance a high-water mark from a file that is not there.`);
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(SIGNAL, 'utf8'));
const probes = Array.isArray(doc.probes) ? doc.probes : [];
if (!probes.length) {
  console.error('occupancy ratchet: the measurement file holds zero probes. Refusing to ratchet on an empty file - that is the state this guard exists to catch, not to bless.');
  process.exit(1);
}

const prior = fs.existsSync(RATCHET)
  ? JSON.parse(fs.readFileSync(RATCHET, 'utf8'))
  : { schema_version: '1.0', high_water_probes: 0, high_water_queries: [], retired_queries: [] };

const retired = new Set((prior.retired_queries || []).map((r) => (typeof r === 'string' ? r : r.query)));
const current = probes.map((p) => p.query).filter(Boolean);
const priorQueries = (prior.high_water_queries || []).filter((q) => !retired.has(q));

// The mark is the union: a query that was measured once is expected to keep a
// reading, and a query measured for the first time today joins the expectation.
const union = Array.from(new Set([...priorQueries, ...current])).sort();
const added = current.filter((q) => !priorQueries.includes(q));

const next = {
  schema_version: '1.0',
  note: 'High-water mark for data/signals/query_class_occupancy.json. Only ever increases. A query that legitimately leaves the panel must be listed in retired_queries with a reason; an unexplained disappearance is a destroyed paid measurement and validate_occupancy_reading_ratchet.js fails on it.',
  high_water_probes: Math.max(Number(prior.high_water_probes) || 0, union.length),
  high_water_queries: union,
  retired_queries: prior.retired_queries || [],
  last_advanced_at: new Date().toISOString(),
  last_advance_added: added.length
};

fs.writeFileSync(RATCHET, JSON.stringify(next, null, 2) + '\n');
console.log(`occupancy ratchet: high water ${prior.high_water_probes || 0} -> ${next.high_water_probes} expected readings (${added.length} newly measured quer(y|ies) added, ${next.retired_queries.length} retired by explicit decision).`);
