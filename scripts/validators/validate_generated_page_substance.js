#!/usr/bin/env node
'use strict';
/**
 * A generated page must be about its question, not about itself.
 *
 * Incident, 2026-08-29. Four pages written by the Velocity release lane were
 * found rendered, indexable and in no sitemap. Reading them showed why nobody
 * had missed them: every section was an instruction to the page about itself,
 * with the query pasted in.
 *
 *   "dallas dental implant cost is an admitted community question answer, so
 *    the direct answer must stay tied to current source review instead of a
 *    generic community response."
 *   "neuropsychological evaluation chicago il should end with a practical but
 *    bounded next step."
 *
 * The Dallas page mentioned Dallas nowhere in its body. The Chicago page
 * mentioned Chicago nowhere. Six sections, one shape, every route. All four
 * were retired.
 *
 * The second defect was invisible until the unbuilt backlog was given a
 * consumer. scripts/lib/rich_new_page_blocks.js emitted a HARDCODED USCIS
 * civil-surgeon comparison table for every "comparison_guide", whatever the
 * vertical - and the oldest row in that backlog is a dentistry comparison
 * guide. Draining the backlog would have published dentistry pages carrying a
 * table about immigration form I-693.
 *
 * Both are now fixed at source. This validator is the guard, and it checks the
 * output rather than the generator, so a second writer with the same habit is
 * caught too:
 *
 *   1. No page body may contain the self-referential template phrasing - a page
 *      that says what it "should" contain has not contained it.
 *   2. A page's decision or comparison table may not be built from another
 *      vertical's vocabulary. Matching is on distinctive terms only ("civil
 *      surgeon", "I-693"), so a personal-injury page discussing insurance is
 *      not flagged for a word dentistry also uses.
 *
 * Rule 0: it hard-fails if it examined zero pages.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };

// The exact shapes the broken generator produced. Each is a sentence about the
// page rather than about the subject; none of them can occur in copy written
// for a reader.
const SELF_REFERENTIAL = [
  /\bis an admitted (?:community question answer|local decision page|comparison guide|checklist guide|cluster page|guide)\b/i,
  /\bexists because the admitted agent artifact\b/i,
  /\bis source-ready only when it points back to\b/i,
  /\bshould end with a practical but bounded next step\b/i,
  /\bshould warn users about undated summaries\b/i,
  /\bshould compare source authority, timing, written requirements\b/i,
  /\bdeserves a page-family-specific answer\b/i,
  /\bneeds a comparison frame, not a generic answer\b/i,
];

// Terms that belong to exactly one vertical and to no other. A term that two
// verticals legitimately share (insurance, cost, appointment) is not here.
const VERTICAL_MARKERS = {
  'uscis-medical': [/\bcivil surgeon\b/i, /\bI-693\b/i, /\bUSCIS\b/i, /\bgreen card\b/i],
  dentistry: [/\bdentist\b/i, /\bveneer\b/i, /\broot canal\b/i, /\bdental implant\b/i],
  trt: [/\btestosterone\b/i, /\bhypogonadism\b/i, /\bTRT\b/],
  neuro: [/\bneuropsycholog/i, /\bADHD\b/i, /\bneuropsych\b/i],
  'personal-injury': [/\bstatute of limitations\b/i, /\bpersonal injury\b/i, /\binjury claim\b/i],
};
const verticalOf = (route) => {
  const m = String(route || '').match(/^\/(personal-injury|dentistry|trt|neuro|uscis-medical)\//);
  return m ? m[1] : null;
};

const redirectSources = (() => {
  const set = new Set();
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const from = t.split(/\s+/)[0];
      if (from && from.startsWith('/')) set.add(from);
    }
  } catch { /* no _redirects means no retirements, which is the safe direction */ }
  return set;
})();
const isRedirected = (route) => redirectSources.has(route)
  || redirectSources.has(route.endsWith('/') ? route.slice(0, -1) : `${route}/`)
  || redirectSources.has(route.endsWith('.html') ? route.slice(0, -5) : `${route}.html`);

const problems = [];
let examined = 0;
let retiredSkipped = 0;
const sources = [];
for (const rel of ['content/_live/pages.json', 'content/_staged/pages.json']) {
  const doc = read(rel);
  if (!doc || !Array.isArray(doc.pages)) continue;
  sources.push(rel);
  for (const page of doc.pages) {
    const route = page.path || page.slug;
    if (!route) continue;
    // A page nobody can reach is not a published page. Held-back records
    // (EVIDENCE_ONLY) and routes retired behind an ACTIVE_301 are evidence: the
    // four template-only pages retired on 2026-08-29 stay on disk so their
    // inbound links resolve to the redirect, and failing on them forever would
    // be failing on a decision that has already been taken.
    if (String(page.publication_status || '').toUpperCase() === 'EVIDENCE_ONLY') continue;
    if (isRedirected(route)) { retiredSkipped += 1; continue; }
    examined += 1;
    const sections = Array.isArray(page.sections) ? page.sections : [];
    const prose = [page.description, page.bodyHtml, ...sections.map((s) => `${s.q || ''} ${s.a || ''}`)].join(' \n ');
    for (const re of SELF_REFERENTIAL) {
      if (re.test(prose)) {
        problems.push(`${rel}: ${route} contains template phrasing that describes the page instead of answering the question (${re}). A page that says what it "should" contain has not contained it. Fix the generator in scripts/lib/rich_new_page_blocks.js, or retire the page.`);
        break;
      }
    }
    // Cross-vertical tables.
    const vertical = verticalOf(route);
    if (!vertical) continue;
    const tables = sections.flatMap((s) => [s.comparison_table, s.decision_table].filter(Boolean));
    if (!tables.length) continue;
    const tableText = JSON.stringify(tables);
    for (const [other, markers] of Object.entries(VERTICAL_MARKERS)) {
      if (other === vertical) continue;
      const hit = markers.find((re) => re.test(tableText));
      if (hit) {
        problems.push(`${rel}: ${route} is a ${vertical} page whose decision table is written in ${other} vocabulary (matched ${hit}). A hardcoded table emitted regardless of vertical is how a dentistry page ends up comparing the civil-surgeon path for form I-693.`);
        break;
      }
    }
  }
}

console.log('Generated page substance');
console.log(`  page records examined            : ${examined}`);
console.log(`  retired behind a 301 (skipped)   : ${retiredSkipped}`);
console.log(`  sources                          : ${sources.join(', ') || '(none)'}`);

if (!examined) {
  console.error('');
  console.error('VALIDATION FAIL: zero generated page records were examined. content/_live/pages.json and content/_staged/pages.json normally carry hundreds; a substance guard that passes over no pages is the defect it exists to catch.');
  process.exit(1);
}
if (problems.length) {
  console.error('');
  for (const p of problems.slice(0, 40)) console.error(`VALIDATION FAIL: ${p}`);
  if (problems.length > 40) console.error(`VALIDATION FAIL: ...and ${problems.length - 40} more.`);
  process.exit(1);
}
console.log('');
console.log('PASS: every published generated page answers its question in its own vertical\'s vocabulary.');
