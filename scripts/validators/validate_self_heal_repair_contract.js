#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Self-heal repair contract.
//
// The self-heal loop (scripts/selfheal/heal_until_clean.mjs) trusts
// _validation_registry.json: when a validator fails, it runs that validator's
// declared `repair_command` and re-validates. Nothing previously checked that
// the repair touches anything the validator actually reads.
//
// That gap was real. `insights-manifest` compares content/_live/insights.json
// against content/_live/pages.json, but its declared repair wrote
// content/_shared/query_to_cluster_map.json - a file the validator never opens.
// The repair therefore exited 0 having changed nothing relevant, and the loop
// burned every attempt re-running an inert command before giving up.
//
// This validator makes that class of mistake impossible to land: every ACTIVE
// validator that declares a repair must also declare `repair_writes`, and at
// least one declared write target must be a path the validator's own source
// refers to.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const errors = [];
const warnings = [];

function rel(p) { return path.join(ROOT, p); }

const registry = JSON.parse(fs.readFileSync(rel('_validation_registry.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(rel('package.json'), 'utf8'));
const npmScripts = new Set(Object.keys(pkg.scripts || {}));

const validators = Array.isArray(registry.validators) ? registry.validators : [];
if (!validators.length) {
  console.error('SELF-HEAL REPAIR CONTRACT FAIL: _validation_registry.json declares no validators');
  process.exit(1);
}

const repairable = validators.filter((v) => v.status === 'ACTIVE' && v.repair_command);

// Zero-item guard. A repair contract that examined nothing has proven nothing,
// and the self-heal loop would have no repair to run at all.
if (!repairable.length) {
  console.error('SELF-HEAL REPAIR CONTRACT FAIL: zero ACTIVE validators declare a repair_command; the self-heal loop can repair nothing');
  process.exit(1);
}

// A repair target counts as reachable by a validator when every path segment of
// the target appears somewhere in the validator's source. Segment matching (not
// whole-path matching) is required because validators address files both as
// 'data/evidence/source_registry.json' and as path.join(ROOT,'content','_live','insights.json').
function reachableFrom(source, target) {
  return target.split('/').filter(Boolean).every((segment) => source.includes(segment));
}

let checkedTargets = 0;

for (const v of repairable) {
  const id = v.id;
  const cmd = String(v.repair_command || '');

  const m = cmd.match(/^npm run ([\w:.-]+)$/);
  if (!m) {
    errors.push(`${id}:repair_command_not_an_npm_script:${cmd}`);
    continue;
  }
  if (!npmScripts.has(m[1])) {
    errors.push(`${id}:repair_command_missing_from_package_json:${m[1]}`);
    continue;
  }

  const writes = Array.isArray(v.repair_writes) ? v.repair_writes : null;
  if (!writes || !writes.length) {
    errors.push(`${id}:repair_writes_missing - a validator that declares a repair must declare which files that repair rewrites`);
    continue;
  }

  const validatorPath = rel(String(v.path || ''));
  if (!v.path || !fs.existsSync(validatorPath)) {
    errors.push(`${id}:validator_source_missing:${v.path}`);
    continue;
  }
  const source = fs.readFileSync(validatorPath, 'utf8');

  const missingOnDisk = writes.filter((w) => !fs.existsSync(rel(w)));
  if (missingOnDisk.length) {
    errors.push(`${id}:repair_writes_do_not_exist:${missingOnDisk.join(',')}`);
  }

  const reachable = writes.filter((w) => reachableFrom(source, w));
  checkedTargets += writes.length;
  if (!reachable.length) {
    errors.push(
      `${id}:repair_is_inert - repair "${cmd}" rewrites ${writes.join(', ')}, none of which ${v.path} reads; running it can never clear this validator`,
    );
  } else if (reachable.length < writes.length) {
    warnings.push(`${id}:some_repair_writes_unread_by_validator:${writes.filter((w) => !reachable.includes(w)).join(',')}`);
  }
}

// Zero examined targets with nothing else to report means the contract proved
// nothing at all, which is a failure in its own right. When specific errors were
// collected, report those instead - they name the actual cause.
if (!checkedTargets && !errors.length) {
  console.error('SELF-HEAL REPAIR CONTRACT FAIL: examined zero repair targets');
  process.exit(1);
}

const report = {
  validator: 'self-heal-repair-contract',
  status: errors.length ? 'FAIL' : 'PASS',
  active_validators_with_repairs: repairable.length,
  repair_targets_checked: checkedTargets,
  error_count: errors.length,
  warning_count: warnings.length,
  errors,
  warnings,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
};
fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
fs.writeFileSync(rel('artifacts/validation/self-heal-repair-contract.json'), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`SELF-HEAL REPAIR CONTRACT FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
for (const w of warnings) console.log(`warning: ${w}`);
console.log(
  `SELF-HEAL REPAIR CONTRACT PASS: ${repairable.length} ACTIVE validator(s) declare a repair, ${checkedTargets} repair target(s) checked; every repair rewrites a file its validator reads.`,
);
