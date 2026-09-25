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
 * The floors are the network's rule, not Bing's exact thresholds: a title of at
 * least MIN_TITLE_CHARS and a description of MIN_DESCRIPTION_CHARS to
 * MAX_DESCRIPTION_CHARS. Nothing here shortens a value that is already long enough
 * - a description over the ceiling is left exactly as authored - because a floor
 * fix that rewrote 1,300 accepted descriptions would be a different change.
 *
 * Lengthening uses the page's OWN data (its accordion questions, its vertical),
 * never one shared sentence: a sentence appended to every page is how duplicate
 * descriptions get made.
 *
 * Guard: scripts/validators/validate_search_snippet_floors.js reads these same
 * constants, so the generator and the validator cannot disagree about the floor.
 */

const MIN_TITLE_CHARS = 30;
const MAX_TITLE_CHARS = 70;
const MIN_DESCRIPTION_CHARS = 110;
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
 * A title of at least MIN_TITLE_CHARS. A title that already clears the floor is
 * returned unchanged. A short one is sentence-cased (community questions arrive
 * as lowercase search strings) and given a page qualifier - its vertical, when the
 * caller has one - then the site name, whichever first clears the floor.
 */
function fitTitle(title, { qualifier = '' } = {}) {
  const base = clean(title);
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
  const topic = clean(subject);
  if (topic) {
    const withSubject = `${lead} Source-backed questions to verify about ${topic} before choosing a provider.`;
    if (withSubject.length >= MIN_DESCRIPTION_CHARS && withSubject.length <= MAX_DESCRIPTION_CHARS) return withSubject;
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
  factsFromBody,
  sentenceStart
};
