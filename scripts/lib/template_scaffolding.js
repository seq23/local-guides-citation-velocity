'use strict';

/**
 * One definition of "this string is TEMPLATE SCAFFOLDING, not reader copy".
 *
 * Sibling of scripts/lib/internal_instruction_text.js, and deliberately a separate
 * list. That file catches BUILD vocabulary leaking onto a page - "FILEPATH:",
 * "Directly answer:", a validator's own failure message. This file catches the other
 * half of the same class: a template slot the compiler could not fill, printed as
 * though it were the answer.
 *
 * Measured on 2026-09-09 across the rendered tree (dist/, 2,070 pages):
 *
 *     111 pages  "Translate “<query>” into a specific verification question
 *                 before choosing a provider."   - the authoring instruction, in the
 *                                                  "What to verify" cell of a table
 *      68 pages  "Concrete verification point <n>" - a numbered slot, never filled
 *       3 pages  "Requirement <n>"                 - the same shape, one row over
 *     ---------
 *     113 pages  union (5.5% of the rendered tree)
 *
 * Where each came from, in scripts/lib/html_fix_acceptance_parser.js:
 *
 *   - requirementsFromFix() padded its result up to the requested row count with
 *     `Concrete verification point ${n}`. The pad exists so a table asked for four
 *     rows gets four rows. What it actually did was promise the reader four
 *     verification points and deliver one.
 *   - rowsFromFix() looped to the requested count regardless of how many seeds it
 *     had, substituting `Requirement ${i + 1}` for the missing ones.
 *   - tableRowForRequirement() matches a requirement against seven known factors and
 *     returns a real three-cell row. Everything else fell to a generic `else` whose
 *     middle cell - the "What to verify" column, the one a reader reads for the
 *     answer - was the instruction to work the answer out themselves.
 *
 * THE RULE: omit, never pad. An absent row beats an instruction masquerading as an
 * answer, on pages whose entire purpose is being cited. scripts/lib/
 * citation_velocity_artifacts.js already renders a table with no surviving rows as
 * nothing at all, for exactly this reason; this module gives it the rows to drop.
 *
 * DELIBERATELY NOT ON THIS LIST: "Comparison method". 63 pages carry that row, many
 * of them twice byte-for-byte, because requirementsFromFix seeds both "Compare every
 * option with the same criteria" and "Ask for specifics instead of accepting ranking
 * language" and tableRowForRequirement's /same criteria|specifics/ branch collapses
 * both to the identical row. The duplication is real and is recorded here, but the
 * cell holds authored copy, not a placeholder - so it is measured, not stripped.
 * Deduplicating it would restructure delivered pages in the name of tidiness, which
 * is a different decision and not this guard's to make.
 */

const TEMPLATE_SCAFFOLDING_PATTERNS = [
  // A numbered slot the compiler padded a list out to.
  /^\s*concrete verification point\s*\d*\s*$/i,
  /^\s*requirement\s+\d+\s*$/i,
  // The authoring instruction, in both the forms tableRowForRequirement can emit.
  /into a specific verification question\b/i,
  /^\s*turn the recommendation into a concrete verification question\.?\s*$/i
];

/** True when this exact string is a template placeholder or an authoring instruction. */
function isTemplateScaffolding(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!text.trim()) return false;
  return TEMPLATE_SCAFFOLDING_PATTERNS.some((pattern) => pattern.test(text));
}

/** Which pattern matched, for a validator that has to name what it found. */
function scaffoldingPatternFor(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!text.trim()) return null;
  return TEMPLATE_SCAFFOLDING_PATTERNS.find((pattern) => pattern.test(text)) || null;
}

/** Drop scaffolding strings from a reader-facing list. */
function withoutTemplateScaffolding(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => !isTemplateScaffolding(value));
}

/**
 * Drop whole ROWS that carry scaffolding in any cell.
 *
 * Blanking the offending cell was the first cut and it is worse: renderTable turns an
 * empty cell into "Not stated", so the page would say "Not stated" in the column the
 * reader came for, under a factor label that is real. The row was never filled in.
 * Omit it.
 */
function withoutTemplateScaffoldingRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => !(Array.isArray(row) ? row : [row]).some(isTemplateScaffolding));
}

/**
 * Every reader-facing surface of one artifact, screened. Returns a new artifact; the
 * input is not mutated. An artifact left with no rows, items or lines is returned as
 * is - renderArtifact already emits nothing for it, which is the intended outcome.
 */
function stripTemplateScaffolding(artifact) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const out = { ...artifact };
  if (Array.isArray(out.rows)) out.rows = withoutTemplateScaffoldingRows(out.rows);
  if (Array.isArray(out.items)) out.items = withoutTemplateScaffolding(out.items);
  if (Array.isArray(out.lines)) out.lines = withoutTemplateScaffolding(out.lines);
  if (Array.isArray(out.headers)) out.headers = withoutTemplateScaffolding(out.headers);
  if (Array.isArray(out.extracted_requirements)) out.extracted_requirements = withoutTemplateScaffolding(out.extracted_requirements);
  return out;
}

/** The same, for a list of artifacts. */
function stripTemplateScaffoldingFromArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map(stripTemplateScaffolding);
}

/** True when any reader-facing string anywhere in this value is scaffolding. */
function containsTemplateScaffolding(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return isTemplateScaffolding(value);
  if (Array.isArray(value)) return value.some(containsTemplateScaffolding);
  if (typeof value === 'object') return Object.values(value).some(containsTemplateScaffolding);
  return false;
}

module.exports = {
  TEMPLATE_SCAFFOLDING_PATTERNS,
  isTemplateScaffolding,
  scaffoldingPatternFor,
  withoutTemplateScaffolding,
  withoutTemplateScaffoldingRows,
  stripTemplateScaffolding,
  stripTemplateScaffoldingFromArtifacts,
  containsTemplateScaffolding
};
