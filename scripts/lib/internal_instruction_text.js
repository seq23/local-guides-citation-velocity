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
  /artifact-required decision support markers/i
];

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

module.exports = { INTERNAL_INSTRUCTION_PATTERNS, isInternalInstructionText, containsInternalInstruction };
