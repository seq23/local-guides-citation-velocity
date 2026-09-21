#!/usr/bin/env node
'use strict';
/**
 * Every landed agent run compiles into a manifest its own validator accepts.
 *
 * THE OUTAGE, FOUR TIMES. An agent run lands on main as raw artifacts plus a
 * manifest; the placement step normalizes it and pushes, WITHOUT compiling it.
 * The first time anything compiled those rows was inside Velocity Content
 * Release, one job later, where compile_html_fix_acceptance_manifest.js wrote
 * the semantic acceptance manifest and agent-exact-acceptance-manifest then
 * rejected the entry it had just written:
 *
 *   2026-09-11 (x2), 2026-09-15, 2026-09-21 run 35608255777:
 *     insights/personal-injury-q008-*:row:agent_94aa39fe97f8f518:compiled_artifact_missing:Mistakes that can increase a fault dispute
 *     insights/personal-injury-q008-*:row:agent_6a5bb44a9cdb25ba:missing_column:Why it matters
 *
 * The compiler and the validator each kept their own idea of what makes an
 * entry satisfiable, and the compiler never asked the question before writing.
 * Now one function answers it - html_fix_rendering_contract.selfConsistencyErrors,
 * shared by the compiler (which REFUSES an inconsistent entry by name rather
 * than writing it) and the validator (which still fails a durable entry that
 * has become inconsistent). This guard asks that same question of every landed
 * run at ABSORPTION TIME, in Validate Repo, on the drop commit itself: the rows
 * are grouped per page exactly as build_agent_exact_implementation_plan.js
 * groups them and compiled through the same passes the durable manifest gets.
 *
 * A failure here means the compile path is broken for a shape of row that is on
 * disk - which is a defect in scripts/lib/html_fix_acceptance_parser.js or
 * html_fix_acceptance_compile.js, never in the run. It fails on the PR that
 * breaks the parser, not on the next agent drop.
 *
 * It also proves the predicate itself is alive, once per run: a constructed
 * entry with a row whose block no artifact answers MUST produce errors, and the
 * 2026-09-21 personal-injury-q039 shape (four rows naming one heading, one of
 * them naming its columns) MUST compile to a single artifact carrying those
 * columns with zero errors. If either stops holding, the guard fails itself.
 *
 * It hard-fails on zero examined runs: "0 runs previewed" is not a pass.
 */
const fs = require('fs');
const path = require('path');
const { compileEntryFromSpec } = require('../lib/html_fix_acceptance_parser');
const { compileDurableEntry, renderedStringsPass, selfConsistencyErrors } = require('../lib/html_fix_acceptance_compile');
const { zeroExaminationVerdict } = require('../lib/zero_item_examination');

const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const RUNS_DIR = 'data/report_fixes/normalized_agent_runs';
const REPORT_PATH = 'artifacts/validation/agent-run-compile-preview.json';

function readJson(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
function writeJson(rel, value) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}
function normalizeImplementationPath(value) {
  return String(value || '').replace(/^\/+/, '').replace(/\/+$/, '') || '';
}
function recommendationText(row) {
  if (typeof row.recommendation === 'string' && row.recommendation.trim()) return row.recommendation;
  const fields = row.recommendation_fields || {};
  return String(fields.raw || fields.recommendation || '');
}

// The planner's grouping (build_agent_exact_implementation_plan.js): one spec per
// intended winner page, every repair row on that page in file order. Selection by
// budget only ever takes a subset of these rows, and the compiler merges same-key
// artifacts row by row, so the full set is the shape that stresses it most.
function specsForRun(rel, payload) {
  const groups = new Map();
  for (const row of payload.records || []) {
    if (row.source && row.source !== 'twin_agent_artifact') continue;
    if (String(row.operation || '') !== 'REPAIR_INTENDED_WINNER_PAGE') continue;
    if (String(row.status || '') !== 'READY_TO_RELEASE') continue;
    const implementationPath = normalizeImplementationPath(row.intended_winner_path || row.implementation_path);
    const recommendation = recommendationText(row);
    if (!implementationPath || !recommendation.trim()) continue;
    if (!groups.has(implementationPath)) {
      groups.set(implementationPath, { record_ids: [], queries: [], recommendations: [], run_date: row.run_date || '' });
    }
    const group = groups.get(implementationPath);
    group.record_ids.push(String(row.id));
    group.queries.push(String(row.query || ''));
    group.recommendations.push(recommendation);
  }
  return [...groups.entries()].map(([implementationPath, group]) => ({
    record_id: group.record_ids[0],
    record_ids: group.record_ids,
    run_date: group.run_date,
    query: group.queries[0],
    queries: [...new Set(group.queries)],
    implementation_path: implementationPath,
    intended_winner_path: implementationPath,
    operation: 'REPAIR_INTENDED_WINNER_PAGE',
    normalized_path: rel,
    fix_recommendations: [...new Set(group.recommendations)]
  }));
}

// The predicate must be able to say no, and the outage shape must now compile.
function selfTest() {
  const errors = [];
  const unanswerable = {
    implementation_path: 'insights/self-test.html',
    artifacts: [{ type: 'protocol', title: 'A heading the page has' }],
    row_requirements: [{ row_id: 'self_test_row', required_blocks: [{ type: 'comparison_table', heading_exact: 'A heading the page has', columns_exact: ['Factor'] }] }]
  };
  const negative = selfConsistencyErrors(unanswerable);
  if (!negative.some((error) => error.includes('compiled_artifact_missing'))) {
    errors.push('self_test:predicate_dead: a row whose block no artifact answers produced no compiled_artifact_missing error');
  }
  const heading = 'Compare Two Contingency Agreements Line by Line';
  const q039 = {
    record_id: 'st_1',
    record_ids: ['st_1', 'st_2', 'st_3', 'st_4'],
    query: 'how should i compare contingency fees and case costs for injury lawyers',
    queries: ['how should i compare contingency fees and case costs for injury lawyers'],
    implementation_path: 'insights/self-test-q039.html',
    fix_recommendations: [
      `FILEPATH: insights/self-test-q039.html || CURRENT: H2 "${heading}" has placeholder rows. || EDIT: Replace the placeholder rows in “${heading}” with a cost comparison covering pre-suit percentage, litigation percentage, and advanced costs.`,
      `FILEPATH: insights/self-test-q039.html || EDIT: Add an H2 titled “${heading}” and a cost table with columns “Ask each lawyer,” “Why it changes your net,” and “Answer from Firm A/Firm B,” including rows for pre-suit and litigation percentages, reimbursable costs, and liens.`,
      `FILEPATH: insights/self-test-q039.html || EDIT: Replace the placeholder rows in “${heading}” with a fill-in cost worksheet covering trial percentages, medical liens, and loss-outcome responsibility.`,
      `FILEPATH: insights/self-test-q039.html || EDIT: Collapse the five duplicate '${heading}' H2s into one and replace the placeholder cost rows beneath it with four concrete rows: contingency percentage, who fronts case costs, deduction order, and what happens on no recovery.`
    ]
  };
  const entry = compileEntryFromSpec(q039);
  const positive = entry ? selfConsistencyErrors(entry) : ['entry_not_compiled'];
  if (positive.length) errors.push(`self_test:outage_shape_still_inconsistent: ${positive.slice(0, 4).join('; ')}`);
  const copies = (entry ? entry.artifacts : []).filter((artifact) => artifact.type === 'cost_table' && artifact.title === heading);
  if (copies.length !== 1) errors.push(`self_test:outage_shape_duplicated: ${copies.length} cost_table artifact(s) titled "${heading}", expected exactly 1`);
  const headers = copies[0] ? copies[0].headers : [];
  for (const column of ['Ask each lawyer', 'Why it changes your net', 'Answer from Firm A/Firm B']) {
    if (!headers.includes(column)) errors.push(`self_test:named_columns_lost: merged artifact lacks "${column}" (headers: ${JSON.stringify(headers)})`);
  }
  if (headers.some((header) => /[,;:]$/.test(header))) errors.push(`self_test:header_keeps_trailing_punctuation: ${JSON.stringify(headers)}`);
  return errors;
}

function main() {
  const errors = [];
  const runs = [];
  const runsDir = path.join(ROOT, RUNS_DIR);
  const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort() : [];
  const renderedStrings = renderedStringsPass();
  let specCount = 0;
  let inconsistentCount = 0;
  for (const name of files) {
    const rel = `${RUNS_DIR}/${name}`;
    const payload = readJson(rel);
    if (!payload || !Array.isArray(payload.records)) {
      errors.push(`${rel}:unreadable_normalized_run`);
      continue;
    }
    const specs = specsForRun(rel, payload);
    const inconsistent = [];
    for (const spec of specs) {
      specCount += 1;
      let entry;
      try { entry = compileDurableEntry(spec, renderedStrings); }
      catch (error) {
        inconsistent.push({ implementation_path: spec.implementation_path, record_ids: spec.record_ids, errors: [`compile_threw:${error.message}`] });
        continue;
      }
      if (!entry) continue;
      const found = selfConsistencyErrors(entry);
      if (found.length) inconsistent.push({ implementation_path: spec.implementation_path, record_ids: spec.record_ids, errors: found });
    }
    inconsistentCount += inconsistent.length;
    runs.push({ run: rel, run_id: payload.run_id || '', records: payload.records.length, specs: specs.length, inconsistent });
    for (const item of inconsistent) {
      errors.push(`${rel}:${item.implementation_path}:entry_not_self_consistent:${item.errors.slice(0, 4).join(';')}`);
    }
  }
  errors.push(...selfTest());

  const verdict = zeroExaminationVerdict({
    validator: 'agent-run-compile-preview',
    unit: 'normalized agent run(s)',
    examined: runs.length,
    available: files.length,
    stopReason: `${RUNS_DIR} holds no normalized agent run, so no run could compile into anything`,
    inputs: [RUNS_DIR]
  });
  if (verdict.error) errors.push(verdict.error);
  // A stop on zero runs is a named stop for the intake, but in THIS repository the
  // directory has held runs since 2026-07; an empty directory is a broken checkout.
  if (!runs.length && !verdict.error) errors.push(`agent-run-compile-preview:zero_runs: ${RUNS_DIR} is empty, and this repository has carried normalized runs since 2026-07 - nothing was examined`);

  const report = {
    schema_version: '1.0',
    guard: 'agent-run-compile-preview',
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: DATE,
    inputs: [RUNS_DIR],
    runs_examined: runs.length,
    specs_compiled: specCount,
    inconsistent_entries: inconsistentCount,
    named_stop: verdict.named_stop,
    runs,
    errors
  };
  writeJson(REPORT_PATH, report);

  if (errors.length) {
    console.error('AGENT RUN COMPILE PREVIEW FAIL');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log(`AGENT RUN COMPILE PREVIEW PASS: ${runs.length} normalized run(s); ${specCount} page spec(s) compiled; 0 would be refused by agent-exact-acceptance-manifest; self-test held`);
}

main();
