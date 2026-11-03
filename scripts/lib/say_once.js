'use strict';
/**
 * SAY IT ONCE — no phrase more than three times on one page.
 *
 * WHY: Search Readiness q1 ("sampled pages meet the page shape") failed 5 of 5
 * sampled pages on theindustryguides.com, 3 Nov 2026, and template filler was the
 * reason on three of them. /settlement-demand-vs-lawsuit-filing/ rendered its one
 * stored answer EIGHT times -- the definition paragraph, the Quick answer, a muted
 * restatement, the recommendation summary, a second answer box, the visible FAQ,
 * the accordion panel, and a checklist bullet directly under that panel.
 *
 * The content ledger is not the bug. `content/_live/pages.json` stores one answer
 * per section; the compiler that wrote it also copied that answer into the section's
 * checklist and into the "Verify" step of its framework atom, and the render layer
 * then gave every copy its own visible slot. The fix belongs at the layer that
 * decides which slot gets which words, because it holds for every page the
 * templates build whatever the ledger happens to contain.
 *
 * THE RULE is the sampler's own rule, applied where the page is assembled: no
 * 8-word window appears more than three times in one <main>. Enforcing the measure
 * itself rather than the shapes that happened to break it means a new template
 * cannot reintroduce the defect in a form this pass does not recognise -- and the
 * tokenizer and window size below are deliberately the sampler's, because a pass
 * that counts words differently trims the wrong sentence (it chased
 * "health facilities commission licenses assisted care living facilities" while the
 * sampler was failing the page for "where can i find a care home in").
 *
 * WHAT IS GIVEN UP: whole sentences, from the least important copy first. These
 * slots own their words and are given up last, in this order --
 *
 *   [data-definition]   the opening definition
 *   .qa-block           a visible FAQ answer
 *   .acc-panel > p      a decision section's own answer
 *
 * -- and everything else in <main> goes before them. `.quick-answer` is pointedly
 * NOT one of them: it is the slot that restated the definition verbatim on every
 * page whose answer box fell back to `description`, and the point of a Quick answer
 * is to add what the definition did not say. A block left with no visible text is
 * removed; an emptied paragraph inside `.quick-answer` goes and the section around
 * it stays, so the speakable selector on `.quick-answer` still resolves.
 *
 * A sentence is only ever cut whole, and only when its span of the block's HTML
 * carries no tags: trimming around an inline link is how a template pass mangles
 * one. Nothing here writes a sentence the page did not already carry.
 *
 * Proven by scripts/tests/test_say_once.js; guarded on the served tree by
 * scripts/validators/check_page_quality_sample.js.
 */

/** The sampler's window size and limit (boss-os page-quality-sample.mjs, QUALITY). */
const SLOT_WORDS = 8;
const SLOT_MAX = 3;

/** The slots that own their words, given up last, in the order a reader meets them. */
const HOME_ORDER = ['definition', 'qa-block', 'acc-panel'];

function plain(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The sampler's tokenizer, exactly: `wordsOf` in page-quality-sample.mjs. */
function wordsIn(text) {
  return String(text).toLowerCase().match(/[a-z0-9][\w'’-]*/g) || [];
}

function normalize(sentence) {
  return wordsIn(sentence).join(' ');
}

/** Split visible text into sentences. An abbreviation is not a sentence end. */
function sentences(text) {
  const out = [];
  for (const part of String(text).split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(])/)) {
    const s = part.trim();
    if (s) out.push(s);
  }
  return out;
}

function windowsOf(words, n = SLOT_WORDS) {
  const out = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Every <p> and <li> inside a fragment, with absolute offsets. A hand-rolled walk
 * rather than a parser: these pages come from this repo's own templates, and adding
 * a DOM dependency to the build for one pass is a worse trade than a scan that only
 * has to understand <p> and <li>.
 */
function blocks(main, base) {
  const out = [];
  const open = /<(p|li)\b[^>]*>/gi;
  let m;
  while ((m = open.exec(main))) {
    const tag = m[1].toLowerCase();
    const token = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
    token.lastIndex = m.index;
    let depth = 0, end = -1, t;
    while ((t = token.exec(main))) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (!depth) { end = token.lastIndex; break; }
    }
    if (end < 0) continue;
    out.push({ tag, openTag: m[0], start: base + m.index, end: base + end, html: main.slice(m.index, end) });
    open.lastIndex = end;
  }
  return out;
}

/** Which home a block sits in, or null. */
function homeOf(main, offset, block) {
  if (/\bdata-definition=["']true["']/i.test(block.openTag)) return 'definition';
  if (/class=["'][^"']*\bdefinition\b/i.test(block.openTag)) return 'definition';
  const before = main.slice(0, offset);
  for (const cls of ['qa-block', 'acc-panel']) {
    const openRe = new RegExp(`<(section|div)\\b[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>`, 'gi');
    let last = null, m;
    while ((m = openRe.exec(before))) last = m;
    if (!last) continue;
    const tail = before.slice(last.index);
    const opens = (tail.match(/<(?:section|div)\b[^>]*>/gi) || []).length;
    const closes = (tail.match(/<\/(?:section|div)>/gi) || []).length;
    if (opens <= closes) continue;
    if (cls === 'acc-panel') return block.tag === 'p' ? 'acc-panel' : null;
    return cls;
  }
  return null;
}

/**
 * Sentence spans over a block's inner HTML: `{ text, from, to }`, so a sentence can
 * be cut without disturbing the markup around it. A span is only offered when the
 * text it covers is free of tags, which `spans` guarantees by only ever reading
 * inside one text node.
 */
function spans(innerHtml) {
  const out = [];
  const text = /(^|>)([^<]+)/g;
  let m;
  while ((m = text.exec(innerHtml))) {
    const chunkStart = m.index + m[1].length;
    let offset = 0;
    for (const sentence of sentences(m[2])) {
      const at = m[2].indexOf(sentence, offset);
      if (at < 0) continue;
      offset = at + sentence.length;
      out.push({ text: sentence, from: chunkStart + at, to: chunkStart + at + sentence.length });
    }
  }
  return out;
}

function inner(block) {
  const openLen = block.openTag.length;
  const closeLen = (block.html.match(/<\/[a-z]+>$/i) || [''])[0].length;
  return block.html.slice(openLen, block.html.length - closeLen);
}

/**
 * The sentences in one block that a phrase can be taken out of.
 *
 * A window does not respect sentence boundaries. /uscis-medical/ repeated
 * "what is included in the quote are vaccine" six times, and it spans the end of
 * "What is included in the quote?" and the start of "Are vaccine records reviewed
 * before the visit?" -- two sentences, so no single sentence contained the phrase
 * and an earlier version of this pass found nothing to cut on that page at all.
 *
 * So the block's sentences are walked as one word stream, each word remembering
 * which sentence it came from, and a matching window is attributed to the sentence
 * its LAST word falls in: removing that sentence is what breaks the phrase, and
 * taking the tail rather than the head leaves the sentence a reader has already
 * started. One candidate per occurrence.
 */
function carriers(block, phrase, n) {
  const list = spans(inner(block));
  const words = [];
  const owner = [];
  for (const span of list) for (const word of wordsIn(span.text)) { words.push(word); owner.push(span); }
  const out = [];
  for (let i = 0; i + n <= words.length; i++) {
    if (words.slice(i, i + n).join(' ') !== phrase) continue;
    const span = owner[i + n - 1];
    if (!out.some((c) => c.span === span)) out.push({ block, span });
  }
  return out;
}

/**
 * Remove repeated phrases from a rendered page until no 8-word window appears more
 * than `cap` times in <main>.
 *
 * Iterative: cutting one sentence changes every window that crossed it, so the
 * counts are rebuilt each pass. `passes` bounds the work; a page that cannot be
 * brought under the cap in that many passes is left as it is and reported by the
 * validator rather than cut further, because at that point the repetition is the
 * page's own content and not a template slot.
 */
function sayOnce(html, { cap = SLOT_MAX, n = SLOT_WORDS, passes = 600 } = {}) {
  let out = String(html);
  for (let pass = 0; pass < passes; pass++) {
    const mainMatch = out.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
    if (!mainMatch) return out;
    const base = mainMatch.index + mainMatch[0].indexOf(mainMatch[1]);
    const main = mainMatch[1];

    const counts = new Map();
    for (const w of windowsOf(wordsIn(plain(main)), n)) counts.set(w, (counts.get(w) || 0) + 1);
    const over = [...counts].filter(([, c]) => c > cap).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (!over.length) return out;

    const found = blocks(main, base);
    for (const b of found) {
      b.home = homeOf(main, b.start - base, b);
      b.rank = b.home ? HOME_ORDER.indexOf(b.home) : HOME_ORDER.length;
    }

    // Not every repeat can be cut here. A phrase that only exists because a window
    // runs out of a heading and into the list beneath it has no sentence to remove,
    // and an earlier version of this loop RETURNED on the first such phrase -- so a
    // page whose worst repeat was uncuttable kept every repeat that was. 142 windows
    // were over the cap on /uscis-medical/ and not one of them was touched. Walk the
    // list instead, and only give up when no phrase on it has a sentence to give.
    let cutThisPass = null;
    for (const [phrase, times] of over) {
      // Candidate sentences carrying the phrase: least important first, latest first
      // within a rank, so the copy a reader meets last is the copy that goes.
      const candidates = [];
      for (const b of found) candidates.push(...carriers(b, phrase, n));
      candidates.sort((a, b) => b.block.rank - a.block.rank || b.block.start - a.block.start);
      const giveUp = candidates.slice(0, Math.max(0, times - cap));
      if (giveUp.length) { cutThisPass = giveUp; break; }
    }
    if (!cutThisPass) return out;
    const giveUp = cutThisPass;

    // Group the cuts by block, then rewrite the blocks from the end of the document.
    const byBlock = new Map();
    for (const { block, span } of giveUp) {
      if (!byBlock.has(block)) byBlock.set(block, { block, cut: [] });
      byBlock.get(block).cut.push(span);
    }
    const edits = [...byBlock.values()].sort((a, b) => b.block.start - a.block.start);
    for (const { block, cut } of edits) {
      let rest = inner(block);
      for (const span of [...cut].sort((a, b) => b.from - a.from)) rest = rest.slice(0, span.from) + rest.slice(span.to);
      rest = rest.replace(/\s{2,}/g, ' ').trim();
      const replacement = plain(rest) ? `${block.openTag}${rest}</${block.tag}>` : '';
      out = out.slice(0, block.start) + replacement + out.slice(block.end);
    }
  }
  return out;
}


/**
 * FURNITURE — the repeats that are not sentences at all.
 *
 * `sayOnce` works on sentences inside <p> and <li>, and two of the shapes it leaves
 * behind on theindustryguides.com only exist because a window crosses from a heading
 * into the list under it:
 *
 *   1. Every decision section carries the SAME three red flags, so
 *      "red flags no current primary source is cited" appears five times on
 *      /settlement-demand-vs-lawsuit-filing/ -- one heading-plus-list pair repeated
 *      verbatim down the page. A warning list that is identical under every section
 *      is a property of the page, not of the section.
 *
 *   2. Each section's checklist opens with "Define the exact decision behind <its own
 *      question>", directly beneath a heading that just asked that question. It is
 *      the filler `ensureSpecificItems` in content_atom.js adds when a section has
 *      fewer than three checklist items, and it reaches the reader as a bullet that
 *      restates the heading above it.
 *
 * Both are removed by what they are rather than by their text, so neither depends on
 * the wording staying put: an identical heading-and-list pair keeps its first
 * appearance and loses the rest, and a list item that contains its own heading whole
 * is dropped. Nothing that says something new is touched.
 */
function dropRepeatedFurniture(html) {
  let out = String(html);

  // 1. The same heading-and-list pair, more than once: keep the first.
  {
    const mainMatch = out.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
    if (!mainMatch) return out;
    const base = mainMatch.index + mainMatch[0].indexOf(mainMatch[1]);
    const main = mainMatch[1];
    const pairs = [...main.matchAll(/<(h[23])\b[^>]*>([\s\S]*?)<\/\1>\s*<(ul|ol)\b[^>]*>([\s\S]*?)<\/\3>/gi)];
    const seen = new Set();
    const cut = [];
    for (const m of pairs) {
      const key = `${normalize(plain(m[2]))}|${normalize(plain(m[4]))}`;
      if (!normalize(plain(m[4]))) continue;
      if (seen.has(key)) cut.push({ start: base + m.index, end: base + m.index + m[0].length });
      else seen.add(key);
    }
    for (const c of cut.sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + out.slice(c.end);
  }

  // 2. A list item that contains its own heading whole, and little else.
  {
    const mainMatch = out.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
    if (!mainMatch) return out;
    const base = mainMatch.index + mainMatch[0].indexOf(mainMatch[1]);
    const main = mainMatch[1];
    const cut = [];
    for (const b of blocks(main, base)) {
      if (b.tag !== 'li') continue;
      const before = main.slice(0, b.start - base);
      const heads = [...before.matchAll(/<(h[1-4]|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      if (!heads.length) continue;
      const heading = normalize(plain(heads[heads.length - 1][2]));
      if (heading.split(' ').length < 5) continue;
      const item = normalize(plain(b.html));
      if (!item.includes(heading)) continue;
      // It restates the heading; drop it only if it adds almost nothing of its own.
      if (item.split(' ').length - heading.split(' ').length > 6) continue;
      cut.push(b);
    }
    for (const b of cut.sort((a, b) => b.start - a.start)) out = out.slice(0, b.start) + out.slice(b.end);
  }
  return out;
}

module.exports = { sayOnce, dropRepeatedFurniture, plain, sentences, normalize, wordsIn, windowsOf, SLOT_WORDS, SLOT_MAX };
