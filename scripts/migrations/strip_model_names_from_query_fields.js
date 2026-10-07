#!/usr/bin/env node
'use strict';
/**
 * One-off clean of answer-engine labels out of query fields (2026-10-07).
 *
 * The intake strip landed 2026-09-22 (a7670612d, scripts/lib/agent_artifact_source_parser.js
 * questionFrom), but every store that carries a query forward merged the old value
 * back in: the fix ledger's `...prior` (prepare_velocity_intake_release.js updateLedger),
 * the implementation ledger's `queries` union and the insights checklist union
 * (scripts/lib/agent_exact_repairs.js). Those writers now clean on write; this
 * rewrites what they had already banked, through the SAME function
 * (scripts/lib/model_name_guard.js cleanQueryText), and records every change.
 *
 *   node scripts/migrations/strip_model_names_from_query_fields.js          # apply + audit
 *   node scripts/migrations/strip_model_names_from_query_fields.js --check  # exit 1 if anything left
 *
 * Audit: data/migrations/2026-10-07_model_names_out_of_query_fields.json (file, json
 * path, before, after). Idempotent: a second run changes nothing and keeps the audit.
 */
const fs = require('fs');
const path = require('path');
const { cleanQueryText } = require('../lib/model_name_guard');
const { QUERY_FIELD_KEYS, QUERY_DERIVED_COPY_KEYS, trackedJsonFiles, walk, readJsonFile } = require('../lib/query_field_walk');

const ROOT = process.cwd();
const AUDIT = 'data/migrations/2026-10-07_model_names_out_of_query_fields.json';
const check = process.argv.includes('--check');
const keys = new Set([...QUERY_FIELD_KEYS, ...QUERY_DERIVED_COPY_KEYS]);
const changes = [];
const skipped = [];
let examined = 0;

for (const rel of trackedJsonFiles(ROOT)) {
  if (rel === AUDIT) continue;
  const read = readJsonFile(ROOT, rel);
  if (!read) continue;
  let changed = false;
  walk(read.doc, keys, (holder, k, v, p) => {
    examined += 1;
    if (typeof v === 'string') {
      const after = cleanQueryText(v);
      if (after !== v) { changes.push({ file: rel, path: p, before: v, after }); holder[k] = after; changed = true; }
    } else {
      const after = [...new Set(v.map(cleanQueryText))];
      if (after.length !== v.length || after.some((x, i) => x !== v[i])) {
        v.forEach((x, i) => { const y = cleanQueryText(x); if (y !== x) changes.push({ file: rel, path: `${p}[${i}]`, before: x, after: y }); });
        holder[k] = after; changed = true;
      }
    }
  });
  if (!changed || check) continue;
  // Only rewrite a file whose bytes are exactly what JSON.stringify(…, 2) produces,
  // so the diff is the cleaned values and nothing else.
  const original = JSON.parse(read.raw);
  if (`${JSON.stringify(original, null, 2)}\n` !== read.raw) { skipped.push(rel); continue; }
  fs.writeFileSync(path.join(ROOT, rel), `${JSON.stringify(read.doc, null, 2)}\n`);
}

if (examined === 0) { console.error('query-field migration: examined zero query fields - refusing to report clean on an empty walk.'); process.exit(1); }
if (skipped.length) { console.error(`query-field migration: NOT rewritten (non-canonical JSON formatting, clean by hand): ${skipped.join(', ')}`); process.exit(1); }
if (check) {
  if (changes.length) { console.error(`query-field migration --check: ${changes.length} value(s) still carry a model name, e.g. ${changes[0].file} ${changes[0].path}: "${changes[0].before}"`); process.exit(1); }
  console.log(`query-field migration --check: clean (${examined} query fields examined).`);
  process.exit(0);
}
if (changes.length) {
  const byFile = changes.reduce((a, c) => { a[c.file] = (a[c.file] || 0) + 1; return a; }, {});
  fs.mkdirSync(path.join(ROOT, path.dirname(AUDIT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, AUDIT), `${JSON.stringify({
    schema_version: '1.0',
    migration: 'scripts/migrations/strip_model_names_from_query_fields.js',
    applied_on: '2026-10-07',
    why: 'Answer-engine labels ("(Perplexity)", "(OpenAI GPT-4o)", "Gemini 1.5 Flash") entered query fields before the 2026-09-22 intake strip and were carried forward by merges. The engine is provenance; the query is the reader search text.',
    query_fields_examined: examined,
    values_changed: changes.length,
    by_file: byFile,
    changes,
  }, null, 2)}\n`);
}
console.log(`query-field migration: ${changes.length} value(s) cleaned across ${new Set(changes.map((c) => c.file)).size} file(s); ${examined} query fields examined.`);
