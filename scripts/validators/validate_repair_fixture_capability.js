#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A registered repair must CLEAR a constructed failing state - proven while its
 * validator is green.
 *
 * Three checks already govern the repair machinery, and between them they leave
 * one specific hole:
 *
 *   self-heal-repair-contract  - STATIC. Every ACTIVE validator with a
 *                                repair_command declares repair_writes, and at
 *                                least one write target is a path the validator
 *                                actually reads. Proves the repair is AIMED at
 *                                the right file. Says nothing about whether it
 *                                fires.
 *   self-heal-commit-coverage  - proves the lane can commit what a repair writes.
 *   repair-command-efficacy    - BEHAVIOURAL, but only for a validator that is
 *                                FAILING right now. On run 34233215688 it
 *                                examined 10 candidates and ran exactly 1
 *                                repair; the other 9 were ALREADY_PASSING /
 *                                repair_run:false.
 *
 * So a repair whose validator is GREEN is never exercised by anything, and its
 * capability can be removed without a single check noticing - until the day
 * production needs it, at which point the release lane deadlocks.
 *
 * That is exactly what happened. `recover:run-delivery-coverage-ratchet` was
 * registered so a newly-absorbed agent run could be ENROLLED in the shrink-only
 * ratchet at its measured gaps. A later change made `--rebaseline` refuse
 * whenever any run "regressed" - correct for a run whose cap would have to be
 * raised, but an unenrolled run defaulted to a cap of 0 and so looked identical.
 * The repair began refusing the one case it existed for. It still declared the
 * right repair_writes, so self-heal-repair-contract stayed green; the validator
 * was passing whenever anything looked, so repair-command-efficacy never ran it.
 * Then absorption landed a run with gaps, self-heal ran the repair, the repair
 * exited 1, no repair changed the tree, and the lane refused to publish.
 *
 * This test closes that window by exercising repairs OFF the production tree. A
 * fixture builds a genuinely failing state in a scratch directory, runs the real
 * registered repair, and requires the validator to pass afterwards. It asserts
 * the repair is capable REGARDLESS of what the production tree currently looks
 * like, which is the property none of the three above provide.
 *
 * Coverage is a GROW-ONLY ratchet (FIXTURE_FLOOR). Fixtures are expensive - some
 * repairs run a full site build - so this does not demand one for all ten today.
 * It does make the count impossible to reduce, so a fixture cannot be quietly
 * deleted, and it names every repair still uncovered so the gap stays visible
 * rather than becoming the status quo.
 *
 * Rule 0 / Rule 4: examining zero repairs is a FAILURE, not a pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const REGISTRY_REL = '_validation_registry.json';
const OUT_REL = 'artifacts/validation/repair-fixture-capability.json';

/**
 * Grow-only floor for Tier 2 behavioural coverage. Raise it when you add a
 * fixture. Never lower it: a repair that was once proven capable must stay
 * proven capable.
 */
const FIXTURE_FLOOR = 1;

const errors = [];
const examined = [];

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

/* ------------------------------------------------------------------ *
 * Tier 2 fixtures.
 *
 * Each fixture gets a scratch checkout of the repo (a git worktree-free copy of
 * only the files it needs, plus the scripts) and must:
 *   break()    - mutate the scratch tree into a state the validator FAILS on
 *   validate() - the validator command, run in the scratch tree
 *   repair()   - the registered repair command, run in the scratch tree
 * The harness asserts: fails before, repair exits 0, passes after.
 * ------------------------------------------------------------------ */
const FIXTURES = {
  'agent-run-delivery-coverage': {
    // The exact production condition, built synthetically so the fixture is
    // deterministic and does not depend on the state of the real ledger: a run
    // is present in the ledger, has gaps, and is absent from the ratchet
    // baseline. That is what absorption produces every time a new agent run
    // lands, because release:velocity-intake has not rendered its pages yet.
    // Before the fix this was classed a regression and the repair refused it,
    // and the release lane deadlocked.
    needs: [],
    break(scratch) {
      const dir = path.join(scratch, 'data/report_fixes');
      fs.mkdirSync(dir, { recursive: true });
      const pages = path.join(scratch, 'pages');
      fs.mkdirSync(pages, { recursive: true });
      fs.writeFileSync(path.join(pages, 'shown.html'), '<html>MARKER-PRESENT</html>', 'utf8');
      fs.writeFileSync(path.join(pages, 'blank.html'), '<html>nothing here</html>', 'utf8');
      const fix = (run, page, marker) => ({
        id: `${run}-${page}-${marker}`,
        run_date: run,
        renderedPath: `pages/${page}`,
        required_markers: [marker],
        implementation_status: 'RELEASED',
      });
      fs.writeFileSync(path.join(dir, 'agent_fix_ledger.json'), `${JSON.stringify({
        fixes: [
          // enrolled run, fully delivered -> 0 gaps
          fix('2000-01-01', 'shown.html', 'MARKER-PRESENT'),
          // unenrolled run, one recommendation not yet on its page -> 1 gap
          fix('2000-01-02', 'shown.html', 'MARKER-PRESENT'),
          fix('2000-01-02', 'blank.html', 'MARKER-PRESENT'),
        ],
      }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(dir, 'agent_run_delivery_coverage_baseline.json'), `${JSON.stringify({
        schema_version: '1.0',
        total_max_gaps: 0,
        max_gaps_by_run: { '2000-01-01': 0 },
      }, null, 2)}\n`, 'utf8');
      return 'run 2000-01-02 landed with 1 undelivered recommendation and no baseline entry';
    },
    validate: ['node', ['scripts/validators/validate_agent_run_delivery_coverage.js']],
    repair: ['node', ['scripts/validators/validate_agent_run_delivery_coverage.js', '--rebaseline']],
  },
};

function run(cmd, args, cwd) {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Copy the scripts tree plus the fixture's data files into a scratch dir. */
function makeScratch(needs) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-contract-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(scratch, 'scripts'), { recursive: true });
  for (const rel of needs) {
    fs.mkdirSync(path.join(scratch, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(scratch, rel));
  }
  return scratch;
}

function tier2(v) {
  const fixture = FIXTURES[v.id];
  const scratch = makeScratch(fixture.needs);
  try {
    const what = fixture.break(scratch);
    const before = run(fixture.validate[0], fixture.validate[1], scratch);
    if (before.code === 0) {
      errors.push(`fixture_does_not_fail:${v.id} - the fixture (${what}) was expected to make the validator fail, but it passed. A repair proven against a state that was never broken proves nothing.`);
      return false;
    }
    const repair = run(fixture.repair[0], fixture.repair[1], scratch);
    if (repair.code !== 0) {
      errors.push(`repair_refuses_its_own_case:${v.id} - fixture (${what}) makes the validator fail, and the registered repair then exited ${repair.code} instead of repairing it. Self-heal cannot converge on this: the repair is registered for a condition it will not act on. Output: ${repair.out.trim().split('\n')[0]}`);
      return false;
    }
    const after = run(fixture.validate[0], fixture.validate[1], scratch);
    if (after.code !== 0) {
      errors.push(`repair_does_not_clear:${v.id} - fixture (${what}); the repair exited 0 but the validator still fails afterwards. Output: ${after.out.trim().split('\n').pop()}`);
      return false;
    }
    return true;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const registryPath = path.join(ROOT, REGISTRY_REL);
  if (!fs.existsSync(registryPath)) {
    console.error(`REPAIR FIXTURE CAPABILITY FAIL: ${REGISTRY_REL} does not exist, so this test examined zero repairs. Repair capability is UNKNOWN, not proven.`);
    process.exit(1);
  }
  const registry = readJson(registryPath);
  const declared = (registry.validators || []).filter((v) => v.repair_command);
  // Scope is by STATUS, not by an id allowlist. A RETIRED validator is in no
  // profile, so self-heal never invokes its repair and there is nothing to
  // prove capable; repair-command-efficacy scopes the same way, which is why it
  // examined 10 of these 12 in production. Deliberately NOT an exemption list:
  // adding a repair to an ACTIVE validator brings it under this contract with
  // no further edit here, which is the property that keeps the next repair from
  // walking into the same wall.
  const retired = declared.filter((v) => String(v.status).toUpperCase() !== 'ACTIVE');
  const withRepairs = declared.filter((v) => String(v.status).toUpperCase() === 'ACTIVE');

  // Rule 0 / Rule 4: an empty input set is a failure, never a pass.
  if (!withRepairs.length) {
    console.error(`REPAIR FIXTURE CAPABILITY FAIL: ${REGISTRY_REL} declares zero ACTIVE validators with a repair_command, so this test examined nothing. Either the registry is not being read or every repair was removed; both are failures, not a clean run. (${declared.length} declared repair(s) seen in total, ${retired.length} on non-ACTIVE validators.)`);
    process.exit(1);
  }

  let behaviouralOk = 0;
  const uncovered = [];
  for (const v of withRepairs) {
    if (!FIXTURES[v.id]) { uncovered.push(v.id); examined.push({ id: v.id, repair_command: v.repair_command, behavioural: 'NO_FIXTURE' }); continue; }
    const ok = tier2(v);
    if (ok) behaviouralOk += 1;
    examined.push({ id: v.id, repair_command: v.repair_command, behavioural: ok ? 'PASS' : 'FAIL' });
  }

  if (behaviouralOk < FIXTURE_FLOOR) {
    errors.push(`behavioural_coverage_fell:${behaviouralOk} repair(s) proved capable against a failing fixture, below the grow-only floor of ${FIXTURE_FLOOR}. A repair that was once proven capable must stay proven capable - restore the fixture rather than lowering the floor.`);
  }

  const report = {
    schema_version: '1.0',
    validator: 'repair-fixture-capability',
    status: errors.length ? 'FAIL' : 'PASS',
    repairs_declared: declared.length,
    repairs_examined: withRepairs.length,
    retired_not_examined: retired.map((v) => v.id),
    behavioural_pass: behaviouralOk,
    fixture_floor: FIXTURE_FLOOR,
    behavioural_fixture_missing: uncovered,
    examined,
    errors,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (errors.length) {
    console.error('REPAIR FIXTURE CAPABILITY FAIL');
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`REPAIR FIXTURE CAPABILITY: FAIL - examined ${withRepairs.length} ACTIVE registered repair(s); ${behaviouralOk} proven to clear a failing fixture (floor ${FIXTURE_FLOOR}).`);
    process.exit(1);
  }
  console.log(`REPAIR FIXTURE CAPABILITY PASS: examined ${withRepairs.length} of ${declared.length} registered repair(s) (${retired.length} on non-ACTIVE validators, never invoked by self-heal); ${behaviouralOk} proven to clear a genuinely failing fixture (floor ${FIXTURE_FLOOR}). Still without a behavioural fixture: ${uncovered.join(', ') || 'none'}.`);
}

if (require.main === module) main();
