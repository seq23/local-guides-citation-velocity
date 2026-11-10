#!/usr/bin/env node
'use strict';
/**
 * Pins what foldRepeatedRows does to an assembled page (Search Readiness q1,
 * 10 Nov 2026): the shared guidance cells are said once, every row subject survives
 * once, identical rows and repeated block headings go, and nothing outside <main>
 * moves. Run by the site-hygiene blocker's page_quality_slots block.
 */
const assert = require('assert');
const { foldRepeatedRows, headingCore, SLOT_MAX } = require('../lib/fold_repeated_rows');
const { plain, wordsIn, windowsOf } = require('../lib/say_once');

const G1 = 'Ask this as a specific question and get the answer in writing before choosing a provider.';
const G2 = 'Specific, written answers are more reliable than broad marketing claims.';
const table = (rows) => `<div class="table-wrap"><table><thead><tr><th>Factor</th><th>What to verify</th><th>Why it matters</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const block = (title, rows) => `<section class="card citation-velocity-artifact cost_table"><div class="badge">Cost table</div><h2 class="h2">${title}</h2>${table(rows)}</section>`;
const subjects = ['Does medicare cover dental implants', 'How to choose a dentist', 'Cleaning fees', 'Crown warranty', 'Payment plans'];
const page = () => `<html><head><title>t</title></head><body><nav>${G1}</nav><main><h1>Hub</h1>`
  + block('What should I know about how much do dental implants cost?', [[subjects[0], G1, G2], ['Comparison method', 'Use the same questions.', 'Consistency helps.'], ['Fee terms', 'Get the fee schedule in writing.', 'Hidden fees are common.']])
  + block('What should I know about direct Answer: how much do dental implants cost — how to compare your options (2)?', [[subjects[1], G1, G2], ['Comparison method', 'Use the same questions.', 'Consistency helps.']])
  + block('Which crowns last longest?', subjects.slice(2).map((s) => [s, G1, G2]))
  + block('Is whitening safe?', [[subjects[0], G1, G2]])
  + `<section class="card citation-velocity-artifact comparison_table"><div class="badge">Comparison table</div><h2 class="h2">Victim or accused?</h2><div class="table-wrap"><table><thead><tr><th>Victim: punitive damages, claim valuation</th><th>What to verify</th><th>Why it matters</th></tr></thead><tbody><tr><td>Fender bender</td><td>${G1}</td><td>${G2}</td></tr><tr><td>Hit and run</td><td>${G1}</td><td>${G2}</td></tr><tr><td>Rideshare crash</td><td>${G1}</td><td>${G2}</td></tr><tr><td>Bus crash</td><td>${G1}</td><td>${G2}</td></tr></tbody></table></div></section>`
  + '<section class="card citation-velocity-artifact callout"><div class="badge">Important context</div><ul><li>Compare every option with the same criteria</li><li>Bring your records</li></ul></section>'
  + '<section class="card citation-velocity-artifact callout"><div class="badge">Important context</div><ul><li>Compare every option with the same criteria</li></ul></section>'
  + block('How long do porcelain crowns last — what to check before you act?', [['Lab fees', 'Ask for the lab fee.', 'It varies.']])
  + '<p class="editorial-byline" data-editorial-byline="true">By us</p></main><footer>f</footer></body></html>';

function worst(html) {
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)[0];
  const counts = new Map();
  for (const w of windowsOf(wordsIn(plain(main)))) counts.set(w, (counts.get(w) || 0) + 1);
  return Math.max(0, ...counts.values());
}
const count = (html, s) => html.toLowerCase().split(s.toLowerCase()).length - 1;

const before = page();
assert.ok(worst(before) > SLOT_MAX, 'fixture must start over the cap');
const out = foldRepeatedRows(before);

// The shared guidance is said once, and the page is under the cap.
assert.strictEqual(count(out, G1) - count(out.slice(0, out.indexOf('<main')), G1), 1, 'guidance sentence must appear once inside <main>');
assert.ok(worst(out) <= SLOT_MAX, `still over the cap: ${worst(out)}`);
// Every subject survives, once (a ledgered marker in cell one is never lost).
for (const s of subjects) assert.strictEqual(count(out, s), 1, `subject "${s}" must survive exactly once`);
// A row with its own guidance stays in its table; an identical later row goes.
assert.ok(out.includes('<td>Fee terms</td>'), 'a specific row must stay in its table');
assert.strictEqual(count(out, '<td>Comparison method</td>'), 1, 'an identical row must be kept once');
// A table emptied by the fold goes; the section around a surviving heading stays.
assert.ok(!/<tbody>\s*<\/tbody>/.test(out), 'no empty table body may be left');
assert.ok(out.includes('Which crowns last longest?'), 'a unique heading must stay');
// The repeated heading goes, the first stays.
assert.strictEqual(count(out, 'how much do dental implants cost'), 1, 'repeated block heading must go');
assert.ok(out.includes('>How much do dental implants cost?</h2>'), 'an unwrapped heading that asks a question keeps its question mark');
assert.strictEqual(headingCore('What should I know about direct Answer: X y z w — how to compare your options (3)?'), headingCore('What should I know about x y z w?'));
// A header cell with words of its own survives the table it headed; a generic one goes.
assert.strictEqual(count(out, 'Victim: punitive damages, claim valuation'), 1, 'a header with its own words must be kept');
const victim = out.slice(out.indexOf('Victim or accused?'));
assert.ok(!/<table\b/.test(victim.slice(0, victim.indexOf('</section>'))), 'an emptied table goes');
// A list item already said is said once; a block left with nothing goes.
assert.strictEqual(count(out, 'Compare every option with the same criteria'), 1, 'a repeated list item is kept once');
assert.strictEqual(count(out, 'callout'), 1, 'a callout emptied by the fold goes');
// The kept heading loses the stamped suffix, not its question.
assert.ok(out.includes('>How long do porcelain crowns last?</h2>'), 'the em-dash suffix must be dropped and the question kept');
// The folded list sits before the byline, and nothing outside <main> moves.
assert.ok(out.indexOf('data-folded-rows') < out.indexOf('data-editorial-byline'), 'list goes before the byline');
assert.ok(out.startsWith(before.slice(0, before.indexOf('<main'))) && out.endsWith('</main><footer>f</footer></body></html>'));
// Idempotent, and a clean page is returned unchanged.
assert.strictEqual(foldRepeatedRows(out), out, 'must be idempotent');
const clean = `<main><h1>x</h1>${table([['A', 'one', 'two']])}</main>`;
assert.strictEqual(foldRepeatedRows(clean), clean, 'a clean page is unchanged');
// A row arriving after the fold joins the existing list instead of starting a second one.
const later = foldRepeatedRows(out.replace('<p class="editorial-byline"', block('Are veneers permanent?', [['Veneer lifespan', G1, G2]]) + '<p class="editorial-byline"'));
assert.strictEqual(count(later, 'data-folded-rows'), 1, 'one list per guidance');
assert.strictEqual(count(later, 'Veneer lifespan'), 1, 'a late row joins the list');

console.log(`fold-repeated-rows: PASS (worst window ${worst(before)}x -> ${worst(out)}x, cap ${SLOT_MAX})`);
