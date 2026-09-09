#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * THE STEP THAT PUBLISHES MUST BE BOUNDED IN TIME AND MUST SAY WHAT IT IS DOING.
 *
 * velocity-content-release.yml's "Rebase, rebuild, revalidate, and push Velocity" step
 * is the repo's only content publication surface. Each of its attempts runs
 * selfheal:release and validate:release, both of which drive
 * run_validation_registry.js --collect-all - which routes per-validator output into
 * artifacts/validation/runtime/ rather than stdout. The step therefore goes SILENT for
 * four to five minutes at a time while doing precisely the work it exists to do.
 *
 * On 2026-09-09 that silence cost two runs. 34392913967 and 34395472450 were both
 * cancelled by a human who read the stillness as a hang. Neither was hung:
 * 34392913967's own log carries 153 timestamped lines over 11.2 minutes, a maximum gap
 * of 272s (one release-profile pass), and self-heal converging 5 failing -> 2 failing
 * before it was killed 76 seconds into the next pass. A step nobody can distinguish
 * from a hang gets killed like one, and the publish never lands - which is the same
 * outcome as the deadlock publish-gate-unblockable exists to prevent, reached a
 * different way.
 *
 * The loop was already bounded in ITERATIONS - three attempts, then a hard exit - but
 * not in TIME. One genuinely stuck command could hold the runner for the job's entire
 * 120-minute budget with no diagnosis at the end of it.
 *
 * This asserts three properties of that step:
 *   1. it declares its own timeout-minutes, so it can never burn the whole job budget;
 *   2. its retry loop is bounded and ends in an explicit failure, not a fallthrough;
 *   3. it emits progress banners, so silence has a stated duration and an observer can
 *      tell converging from stuck without reading the log tail.
 *
 * Rule 0: not finding the step, or examining zero assertions, is a FAILURE.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_REL = '.github/workflows/velocity-content-release.yml';
const STEP_NAME = 'Rebase, rebuild, revalidate, and push Velocity';
const OUT_REL = 'artifacts/validation/publish-step-bounded.json';

let text = '';
try {
  text = fs.readFileSync(path.join(ROOT, WORKFLOW_REL), 'utf8');
} catch (e) {
  console.error(`PUBLISH STEP BOUNDED FAIL: cannot read ${WORKFLOW_REL} (${e.message}), so the publish step's bounds are UNKNOWN, not proven.`);
  process.exit(1);
}

// Slice the step: from its `- name:` line to the next step at the same indentation.
const startIdx = text.indexOf(`- name: ${STEP_NAME}`);
if (startIdx === -1) {
  console.error(
    `PUBLISH STEP BOUNDED FAIL: no step named "${STEP_NAME}" in ${WORKFLOW_REL}. This guard examined zero steps. `
    + 'If the publish step was renamed, rename it here too rather than leaving the guard pointing at nothing.',
  );
  process.exit(1);
}
const rest = text.slice(startIdx);
const nextStep = rest.slice(1).search(/\n      - name: /);
const step = nextStep === -1 ? rest : rest.slice(0, nextStep + 1);

const assertions = [
  {
    id: 'declares_timeout',
    ok: /\n\s*timeout-minutes:\s*(\d+)/.test(step),
    why: 'the step must declare timeout-minutes so a stuck command cannot hold the runner for the job\'s whole budget',
  },
  {
    id: 'retry_loop_bounded',
    ok: /for attempt in [\d ]+; do/.test(step),
    why: 'the retry loop must iterate a fixed list of attempts, never `while true`',
  },
  {
    id: 'ends_in_explicit_failure',
    ok: /exit 1/.test(step),
    why: 'exhausting the attempts must exit non-zero rather than falling through as success',
  },
  {
    id: 'names_the_stop',
    ok: /PUBLISH DID NOT CONVERGE/.test(step),
    why: 'exhausting the attempts must print a named stop saying what did not converge, not a bare exit code',
  },
  {
    id: 'emits_progress_banners',
    ok: /phase\(\)\s*\{/.test(step) && (step.match(/phase "\$attempt"/g) || []).length >= 4,
    why: 'the step must print a progress banner before each long phase, so its silence can be told from a hang',
  },
];

const timeoutMatch = step.match(/\n\s*timeout-minutes:\s*(\d+)/);
const stepTimeout = timeoutMatch ? Number(timeoutMatch[1]) : null;
const jobTimeoutMatch = text.match(/\n\s{4}timeout-minutes:\s*(\d+)/);
const jobTimeout = jobTimeoutMatch ? Number(jobTimeoutMatch[1]) : null;
if (stepTimeout !== null && jobTimeout !== null && stepTimeout >= jobTimeout) {
  assertions.push({
    id: 'step_timeout_below_job_timeout',
    ok: false,
    why: `the step timeout (${stepTimeout}m) must be below the job timeout (${jobTimeout}m), or it can never fire and the step is effectively unbounded`,
  });
}

const errors = assertions.filter((a) => !a.ok).map((a) => `${WORKFLOW_REL}:${STEP_NAME}:${a.id} - ${a.why}`);

const report = {
  schema_version: '1.0',
  validator: 'publish-step-bounded',
  status: errors.length ? 'FAIL' : 'PASS',
  workflow: WORKFLOW_REL,
  step: STEP_NAME,
  step_timeout_minutes: stepTimeout,
  job_timeout_minutes: jobTimeout,
  assertions_checked: assertions.length,
  errors,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  console.error(`PUBLISH STEP BOUNDED FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log(
  `PUBLISH STEP BOUNDED PASS: ${assertions.length} assertion(s) against "${STEP_NAME}" in ${WORKFLOW_REL}; `
  + `step timeout ${stepTimeout}m inside a ${jobTimeout}m job, retry loop bounded, exhaustion prints a named stop, and every long phase is announced.`,
);
