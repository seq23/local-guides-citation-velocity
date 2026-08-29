#!/usr/bin/env node
'use strict';
/**
 * The intake release plan must report how deep the unreleased social backlog is.
 *
 * Why this exists
 * ---------------
 * social_fallback_suppressed_count is computed as
 *   countSocialFallbackCandidates(TARGET - selected.length, seenIds)
 * so it is bounded by THIS RUN'S REMAINING CAPACITY. On any run where agent
 * artifacts already fill the daily target, capacity is 0 and the plan reports
 * "Social fallback suppressed: 0" -- while a real, eligible, unreleased backlog
 * sits idle. Measured on the current data the true depth is 389 against a
 * suppressed_count of 68: the reported number understated the idle backlog by
 * more than five times, and reports zero outright on a full-agent day.
 *
 * Suppressing social fallback is a deliberate, contract-enforced policy
 * (ALLOW_SOCIAL_FALLBACK_RELEASE="0", asserted by validate_velocity_intake_workflow)
 * and this validator does NOT challenge it. A cap that defers is fine. What is
 * not fine is a human reading the plan and seeing "nothing is being held back"
 * when the honest statement is "nothing more fits today, and 389 are waiting."
 *
 * This validator only enforces that the depth is reported, never what it is.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PLAN = path.join(ROOT, 'artifacts/validation/velocity-intake-release-plan.json');
const PREP = path.join(ROOT, 'scripts/citation_velocity/prepare_velocity_intake_release.js');

const errors = [];
let checks = 0;

// Rule 0: never pass having examined nothing.
if (!fs.existsSync(PREP)) {
  console.error(JSON.stringify({
    validator: 'social-fallback-backlog-visibility',
    status: 'FAIL',
    errors: ['prepare_velocity_intake_release.js is missing; backlog visibility cannot be verified'],
  }, null, 2));
  process.exit(1);
}

const src = fs.readFileSync(PREP, 'utf8');

checks += 1;
if (!/measureSocialFallbackBacklogDepth\s*\(/.test(src)) {
  errors.push('prepare_velocity_intake_release.js no longer measures social fallback backlog depth independently of run capacity');
}

checks += 1;
if (!/social_fallback_backlog_depth/.test(src)) {
  errors.push('the release plan no longer carries social_fallback_backlog_depth');
}

// The depth function must not be bounded by a capacity/limit argument, or it
// regresses into the same capacity-bounded number it exists to correct.
checks += 1;
const fnMatch = src.match(/function measureSocialFallbackBacklogDepth\(([^)]*)\)/);
if (fnMatch && /limit/.test(fnMatch[1])) {
  errors.push('measureSocialFallbackBacklogDepth takes a limit argument; backlog depth must not be capacity-bounded');
}

if (fs.existsSync(PLAN)) {
  checks += 1;
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  if (!Number.isInteger(plan.social_fallback_backlog_depth)) {
    errors.push(`release plan is missing an integer social_fallback_backlog_depth (got ${JSON.stringify(plan.social_fallback_backlog_depth)})`);
  } else if (plan.social_fallback_backlog_depth < (plan.social_fallback_suppressed_count || 0)) {
    errors.push(`backlog depth ${plan.social_fallback_backlog_depth} is below suppressed count ${plan.social_fallback_suppressed_count}; depth must count the whole eligible backlog`);
  }
}

if (checks === 0) errors.push('validator examined zero properties and cannot vouch for backlog visibility');

const report = {
  validator: 'social-fallback-backlog-visibility',
  status: errors.length ? 'FAIL' : 'PASS',
  checks_performed: checks,
  errors,
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/social-fallback-backlog-visibility.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log(`SOCIAL FALLBACK BACKLOG VISIBILITY PASS: ${checks} checks`);
