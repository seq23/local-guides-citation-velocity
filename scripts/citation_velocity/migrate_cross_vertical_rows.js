#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Take personal-injury row copy out of the durable stores on every other route.
 *
 * scripts/lib/html_fix_acceptance_parser.js used to answer any table requirement that
 * mentioned a fee, a cost or "pressure" with lawyer-shopping copy ("Get the contingency
 * percentage ..."), whatever the page. The compiler no longer does that, and
 * mergeAcceptedArtifacts screens it at render time - but the stores the renderer merges
 * still hold the delivered copies, and a store that says one thing while every page
 * says another is two components each keeping their own list. This rewrites them
 * through the SAME function the renderer uses (scripts/lib/vertical_rows.js
 * screenCrossVerticalRows), so there is one answer.
 *
 * What it touches, on non-personal-injury routes only:
 *   - data/release/accepted_page_artifacts.json      (delivered blocks)
 *   - data/release/historic_recovered_artifacts.json (blocks recovered from git)
 *   - data/report_fixes/agent_exact_semantic_acceptance_manifest.json
 *       artifacts' rows, and any required_string / checklist entry that is exactly a
 *       lawyer guidance cell (a promise the page no longer makes).
 *
 * What it never touches: cell one of a row (it carries the requirement, which can be a
 * ledgered marker - acceptMutationScope refuses a rebuild that loses one), any
 * personal-injury route, and rendered HTML. Pages change by being rebuilt:
 *
 *   --thaw   also open a mutation scope for every affected route that is frozen, so the
 *            next `npm run build` re-renders them and `node scripts/frozen_pages.js
 *            accept` re-freezes them under the ledgered-marker guard. Then run
 *            `npm run recover:accepted-artifacts` so the store is re-derived from the
 *            newly accepted bytes.
 *   --check  write nothing; exit 1 if any store still carries lawyer copy off a PI route.
 *
 * Idempotent: a second run changes nothing. Rule 0: finding no stores, or examining
 * zero routes, is a failure, never a clean bill of health.
 */

const fs = require('fs');
const path = require('path');
const { screenCrossVerticalRows, isPersonalInjuryRoute, isPersonalInjuryGuidanceCell, PERSONAL_INJURY_GUIDANCE_CELLS } = require('../lib/vertical_rows');

const ROOT = path.resolve(__dirname, '../..');
const STORES = ['data/release/accepted_page_artifacts.json', 'data/release/historic_recovered_artifacts.json'];
const MANIFEST = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const EVIDENCE = 'artifacts/validation/cross-vertical-row-migration.json';
const CHECK_ONLY = process.argv.includes('--check');
const THAW = process.argv.includes('--thaw');

function rel(p) { return path.join(ROOT, p); }
function readJson(p) { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); }
function writeJson(p, value) { fs.writeFileSync(rel(p), `${JSON.stringify(value, null, 2)}\n`); }
function toRoute(renderedRel) {
  const r = String(renderedRel || '').replace(/^\/+/, '');
  return r.endsWith('/index.html') ? `/${r.slice(0, -'index.html'.length)}` : (r === 'index.html' ? '/' : `/${r}`);
}
function countRows(before, after) {
  let n = 0;
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i]; const b = after[i];
    if (!a || !Array.isArray(a.rows) || a === b) continue;
    n += a.rows.filter((row, j) => row !== b.rows[j]).length;
  }
  return n;
}

const affected = new Map(); // rendered rel -> rows rewritten
let examined = 0;
const changedFiles = [];

for (const store of STORES) {
  if (!fs.existsSync(rel(store))) { console.error(`CROSS-VERTICAL ROW MIGRATION FAIL: ${store} is missing.`); process.exit(1); }
  const doc = readJson(store);
  let changed = false;
  for (const [key, record] of Object.entries(doc.routes || {})) {
    examined += 1;
    const before = record.artifacts || [];
    const after = screenCrossVerticalRows(before, key);
    const n = countRows(before, after);
    if (!n) continue;
    affected.set(key, (affected.get(key) || 0) + n);
    doc.routes[key] = { ...record, artifacts: after };
    changed = true;
  }
  if (changed) { changedFiles.push(store); if (!CHECK_ONLY) writeJson(store, doc); }
}

{
  const doc = readJson(MANIFEST);
  let changed = false;
  const dropCells = (list) => (Array.isArray(list) ? list.filter((value) => !isPersonalInjuryGuidanceCell(value)) : list);
  doc.entries = (doc.entries || []).map((entry) => {
    examined += 1;
    const key = String(entry.implementation_path || '');
    if (!key || isPersonalInjuryRoute(key)) return entry;
    const artifacts = screenCrossVerticalRows(entry.artifacts || [], key);
    const n = countRows(entry.artifacts || [], artifacts);
    const required = dropCells(entry.required_strings);
    const checklist = dropCells(entry.checklist);
    const rows = (entry.row_requirements || []).map((row) => {
      const strings = dropCells(row.required_strings);
      return strings && strings.length !== (row.required_strings || []).length ? { ...row, required_strings: strings } : row;
    });
    const stringsMoved = (required || []).length !== (entry.required_strings || []).length
      || (checklist || []).length !== (entry.checklist || []).length
      || rows.some((row, i) => row !== entry.row_requirements[i]);
    if (!n && !stringsMoved) return entry;
    if (n) affected.set(key, (affected.get(key) || 0) + n);
    changed = true;
    return { ...entry, artifacts, required_strings: required, checklist, row_requirements: rows };
  });
  if (changed) { changedFiles.push(MANIFEST); if (!CHECK_ONLY) writeJson(MANIFEST, doc); }
}

if (!examined) {
  console.error('CROSS-VERTICAL ROW MIGRATION FAIL: examined zero routes across the stores. "Nothing to migrate" and "nothing was read" are not the same answer.');
  process.exit(1);
}

// Routes to rebuild: every non-PI rendered page that still publishes lawyer guidance,
// plus every route whose store copy just changed. The rendered bytes are the truth.
const rendered = new Set();
(function walk(dir) {
  const SKIP = new Set(['node_modules', 'data', 'artifacts', 'reports', 'dist', 'docs', 'templates', 'staging', 'content-bank', 'releases', 'proofs', 'outputs']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const r = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(abs); continue; }
    if (!entry.name.endsWith('.html') || isPersonalInjuryRoute(r)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    if (PERSONAL_INJURY_GUIDANCE_CELLS.some((cell) => html.includes(cell))) rendered.add(r);
  }
})(ROOT);
const routes = [...new Set([...affected.keys(), ...rendered])].sort();

let thawed = [];
if (THAW && !CHECK_ONLY && routes.length) {
  const { beginMutationScope } = require('../lib/frozen_pages');
  const scope = beginMutationScope(routes.map(toRoute), `cross-vertical-rows-${process.env.SOURCE_DATE || 'manual'}`);
  thawed = scope.thawed_routes || [];
}

fs.mkdirSync(rel(path.dirname(EVIDENCE)), { recursive: true });
fs.writeFileSync(rel(EVIDENCE), `${JSON.stringify({
  schema_version: '1.0',
  mode: CHECK_ONLY ? 'CHECK' : 'WRITE',
  routes_examined: examined,
  store_files_changed: changedFiles,
  store_routes_rewritten: affected.size,
  rows_rewritten: [...affected.values()].reduce((a, b) => a + b, 0),
  rendered_pages_publishing_lawyer_copy: [...rendered].sort(),
  routes_to_rebuild: routes,
  thawed_routes: thawed
}, null, 2)}\n`);

if (CHECK_ONLY) {
  if (changedFiles.length) {
    console.error(`CROSS-VERTICAL ROW MIGRATION FAIL (--check): ${affected.size} non-personal-injury route(s) still carry lawyer row copy in ${changedFiles.join(', ')}. Run without --check.`);
    process.exit(1);
  }
  console.log(`CROSS-VERTICAL ROW MIGRATION PASS (--check): ${examined} route record(s) examined; no store carries lawyer row copy off a personal-injury route. ${rendered.size} rendered page(s) still do and need a rebuild.`);
  process.exit(0);
}
console.log(`CROSS-VERTICAL ROW MIGRATION: ${examined} route record(s) examined; ${affected.size} store route(s) rewritten (${[...affected.values()].reduce((a, b) => a + b, 0)} row(s)) in ${changedFiles.length} file(s); ${rendered.size} rendered page(s) still publish lawyer copy; ${routes.length} route(s) to rebuild${THAW ? `, ${thawed.length} thawed` : ''}.`);
for (const r of routes) console.log(`  ${r}`);
