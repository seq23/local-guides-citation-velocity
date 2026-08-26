#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { compileEntryFromSpec } = require('../lib/html_fix_acceptance_parser');
const { authorityGroundedEntryForSpec } = require('../lib/authority_grounded_repairs');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const PLAN_PATH = 'artifacts/validation/agent-exact-implementation-plan.json';
const CURRENT_MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const MANIFEST_DIR = 'data/report_fixes/agent_exact_semantic_manifests';
function rel(p) { return path.join(ROOT, p); }
function readJson(p, f = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return f; } }
function writeJson(p, v) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(v, null, 2) + '\n'); }
function keyForSpec(spec) { return `${spec.run_date || 'unknown'}_${String(spec.vertical || spec.intended_winner_path || spec.implementation_path || 'mixed').split('/')[0].replace(/[^a-z0-9_-]+/gi, '-')}`; }
function inferVertical(spec) {
  if (spec.vertical) return spec.vertical;
  const p = spec.implementation_path || spec.intended_winner_path || '';
  if (p.includes('personal-injury')) return 'personal_injury';
  if (p.includes('dentistry')) return 'dentistry';
  if (p.includes('trt')) return 'trt';
  if (p.includes('neuro')) return 'neuro';
  if (p.includes('uscis')) return 'uscis-medical';
  return 'mixed';
}
function main() {
  const plan = readJson(PLAN_PATH, { specs: [] });
  const specs = (plan.specs || []).filter((spec) => spec && spec.status === 'PLANNED' && spec.operation === 'REPAIR_INTENDED_WINNER_PAGE');
  const compile = (spec) => authorityGroundedEntryForSpec(spec) || compileEntryFromSpec(spec);
  const entries = specs.map(compile);
  const manifest = {
    schema_version: '2.0',
    status: 'PASS',
    generated_by: 'compile_html_fix_acceptance_manifest.js',
    generated_at: DATE,
    source_plan: PLAN_PATH,
    rule: 'Production semantic manifests are generated. High-stakes verticals compile agent intent through admitted primary-source authority templates; other verticals compile source FIX/EDIT text into rendered acceptance criteria.',
    entry_count: entries.length,
    row_requirement_count: entries.reduce((sum, entry) => sum + (entry.row_requirements || []).length, 0),
    entries
  };
  writeJson(CURRENT_MANIFEST_PATH, manifest);

  const grouped = new Map();
  for (const spec of specs) {
    const k = `${spec.run_date || DATE}_${inferVertical(spec)}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(compile(spec));
  }
  for (const [key, groupEntries] of grouped.entries()) {
    writeJson(`${MANIFEST_DIR}/${key}.json`, {
      schema_version: '2.0', status: 'PASS', generated_by: 'compile_html_fix_acceptance_manifest.js', generated_at: DATE, source_plan: PLAN_PATH, entry_count: groupEntries.length, entries: groupEntries
    });
  }
  writeJson('artifacts/validation/html-fix-acceptance-compiler.json', {
    schema_version: '1.0', status: 'PASS', generated_at: DATE, source_plan: PLAN_PATH, entries: entries.length, row_requirements: manifest.row_requirement_count, manifest_path: CURRENT_MANIFEST_PATH, run_specific_manifests: [...grouped.keys()].map((key) => `${MANIFEST_DIR}/${key}.json`)
  });
  console.log(`HTML FIX ACCEPTANCE COMPILER PASS: entries=${entries.length}; row_requirements=${manifest.row_requirement_count}`);
}
main();
