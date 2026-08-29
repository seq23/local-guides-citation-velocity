#!/usr/bin/env node
'use strict';
/**
 * Local pantry usage tracer.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG
 *
 * This file and scripts/content/validate_local_pantry_trace.js were byte-for-byte
 * identical four-liners. Both opened content-bank/, counted array lengths, and
 * wrote `{"status":"PASS", ...}` -- the word PASS was a string literal, not a
 * verdict. Neither had an exit(1), a FAIL branch or a throw, so both passed
 * against an empty content-bank/ and would have passed against a corrupt one.
 *
 * Worse, nothing ever executed this file. It has no npm alias and no caller
 * repo-wide; the registry entry for local-pantry-trace merely names it under
 * `requires_files`, which proves the tracer EXISTS and never that it RAN. The
 * validator was therefore "validating" a trace that no tracer had produced.
 *
 * This is now the single producer. It measures two things and asserts neither --
 * asserting is the validator's job -- but every number it reports is counted from
 * disk, and `status` is derived, never authored:
 *
 *   1. INVENTORY: for each content-bank/*.json, the length of every array field.
 *   2. USAGE: which files elsewhere in the repo actually read each bank, split
 *      into `pipeline` consumers (a generator or build path) and `validation_only`
 *      consumers (a gate that inspects the bank but never ships its content).
 *      A bank nobody reads is authored content that reaches no reader, and that
 *      is precisely what a "usage trace" is supposed to surface.
 *
 * Usable as a module (`require(...).trace()`) so the validator runs a trace it
 * actually produced, and as a CLI for inspection.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BANK_DIR = path.join(ROOT, 'content-bank');

// Directories that never consume pantry content at runtime.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', '.wrangler', 'content-bank', 'artifacts',
  'reports', 'dist', 'releases', 'staging', 'proofs', 'logs', 'tmp',
]);
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.yml', '.yaml']);

// The tracer and the trace validator reference every bank name by definition.
// Counting themselves as consumers would make the usage measurement circular.
const SELF = new Set([
  'scripts/content/trace_local_pantry_usage.js',
  'scripts/content/validate_local_pantry_trace.js',
]);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(abs, out);
    } else if (SCAN_EXT.has(path.extname(ent.name))) {
      out.push(abs);
    }
  }
  return out;
}

function classify(rel) {
  return /(^|\/)validate_|(^|\/)scripts\/validators\/|(^|\/)scripts\/validation\//.test(rel)
    ? 'validation_only'
    : 'pipeline';
}

function trace() {
  const bankDirExists = fs.existsSync(BANK_DIR);
  const bankFiles = bankDirExists
    ? fs.readdirSync(BANK_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];

  const files = {};
  const parseErrors = [];
  let itemsExamined = 0;

  for (const f of bankFiles) {
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(path.join(BANK_DIR, f), 'utf8'));
    } catch (e) {
      parseErrors.push(`${f}: ${e.message}`);
      files[f] = { parse_error: e.message, arrays: {}, items: 0, consumers: [] };
      continue;
    }
    const arrays = Object.fromEntries(
      Object.entries(obj).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])
    );
    const items = Object.values(arrays).reduce((a, b) => a + b, 0);
    itemsExamined += items;
    files[f] = { arrays, items, consumers: [] };
  }

  // Usage pass: one walk, every bank name matched against every candidate file.
  const sources = walk(ROOT);
  for (const abs of sources) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (SELF.has(rel)) continue;
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    for (const f of bankFiles) {
      if (!text.includes(f)) continue;
      files[f].consumers.push({ file: rel, kind: classify(rel) });
    }
  }

  const unconsumed = bankFiles.filter((f) => files[f].consumers.length === 0);
  const validationOnly = bankFiles.filter((f) =>
    files[f].consumers.length > 0 && files[f].consumers.every((c) => c.kind === 'validation_only'));
  const pipelineBacked = bankFiles.filter((f) =>
    files[f].consumers.some((c) => c.kind === 'pipeline'));

  return {
    schema_version: '2.0',
    repo: 'local-guides-citation-velocity',
    // Derived from what was counted. Never a literal.
    status: (!bankDirExists || bankFiles.length === 0 || itemsExamined === 0 || parseErrors.length)
      ? 'FAIL' : 'PASS',
    bank_dir_exists: bankDirExists,
    bank_file_count: bankFiles.length,
    items_examined: itemsExamined,
    sources_scanned: sources.length,
    parse_errors: parseErrors,
    unconsumed_banks: unconsumed,
    validation_only_banks: validationOnly,
    pipeline_backed_banks: pipelineBacked,
    files,
    traced_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
  };
}

function writeTrace(result) {
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
  const body = JSON.stringify(result, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, 'reports/local-pantry-trace.json'), body);
  fs.writeFileSync(path.join(ROOT, 'artifacts/validation/local-pantry-trace.json'), body);
}

module.exports = { trace, writeTrace, BANK_DIR };

if (require.main === module) {
  const result = trace();
  writeTrace(result);
  console.log(JSON.stringify(result, null, 2));
  // The tracer reports; the validator judges. But a trace that measured nothing
  // is not a trace, so the producer refuses to exit 0 on it either.
  if (result.status === 'FAIL') process.exit(1);
}
