#!/usr/bin/env node
'use strict';
// Enforce the blocks the external review agent keeps asking for.
//
// Across ~2,750 recommendations in this repo and sprylabs, the agent asks for
// the same small set of things over and over. 27% of distinct defects were
// re-reported on later runs despite being marked released - one across 8
// separate run dates. Those are not new defects; they are the same page missing
// the same block, found again.
//
// Derived from the recommendations themselves (.clarity/content-pattern-spec.json):
//
//   1 checklist / numbered protocol      730 occurrences (36.4%)
//   2 comparison / decision / cost table 529 (26.4%)
//   3 direct-answer block                512 (25.5%)
//   4 decision framework                 392 (19.5%)
//   5 concrete numbers                   365 (18.2%)
//   6 named primary sources              288 (14.3%)
//   7 query present in a heading         261 (13.0%)
//   9 FAQ block                          136 (6.8%)
//  10 structured data                     70 (3.5%)
//
// Severity is deliberately split. The blocks that decide whether a page can be
// quoted at all are blocking; the rest report as gaps so they can be worked
// without stopping a release. Raising a block to blocking is a decision to make
// once its backlog is cleared, not a default.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/content-pattern-contract.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates', 'dist']);
// Explicit, reasoned exceptions. Each entry says why the page cannot satisfy the
// check, so the list stays auditable instead of becoming a place to hide gaps.
const EXCEPTIONS = new Map([
  ['insights/uscis-medical-correction-mistakes-006-wrong-date.html', {
    check: 'query_in_heading',
    reason: 'The h1 comes from a source question recorded as the fragment "wrong date". '
      + 'Rewriting it changes the title slug, which changes the published URL - and the '
      + 'insights lane was just pinned specifically to stop that churn. A stable URL is '
      + 'worth more than one heading. The underlying record is in '
      + 'reports/degraded-answers-backlog.json for authoring, which can fix the question '
      + 'and the URL together as a deliberate migration.',
  }],
]);

const SKIP_FILES = new Set(['404.html', 'about.html', 'privacy.html', 'disclaimer.html', 'methodology.html', 'terms.html']);

const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const CHECKS = [
  { id: 'direct_answer', blocking: true,
    test: (h) => /data-direct-answer=|class="[^"]*answer-box/i.test(h),
    why: 'no direct-answer block - nothing here is quotable without surrounding context' },
  { id: 'query_in_heading', blocking: true,
    // Archive and hub indexes are navigational, not query-answering: "Atlas",
    // "Insights" and "Articles" are correct h1s there. Content pages have no
    // such excuse - an h1 of "Wrong date" carries none of the phrasing a person
    // typed, which is the agent's #7 recurring finding.
    appliesTo: (rel) => !['atlas/index.html', 'insights/index.html', 'medium/index.html'].includes(rel),
    test: (h) => { const m = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); return Boolean(m && text(m[1]).length > 10); },
    why: 'h1 missing or too short to carry the searcher phrasing' },
  { id: 'no_empty_table_cells', blocking: true,
    test: (h) => !/<t[dh][^>]*>\s*<\/t[dh]>/i.test(h),
    why: 'table ships empty cells - the agent calls these impossible to cite' },
  { id: 'conversion_path', blocking: true,
    test: (h) => /request-assistance|#vertical-routes|Find a Provider/i.test(h),
    why: 'no conversion path - an answer-engine citation lands with nowhere to go' },
  { id: 'checklist', blocking: false,
    test: (h) => /<ol[\s>]|<ul[\s>]/i.test(h),
    why: 'no checklist or numbered protocol (agent request #1, 730 occurrences)' },
  { id: 'comparison_table', blocking: false,
    test: (h) => /<table[\s>]/i.test(h),
    why: 'no comparison or cost table (agent request #2, 529 occurrences)' },
  { id: 'concrete_numbers', blocking: false,
    test: (h) => /\$\s?\d|\d+\s?(?:days?|weeks?|months?|years?|hours?)\b/i.test(text(h)),
    why: 'no concrete cost or timeline figures (agent request #5, 365 occurrences)' },
  { id: 'named_sources', blocking: false,
    test: (h) => /data-source|Primary sources|Sources?:/i.test(h) || /<a[^>]+href="https?:\/\/(?!(?:www\.)?theindustryguides\.com)/i.test(h),
    why: 'no named primary source (agent request #6, 288 occurrences)' },
  { id: 'faq', blocking: false,
    test: (h) => /FAQPage|data-faq|class="[^"]*faq/i.test(h),
    why: 'no FAQ block or FAQPage schema (agent request #9)' },
  { id: 'structured_data', blocking: false,
    test: (h) => /application\/ld\+json/i.test(h),
    why: 'no JSON-LD structured data (agent request #10)' },
];

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs); continue; }
    if (!e.name.endsWith('.html')) continue;
    const rel = path.relative(ROOT, abs);
    if (SKIP_FILES.has(rel)) continue;
    pages.push(rel);
  }
})(ROOT);

const blockingFailures = [];
const exempted = [];
const gaps = {};
for (const c of CHECKS) gaps[c.id] = [];

for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const c of CHECKS) {
    if (typeof c.appliesTo === 'function' && !c.appliesTo(rel)) continue;
    if (c.test(html)) continue;
    const exception = EXCEPTIONS.get(rel);
    if (exception && exception.check === c.id) { exempted.push({ path: rel, check: c.id, reason: exception.reason }); continue; }
    if (c.blocking) blockingFailures.push({ path: rel, check: c.id, why: c.why });
    else gaps[c.id].push(rel);
  }
}

const summary = CHECKS.map((c) => ({
  id: c.id, blocking: c.blocking,
  pages_missing: c.blocking ? blockingFailures.filter((f) => f.check === c.id).length : gaps[c.id].length,
  coverage_pct: Number((100 * (1 - (c.blocking
    ? blockingFailures.filter((f) => f.check === c.id).length
    : gaps[c.id].length) / Math.max(pages.length, 1))).toFixed(1)),
  why: c.why,
}));

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'content-pattern-contract',
  spec: '.clarity/content-pattern-spec.json',
  pages_checked: pages.length,
  status: blockingFailures.length ? 'FAIL' : 'PASS',
  blocking_failures: blockingFailures.length,
  exempted,
  summary,
  worst_gaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v.slice(0, 25)])),
}, null, 2)}\n`);

console.log(`CONTENT PATTERN CONTRACT: ${pages.length} pages checked`);
for (const s of summary) {
  const tag = s.blocking ? 'BLOCKING' : 'gap     ';
  console.log(`  ${tag} ${s.id.padEnd(22)} coverage ${String(s.coverage_pct).padStart(5)}%  missing on ${s.pages_missing}`);
}
if (blockingFailures.length) {
  console.error(`\nCONTENT PATTERN CONTRACT FAIL: ${blockingFailures.length} blocking gap(s)`);
  for (const f of blockingFailures.slice(0, 15)) console.error(`  ${f.path} :: ${f.why}`);
  if (blockingFailures.length > 15) console.error(`  ...and ${blockingFailures.length - 15} more`);
  process.exit(1);
}
if (exempted.length) {
  console.log(`\n  ${exempted.length} documented exception(s):`);
  for (const e of exempted) console.log(`    ${e.path} :: ${e.check}`);
}
console.log('\nCONTENT PATTERN CONTRACT PASS');
