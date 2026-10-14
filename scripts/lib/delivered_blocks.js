'use strict';
/**
 * Delivered blocks: what a reader actually receives from a rendered page, counted.
 *
 * The shrink guard used to keep an exact BYTE floor per page. Bytes jitter - a date,
 * a rotated link label, a whitespace change - so a page that lost nothing could red
 * main (2026-10-14: uscis-medical/civil-surgeon-near-me fell 2 bytes below a named
 * floor), while a page that lost a whole block and gained a longer one elsewhere
 * passed (the same release removed the "Use the canonical local guide before
 * acting" block from six pages; five of them grew and went unnoticed, and #194 had
 * removed it from seven more the day before).
 *
 * So the floor is a count per KIND of block inside <main> (the whole <body> when a
 * page has no <main>): sections, h2, h3, paragraphs, list items, tables. Scripts,
 * styles, comments, templates and noscript are not delivered and are not counted.
 * A kind may only fall under a named justification; it can never be paid for by
 * growth in another kind.
 */
const KINDS = ['section', 'h2', 'h3', 'p', 'li', 'table'];

function deliveredRegion(html) {
  const s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const open = s.search(/<main\b[^>]*>/i);
  const close = s.toLowerCase().lastIndexOf('</main>');
  if (open >= 0 && close > open) return s.slice(open, close);
  const body = s.search(/<body\b[^>]*>/i);
  return body >= 0 ? s.slice(body) : s;
}

function deliveredBlocks(html) {
  const region = deliveredRegion(html);
  const out = {};
  for (const k of KINDS) out[k] = (region.match(new RegExp(`<${k}(?=[\\s>/])`, 'gi')) || []).length;
  return out;
}

function totalBlocks(counts) {
  return KINDS.reduce((n, k) => n + (Number(counts && counts[k]) || 0), 0);
}

// Kinds where `current` holds fewer blocks than `floor`: [{ kind, floor, current }].
function lostKinds(floor, current) {
  const out = [];
  for (const k of KINDS) {
    const f = Number(floor && floor[k]) || 0;
    const c = Number(current && current[k]) || 0;
    if (c < f) out.push({ kind: k, floor: f, current: c });
  }
  return out;
}

module.exports = { KINDS, deliveredBlocks, deliveredRegion, totalBlocks, lostKinds };
