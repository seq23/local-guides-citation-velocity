#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Store clock independence.
//
// A generated store that carries a wall-clock `generated_at` INSIDE the payload
// its own --check mode byte-compares does not expire when the content changes.
// It expires at midnight.
//
// That is not hypothetical. data/release/accepted_page_artifacts.json and
// data/release/historic_recovered_artifacts.json were both written that way, and
// both back Tier 1 HARD_FAIL validators. The stores were committed on 2026-09-01;
// from 00:00 UTC on 2026-09-02 the recomputed payload differed from the committed
// one by exactly one field - the date - so accepted-artifact-recovery failed, and
// with it validate:release. That took down the content-release lane (which is
// where a landed agent run is normalized and absorbed), the query-evidence
// self-heal loop, and left Validate Repo red on the unabsorbed run.
//
// It recurred daily because the failure message says "run without --check and
// commit the result", and doing that is a real fix for exactly one day. Every
// green was a day old before the next midnight undid it.
//
// This guard proves the property directly: for every registered store of that
// shape, the validator that guards it must return the SAME verdict regardless of
// what SOURCE_DATE says. It does not care whether the verdict is pass or fail -
// a store that genuinely needs regenerating should fail, and should fail on every
// date. What it forbids is a verdict that depends on the clock.
//
// The enrolment rule needs no hand-maintained second list, because two components
// each keeping their own list with no link between them is how guards drift out of
// reach of what they govern. A contract enrols itself when it is
//   - an ACTIVE validator in _validation_registry.json, and
//   - declares repair_writes naming a JSON file that carries a top-level
//     `generated_at` stamp.
// Any future store built the same way is covered the day it is registered.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const rel = (p) => path.join(ROOT, p);

// Probing two ARBITRARY dates does not work, and the first cut of this guard was
// inert because of it. A date-stamped store fails under every date except the one
// baked into it, so two arbitrary dates both return FAIL, the verdicts agree, and
// the guard reports stability while the contract is broken.
//
// The signature of the defect is specifically: PASSES under the store's own
// generated_at stamp, FAILS under any other date. So the store's own stamp has to
// be one of the probes. These fixed dates are the others - neither is "today", so
// the guard returns the same answer whenever it runs.
const FIXED_PROBE_DATES = ['2020-01-02', '2038-11-23'];

const registry = JSON.parse(fs.readFileSync(rel('_validation_registry.json'), 'utf8'));
const validators = Array.isArray(registry.validators) ? registry.validators : [];
if (!validators.length) {
  console.error('STORE CLOCK INDEPENDENCE FAIL: _validation_registry.json declares no validators');
  process.exit(1);
}

// Returns the store's own generated_at stamp, or '' when it carries none.
function generatedAtOf(relPath) {
  if (!relPath.endsWith('.json') || !fs.existsSync(rel(relPath))) return '';
  try {
    const doc = JSON.parse(fs.readFileSync(rel(relPath), 'utf8'));
    if (!doc || typeof doc !== 'object') return '';
    return typeof doc.generated_at === 'string' ? doc.generated_at : '';
  } catch {
    return '';
  }
}

const enrolled = [];
for (const v of validators) {
  if (v.status !== 'ACTIVE' || !v.command || !v.path) continue;
  const stamped = (Array.isArray(v.repair_writes) ? v.repair_writes : [])
    .map((w) => ({ store: w, generated_at: generatedAtOf(w) }))
    .filter((x) => x.generated_at);
  if (!stamped.length) continue;
  // Every stamp the contract's own stores carry, plus the fixed distant dates.
  const dates = [...new Set([...stamped.map((x) => x.generated_at), ...FIXED_PROBE_DATES])];
  enrolled.push({ id: v.id, command: v.command, stores: stamped, probe_dates: dates });
}

// Rule 0. Examining nothing is a failure, not a clean bill of health: it means
// either the registry stopped declaring these contracts or the enrolment rule
// stopped matching them, and in both cases this guard has proven nothing.
if (!enrolled.length) {
  console.error(
    'STORE CLOCK INDEPENDENCE FAIL: examined zero stores. No ACTIVE validator declares a repair_writes '
    + 'target carrying a top-level generated_at stamp, so either the registry or the enrolment rule has '
    + 'drifted and this guard is no longer reaching anything. Clock independence is UNKNOWN, not proven.',
  );
  process.exit(1);
}

const errors = [];
const checked = [];

for (const item of enrolled) {
  const verdicts = item.probe_dates.map((date) => {
    const r = spawnSync(item.command, {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, SOURCE_DATE: date, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072' },
    });
    return { date, exit_code: r.status === null ? 1 : r.status };
  });

  const codes = [...new Set(verdicts.map((v) => v.exit_code))];
  const stable = codes.length === 1;
  if (!stable) {
    errors.push(
      `${item.id}:verdict_depends_on_the_clock - "${item.command}" exited `
      + verdicts.map((v) => `${v.exit_code} under SOURCE_DATE=${v.date}`).join(', ')
      + `. ${item.stores.map((s) => s.store).join(', ')} carries a generated_at stamp inside the payload the `
      + 'check byte-compares, so this contract goes green only on the day the store was written and red on '
      + 'every day after, with no content change behind it. Carry the previous stamp forward when nothing '
      + 'but the date moved.',
    );
  }
  checked.push({
    id: item.id,
    stores: item.stores,
    probe_dates: item.probe_dates,
    verdicts,
    clock_independent: stable,
  });
}

const report = {
  schema_version: '1.0',
  validator: 'store-clock-independence',
  status: errors.length ? 'FAIL' : 'PASS',
  fixed_probe_dates: FIXED_PROBE_DATES,
  enrolment_rule: 'ACTIVE validator declaring a repair_writes target whose JSON carries a top-level generated_at stamp',
  stores_examined: checked.length,
  checked,
  errors,
};
fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
fs.writeFileSync(rel('artifacts/validation/store-clock-independence.json'), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`STORE CLOCK INDEPENDENCE FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(
  `STORE CLOCK INDEPENDENCE PASS: ${checked.length} store contract(s) return the same verdict under every `
  + `probed SOURCE_DATE, including each store's own generated_at stamp; none expires on a date rollover.`,
);
