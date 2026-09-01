#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { compileEntryFromSpec, phrasesTheFixAsksToRemove, normalizeForbidden } = require('../lib/html_fix_acceptance_parser');
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
  const compiled = specs.map(compile);

  // The manifest is DURABLE, not a per-run snapshot.
  //
  // It was rewritten from scratch every run out of the current plan's PLANNED
  // specs. But a row leaves the plan as soon as it lands in the exact-implementation
  // ledger - that is what the ledger is for - so the page's semantic entry vanished
  // on the very next compile, and with it the checklist, artifacts and required
  // strings that build_site.js injects into the page through
  // applyAgentExactRepairsToPage.
  //
  // Nothing surfaced this because almost every affected page is FROZEN: the build
  // restored its accepted HTML and the loss stayed invisible. It became visible the
  // moment two pages were legitimately thawed for an unrelated repair, and they came
  // back 14KB and 22KB lighter - having silently dropped the 5-factor framework and
  // the scoring rubric that a citation run had asked for and the pipeline had
  // already delivered. Frozen output was the only thing standing between this and
  // site-wide content loss.
  //
  // So entries are merged by implementation_path, exactly as mergeLedgerEntries
  // already does for the ledger and for the same reason: this run's compile wins for
  // a path it covers, and a path this run did not plan keeps what was proven for it
  // before.
  const existing = readJson(CURRENT_MANIFEST_PATH, { entries: [] });
  const byPath = new Map();
  for (const entry of existing.entries || []) {
    const key = String(entry && entry.implementation_path || '');
    if (key) byPath.set(key, entry);
  }
  // A carried entry was compiled before requiredStringsForArtifact learned to refuse
  // a phrase its own fix asked to delete, so it can still be asserting one. The
  // recommendation that proves it is stored on the entry as row_requirements[].source_fix,
  // so the same filter is re-applied here rather than trusting an old compile.
  const cleanCarried = (entry) => {
    const forbidden = new Set();
    for (const row of entry.row_requirements || []) {
      for (const phrase of phrasesTheFixAsksToRemove(row.source_fix || '')) forbidden.add(phrase);
    }
    if (!forbidden.size) return entry;
    const drop = (list) => (list || []).filter((value) => !forbidden.has(normalizeForbidden(value)));
    return {
      ...entry,
      required_strings: drop(entry.required_strings),
      checklist: drop(entry.checklist),
      row_requirements: (entry.row_requirements || []).map((row) => ({ ...row, required_strings: drop(row.required_strings) }))
    };
  };

  let carried = 0;
  for (const key of [...byPath.keys()]) {
    if (compiled.some((e) => String(e.implementation_path || '') === key)) continue;
    carried += 1;
    byPath.set(key, cleanCarried(byPath.get(key)));
  }
  for (const entry of compiled) {
    const key = String(entry && entry.implementation_path || '');
    if (key) byPath.set(key, entry);
  }
  const entries = [...byPath.values()].sort((a, b) => String(a.implementation_path).localeCompare(String(b.implementation_path)));
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
  console.log(`HTML FIX ACCEPTANCE COMPILER PASS: entries=${entries.length} (${compiled.length} compiled this run, ${carried} carried forward); row_requirements=${manifest.row_requirement_count}`);
}
main();
