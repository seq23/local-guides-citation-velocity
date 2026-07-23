#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PLAN_PATHS = [
  'data/report_fixes/agent_exact_implementation_plan.json',
  'artifacts/validation/agent-exact-implementation-plan.json'
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function normalizePath(value) {
  return String(value || '').trim().replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
}

const errors = [];
const warnings = [];
const available = PLAN_PATHS.filter(exists);

if (!available.length) {
  errors.push('missing_existing_agent_exact_implementation_plan');
}

let plan = null;
let planPath = null;
for (const rel of available) {
  try {
    const candidate = readJson(rel);
    if (!plan) {
      plan = candidate;
      planPath = rel;
    }
  } catch (error) {
    errors.push(`${rel}:invalid_json:${error.message}`);
  }
}

if (plan) {
  if (plan.status && plan.status !== 'PASS') errors.push(`plan_status_not_pass:${plan.status}`);
  if (!Array.isArray(plan.specs)) errors.push('plan_specs_must_be_array');
  if (!plan.specs?.length) warnings.push('agent_exact_plan_has_no_specs');

  const seen = new Set();
  for (const [index, spec] of (plan.specs || []).entries()) {
    const status = String(spec.status || '');
    const operation = String(spec.operation || '');
    const implementationPath = normalizePath(spec.implementation_path || spec.intended_winner_path || spec.target_route);
    if (!operation) errors.push(`spec_${index}:missing_operation`);
    if (!status) errors.push(`spec_${index}:missing_status`);
    if (status === 'PLANNED' && !implementationPath) errors.push(`spec_${index}:planned_missing_implementation_path`);
    if (implementationPath) {
      if (seen.has(implementationPath)) warnings.push(`duplicate_implementation_path:${implementationPath}`);
      seen.add(implementationPath);
    }
    if (status === 'BLOCKED' && !spec.blocked_reason) errors.push(`spec_${index}:blocked_missing_reason`);
  }
}

if (errors.length) {
  console.error('AGENT EXACT IMPLEMENTATION PLAN VALIDATION FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`AGENT EXACT IMPLEMENTATION PLAN VALIDATION PASS: path=${planPath}; specs=${plan?.specs?.length || 0}; warnings=${warnings.length}`);
