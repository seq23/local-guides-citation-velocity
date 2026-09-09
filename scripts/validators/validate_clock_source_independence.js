#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * SOURCE_DATE IS NOT THE CLOCK.
 *
 * `SOURCE_DATE` is this repo's reproducible-build stamp. `scripts/release/run_staged_release.js`
 * derives it with readReleaseDate() - the newest DURABLE RELEASE DATE found in
 * data/citation_velocity/runs.json, content/_shared/content_state.json and the page
 * admission registry - and exports it into EVERY stage of `release:ci-validate`,
 * including the whole release validation profile. It answers "what day is this content
 * stamped for", and it trails the wall clock by however long it has been since the last
 * successful publish.
 *
 * THE OUTAGE. `agent-artifact-continuity` measured the age of a landed agent run with
 * `process.env.SOURCE_DATE || new Date()...`. On 2026-09-09 the TRT run landed that
 * morning while the last durable release was 2026-09-08, so a run that was ZERO days old
 * measured -1, and the decision table correctly refuses a negative age as a future-dated
 * run. Validate Repo (run 34360436588) died on
 *
 *     normalized_output_missing:READY_FOR_ABSORPTION:.../2026-09-09/trt:age_days=-1:allowed_days=2
 *
 * blocking 155 further validators. Neither the window (2 days, derived from the dispatch
 * cron) nor the decision table was wrong. The CLOCK was wrong, and wrong in the direction
 * that guarantees recurrence: every run landing after the day of the last release is in
 * the "future" of SOURCE_DATE, so the absorption window could never protect the handoff
 * it exists for except on days a release had already published.
 *
 * WHY A NEW GUARD RATHER THAN A FIX IN PLACE. `store-clock-independence` already owns
 * "a verdict that moves with the clock", but its enrolment reaches only validators that
 * DECLARE a JSON store carrying a top-level `generated_at`. Continuity declares no such
 * store - it walks a directory of agent runs - so the guard written for clock-dependent
 * verdicts could not reach the clock-dependent verdict that took the lane down. That is
 * the same "guard cannot reach what it governs" shape that file names in its own header.
 * This guard enrols on the other axis: not "does it read a stamped store" but "does it
 * read SOURCE_DATE at all".
 *
 * ENROLMENT is derived from the tree, not hand-maintained: every ACTIVE validator whose
 * own source CODE references SOURCE_DATE. A new validator that reads it is covered the
 * day it is written. Reading source is a guess when it decides a VERDICT; here it decides
 * only which commands are worth EXECUTING, and the verdict is the two exit codes.
 *
 * COMMENTS ARE NOT CODE, and enrolling on them made this guard fail the release lane on
 * 2026-09-09 with a false accusation. `validate_build_result_cache.js` mentions
 * SOURCE_DATE once, in a prose comment on line 44, and reads it nowhere. It was enrolled
 * anyway, and its two probes genuinely disagreed - not because a verdict moved with the
 * clock, but because the build cache is keyed on an input hash that legitimately includes
 * the environment: the lane populates the cache under SOURCE_DATE=2026-09-09 (hash
 * 9ee2dde43152c256), so the probe WITHOUT SOURCE_DATE asks for a different hash
 * (42d73d81b6544377), finds no entry, and exits 1. The cache behaved correctly and the
 * guard called it a clock dependency.
 *
 * Two of the other enrolments were prose too, and one of them is the outage this guard
 * was written for: `agent-artifact-continuity` no longer reads SOURCE_DATE - PR #97
 * removed that - and now only DESCRIBES it in its header. Enrolling a validator because
 * its comment explains a bug it no longer has is enrolment measuring documentation.
 *
 * Stripping comments before the test is what makes enrolment mean "reads it". The guard
 * keeps all of its teeth: any `process.env.SOURCE_DATE` in executable code still enrols,
 * so a regression that reintroduces the comparison re-enrols itself automatically.
 *
 * THE PROBE is the two clocks that actually occur in production, not arbitrary dates:
 * the wall clock (SOURCE_DATE unset, how a validator runs standalone and in the self-heal
 * loop) against the durable release date the staged release lane exports. Arbitrary
 * distant dates are what `store-clock-independence` warns are useless on their own - a
 * date-keyed check fails under every date but its own, so two wrong dates agree and the
 * guard reports stability. Unset-versus-release-date cannot agree by accident: it is
 * exactly the pair that diverged on 2026-09-09.
 *
 * Stamping SOURCE_DATE into a report field (`checked_at`, `generated_at`) is legitimate
 * and this guard permits it, because it does not change a verdict. Comparing against it
 * is not.
 *
 * Rule 0: enrolling zero validators, or probing zero of them, is a FAILURE.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT_REL = 'artifacts/validation/clock-source-independence.json';
const REGISTRY_REL = '_validation_registry.json';
const SELF_ID = 'clock-source-independence';
const abs = (rel) => path.join(ROOT, rel);

// The guard declares its own probe budget rather than quietly skipping whatever happens
// to be slow. A validator above it is NAMED in the receipt as unprobed, so the gap is
// visible instead of becoming the status quo.
const PROBE_BUDGET_SECONDS = Number(process.env.CLOCK_PROBE_BUDGET_SECONDS || 30);

// The durable release date the staged release lane exports, read the same way
// scripts/release/run_staged_release.js reads it, so this probes the value that is
// really in the environment rather than an invented one.
function durableReleaseDate() {
  const dates = [];
  const add = (v) => { const d = String(v || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d); };
  try { const p = JSON.parse(fs.readFileSync(abs('data/citation_velocity/runs.json'), 'utf8')); add(p.current_through); for (const r of p.runs || []) add(r.date || r.run_date); } catch { /* absent */ }
  try { const s = JSON.parse(fs.readFileSync(abs('content/_shared/content_state.json'), 'utf8')); for (const e of Object.values(s)) add(e && e.lastmod); } catch { /* absent */ }
  try { const r = JSON.parse(fs.readFileSync(abs('data/content/page_admission_registry.json'), 'utf8')); for (const e of r.pages || r.routes || []) add(e && (e.date_modified || e.last_modified || e.reviewed_at || e.admitted_at)); } catch { /* absent */ }
  return dates.sort().at(-1) || null;
}

// Executable source only. Block comments and line comments are stripped so enrolment
// means "this validator READS SOURCE_DATE", not "this validator talks about it". The
// line-comment pattern deliberately spares "://" so a URL in code is not treated as a
// comment.
function codeOf(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const registry = JSON.parse(fs.readFileSync(abs(REGISTRY_REL), 'utf8'));
const validators = Array.isArray(registry.validators) ? registry.validators : [];
if (!validators.length) {
  console.error(`CLOCK SOURCE INDEPENDENCE FAIL: ${REGISTRY_REL} declares no validators.`);
  process.exit(1);
}

const releaseDate = durableReleaseDate();
if (!releaseDate) {
  console.error(
    'CLOCK SOURCE INDEPENDENCE FAIL: could not derive the durable release date the staged release lane exports as '
    + 'SOURCE_DATE. With no second clock there is nothing to compare the wall clock against and this guard proved '
    + 'nothing.',
  );
  process.exit(1);
}

const enrolled = [];
const unprobed = [];
for (const v of validators) {
  if (v.status !== 'ACTIVE' || !v.command || !v.path) continue;
  if (v.id === SELF_ID) continue;
  const src = fs.existsSync(abs(v.path)) ? fs.readFileSync(abs(v.path), 'utf8') : '';
  if (!codeOf(src).includes('SOURCE_DATE')) continue;
  const budget = Number(v.estimated_runtime_seconds || 0);
  if (budget > PROBE_BUDGET_SECONDS) {
    unprobed.push({ id: v.id, estimated_runtime_seconds: budget, reason: `declared runtime ${budget}s exceeds the ${PROBE_BUDGET_SECONDS}s probe budget` });
    continue;
  }
  enrolled.push({ id: v.id, command: v.command, path: v.path });
}

if (!enrolled.length) {
  console.error(
    'CLOCK SOURCE INDEPENDENCE FAIL: enrolled zero validators. Enrolment is every ACTIVE validator whose source '
    + 'mentions SOURCE_DATE; finding none means either the registry or the enrolment rule has drifted and this '
    + 'guard is reaching nothing. Clock independence is UNKNOWN, not proven.',
  );
  process.exit(1);
}

const errors = [];
const checked = [];
for (const item of enrolled) {
  const wallEnv = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' };
  delete wallEnv.SOURCE_DATE;
  delete wallEnv.RELEASE_DATE;
  const wall = spawnSync(item.command, { cwd: ROOT, shell: true, encoding: 'utf8', env: wallEnv });
  const staged = spawnSync(item.command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...wallEnv, SOURCE_DATE: releaseDate },
  });
  const wallCode = wall.status === null ? 1 : wall.status;
  const stagedCode = staged.status === null ? 1 : staged.status;
  const independent = wallCode === stagedCode;
  checked.push({ id: item.id, command: item.command, wall_clock_exit: wallCode, source_date_exit: stagedCode, source_date_probed: releaseDate, clock_independent: independent });
  if (!independent) {
    errors.push(
      `${item.id}:verdict_depends_on_SOURCE_DATE - "${item.command}" exited ${wallCode} on the wall clock and `
      + `${stagedCode} under SOURCE_DATE=${releaseDate}, the durable release date scripts/release/run_staged_release.js `
      + 'exports into every validation stage. SOURCE_DATE is the reproducible-build stamp for the content, not today; '
      + 'anything measuring an AGE, a DEADLINE or a WINDOW must read the wall clock. Stamping it into a report field '
      + 'is fine - comparing against it is not.',
    );
  }
}

const report = {
  schema_version: '1.0',
  validator: SELF_ID,
  status: errors.length ? 'FAIL' : 'PASS',
  enrolment_rule: 'every ACTIVE validator whose own source mentions SOURCE_DATE',
  probe: { wall_clock: 'SOURCE_DATE and RELEASE_DATE unset', source_date: releaseDate, source_of_source_date: 'readReleaseDate() in scripts/release/run_staged_release.js' },
  probe_budget_seconds: PROBE_BUDGET_SECONDS,
  probed_count: checked.length,
  unprobed_over_budget: unprobed,
  checked,
  errors,
};
fs.mkdirSync(abs('artifacts/validation'), { recursive: true });
fs.writeFileSync(abs(OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  console.error(`CLOCK SOURCE INDEPENDENCE FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(
  `CLOCK SOURCE INDEPENDENCE PASS: ${checked.length} SOURCE_DATE-reading validator(s) returned the same verdict on `
  + `the wall clock and under SOURCE_DATE=${releaseDate} (the durable release date the staged release lane exports). `
  + (unprobed.length
    ? `${unprobed.length} over the ${PROBE_BUDGET_SECONDS}s probe budget and NOT probed: ${unprobed.map((u) => `${u.id} (${u.estimated_runtime_seconds}s)`).join(', ')}.`
    : 'None were over the probe budget.'),
);
