'use strict';

// One definition of "this string is an internal build instruction, not reader copy".
//
// scripts/validators/validate_no_internal_instruction_leak.js rejects these shapes
// on published pages. That is a post-hoc scan: by the time it fires, the generator
// has already written the text into a page. Two producers must refuse to emit it in
// the first place, and both import this list so they cannot drift from the gate:
//
//   scripts/lib/html_fix_acceptance_parser.js  - compiles agent FIX/EDIT text into
//     acceptance criteria (artifact titles, heading_exact, required_strings).
//   scripts/lib/agent_exact_repairs.js         - renders those criteria onto pages.
//
// The failure this closes is self-referential. The 2026-07-16 neuro agent report
// described a defect by quoting it: "...exposes unfinished internal placeholder
// text ('Citation-ready update: FILEPATH... CURRENT: ...')". The compiler lifted the
// quoted phrase into an artifact title and a required string, so the agent's own
// example of the bug became mandatory page copy, and the renderer published it as an
// <h2> on insights/neuro-013-how-to-compare-providers-fast.html. The agent then
// re-reports the same defect, because it is reading its own instruction back off the
// page. Quoted agent text is evidence about a page; it is never copy for that page.
const INTERNAL_INSTRUCTION_PATTERNS = [
  /FILEPATH:/i,
  /\|\|\s*(?:CURRENT|MISSING|EDIT)\s*:/i,
  /Citation-ready update:/i,
  /Marker-only framework cards/i,
  /Required semantic acceptance:/i,
  /citation-agent source patch/i,
  /artifact-required decision support markers/i,
  // Four more shapes, measured on 2026-08-27: 148 published pages render one of
  // these as visible copy, which is more than the original leak this file was
  // written to close. They were missed because every pattern above is a noun
  // phrase from the build vocabulary, and these are imperatives - they read like
  // prose, so they survived review.
  //
  // The worst of them is on the pages whose whole job is the answer. The
  // dentistry cost hub publishes, inside its own "Direct answer" block:
  //   "Directly answer: how much does a dental implant cost without insurance.
  //    Directly answer: does medicare cover dental implants."
  // That is the instruction to write the answer, printed instead of the answer,
  // in the exact block answer engines extract.
  //
  // The last pattern is a validator's own failure message. 25 pages tell the
  // reader "The rendered page does not include the exact requested heading,
  // table, checklist, script, or callout" as though it were advice.
  //
  /\bDirectly answer\s*:/i,
  /\bAnswer directly\s*:/i,
  /does not include the exact requested (?:heading|table|checklist|script|callout)/i,
  // "acceptance block" was held out of this list on 2026-08-27 for a good reason:
  // the compiler's own fallback heading was "<query> - acceptance block 1", so
  // adding the pattern made check 3 of validate_generator_instruction_refusal
  // fail, and it failed CORRECTLY - it was reporting that the compiler still
  // authored a leaky heading. Narrowing the pattern to get past that would have
  // been sanding down the smoke detector.
  //
  // The right fix was the one the note said it was: rename the block. The
  // fallback in html_fix_acceptance_parser.js now names the block by what it does
  // for the reader ("How much does TRT cost? - what it costs and what to check"),
  // the manifests were recompiled, and the 20 pages that rendered the old heading
  // were thawed, rebuilt and refrozen. With no producer emitting it, the pattern
  // can finally join the list.
  /\bacceptance block\b/i,
  // Three siblings of the validator-failure message above, found 2026-08-27 on 20
  // pages. compileEntryFromSpec emits four build-ACCEPTANCE criteria -- statements
  // about whether the BUILD succeeded -- and they were being written into
  // `red_flags`, which is a READER-facing field. The pages render them under a
  // visible "<h2>Red flags to watch</h2>" alongside genuine warnings, so a reader
  // comparing TRT clinics was told to watch out for "The target route cannot be
  // resolved deterministically."
  //
  // Only the first of the four was filtered. These are the other three.
  /substitutes a generic framework for concrete decision-support content/i,
  /target route cannot be resolved deterministically/i,
  /tells the reader to follow internal workflow notes instead of answering the query/i
];

// The four build-acceptance criteria, as a set. These are NOT reader content: they
// describe how a build failed, not what a person should watch out for. They are
// legitimate as compiler output -- they are just not `red_flags`, and must never
// reach a rendered page. Kept separate from INTERNAL_INSTRUCTION_PATTERNS because
// that list is the leak GATE, while this one is the FILTER the producers apply.
const BUILD_ACCEPTANCE_CRITERIA = [
  /does not include the exact requested (?:heading|table|checklist|script|callout)/i,
  /substitutes a generic framework for concrete decision-support content/i,
  /target route cannot be resolved deterministically/i,
  /tells the reader to follow internal workflow notes instead of answering the query/i
];

function isBuildAcceptanceCriterion(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!text) return false;
  return BUILD_ACCEPTANCE_CRITERIA.some((pattern) => pattern.test(text));
}

// Drop build-acceptance criteria from anything destined for a reader.
function withoutBuildAcceptanceCriteria(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => !isBuildAcceptanceCriterion(value));
}

function isInternalInstructionText(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!text) return false;
  return INTERNAL_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

// Deep check: an artifact leaks if the directive is anywhere a renderer will print -
// title, intro, headers, rows, items, lines.
function containsInternalInstruction(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return isInternalInstructionText(value);
  if (Array.isArray(value)) return value.some(containsInternalInstruction);
  if (typeof value === 'object') return Object.values(value).some(containsInternalInstruction);
  return false;
}

// Turn a query into a checklist item a reader can actually use.
//
// Three producers built these items as "Directly answer: <query>" or
// "Answer directly: <query>" - html_fix_acceptance_parser.js lines 180 and 243,
// and agent_exact_repairs.js line 272. That is an instruction addressed to the
// generator, and it was being published: 148 pages render one, 133 of them the
// "Directly answer:" form. The dentistry cost hub printed three of them inside
// its own Direct answer block, so the page whose job was to answer
// "how much does a dental implant cost without insurance" published the
// instruction to answer it instead.
//
// The intent behind the item is sound - the page should address this question.
// The phrasing was simply written for the wrong audience. Asking the question is
// both a legitimate checklist item and the thing the reader actually wants.
function readerFacingQueryPrompt(query) {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  if (!q) return '';
  const capped = q.charAt(0).toUpperCase() + q.slice(1);
  return /[?.!]$/.test(capped) ? capped : `${capped}?`;
}

module.exports = {
  BUILD_ACCEPTANCE_CRITERIA,
  isBuildAcceptanceCriterion,
  withoutBuildAcceptanceCriteria, INTERNAL_INSTRUCTION_PATTERNS, isInternalInstructionText, containsInternalInstruction, readerFacingQueryPrompt };
