#!/usr/bin/env node
/**
 * The occupancy instrument's own control check, made binding.
 *
 * Why this exists as a hard gate
 * ------------------------------
 * data/signals/query_class_occupancy.json carries a control pair: one query
 * known to be OPEN and one known to be CLOSED. The pair exists to prove the
 * instrument measures what it claims. It measured control_known_closed at 1.00
 * and control_known_open at 0.50 - the closed query read as MORE open than the
 * open one - and the run passed. The inversion was, at best, printed as a note.
 * A note does not stop a wrong number: scripts/queries/join_atlas_to_release_queue.mjs
 * RANKS publishing candidates by that number, and five pages were queued off it.
 *
 * The root cause was that "unbranded" - the bucket the number was computed from -
 * was a blind else-branch. Any host the probe did not recognise counted as open
 * ground, so incumbent local practices, provider directories and institutional
 * sites all inflated openness. That is fixed in
 * scripts/queries/host_occupancy_classifier.js: open is now a positively
 * recognised bucket and an unrecognised host is unclassifiable and CLOSED.
 *
 * What this validator asserts, on the data and independently of the probe:
 *
 *   1. The control pair is present and does not INVERT. An inversion is a hard
 *      FAIL, not a note.
 *   2. No unrecognised host is counted as open. Every host is re-classified here
 *      with the shared classifier and the recorded open counts must match; an
 *      open slot must additionally carry a positive open reason.
 *   3. A number is published only while the controls separate. If they do not,
 *      citation_occupancy must be withheld (null on every probe) with a named
 *      signal_status stop - not left in place looking meaningful.
 *   4. The unclassifiable count is published on every run.
 *
 * Rule 0: it hard-fails if it examines zero queries or zero controls. A
 * validator that passes on an empty loop is the defect it is hunting.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SIGNAL = 'data/signals/query_class_occupancy.json';
const CLASSIFIER = 'scripts/queries/host_occupancy_classifier.js';

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const readJson = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail(`missing ${rel}`); return null; }
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { fail(`unreadable JSON: ${rel} (${e.message})`); return null; }
};

const doc = readJson(SIGNAL);
const probeConfig = readJson('data/signals/citation_probe_config.json') || {};
const strategyRegistry = readJson('data/strategy/page_strategy_registry.json') || {};

let classify = null;
try {
  const { createClassifier } = require(path.join(ROOT, CLASSIFIER));
  const built = createClassifier({ owned: probeConfig.owned_domains || [], strategyRegistry });
  if (!built.vocabularyAvailable) fail(`${CLASSIFIER} could not build its governed service vocabulary from data/strategy/page_strategy_registry.json, so it classifies every host as unclassifiable and nothing below can be checked.`);
  classify = built.classify;
} catch (e) {
  fail(`${CLASSIFIER} could not be loaded (${e.message}); the probe's classification cannot be independently reproduced.`);
}

const probes = (doc && Array.isArray(doc.probes)) ? doc.probes : [];

// ------------------------------------------------------------------- Rule 0
if (!probes.length) {
  fail(`${SIGNAL} holds zero probes. This validator examined nothing and must not pass on an empty loop.`);
}

// ------------------------------------------- (2) nothing unrecognised is open
// Declared open reasons. An open slot must name one of these; "we ran out of
// tests" is not one of them, and never can be, because the string has to be
// written by a branch that positively recognised something.
const OPEN_REASONS = new Set(['FREE_BLOG_OR_CONTENT_FARM', 'PARKED_OR_DEAD_DOMAIN', 'CDN_OR_ASSET_HOST_NOT_A_PAGE']);
let hostsExamined = 0;
let openExamined = 0;
let unclassifiableExamined = 0;

if (classify) {
  for (const p of probes) {
    const q = p && p.query;
    const hosts = (p && p.cited_hosts_in_order) || [];
    if (!q) { fail('probe with no query string'); continue; }
    if (!hosts.length) { fail(`probe recorded with no cited hosts, so its shares are underivable: ${q}`); continue; }

    const marks = hosts.map((h) => classify(h));
    hostsExamined += marks.length;
    const recomputedOpen = marks.filter((m) => m.open).length;
    const recomputedUnclassifiable = marks.filter((m) => m.kind === 'unclassifiable').length;
    openExamined += recomputedOpen;
    unclassifiableExamined += recomputedUnclassifiable;

    for (const m of marks) {
      if (m.kind === 'unclassifiable' && m.open) {
        fail(`an unrecognised host is marked open, which is exactly the fallthrough this replaced: ${m.name} on "${q}"`);
      }
      if (m.open && !OPEN_REASONS.has(m.why)) {
        fail(`host ${m.name} on "${q}" is counted OPEN with reason "${m.why}", which is not one of the declared positive open reasons (${[...OPEN_REASONS].join(', ')}). Open must be earned by recognition, never reached by falling through.`);
      }
    }

    if (typeof p.open_slots !== 'number' || p.open_slots !== recomputedOpen) {
      fail(`recorded open_slots (${p.open_slots}) does not match the ${recomputedOpen} this validator derives from the recorded hosts: ${q}`);
    }
    if (typeof p.unclassifiable_slots !== 'number' || p.unclassifiable_slots !== recomputedUnclassifiable) {
      fail(`recorded unclassifiable_slots (${p.unclassifiable_slots}) does not match the ${recomputedUnclassifiable} derived from the recorded hosts: ${q}`);
    }
    const expectedOpenShare = +(recomputedOpen / marks.length).toFixed(2);
    if (p.open_share !== expectedOpenShare) {
      fail(`recorded open_share ${p.open_share} does not match ${expectedOpenShare} derived from the recorded hosts: ${q}`);
    }
    if (Object.prototype.hasOwnProperty.call(p, 'unbranded_share')) {
      fail(`the retired unbranded_share field is back on a probe. It was the blind-fallthrough number: ${q}`);
    }
  }
}
if (hostsExamined === 0) fail('examined zero cited hosts - refusing to pass on an empty loop.');

// -------------------------------------------- (1) the control pair, made binding
const sep = doc && doc.control_check && doc.control_check.separation;
const controlRows = probes.filter((p) => String((p && p.role) || '').startsWith('control_'));
const openCtl = controlRows.find((c) => c.role === 'control_known_open');
const closedCtl = controlRows.find((c) => c.role === 'control_known_closed');

if (!controlRows.length) {
  fail(`${SIGNAL} carries zero control probes. With no control pair the instrument cannot be checked against a known result, and "no controls, therefore nothing failed" is an empty-loop pass.`);
}
if (!openCtl) fail(`${SIGNAL} carries no control_known_open probe.`);
if (!closedCtl) fail(`${SIGNAL} carries no control_known_closed probe.`);
if (!sep) {
  fail(`${SIGNAL} records no control_check.separation, so nothing states whether the two known classes separate.`);
}

let separated = null;
if (openCtl && closedCtl && sep) {
  const known_open = openCtl.open_share;
  const known_closed = closedCtl.open_share;
  if (typeof known_open !== 'number' || typeof known_closed !== 'number') {
    fail('a control probe carries no numeric open_share, so the separation cannot be recomputed.');
  } else {
    if (sep.known_open !== known_open || sep.known_closed !== known_closed) {
      fail(`control_check.separation reports known_open=${sep.known_open}/known_closed=${sep.known_closed}, but the control probes carry ${known_open}/${known_closed}. The published separation is not the one measured.`);
    }
    // THE HARD GATE. An inversion means the instrument reads backwards.
    if (known_closed > known_open) {
      fail(`CONTROL PAIR INVERTED: the query known to be CLOSED ("${closedCtl.query}") measured ${known_closed}, MORE open than the query known to be OPEN ("${openCtl.query}") at ${known_open}. The instrument is reading backwards and every number derived from it is wrong. This is a FAIL, not a note - it was a note once, and five pages were queued for publication off the numbers it did not stop.`);
    }
    const margin = +(known_open - known_closed).toFixed(2);
    const minimum = typeof sep.minimum_separation === 'number' ? sep.minimum_separation : 0.10;
    separated = margin >= minimum;
    if (sep.separated !== separated) {
      fail(`control_check.separation.separated=${sep.separated} disagrees with the margin actually measured (${margin} against a minimum of ${minimum}).`);
    }
  }
}

// ------------------------------- (3) a number is published only when validated
const status = doc && doc.signal_status;
if (!status || typeof status.published !== 'boolean') {
  fail(`${SIGNAL} carries no signal_status.published. Whether citation_occupancy is entitled to be read as winnability must be stated in the file, not inferred by each consumer.`);
} else if (separated === false && status.published) {
  fail(`${SIGNAL} publishes citation_occupancy while its control pair does not separate (known_open=${sep.known_open}, known_closed=${sep.known_closed}). A number the controls say is not measuring winnability must be withheld behind a named stop, not left in place looking meaningful.`);
} else if (separated === true && !status.published) {
  fail(`${SIGNAL} withholds citation_occupancy although its control pair separates. A working instrument must not be silently stopped.`);
}

if (status && status.published === false) {
  if (!status.reason) fail(`${SIGNAL}: signal_status.published is false with no named reason. An unnamed stop is the silence this repo keeps finding.`);
  for (const p of probes) {
    if (p.citation_occupancy !== null) {
      fail(`${SIGNAL}: signal_status says the signal is withheld, but probe "${p.query}" still carries citation_occupancy=${p.citation_occupancy}. A withheld number must actually be absent, or every consumer keeps reading it.`);
      break;
    }
  }
  if (doc.summary && doc.summary.mean_citation_occupancy !== null) {
    fail(`${SIGNAL}: the signal is withheld but summary.mean_citation_occupancy is ${doc.summary.mean_citation_occupancy}. A withheld signal must not be republished as an average.`);
  }
} else if (status && status.published === true) {
  for (const p of probes) {
    if (typeof p.citation_occupancy !== 'number' || p.citation_occupancy !== p.open_share) {
      fail(`${SIGNAL}: signal is published but probe "${p.query}" carries citation_occupancy=${p.citation_occupancy} against open_share=${p.open_share}.`);
      break;
    }
  }
}

// --------------------------------- (4) the unclassifiable count, every run
const summary = (doc && doc.summary) || {};
if (typeof summary.unclassifiable_slots !== 'number') {
  fail(`${SIGNAL}: summary.unclassifiable_slots is not published. An unrecognised host is counted CLOSED so it cannot inflate openness, but how much of the channel this classifier cannot identify is itself a finding and must be on every run.`);
} else if (summary.unclassifiable_slots !== unclassifiableExamined) {
  fail(`${SIGNAL}: summary.unclassifiable_slots is ${summary.unclassifiable_slots}, but ${unclassifiableExamined} slots re-classify as unclassifiable.`);
}
if (typeof summary.unclassifiable_slot_share !== 'number') {
  fail(`${SIGNAL}: summary.unclassifiable_slot_share is not published.`);
} else if (summary.unclassifiable_slot_share >= 0.5) {
  notes.push(`${(summary.unclassifiable_slot_share * 100).toFixed(1)}% of citation slots could not be identified. That is most of the channel, and every one of them is being counted as closed - the shares below are a floor on openness, not a measurement of it.`);
}

// -------------------------------------------------------------------- verdict
if (problems.length) {
  console.error('OCCUPANCY CONTROL SEPARATION FAIL:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OCCUPANCY CONTROL SEPARATION PASS: ${probes.length} probes / ${hostsExamined} citation slots re-classified; controls known_open=${sep.known_open} known_closed=${sep.known_closed} (margin ${sep.margin}, separated=${sep.separated}, inverted=false); citation_occupancy ${status.published ? 'PUBLISHED' : `WITHHELD (${status.reason})`}; ${openExamined} slot(s) counted open, all positively recognised; ${unclassifiableExamined} unclassifiable slot(s) (${summary.unclassifiable_slot_share}) counted CLOSED.`);
for (const n of notes) console.log(`  NOTE: ${n}`);
