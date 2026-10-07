#!/usr/bin/env node
'use strict';
/**
 * No answer-engine name inside a query field.
 *
 * Why this is a blocker (hard_fail_basis: user_safety_or_false_public_claim -
 * "internal build text shown to readers"; and public_route_integrity)
 * ---------------------------------------------------------------------
 * A query field is not inert data. routeForFamily slugifies it into a URL, the fix
 * ledger copies it into required_markers (copy every rebuild must keep printing),
 * and agent-run coverage matches it against rendered pages. A panel label inside it
 * - "best TRT clinic near me (Perplexity)" - therefore became seven public URLs
 * ending -openai-gpt-4o / -perplexity / -gemini-1-5-flash (301'd 2026-08-29), 16 live
 * insight pages printing "(OpenAI GPT-4o)" in their checklist, and 74 false
 * "live_missing_markers" gaps. On 2026-10-07 265 values in 5 stores still carried one,
 * 15 days after the intake strip, because merges re-banked them.
 *
 * Scope is the RECORD layer, not page copy: rendered/reader copy is copy-hygiene's
 * job (warning only, owner decision 2026-09-22). This fails only when a writer puts
 * a model name into a query field, which no well-formed run does - the intake strips
 * it (agent_artifact_source_parser.js questionFrom) and every carry-forward writer
 * cleans on write (model_name_guard.js cleanQueryText). Content motion cannot red it.
 *
 * Repair: node scripts/migrations/strip_model_names_from_query_fields.js
 * Rule 0: fails on zero query fields examined.
 */
const fs = require('fs');
const path = require('path');
const { hasEngineLabel, modelNamesIn } = require('../lib/model_name_guard');
const { QUERY_FIELD_KEYS, trackedJsonFiles, walk, readJsonFile } = require('../lib/query_field_walk');

const ROOT = process.cwd();
const EVIDENCE = 'artifacts/validation/query-fields-model-free.json';
const problems = [];
let examined = 0;
let files = 0;
for (const rel of trackedJsonFiles(ROOT)) {
  const read = readJsonFile(ROOT, rel);
  if (!read) continue;
  files += 1;
  walk(read.doc, QUERY_FIELD_KEYS, (holder, k, v, p) => {
    for (const s of typeof v === 'string' ? [v] : v) {
      examined += 1;
      if (hasEngineLabel(s)) problems.push({ file: rel, path: p, value: s.slice(0, 160), model_names: modelNamesIn(s) });
    }
  });
}
if (examined === 0) problems.push({ file: '(none)', path: '', value: 'examined zero query fields - a guard that passes on an empty walk is the defect it hunts', model_names: [] });
const ok = problems.length === 0;
fs.mkdirSync(path.join(ROOT, path.dirname(EVIDENCE)), { recursive: true });
fs.writeFileSync(path.join(ROOT, EVIDENCE), `${JSON.stringify({ validator: 'query-fields-model-free', ok, files_examined: files, query_fields_examined: examined, problem_count: problems.length, problems: problems.slice(0, 200) }, null, 2)}\n`);
if (!ok) {
  console.error(`QUERY FIELDS MODEL-FREE FAIL: ${problems.length} query field value(s) name an answer engine (${examined} examined in ${files} files). The engine is provenance and lives in its own field.`);
  for (const p of problems.slice(0, 15)) console.error(`  ${p.file} ${p.path}: "${p.value}" [${p.model_names.join(', ')}]`);
  console.error('  Repair: node scripts/migrations/strip_model_names_from_query_fields.js, then find the writer that skipped cleanQueryText.');
  process.exit(1);
}
console.log(`QUERY FIELDS MODEL-FREE PASS: ${examined} query field value(s) in ${files} tracked JSON files carry no answer-engine name.`);
