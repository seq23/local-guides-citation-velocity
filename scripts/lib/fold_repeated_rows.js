'use strict';
/**
 * FOLD REPEATED TABLE ROWS -- one guidance sentence, said once.
 *
 * WHY: Search Readiness q1 failed /trt/ and /personal-injury/ on 10 Nov 2026 for
 * template filler: "Ask this as a specific question and get the answer in writing
 * before choosing a provider." 303 times on /trt/, 268 on /personal-injury/, 117 on
 * /dentistry/. The hubs accumulate every accepted citation-velocity block, and
 * tableRowForRequirement (scripts/lib/html_fix_acceptance_parser.js) gives any
 * requirement it has no specific copy for the same two guidance cells. /trt/ carried
 * 148 tables and 506 rows, of which 186 were distinct.
 *
 * say_once.js could not reach these: it cuts whole sentences, and a table cell is not
 * a sentence it may empty (renderTable would print "Not stated"). And the row cannot
 * simply be dropped, because its FIRST cell is sometimes the only place a ledgered
 * marker appears (the 2026-09-10 /dentistry/cost-insurance/ lesson in
 * template_scaffolding.js).
 *
 * So, applied to the assembled page, inside <main>, measured rather than matched on
 * wording:
 *
 *   1. A row identical to an earlier row on the page is dropped. Every word in it is
 *      still on the page, in the first copy.
 *   2. A row whose guidance cells (everything after cell one) are shared by more than
 *      SLOT_MAX rows on the page carries nothing of its own except cell one. Those
 *      rows leave their tables and their first cells become ONE list under ONE copy of
 *      the shared guidance. Cell one is kept, once, in full -- no marker is lost.
 *   3. A table left with no body rows goes, with the .table-wrap around it. The
 *      section, its heading and its intro stay.
 *
 * Nothing here writes a sentence the page did not carry: the list's paragraph is the
 * shared guidance cells, verbatim. Idempotent: a page already folded has no rows left
 * to fold, and rows that arrive later join the existing list.
 *
 * Proven by scripts/tests/test_fold_repeated_rows.js; the served tree is guarded by
 * the page_quality_slots ratchet (scripts/lib/page_quality_slots_check.js).
 */

const SLOT_MAX = 3;
const QUESTION_START = /^(what|how|is|are|can|do|does|did|should|which|when|where|why|will|who|would|could)\b/i;
const HEADING = 'Which questions should I ask every provider?';

function plain(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
const norm = (html) => plain(html).toLowerCase();
const wordsOf = (html) => plain(html).toLowerCase().match(/[a-z0-9][\w'’-]*/g) || [];

function cellsOf(tr) {
  return [...tr.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((m) => m[2]);
}

/** Every body row in `main`, with its offsets and cells. */
function bodyRows(main) {
  const rows = [];
  for (const body of main.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    const bodyStart = body.index + body[0].indexOf('>') + 1;
    for (const tr of body[1].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
      const cells = cellsOf(tr[0]);
      rows.push({ start: bodyStart + tr.index, end: bodyStart + tr.index + tr[0].length, cells });
    }
  }
  return rows;
}

const guidanceKey = (cells) => cells.slice(1).map(norm).join(' | ');
const rowKey = (cells) => cells.map(norm).join(' | ');

/**
 * A LEDGERED BLOCK IS NEVER FOLDED AWAY (13 Nov 2026). A citation-velocity block whose
 * id is an agent-exact marker is the rendered proof of a ledgered repair:
 * trace_agent_exact_implementation.js looks for that id on the page. The fold took
 * /uscis-medical/'s block (id agent-exact-8b60d8e686) apart - its rows matched an
 * earlier atom table, its heading repeated, and the emptied card went with its id -
 * and the Velocity Content Release failed repair_not_proven every day from 11 Nov.
 * Five hubs lost a marker that way. Its rows still fold like any other (the
 * repeated guidance is said once, every first cell kept once); the card itself,
 * with its id, badge and heading, is never removed. Nothing else changes: the
 * first copy of a heading elsewhere still keeps its own.
 */
const LEDGERED_BLOCK = /<section\b[^>]*\bid="agent-exact-[0-9a-f]+"[^>]*>[\s\S]*?<\/section>/gi;
function ledgeredSpans(html) {
  return [...String(html).matchAll(LEDGERED_BLOCK)].map((m) => [m.index, m.index + m[0].length]);
}
const inSpans = (spans, at) => spans.some(([a, b]) => at >= a && at < b);

/** Existing folded lists, keyed by guidance text, so a re-run appends rather than duplicates. */
function foldedSections(main) {
  const out = new Map();
  for (const m of main.matchAll(/<section\b[^>]*data-folded-rows="true"[^>]*>[\s\S]*?<\/section>/gi)) {
    const p = m[0].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (p) out.set(norm(p[1]), m[0]);
  }
  return out;
}

function renderSection(guidanceCells, subjects) {
  const text = guidanceCells.map((c) => plain(c)).filter(Boolean).join(' ');
  return `<section class="card" data-folded-rows="true"><h2>${HEADING}</h2><p>${text}</p><ul>${subjects.map((s) => `<li>${s.trim()}</li>`).join('')}</ul></section>`;
}

function foldMain(main) {
  const rows = bodyRows(main);
  if (!rows.length) return main;
  const existing = foldedSections(main);
  const existingByText = new Map([...existing].map(([k, v]) => [k, v]));
  const counts = new Map();
  for (const r of rows) if (r.cells.length >= 2) counts.set(guidanceKey(r.cells), (counts.get(guidanceKey(r.cells)) || 0) + 1);

  const seenRows = new Set();
  const groups = new Map(); // guidance key -> { cells, subjects[], seen:Set }
  const drop = [];
  for (const r of rows) {
    if (r.cells.length < 2) continue;
    const key = rowKey(r.cells);
    if (seenRows.has(key)) { drop.push(r); continue; }
    seenRows.add(key);
    const g = guidanceKey(r.cells);
    const subject = r.cells[0];
    if (!norm(subject) || !g.replace(/[ |]/g, '')) continue;
    const joined = r.cells.slice(1).map((c) => plain(c)).filter(Boolean).join(' ').toLowerCase();
    if ((counts.get(g) || 0) <= SLOT_MAX && !existingByText.has(joined)) continue;
    if (!groups.has(g)) groups.set(g, { cells: r.cells.slice(1), joined, subjects: [], seen: new Set() });
    const group = groups.get(g);
    if (!group.seen.has(norm(subject))) { group.seen.add(norm(subject)); group.subjects.push(subject); }
    drop.push(r);
  }
  if (!drop.length) return main;

  let out = main;
  for (const r of [...drop].sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + out.slice(r.end);
  // A table with no body rows left says nothing; take it (and a wrapper holding only it) out.
  // A header cell can carry words of its own ("Victim: punitive damages, contingency
  // fee, claim valuation" on /personal-injury/); those are kept, as a list where the
  // table stood. Generic headers ("Factor", "Why it matters") go with the table.
  const emptied = /(?:<div class="table-wrap">\s*)?<table\b[^>]*>(?:(?!<\/table>)[\s\S])*?<tbody\b[^>]*>\s*<\/tbody>\s*<\/table>(?:\s*<\/div>)?/gi;
  for (const m of [...out.matchAll(emptied)]) {
    const rest = out.replace(m[0], ' ');
    const have = new Set(wordsOf(rest));
    const keep = [...m[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => h[1]).filter((h) => wordsOf(h).some((w) => !have.has(w)));
    out = out.replace(m[0], keep.length ? `<ul>${keep.map((h) => `<li>${h.trim()}</li>`).join('')}</ul>` : '');
  }

  const fresh = [];
  for (const group of groups.values()) {
    const prior = existingByText.get(group.joined);
    if (prior) {
      const have = new Set([...prior.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => norm(m[1])));
      const add = group.subjects.filter((s) => !have.has(norm(s)));
      if (add.length) out = out.replace(prior, prior.replace(/<\/ul>/i, `${add.map((s) => `<li>${s.trim()}</li>`).join('')}</ul>`));
    } else if (group.subjects.length) {
      fresh.push(renderSection(group.cells, group.subjects));
    }
  }
  if (fresh.length) {
    const at = out.search(/<p\b[^>]*data-editorial-byline=["']true["']/i);
    const close = out.search(/<\/main>/i);
    const pos = at >= 0 ? at : close >= 0 ? close : out.length;
    out = out.slice(0, pos) + fresh.join('') + out.slice(pos);
  }
  return out;
}

/**
 * The subject of a heading, without the wrappers the release lane and shape() put
 * around a query string: "What should I know about direct Answer: X — how to compare
 * your options (3)?" and "What should I know about X?" are the same heading.
 */
function headingCore(html) {
  return norm(html)
    .replace(/^what should i know about\s+/, '')
    .replace(/^direct answer:\s*/, '')
    .replace(/\s*\(\d+\)?\s*\??$/, '')
    // The release lane stamps a block-type suffix after an em dash ("— what to check
    // before you act", "— what it costs and what to compare", "— how to compare your
    // options (3)"); the subject is what comes before it.
    .replace(/\s+[—–]\s+.*$/, '')
    .replace(/[?.!:\s]+$/, '')
    .trim();
}

/**
 * 4. A block heading that repeats an earlier heading's subject is dropped; the block's
 *    content stays under the first. The hubs titled 33 blocks on /trt/ after the one
 *    query "what is scrotal cream and is it more effective than standard trt gel", and
 *    a repeated title is the same 8-word window again. The words stay on the page, in
 *    the first heading. An artifact block left with nothing but its badge goes.
 */
function dropRepeatedHeadings(main) {
  const seen = new Set();
  // 4a. Under an artifact badge, shape()'s "What should I know about X?" wrapper is
  //     the template, not the question: it opened 84 block headings on /trt/ and,
  //     with the badge in front, was an 8-word window on its own. The block's own
  //     title is used instead (with the capital shape() lowered put back). The
  //     page's question headings outside the blocks are untouched, so b3 holds.
  let out = main.replace(/(<div class="badge">[^<]*<\/div>\s*<h2\b[^>]*>)What should I know about ([^<]+?)[,.\s]*\?<\/h2>/g,
    (all, open, title) => {
      const t = title.replace(/[,.:\s]+$/, '');
      return `${open}${t.charAt(0).toUpperCase()}${t.slice(1)}${QUESTION_START.test(t) ? '?' : ''}</h2>`;
    });
  const ledgered = ledgeredSpans(out);
  out = out.replace(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (all, level, inner, at) => {
    if (/<(?:a|img)\b/i.test(inner)) return all;
    if (inSpans(ledgered, at)) return all;
    const core = headingCore(inner);
    if (core.split(' ').length < 4) return all;
    if (seen.has(core)) return '';
    seen.add(core);
    // The kept heading loses the stamped suffix too: "How to choose a lawyer for
    // truck accidents — what to check before you act?" asks the same question as
    // the part before the dash, and the suffix was a repeated window on its own.
    const suffix = inner.match(/^([^<]*?\S)\s+[—–]\s+[^<]*$/);
    if (suffix && headingCore(suffix[1]).split(' ').length >= 4) {
      const head = suffix[1].replace(/[?.!:\s]+$/, '');
      return all.replace(inner, `${head}${/\?\s*$/.test(inner) ? '?' : ''}`);
    }
    return all;
  });
  // 5. A list item already said earlier on the page is said once. "Compare every
  //    option with the same criteria" closed 22 callouts on /trt/. Items carrying a
  //    link are left alone (they are navigation, and a link is never cut through).
  const items = new Set();
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (all, inner) => {
    if (/<(?:a|img|code)\b/i.test(inner)) return all;
    const key = norm(inner);
    if (key.split(' ').length < 3) return all;
    if (items.has(key)) return '';
    items.add(key);
    return all;
  });
  out = out.replace(/<(ul|ol)\b[^>]*>\s*<\/\1>/gi, '');
  // 6. A block the fold left as a badge over a heading, with nothing under it, says
  //    nothing. It goes only if every word of its heading is still on the page
  //    elsewhere (say_once.js's invariant: no page loses a word it has nowhere else).
  const bare = /<section class="card citation-velocity-artifact[^"]*"[^>]*>\s*<div class="badge">[^<]*<\/div>\s*<h2\b[^>]*>([^<]*)<\/h2>\s*<\/section>/gi;
  for (const m of [...out.matchAll(bare)]) {
    const rest = out.replace(m[0], ' ');
    const words = new Set(wordsOf(rest));
    const mine = wordsOf(m[1]);
    if (/\bid="agent-exact-/.test(m[0])) continue;
    if (mine.every((w) => words.has(w))) out = rest === out ? out : out.replace(m[0], '');
  }
  out = out.replace(/<section class="card citation-velocity-artifact[^"]*"[^>]*>\s*(?:<div class="badge">[^<]*<\/div>\s*)?(?:<(ul|ol)\b[^>]*>\s*<\/\1>\s*)*<\/section>/gi,
    (all) => (/\bid="agent-exact-/.test(all) ? all : ''));
  return out;
}

/** Fold the repeated rows inside the page's <main>; a page with no <main> is returned unchanged. */
function foldRepeatedRows(html) {
  const s = String(html);
  const open = s.search(/<main\b/i);
  if (open < 0) return s;
  const closeRel = s.slice(open).search(/<\/main>/i);
  const end = closeRel < 0 ? s.length : open + closeRel + '</main>'.length;
  return s.slice(0, open) + dropRepeatedHeadings(foldMain(s.slice(open, end))) + s.slice(end);
}

module.exports = { foldRepeatedRows, headingCore, SLOT_MAX, HEADING };
