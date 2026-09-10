#!/usr/bin/env node
'use strict';
/**
 * No published page may render TEMPLATE SCAFFOLDING as content.
 *
 * Sibling of validate_no_internal_instruction_leak.js, and deliberately a second
 * gate rather than more patterns bolted onto that one. That gate catches BUILD
 * VOCABULARY reaching a reader - "FILEPATH:", "Directly answer:", a validator's own
 * failure message. This one catches the other half of the same class:
 *
 *   - a numbered template slot the compiler could not fill, printed anyway
 *     ("Concrete verification point 3", "Requirement 5");
 *   - an AUTHORING INSTRUCTION sitting in the cell a reader reads for the answer
 *     ("Translate “<query>” into a specific verification question before choosing
 *     a provider.").
 *
 * Measured on 2026-09-09 across the rendered tree: 113 of 2,070 pages, 5.5%.
 * 111 carried the instruction, 68 a numbered point, 3 a bare "Requirement <n>".
 * They are not a typo. They are what scripts/lib/html_fix_acceptance_parser.js
 * emitted when it had fewer real requirements than the requested row count, and
 * they were re-emitted on every build from two durable stores, which is why they
 * survived being flagged.
 *
 * KEYED ON THE STRING FAMILY, NOT THE THREE KNOWN STRINGS.
 * The patterns live in scripts/lib/template_scaffolding.js and are the SAME list the
 * producers screen against, imported rather than restated - the parity assertion
 * below fails the gate if the two ever diverge. That is the specific defect
 * validate_no_internal_instruction_leak.js recorded in its own header: two lists,
 * no link, so three of four patterns stayed invisible to the gate for weeks.
 *
 * RULE 0: examining zero pages is a FAILURE. An unbuilt tree and a clean site are
 * indistinguishable from the outside, and that is exactly how this family hid.
 *
 * DEFERRED, NAMED, AND RATCHETED: data/content/template_scaffolding_deferred.json.
 * Routes under trt/community-questions/ and trt/guides/ are being rebuilt in a
 * separate, concurrent lane (VALIDATION_AND_HANDOFF.md item 1 - 39 recommendations
 * regressing on 13 TRT pages). Thawing them here would have collided with that work.
 * They are listed with a reason, and the list is SHRINK-ONLY: a listed route that no
 * longer carries scaffolding FAILS this gate until it is deleted from the file, so
 * the deferral cannot outlive the other lane. It can never be used to admit a new
 * offender - a route not on the list fails, full stop.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/rendered-template-scaffolding.json');
const DEFERRED = path.join(ROOT, 'data/content/template_scaffolding_deferred.json');

// data/ holds the agent's own raw reports and the acceptance stores; those are
// EVIDENCE about pages and are supposed to quote this text. templates/ is not a
// route. artifacts/, reports/, staging/ are not published.
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates', 'docs', 'releases', 'content-bank', 'proofs', 'outputs']);

// [gate pattern, human reason, shape id, the producer pattern it covers].
//
// The gate pattern is NOT the producer pattern. The producers match a whole CELL or
// list item, so theirs are anchored; this one greps rendered HTML, where the string is
// wrapped in tags, so it must not be. The fourth element is the producer pattern this
// shape is the rendered-page counterpart of, and the parity assertion below checks
// them off by identity rather than by guessing at regex equivalence.
const { TEMPLATE_SCAFFOLDING_PATTERNS } = require('../lib/template_scaffolding');
const [P_POINT, P_REQUIREMENT, P_TRANSLATE, P_TURN] = TEMPLATE_SCAFFOLDING_PATTERNS;
const SHAPES = [
  [/\bConcrete verification point\s*\d*/i, 'a numbered template slot the compiler never filled', 'concrete-verification-point', P_POINT],
  [/>\s*Requirement\s+\d+\s*</, 'a bare "Requirement <n>" placeholder in a table cell', 'bare-requirement-number', P_REQUIREMENT],
  [/into a specific verification question\b/i, 'the authoring instruction, printed in the "What to verify" cell', 'translate-into-verification-question', P_TRANSLATE],
  [/\bTurn the recommendation into a concrete verification question\b/i, 'the same authoring instruction, query-less form', 'turn-recommendation-into-question', P_TURN]
];

// If a pattern is added to scripts/lib/template_scaffolding.js and not here, the
// producers would silently remove text this gate cannot see, and the gate would go on
// reporting a clean site it never checked for. That is the exact defect
// validate_no_internal_instruction_leak.js records in its own header - two lists, no
// link. Refuse to run rather than pass blind.
(function assertPatternParity() {
  const covered = new Set(SHAPES.map(([, , , producer]) => producer && producer.source));
  const missing = TEMPLATE_SCAFFOLDING_PATTERNS.filter((re) => !covered.has(re.source));
  if (missing.length) {
    console.error(`RENDERED TEMPLATE SCAFFOLDING GATE is missing ${missing.length} pattern(s) the producers strip on:`);
    for (const re of missing) console.error(`  ${re.source}`);
    console.error('  Add a SHAPES row naming it, or the producers will strip text this gate cannot see.');
    process.exit(2);
  }
})();

const deferredDoc = fs.existsSync(DEFERRED) ? JSON.parse(fs.readFileSync(DEFERRED, 'utf8')) : { routes: [] };
const deferred = new Map((deferredDoc.routes || []).map((r) => [String(r.path), r]));

const offenders = [];
const deferredHits = [];
let scanned = 0;

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    scanned += 1;
    const html = fs.readFileSync(abs, 'utf8');
    const hits = SHAPES.filter(([re]) => re.test(html));
    if (!hits.length) continue;
    const record = { path: rel, reason: hits[0][1], shapes: hits.map(([, , id]) => id) };
    // A dist/ mirror is the same page; defer it with its source route.
    const sourceRel = rel.startsWith('dist/') ? rel.slice(5) : rel;
    if (deferred.has(sourceRel)) deferredHits.push({ ...record, deferred_as: sourceRel });
    else offenders.push(record);
  }
})(ROOT);

function tally(pages) {
  const out = {};
  for (const page of pages) for (const shape of page.shapes || []) out[shape] = (out[shape] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

const sourceOffenders = offenders.filter((o) => !o.path.startsWith('dist/'));
const stillDeferred = new Set(deferredHits.map((d) => d.deferred_as));
const staleDeferrals = [...deferred.keys()].filter((p) => !stillDeferred.has(p));

const report = {
  schema_version: '1.0',
  validator: 'rendered-template-scaffolding',
  scanned_pages: scanned,
  offender_pages: offenders.length,
  offender_source_pages: sourceOffenders.length,
  offender_dist_mirrors: offenders.length - sourceOffenders.length,
  shape_tally_source_pages: tally(sourceOffenders),
  deferred_routes: deferred.size,
  deferred_pages_still_carrying: deferredHits.length,
  stale_deferrals: staleDeferrals,
  status: 'PASS',
  offenders: offenders.slice(0, 200)
};

function emit() {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`);
}

// Rule 0. An empty loop passes every assertion ever written.
if (scanned === 0) {
  report.status = 'FAIL';
  report.failure = 'examined_zero_pages';
  emit();
  console.error('RENDERED TEMPLATE SCAFFOLDING FAIL: examined 0 pages.');
  console.error('  "No page carries scaffolding" and "no page was read" are not the same answer.');
  console.error('  Run `npm run build`, then re-run this validator.');
  process.exit(1);
}

if (staleDeferrals.length) {
  report.status = 'FAIL';
  report.failure = 'stale_deferral';
  emit();
  console.error(`RENDERED TEMPLATE SCAFFOLDING FAIL: ${staleDeferrals.length} deferral(s) no longer reproduce.`);
  for (const p of staleDeferrals) console.error(`  ${p} is clean; delete its entry from ${path.relative(ROOT, DEFERRED)}.`);
  console.error('  A deferral that outlives the defect is a permanent licence to publish scaffolding.');
  process.exit(1);
}

if (offenders.length) {
  report.status = 'FAIL';
  report.failure = 'scaffolding_published';
  emit();
  console.error(`RENDERED TEMPLATE SCAFFOLDING FAIL: ${offenders.length} rendered page(s) publish template scaffolding as content.`);
  console.error(`  ${sourceOffenders.length} source page(s); the rest are dist/ mirrors of the same routes.`);
  for (const page of offenders.slice(0, 25)) console.error(`  ${page.path} — ${page.reason} [${page.shapes.join(', ')}]`);
  if (offenders.length > 25) console.error(`  ... and ${offenders.length - 25} more; full list in ${path.relative(ROOT, EVIDENCE)}`);
  console.error('  Fix the GENERATOR, never the page: a hand-edited page has the string back on the next build.');
  console.error('  scripts/lib/html_fix_acceptance_parser.js emits this family; scripts/lib/template_scaffolding.js is the shared screen.');
  console.error('  Where a section was never filled in, OMIT it. Do not invent content for the slot.');
  process.exit(1);
}

emit();
console.log(`RENDERED TEMPLATE SCAFFOLDING PASS: ${scanned} page(s) examined; 0 publish template scaffolding.`);
if (deferred.size) console.log(`  ${deferred.size} route(s) deferred by name to the concurrent TRT lane, all still reproducing.`);
