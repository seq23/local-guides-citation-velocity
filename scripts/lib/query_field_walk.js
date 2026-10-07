'use strict';
/**
 * One definition of "a query field", read by both the migration that cleaned the
 * stores (scripts/migrations/strip_model_names_from_query_fields.js) and the
 * validator that keeps them clean (scripts/validators/validate_query_fields_model_free.js).
 *
 * A query field holds the reader's search text. It is slugified into routes,
 * copied into required_markers (copy a rebuild is then obliged to keep printing),
 * and matched against rendered pages by agent-run coverage. The answer engine that
 * produced an observation is provenance and lives in its own field (model / engine
 * / surface), never inside the query.
 *
 * Scope: every git-tracked .json under data/ and content/, except the protected
 * agent roots (raw and normalized agent drops and their dated semantic manifests
 * are provenance, never rewritten - the intake strip applies when they are read).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const QUERY_FIELD_KEYS = new Set([
  'query', 'queries', 'normalized_query', 'query_target', 'primary_query', 'target_query',
  'llm_bait_phrase', 'required_markers',
]);
// Reader copy built straight from a query (readerFacingQueryPrompt). Cleaned by the
// migration as a source fix; NOT asserted by the validator - copy is copy-hygiene's
// job, reported and never blocking (owner decision 2026-09-22).
const QUERY_DERIVED_COPY_KEYS = new Set(['checklist']);
const PROTECTED_ROOTS = [
  'data/report_fixes/agent_runs/',
  'data/report_fixes/normalized_agent_runs/',
  'data/report_fixes/source_record_ledgers/',
  'data/report_fixes/agent_exact_semantic_manifests/',
];

function trackedJsonFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', 'data', 'content'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((f) => f.endsWith('.json') && !PROTECTED_ROOTS.some((p) => f.startsWith(p)));
}

/** Calls visit(holder, key, value, jsonPath) for every string or string[] under a query key. */
function walk(node, keys, visit, jsonPath = '') {
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, keys, visit, `${jsonPath}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const p = `${jsonPath}.${k}`;
    if (keys.has(k) && (typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')))) visit(node, k, v, p);
    else walk(v, keys, visit, p);
  }
}

function readJsonFile(root, rel) {
  const raw = fs.readFileSync(path.join(root, rel));
  try { return { raw: raw.toString('utf8'), doc: JSON.parse(raw.toString('utf8')) }; } catch { return null; }
}

module.exports = { QUERY_FIELD_KEYS, QUERY_DERIVED_COPY_KEYS, PROTECTED_ROOTS, trackedJsonFiles, walk, readJsonFile };
