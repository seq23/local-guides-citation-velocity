#!/usr/bin/env node
'use strict';

// The producers must refuse internal build instructions; the page scan is a net, not a guard.
//
// scripts/validators/validate_no_internal_instruction_leak.js reads published HTML and
// fails if it finds a build directive. That check is real, but it is downstream of the
// damage: it fires only once a generator has already written the directive into a page,
// and it fires on whatever run happens to rebuild that page - which on 2026-08-27 was a
// release triggered by an unrelated agent run, three weeks after the input landed.
//
// The defect it caught was self-referential. The 2026-07-16 neuro agent report described
// a bug by quoting it: "...exposes unfinished internal placeholder text ('Citation-ready
// update: FILEPATH... CURRENT: ...')". html_fix_acceptance_parser.js lifted the quoted
// phrase into an artifact title, made it a required_string, and agent_exact_repairs.js
// rendered it as an <h2> on insights/neuro-013-how-to-compare-providers-fast.html.
//
// a5bd62cc8 ("Stop publishing internal build instructions as page copy") removed the two
// known render sites and added looksLikeInternalInstruction() to agent_exact_repairs.js -
// and never called it, and never touched the compiler at all. A guard that is defined and
// not invoked reads exactly like a guard that works.
//
// This validator asserts three things that a page scan cannot:
//   1. every directive shape the published-page gate forbids is also refused by the
//      shared generator predicate, so the two cannot drift apart again;
//   2. both producers import that predicate AND call it, not merely define it;
//   3. compiling the real 2026-07-16 recommendation text yields an artifact and a set of
//      required_strings that the published-page gate would accept.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/generator-instruction-refusal.json';
const GATE = 'scripts/validators/validate_no_internal_instruction_leak.js';
const SHARED = 'scripts/lib/internal_instruction_text.js';
const PRODUCERS = ['scripts/lib/html_fix_acceptance_parser.js', 'scripts/lib/agent_exact_repairs.js'];

const { isInternalInstructionText, containsInternalInstruction } = require(path.join(ROOT, SHARED));

// One probe per directive shape the gate forbids. Adding a pattern to the gate without
// adding a probe here fails check 1(b) below, which is the point: the corpus is the
// contract between the two files.
const PROBES = [
  'FILEPATH: https://example.com/x.html || CURRENT: thin || MISSING: table || EDIT: add one',
  'Rewrite the block || EDIT: open with a direct answer',
  'Citation-ready update: FILEPATH...',
  'Marker-only framework cards are not sufficient for release',
  'Required semantic acceptance: the page must carry the marker',
  'Apply the citation-agent source patch to this route',
  'Page is missing artifact-required decision support markers',
  // The four imperative shapes. 148 published pages carried one on 2026-08-27 -
  // more than the original leak this whole mechanism was built to close. The
  // first is the instruction to write the answer, printed inside the answer
  // block; the last is a validator's own failure message printed as advice.
  'Directly answer: how much does a dental implant cost without insurance',
  'Answer directly: what are the common side effects of TRT to watch for',
  'The rendered page does not include the exact requested heading, table, checklist, script, or callout',
  // The compiler's own former fallback heading. Check 3 below compiles the recorded
  // 2026-07-16 directive, which takes exactly that fallback path, so this probe and
  // that assertion together are what stop the old name coming back.
  'How much does TRT cost — acceptance block 1',
  // The other three build-ACCEPTANCE criteria. compileEntryFromSpec emitted all
  // four into `red_flags`, a reader field, and only the first was ever in the gate.
  // 20 pages rendered these under a visible "Red flags to watch" heading, so a
  // reader comparing TRT clinics was told to watch out for the build's own
  // route-resolution failure.
  'The page substitutes a generic framework for concrete decision-support content',
  'The target route cannot be resolved deterministically',
  'Visible content tells the reader to follow internal workflow notes instead of answering the query'
];
const CLEAN_PROBES = [
  // Genuine reader-facing red flags, authored per vertical. These are what the
  // "Red flags to watch" list is for, and they must survive the filter that strips
  // build-acceptance criteria -- otherwise the fix for the leak would have quietly
  // emptied the section on every page that had real warnings.
  'Starts treatment before reviewing baseline labs',
  'Quotes one number but cannot explain total annual cost',
  'Only sells speed',
  'How to quickly compare neuropsych evaluation providers in my area',
  'What to verify before booking an evaluation',
  'Compare total planned testing hours and whether feedback is included'
];

const errors = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 1. Gate patterns and generator predicate must agree.
const gateSource = read(GATE);
const block = gateSource.slice(gateSource.indexOf('const PATTERNS'), gateSource.indexOf('];', gateSource.indexOf('const PATTERNS')));
const gatePatterns = [...block.matchAll(/^\s*\[\s*(\/(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*)\s*,/gm)].map((m) => m[1]);
if (gatePatterns.length < 5) errors.push(`gate_patterns_unreadable:parsed_${gatePatterns.length}`);
for (const literal of gatePatterns) {
  const lastSlash = literal.lastIndexOf('/');
  const re = new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
  // (a) the generator refuses every probe the gate would reject
  for (const probe of PROBES) {
    if (re.test(probe) && !isInternalInstructionText(probe)) errors.push(`generator_allows_text_gate_rejects:${re}:${probe.slice(0, 60)}`);
  }
  // (b) every gate pattern is exercised by at least one probe
  if (!PROBES.some((probe) => re.test(probe))) errors.push(`gate_pattern_has_no_probe:${re}`);
}
for (const probe of CLEAN_PROBES) {
  if (isInternalInstructionText(probe)) errors.push(`generator_refuses_reader_copy:${probe.slice(0, 60)}`);
}

// 2. Both producers must import the shared predicate and actually call it.
for (const rel of PRODUCERS) {
  const source = read(rel);
  if (!/require\(['"]\.\/internal_instruction_text['"]\)/.test(source)) errors.push(`producer_does_not_import_shared_predicate:${rel}`);
  // Count only the predicate itself. An earlier draft of this check also counted a
  // local helper that wraps it, and passed after the wrapper was hollowed out to stop
  // consulting the predicate - the same "looks guarded, is not" shape as the bug.
  const calls = (source.match(/\b(?:isInternalInstructionText|containsInternalInstruction|looksLikeInternalInstruction)\s*\(/g) || []).length;
  if (calls < 1) errors.push(`producer_imports_guard_but_never_calls_it:${rel}`);
}

// 3. Compiling the recorded directive text must produce publishable copy.
const { artifactFromFix, rowRequirementFromFix } = require(path.join(ROOT, 'scripts/lib/html_fix_acceptance_parser.js'));
// The exact fix_recommendation the 2026-07-16 neuro run recorded for
// insights/neuro-013-how-to-compare-providers-fast.html, verbatim. Its EDIT clause is
// the trap: the agent asks for the placeholder to be REMOVED and quotes it while doing
// so, and stripPrefixes() hands everything after EDIT: to the compiler. Shortening or
// paraphrasing this fixture drops the quoted directive and the probe stops testing
// anything - which is how a first draft of this validator passed against a compiler
// with the filter torn out.
const RECORDED = "FILEPATH: https://theindustryguides.com/insights/neuro-013-how-to-compare-providers-fast.html || CURRENT: Page contains a 'Neuro Provider Comparison Scorecard' direct answer but exposes unfinished internal placeholder text ('Citation-ready update: FILEPATH... CURRENT: Page has a Neuro Provider Comparison Scorecard...') and truncated links/sentences, making the page look incomplete to crawlers and LLMs || MISSING: A fully finished, self-contained direct-answer paragraph that spells out all 8 scorecard factors and the 5-factor verification table in prose is missing; instead raw editorial notes are visible, and the GPT-4o response never referenced or cited the page at all || EDIT: Remove all placeholder/instruction text (the 'Citation-ready update: FILEPATH...' block), replace it with a complete 60-90 word answer that lists all 8 scorecard factors plus the verification table contents, and fix truncated links so the page is a clean, quotable source.";
const query = 'how to quickly compare neuropsych evaluation providers in my area';
const artifact = artifactFromFix({ recommendation: RECORDED, query, recordId: 'guard-probe', index: 0 });
if (!artifact || !artifact.title) errors.push('compiler_emitted_no_artifact_for_recorded_directive');
if (containsInternalInstruction(artifact)) errors.push(`compiler_artifact_carries_directive:${JSON.stringify(artifact.title).slice(0, 80)}`);
const rowRequirement = rowRequirementFromFix({ recommendation: RECORDED, query, recordId: 'guard-probe', implementationPath: 'insights/x.html', index: 0 });
for (const required of rowRequirement.required_strings || []) {
  if (isInternalInstructionText(required)) errors.push(`compiler_requires_directive_string:${String(required).slice(0, 60)}`);
}
for (const bl of rowRequirement.required_blocks || []) {
  if (isInternalInstructionText(bl.heading_exact)) errors.push(`compiler_requires_directive_heading:${String(bl.heading_exact).slice(0, 60)}`);
}

const report = {
  schema_version: '1.0',
  validator: 'generator-instruction-refusal',
  status: errors.length ? 'FAIL' : 'PASS',
  gate: GATE,
  shared_predicate: SHARED,
  producers: PRODUCERS,
  gate_patterns_checked: gatePatterns.length,
  probes: PROBES.length,
  compiled_title: artifact ? artifact.title : null,
  errors
};
fs.mkdirSync(path.join(ROOT, path.dirname(EVIDENCE)), { recursive: true });
fs.writeFileSync(path.join(ROOT, EVIDENCE), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`GENERATOR INSTRUCTION REFUSAL FAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`GENERATOR INSTRUCTION REFUSAL PASS: ${gatePatterns.length} gate pattern(s) refused by both producers`);
