#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'artifacts/validation/citation-yield-feedback.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const result = spawnSync(
  process.execPath,
  ['scripts/authority_scale/validate_citation_yield_feedback.mjs'],
  { cwd: ROOT, encoding: 'utf8' }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const errors = [];
if (result.error) errors.push(`spawn_error:${result.error.message}`);
if ((result.status ?? 1) !== 0) {
  const detail = String(result.stderr || result.stdout || '').trim();
  errors.push(detail || `validator_exit:${result.status ?? 'unknown'}`);
}

let report;
try {
  const contract = readJson('data/authority_scale/citation_yield_contract.json');
  const scoreboard = readJson('data/authority_scale/citation_yield_scoreboard.json');
  const decision = readJson('data/authority_scale/velocity_decision.json');
  report = {
    validator: 'citation-yield-feedback',
    ok: errors.length === 0,
    repo_id: contract.repo_id || null,
    objective: contract.objective || null,
    twin_agent_enabled: Boolean(contract.twin_agent?.enabled),
    verified_external_citations_with_required_evidence:
      Number(scoreboard.verified_external_citations_with_required_evidence || 0),
    current_new_url_ceiling_per_day:
      Number(decision.current_new_url_ceiling_per_day || 0),
    velocity_decision: decision.decision || null,
    recommended_new_url_ceiling_per_day:
      Number(decision.recommended_new_url_ceiling_per_day || 0),
    errors
  };
} catch (error) {
  errors.push(`receipt_read_error:${error.message}`);
  report = {
    validator: 'citation-yield-feedback',
    ok: false,
    repo_id: null,
    errors
  };
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) process.exit(result.status || 1);
console.log(
  `CITATION YIELD FEEDBACK REGISTRY PASS: repo=${report.repo_id}; ` +
  `verified=${report.verified_external_citations_with_required_evidence}; ` +
  `decision=${report.velocity_decision}`
);
