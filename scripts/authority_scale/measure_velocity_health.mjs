#!/usr/bin/env node
/**
 * Populate data/authority_scale/velocity_health.json from REAL evidence.
 *
 * THE BUG THIS FIXES. `evaluate_velocity.mjs` reads this file to decide whether the
 * publication ceiling may rise. Three scripts read it. NOTHING HAS EVER WRITTEN IT: it
 * was created on 2026-08-10 with every gate set to UNKNOWN and never touched again.
 * Because `UNKNOWN never means PASS`, the upshift branch was unreachable by
 * construction - a safety ladder with no rung reachable from below. The ceiling sat at
 * 2 new URLs/day from 2026-07-24 until an owner override on 2026-09-10, while pages
 * cleared as SAFE_AUTOPUBLISH were released one per day.
 *
 * The defect was never the ceiling. It was a governor that could only ever see UNKNOWN.
 *
 * WHAT THIS DOES NOT DO. It does not manufacture PASS. Every gate is read from a
 * validator artifact or a measured ledger, and any gate with no evidence STAYS UNKNOWN
 * and is reported as such. A gate whose evidence says FAIL is written as FAIL, which
 * can downshift the ceiling - this file is as capable of applying the brake as of
 * releasing it, and that is the point.
 *
 * In particular `observed_yield_trend` stays UNKNOWN while
 * data/authority_scale/citation_yield_observations.json holds zero events. Calling a
 * trend STABLE with nothing observed would be the exact defect this repo keeps
 * producing: a green reading with no measurement behind it.
 *
 * Run it after a release-profile validation, so the artifacts it reads describe the
 * tree that is actually being published.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } };
const write = (p, v) => {
  const f = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
};

const HEALTH = 'data/authority_scale/velocity_health.json';
const sources = {};
const notes = [];

/** Read a validator artifact's verdict. Returns 'PASS' | 'FAIL' | null (no evidence). */
function verdict(artifactPath) {
  const doc = read(artifactPath);
  if (!doc) return null;
  if (typeof doc.status === 'string') {
    const s = doc.status.toUpperCase();
    if (s === 'PASS' || s === 'OK') return 'PASS';
    if (s === 'FAIL' || s === 'ERROR') return 'FAIL';
    return null;
  }
  if (typeof doc.ok === 'boolean') return doc.ok ? 'PASS' : 'FAIL';
  return null;
}

/** Map a verdict onto a gate's own vocabulary, keeping UNKNOWN when there is no evidence. */
function gate(name, artifactPath, onPass, onFail) {
  const v = verdict(artifactPath);
  sources[name] = { artifact: artifactPath, verdict: v ?? 'NO_EVIDENCE' };
  if (v === 'PASS') return onPass;
  if (v === 'FAIL') return onFail;
  notes.push(`${name}: no readable verdict in ${artifactPath}; left UNKNOWN.`);
  return 'UNKNOWN';
}

// 1. VALIDATION. The release profile's own summary - the same verdict that gates a push.
const validation_status = gate(
  'validation_status', 'artifacts/validation/validation-summary-release.json', 'PASS', 'FAIL',
);

// 2. SEMANTIC DUPLICATION. `velocity-agent-duplicate-resolution` is the registered
//    validator for this, and its vocabulary here is CLEAN / REGRESSION.
const semantic_duplicate_status = gate(
  'semantic_duplicate_status', 'artifacts/validation/velocity-agent-duplicate-resolution.json', 'CLEAN', 'REGRESSION',
);

// 3. DISTRIBUTION. The distribution contract covers the surfaces a published page has
//    to reach - sitemaps, feeds, the llms files.
const distribution_status = gate(
  'distribution_status', 'artifacts/validation/distribution-contract.json', 'HEALTHY', 'DEGRADED',
);

// 4. SOURCE AND CLAIM. Whether what the pages assert is still tied to its source.
const source_claim_status = gate(
  'source_claim_status', 'artifacts/validation/repair-claim-integrity.json', 'PASS', 'FAIL',
);

/*
 * 5. INDEXATION. DELIBERATELY UNKNOWN.
 *
 * Indexation is a fact about Google's index, not about this repository. Nothing in the
 * tree can observe it: internal-link coverage and IndexNow submission budgets say what
 * this repo SENT, never what got indexed. Reading a submission receipt as "indexation
 * healthy" is precisely the false-green this file exists to prevent, so the gate stays
 * UNKNOWN until real Search Console coverage data is wired in.
 */
const indexation_status = 'UNKNOWN';
sources.indexation_status = { artifact: null, verdict: 'NO_EVIDENCE' };
notes.push('indexation_status: no Search Console coverage source is wired in. A submission receipt is not an indexation result, so this stays UNKNOWN and continues to hold the tier.');

/*
 * 6. OBSERVED YIELD TREND. Measured, and honest about being empty.
 *
 * Upshift additionally requires `minimum_yield_events_for_upshift` observed events. With
 * zero recorded, the trend is UNKNOWN - not STABLE. A trend asserted over no
 * observations is a green reading with no measurement behind it.
 */
const observations = read('data/authority_scale/citation_yield_observations.json');
const events = Array.isArray(observations?.events) ? observations.events.length : 0;
const observed_yield_trend = events === 0 ? 'UNKNOWN' : 'MEASURED_SEE_SCOREBOARD';
sources.observed_yield_trend = { artifact: 'data/authority_scale/citation_yield_observations.json', verdict: `${events} event(s)` };
if (events === 0) notes.push('observed_yield_trend: citation_yield_observations.json records zero events, so no trend exists to report. UNKNOWN, not STABLE.');

const previous = read(HEALTH) || {};
const health = {
  schema_version: '1.0',
  as_of: new Date().toISOString(),
  validation_status,
  semantic_duplicate_status,
  distribution_status,
  indexation_status,
  observed_yield_trend,
  source_claim_status,
  minimum_yield_events_for_upshift: Number(previous.minimum_yield_events_for_upshift ?? 10),
  truth_rule: 'UNKNOWN never means PASS. This file may be updated only from real validator/distribution/indexation/yield evidence.',
  measured_by: 'scripts/authority_scale/measure_velocity_health.mjs',
  evidence_sources: sources,
  gates_still_unknown: notes,
};

write(HEALTH, health);

const unknown = Object.entries(health)
  .filter(([k, v]) => k.endsWith('_status') || k === 'observed_yield_trend')
  .filter(([, v]) => v === 'UNKNOWN')
  .map(([k]) => k);

console.log('VELOCITY HEALTH MEASURED');
for (const k of ['validation_status', 'semantic_duplicate_status', 'distribution_status', 'indexation_status', 'observed_yield_trend', 'source_claim_status']) {
  console.log(`  ${k.padEnd(26)}: ${health[k]}`);
}
console.log(`  observed yield events     : ${events} (need ${health.minimum_yield_events_for_upshift} to upshift)`);
if (unknown.length) {
  console.log(`\n${unknown.length} gate(s) remain UNKNOWN and will HOLD the tier - this is correct, not a failure:`);
  for (const n of notes) console.log(`  - ${n}`);
} else {
  console.log('\nEvery gate has real evidence behind it.');
}
