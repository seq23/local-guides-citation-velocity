'use strict';
/**
 * One definition of "this text names the model that generated it".
 *
 * Incident, 2026-08-29. Seven rendered, indexable pages carried the generating
 * model in the URL:
 *
 *   /personal-injury/community-questions/how-is-fault-determined-in-a-personal-injury-case-openai-gpt-4o/
 *   /uscis-medical/guides/what-are-the-requirements-for-the-i-693-medical-exam-perplexity/
 *   ... and five more ending in -openai-gpt-4o, -perplexity, -gemini-1-5-flash.
 *
 * Nothing generated the model name deliberately. The queries were harvested
 * from an LLM answer panel, where each row records which model produced the
 * answer, and the harvest wrote the panel's display string - question plus
 * model - into `query`. Every downstream consumer treats `query` as the user's
 * question: routeForFamily slugifies it into the URL, the release lane copies
 * it into <title>, and the admission registry stores it as primary_query. So
 * one un-stripped suffix in one intake became a public URL, a page title, and a
 * registry row that all name a model.
 *
 * A public URL that names the model that wrote the page is a generation
 * artifact in the address bar. It reads as automated to a person and to a
 * search engine, and these properties exist to be cited.
 *
 * The fix is at the boundary rather than in the seven slugs: any text that
 * becomes a route, a slug or a title is stripped here first, and the intake
 * gate refuses a row whose route still names a model after stripping. The
 * registered validator `model-name-free-routes` re-checks every public surface
 * so a new intake shape cannot reintroduce it silently.
 *
 * The list is deliberately literal. Matching "claude" or "gemini" as bare words
 * would eat legitimate content - a page about a person named Claude, or the
 * Gemini programme - so each entry is anchored to the vendor-and-version shape
 * these panels actually emit, plus the bare vendor names that no editorial
 * query in these five verticals ever contains.
 */

// Ordered longest-first so "openai gpt 4o" is stripped whole rather than
// leaving "openai" behind after "gpt 4o" matches.
const MODEL_NAME_PATTERNS = [
  /\bopen\s*ai[\s._-]*gpt[\s._-]*[0-9][a-z0-9.\s_-]*\b/gi,
  /\bgpt[\s._-]*[0-9][a-z0-9.\s_-]*\b/gi,
  /\bgemini[\s._-]*[0-9][a-z0-9.\s_-]*\b/gi,
  /\bclaude[\s._-]*(?:opus|sonnet|haiku)[\s._-]*[0-9a-z.\s_-]*\b/gi,
  /\bclaude[\s._-]*[0-9][a-z0-9.\s_-]*\b/gi,
  /\bllama[\s._-]*[0-9][a-z0-9.\s_-]*\b/gi,
  /\bmistral[\s._-]*(?:large|small|medium|[0-9])[a-z0-9.\s_-]*\b/gi,
  /\bdeepseek[\s._-]*[a-z0-9.\s_-]*\b/gi,
  /\bopen\s*ai\b/gi,
  /\bperplexity\b/gi,
  /\banthropic\b/gi,
  /\bcopilot\b/gi,
  /\bgrok\b/gi,
];

/** True when the text names a generating model anywhere in it. */
function containsModelName(value) {
  const text = String(value || '');
  return MODEL_NAME_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(text); });
}

/** Every model name the text contains, for error messages that name the cause. */
function modelNamesIn(value) {
  const text = String(value || '');
  const found = [];
  for (const re of MODEL_NAME_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) found.push(m[0].trim());
  }
  return [...new Set(found)];
}

/**
 * Remove model names from text destined for a route, slug or title.
 *
 * Punctuation the panel used to attach the model - a trailing "(Perplexity)",
 * a dash, a pipe - goes with it, so "what to bring (Perplexity)" becomes
 * "what to bring" rather than "what to bring ()".
 */
function stripModelNames(value) {
  let text = String(value || '');
  for (const re of MODEL_NAME_PATTERNS) {
    re.lastIndex = 0;
    text = text.replace(re, ' ');
  }
  return text
    .replace(/\(\s*\)/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/[\s|,;:_-]*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = { MODEL_NAME_PATTERNS, containsModelName, modelNamesIn, stripModelNames };
