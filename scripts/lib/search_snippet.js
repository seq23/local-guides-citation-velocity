'use strict';

/**
 * Search-result snippet floors: the <title> and meta description a crawler shows.
 *
 * Bing Webmaster, 2026-09-25: theindustryguides.com carried 86 titles under 30
 * characters ("About", "Atlas", "USCIS: Cost", "Minoxidil cost | Insight") and 43
 * meta descriptions under 100 ("Privacy notes for this site." is 28). Every one
 * came from a generator that printed whatever short label its record happened to
 * hold, so the fix lives here, where the generators ask for the head values, and
 * not on any one page.
 *
 * The floors are the network's rule, not Bing's exact thresholds: a title of
 * MIN_TITLE_CHARS to MAX_TITLE_CHARS and a description of MIN_DESCRIPTION_CHARS to
 * MAX_DESCRIPTION_CHARS.
 *
 * Both ENDS are now held. Until 2026-10-25 only the floors were, on the reasoning
 * that "a floor fix that rewrote 1,300 accepted descriptions would be a different
 * change" - and that change is this one. The Search Readiness audit measured the
 * served pages on 2026-10-25: titles of 74 and 69 characters and descriptions of
 * 199 to 227, which search results cut off mid-sentence. A value over its ceiling
 * is trimmed here, at the one place the generators ask for head values, on a word
 * boundary so the trim never ends mid-word.
 *
 * Lengthening uses the page's OWN data (its accordion questions, its vertical),
 * never one shared sentence: a sentence appended to every page is how duplicate
 * descriptions get made.
 *
 * Guard: scripts/validators/validate_search_snippet_floors.js reads these same
 * constants, so the generator and the validator cannot disagree about the floor.
 */

const MIN_TITLE_CHARS = 30;
const MAX_TITLE_CHARS = 65;
const MIN_DESCRIPTION_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 160;
const SITE_NAME = 'The Industry Guides';

// Accordion labels that the generator prints on many pages. They describe the
// template, not the page, so they are never used as a page's own facts.
const GENERIC_FACT = /^(additional practical questions|section$|quick answer|direct answer|related questions|primary sources)/i;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function sentenceStart(value) {
  const s = clean(value);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * A value trimmed to `max` characters on a word boundary, never mid-word, with a
 * dangling connective or punctuation removed from the end. Returns the value
 * unchanged when it already fits.
 *
 * `keepWhole` is a suffix that must survive the trim intact (a title's " | The
 * Industry Guides"): the body before it is shortened instead.
 */
function trimTo(value, max, { keepWhole = '' } = {}) {
  const s = clean(value);
  if (s.length <= max) return s;
  const suffix = clean(keepWhole);
  if (suffix && s.endsWith(suffix) && suffix.length < max) {
    const room = max - suffix.length;
    const head = trimTo(s.slice(0, s.length - suffix.length), room);
    return `${head}${suffix}`;
  }
  const cut = s.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  // A single token longer than the ceiling has no boundary to cut on; a hard cut
  // is the only honest answer and is still better than an unbounded value.
  let out = lastSpace > 0 ? cut.slice(0, lastSpace) : s.slice(0, max);
  // Both ends settle together: dropping the orphan word in "evaluations, and"
  // exposes the comma it was hiding, so each pass re-runs until nothing changes.
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out.replace(/[\s,;:.\-–—|]+$/, '');
    // "... and", "... of", "... the" reads as a truncation; drop the orphan word.
    out = out.replace(/\s+(a|an|and|at|by|for|from|in|of|on|or|the|to|with|without)$/i, '');
    if (out === before) break;
  }
  return out.trim();
}

/**
 * A title of at least MIN_TITLE_CHARS. A title that already clears the floor is
 * returned unchanged. A short one is sentence-cased (community questions arrive
 * as lowercase search strings) and given a page qualifier - its vertical, when the
 * caller has one - then the site name, whichever first clears the floor.
 */
function fitTitle(title, { qualifier = '' } = {}) {
  const base = clean(title);
  // Over the ceiling: a search result shows roughly MAX_TITLE_CHARS, so trim the
  // title itself rather than let the result cut it off mid-word.
  if (base.length > MAX_TITLE_CHARS) return trimTo(base, MAX_TITLE_CHARS);
  if (base.length >= MIN_TITLE_CHARS) return base;
  const head = sentenceStart(base);
  const q = clean(qualifier);
  const candidates = [
    q && `${head} | ${q}`,
    `${head} | ${SITE_NAME}`,
    q && `${head} | ${q} | ${SITE_NAME}`
  ].filter(Boolean);
  // The first candidate that clears the floor without passing MAX_TITLE_CHARS, where
  // Bing starts reporting "title too long".
  return candidates.find((c) => c.length >= MIN_TITLE_CHARS && c.length <= MAX_TITLE_CHARS)
    || candidates.find((c) => c.length >= MIN_TITLE_CHARS)
    || candidates[candidates.length - 1];
}

/**
 * The page's own questions, as printed in its accordion, in page order. These are
 * what a reader will find on the page, which makes them the honest thing to put
 * in the snippet.
 */
function factsFromBody(bodyHtml) {
  const out = [];
  const seen = new Set();
  const re = /<button\b[^>]*class=\\?["']acc-btn\\?["'][^>]*>\s*<div>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(String(bodyHtml || '')))) {
    const text = clean(decodeEntities(m[1].replace(/<[^>]+>/g, ' ')));
    const key = text.toLowerCase();
    if (!text || GENERIC_FACT.test(text) || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function terminate(value) {
  const s = clean(value);
  if (!s) return s;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * A description of at least MIN_DESCRIPTION_CHARS. One that already clears the
 * floor is returned unchanged. A short one gains the page's own facts, as many as
 * fit under MAX_DESCRIPTION_CHARS; if none fits it gains the page subject instead.
 */
function fitDescription(description, { facts = [], subject = '' } = {}) {
  const base = clean(description);
  // Over the ceiling: trim to a whole word and terminate, so the snippet reads as
  // a finished sentence instead of being cut off by the search result. The full
  // stop terminate() adds counts against the ceiling, so a trim that lands
  // exactly on it is redone one character shorter.
  if (base.length > MAX_DESCRIPTION_CHARS) {
    const ended = terminate(trimTo(base, MAX_DESCRIPTION_CHARS));
    return ended.length <= MAX_DESCRIPTION_CHARS ? ended : terminate(trimTo(base, MAX_DESCRIPTION_CHARS - 1));
  }
  if (base.length >= MIN_DESCRIPTION_CHARS) return base;
  const lead = terminate(base);
  const usable = facts.map((f) => clean(f).replace(/[.?!:;]+$/, '')).filter(Boolean);
  let picked = [];
  for (const fact of usable) {
    const trial = `${lead} Covers: ${[...picked, fact].join('; ')}.`;
    if (trial.length <= MAX_DESCRIPTION_CHARS) picked.push(fact);
    const now = `${lead} Covers: ${picked.join('; ')}.`;
    if (picked.length && now.length >= MIN_DESCRIPTION_CHARS) return now;
  }
  if (picked.length) {
    const withFacts = `${lead} Covers: ${picked.join('; ')}.`;
    if (withFacts.length >= MIN_DESCRIPTION_CHARS) return withFacts;
  }
  // Graduated tails, longest first, each naming the page's OWN subject so the
  // result stays unique: a single sentence appended to every page is how
  // duplicate descriptions get made. The first one that lands inside the band
  // wins. Seven pages reached here on 2026-10-25 (112 to 116 characters) with no
  // accordion questions to draw on, so the one tail they had was far too long.
  const topic = clean(subject).replace(/[.?!]+$/, '');
  const tails = [
    ...(topic ? [
      `Source-backed questions to verify about ${topic} before choosing a provider.`,
      `Source-backed answers about ${topic}, with the primary source for each.`,
      `What to verify about ${topic}, and the source behind each answer.`,
      `With the primary source behind each answer about ${topic}.`
    ] : []),
    // Shorter rungs for a lead that is already near the band: a 112-character
    // lead has room for 47 characters, not 81, and a tail that has to be cut
    // mid-phrase ("...to verify about Senior.") is worse than a short true one.
    'Each answer names the primary source it rests on.',
    'Each answer names its primary source.',
    'With the primary source for each answer.',
    'Primary sources named throughout.',
    'Primary sources named.'
  ];
  for (const tail of tails) {
    const candidate = `${lead} ${tail}`;
    if (candidate.length >= MIN_DESCRIPTION_CHARS && candidate.length <= MAX_DESCRIPTION_CHARS) return candidate;
  }
  // Nothing landed in the band: take the longest tail and trim it to the ceiling,
  // which is still inside the band because every tail clears the floor on its own.
  const longest = `${lead} ${tails[0]}`;
  if (longest.length > MAX_DESCRIPTION_CHARS) {
    const trimmed = terminate(trimTo(longest, MAX_DESCRIPTION_CHARS));
    if (trimmed.length >= MIN_DESCRIPTION_CHARS) return trimmed.length <= MAX_DESCRIPTION_CHARS ? trimmed : terminate(trimTo(longest, MAX_DESCRIPTION_CHARS - 1));
  }
  return picked.length ? `${lead} Covers: ${picked.join('; ')}.` : lead;
}

module.exports = {
  MIN_TITLE_CHARS,
  MAX_TITLE_CHARS,
  MIN_DESCRIPTION_CHARS,
  MAX_DESCRIPTION_CHARS,
  SITE_NAME,
  fitTitle,
  fitDescription,
  trimTo,
  factsFromBody,
  sentenceStart
};
