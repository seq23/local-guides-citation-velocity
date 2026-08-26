'use strict';

/**
 * Answer shape: the two things an answer engine reaches for first.
 *
 * The measured problem this solves is not structure. This property already has
 * FAQPage schema on 97% of pages, Article on 97%, complete sitemap lastmod, and
 * a median of 1,150 words of non-template prose. A 40-observation grounded probe
 * still returned zero citations. What is missing is shape:
 *
 *   1. A primary heading phrased as the question a person actually types.
 *   2. A direct answer that survives being lifted out of the page - self
 *      contained, whole sentences, no pointer back into surrounding context.
 *
 * Both are produced here by re-shaping words the page already carries. Nothing
 * in this module invents a fact, a figure, a source, or a claim. Where a page
 * cannot supply the shape from its own content, the input is returned unchanged
 * and the caller can record the skip - a heading or answer that reads as filler
 * is worse than one that was left alone.
 */

const STOPWORDS = new Set('a an and are as at be best by can do does for from how i in into is it me my near of on or should the this to vs what when where which who why with you your'.split(' '));

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ *
 * Scaffolding removal
 * ------------------------------------------------------------------ */

// The generator opened most answers by quoting the searcher's own query back at
// them - `For "how much do implants cost": start with ...`. Two of those stack
// on 2,228 stored answers, because the raw answer field already carried one and
// the renderer added another. The words after the colon are the page's own; the
// echo in front of them is template scaffolding that spends the opening of the
// answer restating what the heading just said.
const QUERY_SCAFFOLD = /^for\s+[“‘"']([\s\S]{4,}?)[”’"']\s*[:,;—-]?\s*/i;
const LABEL_PREFIX = /^(short answer|quick answer|direct answer|answer|bottom line|summary|tl;?dr)\s*[:—-]\s*/i;

/** Strip stacked query echoes and answer labels. Idempotent by construction. */
function stripScaffold(text) {
  let out = clean(text);
  for (let i = 0; i < 6; i += 1) {
    const before = out;
    out = clean(out.replace(LABEL_PREFIX, '').replace(QUERY_SCAFFOLD, ''));
    if (out === before) break;
  }
  if (!out) return '';
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* ------------------------------------------------------------------ *
 * Sentence handling
 * ------------------------------------------------------------------ */

// Abbreviations whose period is not a sentence boundary. Splitting on them
// produces a first "sentence" of `U.` - which is exactly the fragment shape that
// reads as broken when an answer engine quotes it.
const ABBREV = /(?:\b(?:mr|mrs|ms|dr|prof|st|no|vs|etc|approx|est|inc|ltd|co|fig|eg|ie|u\.s|u\.k|d\.c)\.|\b[A-Z]\.)$/i;

function splitSentences(text) {
  const value = clean(text);
  if (!value) return [];
  const out = [];
  let buffer = '';
  const parts = value.split(/(?<=[.!?][”’"')\]]?)\s+/);
  for (const part of parts) {
    buffer = buffer ? `${buffer} ${part}` : part;
    if (ABBREV.test(buffer)) continue;
    out.push(buffer);
    buffer = '';
  }
  if (buffer) out.push(buffer);
  return out.filter(Boolean);
}

// A span that opens on a bare pronoun, or points at material outside itself,
// cannot be lifted. "It depends on the state" is true on the page and useless
// off it. These are dropped from the front of the answer rather than rewritten,
// because rewriting them would mean inventing the referent.
const OUTWARD_OPENER = /^(it|this|that|these|those|they|he|she|there|such|both|either|neither|the former|the latter|instead|however|also|additionally|then|so)\b/i;
const OUTWARD_REFERENCE = /\b(as (?:described|noted|shown|explained|listed|set out) above|see above|the above|as follows|listed below|shown below|the (?:table|list|checklist|section|prompt|framework) below|this page|this guide|this article|on this page)\b/i;

function isLiftable(sentence, { first = false } = {}) {
  const value = clean(sentence);
  if (!value) return false;
  if (OUTWARD_REFERENCE.test(value)) return false;
  if (first && OUTWARD_OPENER.test(value)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Direct answer
 * ------------------------------------------------------------------ */

/**
 * Assemble a self-contained direct answer from sentences the page already has.
 *
 * Whole sentences only. The previous behaviour clipped at a word budget and
 * appended a full stop, which shipped answers ending "...and confirm that it."
 * on live pages. A sentence kept whole and slightly over budget is quotable; a
 * sentence cut mid-clause is not, at any length.
 *
 * @returns {{answer:string, words:number, sentences:number, status:string}}
 *   status is one of: shaped | long_sentence_kept_whole | short_source_kept |
 *   empty. Callers use it to record which pages the source content could not
 *   supply a banded answer for, rather than padding them.
 */
function shapeAnswer({ raw, topic, extend = [], min = 40, max = 60 } = {}) {
  const base = stripScaffold(raw);
  const candidates = splitSentences(base);

  const usable = [];
  for (const sentence of candidates) {
    if (!isLiftable(sentence, { first: usable.length === 0 })) continue;
    usable.push(sentence);
  }

  const picked = [];
  let words = 0;
  for (const sentence of usable) {
    if (words >= min) break;
    picked.push(sentence);
    words += wordCount(sentence);
  }

  // Extend only from other sentences the page itself renders - the named
  // framework steps that already appear further down the same page. Nothing is
  // pulled in from outside the page, and nothing is written.
  if (words < min) {
    for (const sentence of extend) {
      if (words >= min) break;
      const value = clean(sentence).replace(/[;,]\s*$/, '');
      if (!value || !isLiftable(value, { first: picked.length === 0 })) continue;
      const withStop = /[.!?]$/.test(value) ? value : `${value}.`;
      // A framework step is frequently already quoted inside the sentence the
      // page opens with. Appending it again reads as a stutter in the one span
      // an answer engine is most likely to lift.
      const haystack = picked.join(' ').toLowerCase();
      if (haystack.includes(value.replace(/[.!?]$/, '').toLowerCase())) continue;
      picked.push(withStop);
      words += wordCount(withStop);
    }
  }

  // Trim from the back to land inside the band, but never below it and never
  // below one sentence.
  while (picked.length > 1 && words > max) {
    const tailWords = wordCount(picked[picked.length - 1]);
    if (words - tailWords < min) break;
    picked.pop();
    words -= tailWords;
  }

  const answer = clean(picked.join(' ')).replace(/\s+([,.!?;:])/g, '$1');
  if (!answer) return { answer: '', words: 0, sentences: 0, status: 'empty' };

  // The page-specificity contract: the answer has to share a content token with
  // the heading, or it is not an answer to this page's question.
  const topicTokens = new Set(tokens(topic));
  const answerTokens = new Set(tokens(answer));
  const specific = topicTokens.size < 2 || [...topicTokens].some((token) => answerTokens.has(token));

  let status = 'shaped';
  if (!specific) status = 'not_page_specific';
  else if (picked.length === 1 && words > max) status = 'long_sentence_kept_whole';
  else if (words < min) status = 'short_source_kept';

  return { answer, words, sentences: picked.length, status };
}

/* ------------------------------------------------------------------ *
 * Question heading
 * ------------------------------------------------------------------ */

// Residue from the community-signal ingest that reached rendered headings:
// `&#32; submitted by &#32; /[username removed] [link] [comments]`. It is not
// the searcher's phrasing, it is not anybody's phrasing, and the double escape
// renders it visible as `&#32;`.
function stripIngestResidue(text) {
  return clean(String(text || '')
    // The residue always arrives as one run: an attribution verb followed by
    // bracketed placeholders and escaped spaces. Removing the run as a unit is
    // what keeps a bare "submitted by" from being left behind mid-heading.
    .replace(/\s*(?:&(?:amp;)?#3[02];\s*)*\bsubmitted by\b(?:\s*(?:&(?:amp;)?#3[02];|\/?\[[^\]]*\]))*\s*/gi, ' ')
    .replace(/\/?\[username removed\]/gi, ' ')
    .replace(/\[link\]/gi, ' ')
    .replace(/\[comments?\]/gi, ' ')
    .replace(/&(?:amp;)?#3[02];/g, ' '));
}

const INTERROGATIVE_OPENER = /^(how|what|when|where|why|which|who|whose|whom|can|could|do|does|did|is|are|was|were|should|shall|will|would|has|have|had|must|may|might|am)\b/i;

// `How to X` is an infinitive, not a question. Restoring the auxiliary is a
// mechanical transform over the page's own words - it inserts function words
// only, never a noun, verb, figure, or claim.
const INFINITIVE_FORMS = [
  [/^how to\s+/i, 'How do I '],
  [/^what to\s+/i, 'What should I '],
  [/^where to\s+/i, 'Where do I '],
  [/^when to\s+/i, 'When should I '],
  [/^who to\s+/i, 'Who do I ']
];

/** Lowercase a title-cased word, but leave acronyms and brand names alone. */
function decapitalize(text) {
  const value = clean(text);
  const first = value.split(/\s+/)[0] || '';
  if (!first) return value;
  const stripped = first.replace(/[^A-Za-z]/g, '');
  if (!stripped) return value;
  // ALL CAPS (USCIS), internal caps (McGraw, iPhone) and hyphenated proper forms
  // stay as they are.
  if (stripped === stripped.toUpperCase()) return value;
  if (/[A-Z]/.test(stripped.slice(1))) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Re-shape a page title into the question a searcher types.
 *
 * Returns `{ heading, changed, rule }`. When no rule applies the original title
 * is returned unchanged with `rule: 'skipped_not_interrogative'` - a navigational
 * heading ("Dentistry Atlas", "Alabama Medicaid Dental Coverage Guide") cannot
 * be turned into a question without inventing phrasing nobody searched for.
 */
function questionHeading(rawTitle) {
  const original = clean(rawTitle);
  if (!original) return { heading: original, changed: false, rule: 'skipped_empty' };

  const hadQuestionMark = /\?\s*$/.test(original);
  let value = stripIngestResidue(original);
  const residueRemoved = value !== original;
  value = clean(value).replace(/[\s,;:–—-]+$/, '').trim();
  if (!value) return { heading: original, changed: false, rule: 'skipped_empty' };
  if (hadQuestionMark && !value.endsWith('?')) value = `${value}?`;
  value = value.replace(/\s+([?!.,;:])/g, '$1');

  if (value.endsWith('?')) {
    return {
      heading: value,
      changed: value !== original,
      rule: residueRemoved ? 'ingest_residue_removed' : 'already_question'
    };
  }

  for (const [pattern, replacement] of INFINITIVE_FORMS) {
    if (!pattern.test(value)) continue;
    const rest = decapitalize(value.replace(pattern, ''));
    if (!rest) break;
    return { heading: `${replacement}${rest}?`, changed: true, rule: 'infinitive_to_question' };
  }

  if (INTERROGATIVE_OPENER.test(value)) {
    // The opening word here is always an interrogative, so sentence-casing it is
    // safe - there is no acronym or brand name to damage.
    const cased = value.charAt(0).toUpperCase() + value.slice(1);
    return { heading: `${cased}?`, changed: true, rule: 'question_mark_restored' };
  }

  return {
    heading: residueRemoved ? value : original,
    changed: residueRemoved,
    rule: residueRemoved ? 'ingest_residue_removed' : 'skipped_not_interrogative'
  };
}

/* ------------------------------------------------------------------ *
 * Heading plan
 * ------------------------------------------------------------------ */

/**
 * Decide every page's heading together, so that re-shaping cannot introduce a
 * duplicate h1.
 *
 * Two near-duplicate routes can carry different titles ("How to get a second
 * opinion" and "How do I get a second opinion") that converge on the same
 * question once both are shaped. A duplicate h1 is a blocking release finding,
 * so the second route keeps its original title and is recorded as skipped
 * rather than being given an invented variation.
 *
 * Deterministic: routes are decided in sorted order, and unchanged headings
 * claim their text first so a re-shape never displaces a heading that was
 * already a question.
 *
 * @param {Array<{route:string,title:string}>} entries
 * @returns {Map<string,{heading:string,rule:string,title:string}>}
 */
function planHeadings(entries) {
  const decided = (entries || [])
    .filter((entry) => entry && entry.route)
    .map((entry) => ({ route: String(entry.route), title: clean(entry.title), ...questionHeading(entry.title) }))
    .sort((a, b) => a.route.localeCompare(b.route));

  const claimed = new Map();
  for (const item of decided) {
    if (item.changed) continue;
    const key = item.heading.toLowerCase();
    if (!claimed.has(key)) claimed.set(key, item.route);
  }

  const plan = new Map();
  for (const item of decided) {
    if (!item.changed) {
      plan.set(item.route, { heading: item.heading, rule: item.rule, title: item.title });
      continue;
    }
    const key = item.heading.toLowerCase();
    if (claimed.has(key) && claimed.get(key) !== item.route) {
      plan.set(item.route, { heading: item.title, rule: 'skipped_heading_collision', title: item.title });
      continue;
    }
    claimed.set(key, item.route);
    plan.set(item.route, { heading: item.heading, rule: item.rule, title: item.title });
  }
  return plan;
}

let activePlan = null;

/** Install the plan for the current build. Passing null clears it. */
function setHeadingPlan(plan) {
  activePlan = plan instanceof Map ? plan : null;
  return activePlan;
}

function getHeadingPlan() {
  return activePlan;
}

/**
 * The heading to render for a route.
 *
 * With no plan installed the original title is returned untouched. That default
 * matters: a renderer that runs outside the planned inventory must not quietly
 * re-shape a heading whose uniqueness nobody checked.
 */
function headingFor(route, title) {
  const fallback = clean(title);
  if (!activePlan) return fallback;
  const entry = activePlan.get(String(route || ''));
  if (!entry) return fallback;
  // The plan is keyed on the title it was built from. A caller rendering a
  // different title for the same route (a hub falling back to registry copy)
  // gets its own title back rather than another page's heading.
  if (entry.title && fallback && entry.title !== fallback) return fallback;
  return entry.heading || fallback;
}

module.exports = {
  clean,
  decapitalize,
  getHeadingPlan,
  headingFor,
  planHeadings,
  setHeadingPlan,
  isLiftable,
  questionHeading,
  shapeAnswer,
  splitSentences,
  stripIngestResidue,
  stripScaffold,
  tokens,
  wordCount
};
