#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A REMOVAL DIRECTIVE IS ADDRESSED TO A ROUTE, NOT TO THE SENTENCE THAT CARRIES IT.
 *
 * On 2026-09-10, Validate Repo run 34501826995 failed with 0 rendered pages and 4
 * source records: the acceptance manifest published "Direct answer" on
 * insights/personal-injury-025-* and "with a structured lead:" on
 * personal-injury/cost-fees/, both phrases a landed agent report had asked to delete.
 *
 * Neither was a missing link. compile_html_fix_acceptance_manifest.js ALREADY built a
 * route-scoped forbidden set across every row's source_fix, ALREADY detected both
 * titles, and ALREADY called artifactFromFix to recompile them. But it called it
 * WITHOUT that set, and artifactFromFix screens only the single recommendation it is
 * handed - which is the very recommendation the offending title was lifted out of. So
 * the repair fed the phrase back through the parser that had just produced it, got the
 * identical forbidden string back, and wrote the entry out unchanged. Detection fired
 * on every run since 2026-09-03; the repair had never once changed a byte.
 *
 * That is the failure this test exists to make impossible to reintroduce, and it is a
 * shape a green run cannot distinguish from a healthy one: a repair that runs, reports,
 * and does nothing. So the assertions below are about the REPAIR CHANGING SOMETHING,
 * not merely about the final state being clean.
 *
 * Rule 0: this file hard-fails if it examines zero cases.
 */

const assert = require('assert');
const {
  compileEntryFromSpec, phrasesTheFixAsksToRemove, phrasesTheRouteAsksToRemove, normalizeForbidden
} = require('../lib/html_fix_acceptance_parser');
const { cleanRouteRemovalDirectives } = require('../citation_velocity/compile_html_fix_acceptance_manifest');

let examined = 0;
const surfacesOf = (entry) => [
  entry.title,
  ...(entry.artifacts || []).map((a) => a && a.title),
  ...(entry.checklist || []),
  ...(entry.required_strings || []),
  ...(entry.row_requirements || []).flatMap((row) => [
    ...(row.required_blocks || []).map((b) => b && b.heading_exact),
    ...(row.required_strings || [])
  ])
].filter(Boolean).map(normalizeForbidden);

// ---------------------------------------------------------------------------
// 1. The union itself. A route's forbidden set is every recommendation's, together.
// ---------------------------------------------------------------------------
const AUTHORS = "EDIT: Add a cost table titled 'With A Structured Lead' covering pre-suit, post-filing and appeal percentages.";
const ORDERS = "EDIT: Remove the rendered H2 'With A Structured Lead' and replace it with a clean percentages table.";
examined += 1;
assert.strictEqual(phrasesTheFixAsksToRemove(AUTHORS).size, 0, 'the authoring recommendation issues no removal directive - that is the whole problem');
assert.ok(phrasesTheRouteAsksToRemove([AUTHORS, ORDERS]).has(normalizeForbidden('With A Structured Lead')),
  'the ROUTE forbids the phrase even though the recommendation that authored it does not');

// ---------------------------------------------------------------------------
// 2. Fresh compile. A sibling recommendation's deletion order must reach the
//    artifact another recommendation authors.
// ---------------------------------------------------------------------------
examined += 1;
const compiled = compileEntryFromSpec({
  implementation_path: 'personal-injury/route-scope-fixture/index.html',
  fix_recommendations: [AUTHORS, ORDERS],
  queries: ['how does a contingency fee work', 'how does a contingency fee work'],
  record_ids: ['fixture-a', 'fixture-b']
});
assert.ok((compiled.artifacts || []).length > 0, 'fixture must compile at least one artifact, or this case proves nothing');
const forbiddenNorm = normalizeForbidden('With A Structured Lead');
assert.ok(!surfacesOf(compiled).includes(forbiddenNorm),
  `a freshly compiled entry published a phrase a sibling recommendation asked to remove: ${JSON.stringify(compiled.artifacts.map((a) => a.title))}`);

// A phrase NO recommendation asks to remove must survive. A screen that simply
// emptied every surface would pass the assertion above, and would be the same class
// of defect in the opposite direction.
examined += 1;
const untouched = compileEntryFromSpec({
  implementation_path: 'personal-injury/route-scope-fixture-2/index.html',
  fix_recommendations: [AUTHORS],
  queries: ['how does a contingency fee work'],
  record_ids: ['fixture-c']
});
assert.ok(surfacesOf(untouched).includes(forbiddenNorm),
  'with no removal directive on the route, the authored phrase must still be published - the screen must be driven by directives, not by the phrase');

// ---------------------------------------------------------------------------
// 3. THE REGRESSION THAT SHIPPED: the carried-entry repair must not be a no-op.
// ---------------------------------------------------------------------------
examined += 1;
const carried = {
  implementation_path: 'personal-injury/route-scope-fixture/index.html',
  title: 'With A Structured Lead',
  artifacts: [{ id: 'x', marker: 'm', type: 'cost_table', title: 'With A Structured Lead', title_source: 'derived', rows: [], headers: [] }],
  required_strings: ['With A Structured Lead'],
  checklist: ['With A Structured Lead'],
  row_requirements: [
    { row_id: 'fixture-a', query: 'how does a contingency fee work', source_fix: AUTHORS, required_blocks: [{ type: 'cost_table', heading_exact: 'With A Structured Lead', heading_source: 'derived' }], required_strings: ['With A Structured Lead'] },
    { row_id: 'fixture-b', query: 'how does a contingency fee work', source_fix: ORDERS, required_blocks: [{ type: 'cost_table', heading_exact: 'Clean Percentages', heading_source: 'derived' }], required_strings: [] }
  ]
};
const repaired = cleanRouteRemovalDirectives(carried);
assert.notStrictEqual(JSON.stringify(repaired), JSON.stringify(carried),
  'THE NO-OP REPAIR: cleanRouteRemovalDirectives detected the forbidden title and returned the entry byte-identical. This is exactly run 34501826995.');
assert.ok(!surfacesOf(repaired).includes(forbiddenNorm),
  `the repaired entry still carries the forbidden phrase on some surface: ${JSON.stringify(surfacesOf(repaired))}`);

// The repair RETIRES the heading; it must not silently delete the block's content.
examined += 1;
const keptTitles = (repaired.artifacts || []).map((a) => a.title);
const withheld = (repaired.withheld_row_requirements || []).map((w) => w.heading_exact);
assert.ok(keptTitles.length + withheld.length >= 1,
  'the repair dropped the artifact AND recorded no withheld row - a refusal that leaves no trace is content loss, not a repair');
if (!keptTitles.length) {
  assert.ok(withheld.includes('With A Structured Lead'),
    'an artifact refused outright must be recorded in withheld_row_requirements so the refusal stays visible');
}

// ---------------------------------------------------------------------------
// 4. An instruction fragment is never a heading. "Step 2 - Add a" is what the
//    cost-fees repair degraded to before this was closed, and shipping it would
//    have swapped one unreadable <h2> for another.
// ---------------------------------------------------------------------------
examined += 1;
const fragmentSpec = compileEntryFromSpec({
  implementation_path: 'personal-injury/route-scope-fixture-3/index.html',
  fix_recommendations: ["EDIT: Step 1 — Add a 'With A Structured Lead' table. Step 2 — Add a percentage breakdown.", ORDERS],
  queries: ['how does a contingency fee work', 'how does a contingency fee work'],
  record_ids: ['fixture-d', 'fixture-e']
});
for (const artifact of fragmentSpec.artifacts || []) {
  assert.ok(!/^step\s*\d+\b/i.test(String(artifact.title || '')),
    `a numbered build step became a reader heading: ${JSON.stringify(artifact.title)}`);
  assert.ok(!/\b(?:a|an|the|with|and|or|of|for|to|in|on|at|by|from)$/i.test(String(artifact.title || '').replace(/[^A-Za-z0-9\s]+$/, '').trim()),
    `a heading was cut mid-clause: ${JSON.stringify(artifact.title)}`);
}

// ---------------------------------------------------------------------------
// Rule 0.
// ---------------------------------------------------------------------------
if (examined === 0) {
  console.error('REMOVAL DIRECTIVE ROUTE SCOPE TEST FAIL: zero cases examined. A test that asserts nothing is not a passing test.');
  process.exit(1);
}
console.log(`REMOVAL DIRECTIVE ROUTE SCOPE TEST PASS: ${examined} case(s). A deletion order reaches every recommendation on its route, the carried-entry repair provably changes the entry, a route under no directive keeps its copy, and no build-step fragment becomes a heading.`);
