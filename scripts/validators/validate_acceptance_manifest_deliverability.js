#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * THE ACCEPTANCE MANIFEST MAY ONLY PROMISE WHAT THE PAGE CAN ACTUALLY DELIVER.
 *
 * WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
 *
 * On 2026-09-09 the emitters in scripts/lib/html_fix_acceptance_parser.js stopped
 * padding a table up to a requested row count with `Concrete verification point <n>`
 * and `Requirement <n>`, and scripts/lib/template_scaffolding.js became the one shared
 * definition of that family - screened at both durable artifact stores on load and at
 * every render site. 113 published pages stopped shipping an authoring instruction in
 * the cell a reader came to for the answer. OMIT, NEVER PAD.
 *
 * compile_html_fix_acceptance_manifest.js was never told. So the manifest went on
 * ASSERTING the padding as required_strings, and went on carrying min_rows counts that
 * only ever added up while the padded rows existed. The next release run reported the
 * pages as broken for no longer containing text they had been deliberately fixed to
 * stop containing:
 *
 *   dentistry/anxiety-trust/index.html:missing_required_string:Concrete verification point 3
 *   dentistry/choosing-a-dentist/index.html:row:agent_62c166acdc8b1f94:min_rows_not_met:1<3
 *
 * agent-exact-acceptance-manifest went HARD_FAIL on 269 findings, and
 * agent-exact-implementation cascaded off it with semantic_acceptance_manifest_not_pass.
 *
 * Underneath sat a second, quieter version of the same shape. build_site.js ends with
 * restoreFrozenPages(), which puts most routes back byte-for-byte from the accepted
 * store. For a frozen route the compiler's freshly built artifacts are not what any
 * reader sees, so a min_rows or a required_string derived from them is not a statement
 * about the page at all - and cannot be satisfied by any amount of rebuilding:
 *
 *   trt/index.html:row:agent_216e7290b4e17f8d:min_rows_not_met:3<4
 *
 * THE CLASS DEFECT, both times, is two components each keeping their own idea of what
 * a page contains, with no link between them. This validator is that link's guard.
 *
 * WHAT IT PROVES, over every entry in the durable manifest and every per-run manifest:
 *
 *   1. NO TEMPLATE SCAFFOLDING IS ASSERTABLE. Not at entry level, not in `checklist`,
 *      not in `row_requirements[].required_strings`, and not sitting in an entry's own
 *      artifact rows/items/lines where mergeAcceptedArtifacts would put it back into
 *      the answer to "what does this page contain". The patterns are IMPORTED from
 *      scripts/lib/template_scaffolding.js. There is no second list here, deliberately:
 *      a copy would agree with the producers only until one of them was edited.
 *
 *   2. NO min_rows EXCEEDS WHAT IS DELIVERABLE. For a tabular block the contract
 *      actually counts, min_rows may not be greater than the rows the compiled artifact
 *      carries, nor - on a frozen route - than the rows the accepted bytes carry. The
 *      row counter is IMPORTED from scripts/lib/html_fix_rendering_contract.js, the
 *      same function the contract will use, against the same bytes.
 *
 *   3. NO required_string IS ABSENT FROM A FROZEN PAGE. A frozen route's accepted HTML
 *      is immutable by construction, so a string it does not contain is an unsatisfiable
 *      promise, not a repair waiting to happen.
 *
 * The fix for any failure here is to re-run the compiler, which screens all three -
 * NEVER to pad the rows back in.
 *
 * It hard-fails when it examines zero entries while entries were available.
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { isTemplateScaffolding, containsTemplateScaffolding, scaffoldingPatternFor } = require('../lib/template_scaffolding');
const { countRowsNearHeading, includesNormalized } = require('../lib/html_fix_rendering_contract');
const { mergeAcceptedArtifacts } = require('../lib/accepted_artifacts');
const { acceptedHtmlForRoute, normalizeRoute, mutableRouteSet } = require('../lib/frozen_pages');
const { zeroExaminationVerdict } = require('../lib/zero_item_examination');

const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const MANIFEST_DIR = 'data/report_fixes/agent_exact_semantic_manifests';
const REPORT_PATH = 'artifacts/validation/acceptance-manifest-deliverability.json';

// The only block types validateEntryAgainstHtml counts rows for. Asserting min_rows on
// anything else is inert there, so it is not judged here either.
const ROW_COUNTED_TYPES = new Set(['comparison_table', 'decision_matrix', 'cost_table', 'timeline_table', 'severity_matrix', 'scorecard', 'worksheet']);

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }
function writeJson(p, value) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(value, null, 2) + '\n'); }

const errors = [];
const mutable = mutableRouteSet();

function frozenHtmlFor(implementationPath) {
  const route = normalizeRoute(String(implementationPath || ''));
  if (!route || (mutable && mutable.has && mutable.has(route))) return null;
  try { return acceptedHtmlForRoute(route) || null; } catch { return null; }
}

function checkStrings(label, entryPath, values) {
  for (const value of values || []) {
    if (!isTemplateScaffolding(value)) continue;
    const pattern = scaffoldingPatternFor(value);
    errors.push(`${entryPath}:${label}:template_scaffolding_asserted:${String(value).slice(0, 80)}${pattern ? ` (${pattern.source})` : ''}`);
  }
}

function checkEntry(entry, source) {
  if (!entry || typeof entry !== 'object') return;
  const entryPath = `${source}:${String(entry.implementation_path || 'unknown')}`;

  // 1. Nothing from the scaffolding family may be asserted, anywhere it is assertable.
  checkStrings('required_strings', entryPath, entry.required_strings);
  checkStrings('checklist', entryPath, entry.checklist);
  for (const row of entry.row_requirements || []) {
    checkStrings(`row:${row && row.row_id ? row.row_id : 'unknown'}:required_strings`, entryPath, row && row.required_strings);
  }
  // ...including inside the entry's own artifacts, which mergeAcceptedArtifacts feeds
  // straight back into "what this page contains". Leaving them there is how a screened
  // required_strings list still ended up re-acquiring a placeholder.
  for (const artifact of entry.artifacts || []) {
    if (!artifact || typeof artifact !== 'object') continue;
    for (const field of ['rows', 'items', 'lines', 'headers', 'extracted_requirements']) {
      if (!containsTemplateScaffolding(artifact[field])) continue;
      errors.push(`${entryPath}:artifact:${String(artifact.title || artifact.id || 'untitled').slice(0, 60)}:${field}:template_scaffolding_published`);
    }
  }

  // 2 and 3 are statements about DELIVERY, so they need the delivered bytes.
  const merged = mergeAcceptedArtifacts(entry.implementation_path, entry.artifacts || []);
  const frozenHtml = frozenHtmlFor(entry.implementation_path);
  const rowsByTitle = new Map();
  for (const artifact of merged || []) {
    if (!artifact || !artifact.title) continue;
    const count = Array.isArray(artifact.rows) ? artifact.rows.length : (artifact.items || artifact.lines || []).length;
    const key = String(artifact.title).replace(/\s+/g, ' ').trim().toLowerCase();
    rowsByTitle.set(key, Math.max(rowsByTitle.get(key) || 0, count));
  }

  for (const row of entry.row_requirements || []) {
    const rowId = row && row.row_id ? row.row_id : 'unknown';
    for (const block of (row && row.required_blocks) || []) {
      if (!block || !block.min_rows || !ROW_COUNTED_TYPES.has(String(block.type))) continue;
      const want = Number(block.min_rows);
      const key = String(block.heading_exact || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const fromArtifact = rowsByTitle.get(key);
      if (fromArtifact !== undefined && want > fromArtifact) {
        errors.push(`${entryPath}:row:${rowId}:min_rows_exceeds_compiled_artifact:${want}>${fromArtifact}:${block.heading_exact}`);
      }
      if (frozenHtml) {
        const onPage = countRowsNearHeading(frozenHtml, block.heading_exact || '');
        // 0 means the heading is absent, which the contract itself declines to judge.
        if (onPage > 0 && want > onPage) {
          errors.push(`${entryPath}:row:${rowId}:min_rows_exceeds_frozen_page:${want}>${onPage}:${block.heading_exact}`);
        }
      }
    }
  }

  if (!frozenHtml) return;
  for (const value of entry.required_strings || []) {
    if (!includesNormalized(frozenHtml, value)) {
      errors.push(`${entryPath}:required_string_absent_from_frozen_page:${String(value).slice(0, 80)}`);
    }
  }
  for (const row of entry.row_requirements || []) {
    const rowId = row && row.row_id ? row.row_id : 'unknown';
    for (const value of (row && row.required_strings) || []) {
      if (!includesNormalized(frozenHtml, value)) {
        errors.push(`${entryPath}:row:${rowId}:required_string_absent_from_frozen_page:${String(value).slice(0, 80)}`);
      }
    }
  }
}

const manifest = readJson(MANIFEST_PATH, null);
if (!manifest) errors.push(`missing_manifest:${MANIFEST_PATH}`);
const durableEntries = (manifest && Array.isArray(manifest.entries)) ? manifest.entries : [];
for (const entry of durableEntries) checkEntry(entry, 'durable');

// The per-run manifests written by THIS compile are a second copy of the same promises
// one directory over, and an unscreened copy there is the same defect waiting for
// whatever reads it next - scripts/search_intelligence/lib.js and the neuro remediation
// script both read out of this directory.
//
// ONLY THIS RUN'S FILES ARE JUDGED, and that is a deliberate line rather than an
// oversight. The 49 files here are dated per-run archives going back to 2026-06-29:
// a truthful record of what a run on that date promised, written before the scaffolding
// family was identified. Holding a June archive to a September screen would only ever
// be satisfiable by rewriting it, and rewriting a record of what was promised to make
// today's guard green is falsifying evidence, not fixing a defect. The durable manifest
// immediately above is the live contract - it is the file
// validate_agent_exact_acceptance_manifest.js enforces against rendered pages - and it
// is judged in full.
const runManifests = [];
const skippedArchives = [];
let runEntryCount = 0;
try {
  const generatedAt = String((manifest && manifest.generated_at) || DATE);
  for (const file of fs.readdirSync(rel(MANIFEST_DIR)).filter((f) => f.endsWith('.json')).sort()) {
    const runManifest = readJson(`${MANIFEST_DIR}/${file}`, null);
    const runEntries = (runManifest && Array.isArray(runManifest.entries)) ? runManifest.entries.filter(Boolean) : [];
    if (!runManifest || String(runManifest.generated_at || '') !== generatedAt) { skippedArchives.push(file); continue; }
    runManifests.push(file);
    runEntryCount += runEntries.length;
    for (const entry of runEntries) checkEntry(entry, `run:${file}`);
  }
} catch { /* no per-run manifests is not a defect; the durable one is the contract */ }

// `available` is derived from the plan, NOT from the manifest being examined - an empty
// manifest with planned repair specs is exactly the silent-pipeline case this catches.
//
// `examined` counts the DURABLE entries ALONE, deliberately. Counting the per-run
// entries too was tried and let the check pass over an emptied durable manifest, on the
// strength of 17 rows in a directory nothing enforces against a page. The live contract
// going empty is precisely the event this is here to notice, so it may not be masked by
// a second collection.
const plan = readJson('artifacts/validation/agent-exact-implementation-plan.json', { specs: [] });
const plannedRepairs = (plan.specs || []).filter((spec) => spec && spec.operation === 'REPAIR_INTENDED_WINNER_PAGE').length;
const verdict = zeroExaminationVerdict({
  validator: 'acceptance-manifest-deliverability',
  unit: 'durable semantic acceptance manifest entries',
  examined: durableEntries.length,
  available: Math.max(plannedRepairs, runEntryCount),
  stopReason: 'no semantic acceptance entry exists and no repair spec is planned, so there is no promise to any page to judge',
  inputs: [MANIFEST_PATH, MANIFEST_DIR]
});
if (verdict.error) errors.push(verdict.error);

writeJson(REPORT_PATH, {
  schema_version: '1.0',
  guard: 'acceptance-manifest-deliverability',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: DATE,
  inputs: [MANIFEST_PATH, MANIFEST_DIR, 'artifacts/validation/agent-exact-implementation-plan.json'],
  rule: 'The acceptance manifest may only assert what the delivered page can carry. Template scaffolding is never assertable; min_rows may not exceed the compiled artifact or, on a frozen route, the accepted bytes; a frozen route\'s required_strings must be present in those bytes. The repair is to re-run compile_html_fix_acceptance_manifest.js - never to pad rows back in.',
  durable_entry_count: durableEntries.length,
  run_manifest_count: runManifests.length,
  run_manifests_judged: runManifests,
  dated_archives_not_judged: skippedArchives,
  dated_archive_policy: 'A per-run manifest from an earlier date is a record of what that run promised. It is read, never rewritten: making a June archive satisfy a September screen would falsify the record rather than fix a defect. The durable manifest is the live contract and is judged in full.',
  run_entry_count: runEntryCount,
  examined_count: durableEntries.length + runEntryCount,
  planned_repair_specs: plannedRepairs,
  named_stop: verdict.named_stop,
  error_count: errors.length,
  errors
});

if (errors.length) {
  console.error('ACCEPTANCE MANIFEST DELIVERABILITY FAIL');
  errors.slice(0, 40).forEach((error) => console.error(`- ${error}`));
  if (errors.length > 40) console.error(`- ... and ${errors.length - 40} more (see ${REPORT_PATH})`);
  console.error('  Re-run: node scripts/citation_velocity/compile_html_fix_acceptance_manifest.js');
  console.error('  OMIT, NEVER PAD: do not restore the padded rows to make a count add up.');
  process.exit(1);
}
console.log(`ACCEPTANCE MANIFEST DELIVERABILITY PASS: ${durableEntries.length} durable entry(ies) and ${runEntryCount} per-run entry(ies) across ${runManifests.length} run manifest(s) examined; no scaffolding asserted, no undeliverable min_rows, no unsatisfiable promise on a frozen route`);
