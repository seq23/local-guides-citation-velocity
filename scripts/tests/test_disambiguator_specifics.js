#!/usr/bin/env node
'use strict';
/**
 * The 20 comparison pages say things only they can say (Search Readiness q1, 17 Nov 2026).
 *
 * Guards where the behaviour lives - the ledger records and the side-by-side atom helpers:
 *   1. every VELOCITY_DISAMBIGUATOR_20 record matches data/content/disambiguator_specifics.json
 *      (apply_disambiguator_specifics.js --check), and there are exactly 20 of them;
 *   2. no section answer, checklist item or table cell is shared by two of those records, and none
 *      carries the retired program's slot text or echoes its own page title in a question;
 *   3. a side-by-side table's how-to step names both options, never one bare column-A cell;
 *   4. negative: a copied answer and the old generic slot are each caught by check 2.
 */
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { atomHowToSteps } = require('../lib/content_atom');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERIC = [/governing purpose, setting, eligibility/i, /defined purpose and setting match/i, /separate purpose, jurisdiction, or provider type/i, /fits the first category/i, /Compare the categories, verify the current source/i];

function problems(pages) {
  const out = [];
  const seen = new Map();
  for (const page of pages) {
    const texts = [];
    for (const s of page.sections || []) {
      texts.push(s.a, ...(s.checklist || []));
      if (page.title.length > 30 && String(s.visible_q).includes(page.title)) out.push(`${page.slug}: question echoes the title`);
    }
    for (const row of (page.content_atom && page.content_atom.rows) || []) texts.push(...row.slice(1));
    for (const t of texts) {
      if (GENERIC.some((g) => g.test(t))) out.push(`${page.slug}: generic slot text "${t}"`);
      if (String(t).split(/\s+/).length < 6) continue; // short cells such as "No" may repeat
      const prior = seen.get(t);
      if (prior && prior !== page.slug) out.push(`${page.slug}: shares "${t}" with ${prior}`);
      seen.set(t, page.slug);
    }
  }
  return out;
}

const pages = require(path.join(ROOT, 'content/_live/pages.json')).pages.filter((p) => p.full_scope_program === 'VELOCITY_DISAMBIGUATOR_20' && !p.status);
assert.strictEqual(pages.length, 20, `expected 20 comparison pages, found ${pages.length}`);
execFileSync(process.execPath, [path.join(ROOT, 'scripts/content/apply_disambiguator_specifics.js'), '--check'], { stdio: 'pipe' });
assert.deepStrictEqual(problems(pages), []);

const steps = atomHowToSteps(pages[0].content_atom);
const [a, b] = pages[0].content_atom.headers.slice(1);
assert.ok(steps.length >= 3 && steps.every((s) => s.text.includes(a) && s.text.includes(b)), 'side-by-side step must name both options');

// Negative proofs: the check is not passing by seeing nothing.
const copied = JSON.parse(JSON.stringify(pages.slice(0, 2)));
copied[1].sections[1].a = copied[0].sections[1].a;
assert.ok(problems(copied).some((p) => p.includes('shares')), 'a copied answer must be caught');
const generic = JSON.parse(JSON.stringify(pages.slice(0, 1)));
generic[0].sections[2].a = 'Choose it only when its governing purpose, setting, eligibility, and decision-maker match your situation.';
assert.ok(problems(generic).some((p) => p.includes('generic slot')), 'the old slot text must be caught');

console.log(`PASS disambiguator specifics: ${pages.length} pages, no shared or generic slot text`);
