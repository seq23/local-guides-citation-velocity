'use strict';
/**
 * Does this page's SUBJECT belong to the vertical whose path it occupies?
 *
 * ONE predicate, three callers: the ingestion classifier that assigns a vertical
 * (scripts/community/normalize_signals.js), the CI guard that blocks admission
 * (scripts/validators/validate_vertical_topic_admission.js), and the retirement
 * tool (scripts/retire_offtopic_routes.js). They must agree, so they share this.
 *
 * WHY THE VERTICAL ON THE PATH CANNOT BE TRUSTED AS EVIDENCE
 *
 * The subject is scored WITHOUT the vertical segment of the route. That segment is
 * the claim under test, not evidence for it. Scoring the full path made every route
 * under /personal-injury/ match the anchor "injur" and pass trivially - which is how
 * an IT-degree question scored as a personal-injury page.
 *
 * WHY THIS IS NOT A KEYWORD BLOCKLIST
 *
 * data/content/vertical_topic_contract.json states what each vertical IS, positively.
 * A blocklist of the off-topic pages found today ("IT degree", "hair transplant
 * Istanbul", "IRS letter") passes tomorrow's off-topic page unchanged, because the
 * defect is not any particular subject - it is the ABSENCE of a relationship between
 * a page's subject and its vertical. Only a positive definition of the vertical can
 * test for that absence, so that is what the contract holds.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT_REL = 'data/content/vertical_topic_contract.json';

let contractCache = null;
function contract(rootDir = ROOT) {
  if (contractCache) return contractCache;
  const doc = JSON.parse(fs.readFileSync(path.join(rootDir, CONTRACT_REL), 'utf8'));
  const verticals = doc.verticals || {};
  if (!Object.keys(verticals).length) {
    throw new Error(`${CONTRACT_REL} declares no verticals; every page would be judged against an empty definition.`);
  }
  contractCache = verticals;
  return contractCache;
}

/**
 * Normalized haystack. HTML entities and ampersands become spaces/"and" BEFORE
 * alphanumeric squashing, so "hit & run" and "hit &amp; run" both reach the
 * anchor "hit and run" - they did not, and a genuine hit-and-run page was
 * mis-flagged as off-topic during development.
 */
function normalize(s) {
  return ' ' + String(s || '')
    .toLowerCase()
    .replace(/&amp;|&/g, ' and ')
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() + ' ';
}

/**
 * The same vertical is spelled two ways in this repo: data/content/page_admission_registry.json
 * writes "personal-injury" and content/_live/pages.json writes "personal_injury". The first
 * version of this module keyed the contract on the underscore form only, so all 116 admitted
 * personal-injury routes read as "vertical not contracted" and were WAVED THROUGH - the guard
 * could not reach the vertical carrying almost every defect. Aliases are resolved here, once,
 * and an unrecognised vertical is an error rather than a pass (see canonicalVertical).
 */
const ALIASES = {
  'personal-injury': 'personal_injury',
  'personal injury': 'personal_injury',
  pi: 'personal_injury',
  uscis: 'uscis-medical',
  uscis_medical: 'uscis-medical',
  neuro: 'neuro',
};

/**
 * Resolve a vertical name to a contract key. Returns null when it genuinely is not a
 * contracted vertical. Callers MUST treat null as "cannot judge" and fail closed;
 * returning "ok" for an unknown vertical would let a rename disable the whole guard.
 */
function canonicalVertical(vertical, rootDir = ROOT) {
  const raw = String(vertical || '').trim().toLowerCase();
  const key = ALIASES[raw] || raw;
  return Object.prototype.hasOwnProperty.call(contract(rootDir), key) ? key : null;
}

/** The words a page is ABOUT: its title plus the route below the vertical segment. */
function subjectOf({ route, title }) {
  const segs = String(route || '').replace(/^\/+|\/+$/g, '').split('/');
  return [String(title || ''), ...segs.slice(1)].join(' ');
}

/** How many of `vertical`'s anchors the subject carries. Anchors match at word-start. */
function affinity(subject, vertical, rootDir = ROOT) {
  const key = canonicalVertical(vertical, rootDir);
  const v = key && contract(rootDir)[key];
  if (!v) return 0;
  const hay = normalize(subject);
  let n = 0;
  for (const anchor of v.anchors || []) {
    const needle = ' ' + String(anchor).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (needle.trim() && hay.includes(needle)) n++;
  }
  return n;
}

// Words too generic to be a subject. A title made only of these is not a question
// anyone can answer ("What Should I Be Doing?"), whatever vertical it sits under.
const EMPTY = new Set(('a an the and or but if of for to in on at by with from as is are was were be do does did have has '
  + 'had i me my we our us you your he she it its they them this that what when where which who why how can could should '
  + 'would will may might must not no so than then there here about after before while all any some such only same too '
  + 'very now get go know need want take make just like into out up down also been being see look many much really thing '
  + 'please thanks help advice recommend recommendations worried sure think said told back still even ever anyone else').split(/\s+/));

function subjectWordCount(title) {
  return normalize(title).trim().split(/\s+/).filter((w) => w.length > 2 && !EMPTY.has(w)).length;
}

/**
 * The verdict for one route.
 * Returns { ok: true } or { ok: false, reason, detail, better_home }.
 */
function classifyRoute({ route, title, vertical }, rootDir = ROOT) {
  const verticals = contract(rootDir);
  const key = canonicalVertical(vertical, rootDir);
  // FAIL CLOSED. This used to `return { ok: true }`, which meant a vertical spelled
  // any way the contract did not anticipate was exempt from the guard entirely.
  if (!key) {
    return { ok: false, reason: 'VERTICAL_NOT_CONTRACTED',
      detail: `"${vertical}" is not a vertical in ${CONTRACT_REL} and has no alias, so this route's `
        + 'subject cannot be judged. Add the vertical to the contract or map it in ALIASES; an '
        + 'unjudgeable route is not an admitted one.' };
  }
  const subject = subjectOf({ route, title });
  const own = affinity(subject, key, rootDir);
  if (own > 0) return { ok: true, own };

  const ranked = Object.keys(verticals)
    .map((v) => ({ vertical: v, score: affinity(subject, v, rootDir) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked.find((r) => r.vertical !== key && r.score > 0) || ranked[0];

  if (subjectWordCount(title) < 5) {
    return { ok: false, reason: 'NO_ANSWERABLE_SUBJECT',
      detail: 'the title carries no subject once filler is removed, so no vertical can host it and no writer can answer it' };
  }
  if (best && best.score > 0) {
    return { ok: false, reason: 'MISFILED_VERTICAL', better_home: best.vertical,
      detail: `the subject matches ${best.vertical} (${best.score} anchor(s)) and this vertical not at all` };
  }
  return { ok: false, reason: 'NO_NETWORK_TOPIC',
    detail: 'the subject matches no vertical this network covers' };
}

/** Raw scrape residue that must never appear in the title of a live page. */
const SCRAPE_ARTIFACT = /&#\d+;|&#x[0-9a-f]+;|submitted by|\[username removed\]|\[link\]|\[comments\]|\[deleted\]|\[removed\]|https?:\/\/|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/iu;

/**
 * Subjects that do not belong on a professional legal/medical guide network.
 * Unlike the topical test this IS a lexicon, because "explicit sexual content" has
 * no positive definition to test against. It is scoped to categories, not to the
 * examples found today, and it is checked against title AND body.
 */
const INAPPROPRIATE = /\b(kink|bdsm|fetish|porn|nsfw|masturbat\w*|orgasm\w*|ejaculat\w*|genitalia|penis|vagina|vulva|scrotum|anal sex|sexual practice|sex life|foreskin|nipple\w*)\b/i;

/** Every non-topical defect on one route. */
function contentDefects({ title, body }) {
  const d = [];
  if (SCRAPE_ARTIFACT.test(String(title || ''))) d.push('SCRAPE_ARTIFACT_IN_TITLE');
  if (INAPPROPRIATE.test(`${title || ''} ${body || ''}`)) d.push('INAPPROPRIATE_FOR_NETWORK');
  return d;
}

module.exports = { CONTRACT_REL, contract, canonicalVertical, normalize, subjectOf, affinity, subjectWordCount, classifyRoute, contentDefects, SCRAPE_ARTIFACT, INAPPROPRIATE };
