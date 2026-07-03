#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { validateEntryAgainstHtml } = require('../lib/html_fix_rendering_contract');
const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const PLAN_PATH = 'artifacts/validation/agent-exact-implementation-plan.json';
const REPORT_PATH = 'artifacts/validation/agent-exact-acceptance-manifest.json';
function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }
function writeJson(p, value) { fs.mkdirSync(path.dirname(rel(p)), { recursive: true }); fs.writeFileSync(rel(p), JSON.stringify(value, null, 2) + '\n'); }
function normalizePath(value) {
  let out = String(value || '').trim().replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  if (out && !out.endsWith('.html') && !out.endsWith('.json') && !out.endsWith('.csv')) out = out.replace(/\/+$/, '') + '/index.html';
  return out.replace(/\/+/g, '/');
}
function fileText(p) { try { return fs.readFileSync(rel(p), 'utf8'); } catch { return ''; } }
function plannedPathSet(plan) {
  const out = new Set();
  for (const spec of plan.specs || []) {
    if (spec.operation === 'REPAIR_INTENDED_WINNER_PAGE' && spec.status !== 'BLOCKED') out.add(normalizePath(spec.implementation_path || spec.intended_winner_path || spec.target_route));
  }
  return out;
}
function main() {
  const errors = [];
  const traces = [];
  const manifest = readJson(MANIFEST_PATH, null);
  const plan = readJson(PLAN_PATH, { specs: [] });
  if (!manifest) errors.push('missing_semantic_acceptance_manifest');
  if (!manifest || manifest.generated_by !== 'compile_html_fix_acceptance_manifest.js') errors.push('semantic_manifest_must_be_generated_not_hand_authored');
  if (!manifest || !Array.isArray(manifest.entries) || !manifest.entries.length) errors.push('semantic_acceptance_manifest_empty');
  const planned = plannedPathSet(plan);
  const manifestPaths = new Set();
  for (const entry of manifest?.entries || []) {
    const implementationPath = normalizePath(entry.implementation_path);
    manifestPaths.add(implementationPath);
    const html = fileText(implementationPath);
    const renderErrors = validateEntryAgainstHtml(entry, html);
    if (!html) renderErrors.push('missing_rendered_html');
    if (!planned.has(implementationPath)) renderErrors.push('not_present_in_current_agent_exact_plan');
    for (const oldPath of entry.canonicalized_from || []) {
      const stillBlocked = (plan.specs || []).some((spec) => spec.status === 'BLOCKED' && normalizePath(spec.intended_winner_path || spec.target_route) === normalizePath(oldPath));
      if (stillBlocked) renderErrors.push(`canonicalized_path_still_blocked:${oldPath}`);
    }
    traces.push({
      implementation_path: implementationPath,
      trace_status: renderErrors.length ? 'FAIL' : 'PASS',
      row_requirement_count: (entry.row_requirements || []).length,
      required_strings_checked: (entry.required_strings || []).length,
      required_artifact_types: entry.required_artifact_types || [],
      errors: renderErrors,
      canonicalized_from: entry.canonicalized_from || []
    });
    errors.push(...renderErrors.map((err) => `${implementationPath}:${err}`));
  }
  for (const p of planned) if (!manifestPaths.has(p)) errors.push(`${p}:missing_generated_semantic_acceptance_entry`);
  const report = {
    schema_version: '2.0',
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
    manifest_path: MANIFEST_PATH,
    plan_path: PLAN_PATH,
    entry_count: manifest?.entries?.length || 0,
    row_requirement_count: manifest?.row_requirement_count || traces.reduce((sum, t) => sum + t.row_requirement_count, 0),
    generated_by: manifest?.generated_by || '',
    traces,
    errors
  };
  writeJson(REPORT_PATH, report);
  if (errors.length) {
    console.error('AGENT EXACT ACCEPTANCE MANIFEST FAIL');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log(`AGENT EXACT ACCEPTANCE MANIFEST PASS: ${report.entry_count} target(s); ${report.row_requirement_count} row requirement(s)`);
}
main();
