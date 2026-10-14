#!/usr/bin/env node
'use strict';
// Proves validate_umbrella_homepage_shape.js passes the approved homepage shape
// and fails each way it can break (the same cases the validator self-tests on
// every run), and that the homepage renderer's cards resolve against the
// canonical guide inventories (no invented question links).
const assert = require('assert');
const path = require('path');
const { selfTest, checkHtml } = require('../validators/validate_umbrella_homepage_shape');
const { resolveCards, renderBody, HERO_SUBLINE } = require('../lib/umbrella_homepage');
const { loadInventories } = require('../lib/canonical_guide_links');
const { canonicalVerticalIds } = require('../lib/canonical_vertical');

const ROOT = path.resolve(__dirname, '..', '..');
const st = selfTest();
assert.deepStrictEqual(st.failures, [], st.failures.join('\n'));
assert.ok(st.cases >= 11, 'self-test must cover at least 11 cases');

const ids = canonicalVerticalIds(ROOT);
const cards = resolveCards(ROOT);
assert.deepStrictEqual(cards.map((c) => c.vertical).sort(), [...ids].sort(), 'one card per canonical vertical');
for (const c of cards) assert.strictEqual(c.questions.length, 3, `${c.vertical}: three question links`);

// The renderer's own output, wrapped as the layout wraps it, passes the guard.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const body = renderBody({ esc, definition: 'The Industry Guides is a test.', faq: [{ q: 'Q?', a: 'A.' }], root: ROOT });
const errs = checkHtml(`<html><body><main>${body}</main></body></html>`, { inventories: loadInventories(ROOT), ids });
assert.deepStrictEqual(errs, [], errs.join('\n'));
// The hero is H1 + the approved subline; the definition renders once, in About.
const hero = body.slice(body.indexOf('<section class="uh-hero"'), body.indexOf('</section>') + 10);
assert.ok(hero.includes(HERO_SUBLINE.split('.')[0]), 'hero carries the approved subline');
assert.ok(!hero.includes('data-site-definition'), 'the definition is not in the hero');
assert.strictEqual((body.match(/data-site-definition="true"/g) || []).length, 1, 'exactly one definition paragraph');
assert.ok(/<section id="about"[^>]*>[\s\S]*data-site-definition="true"/.test(body), 'the definition sits in the About block');
console.log(`umbrella homepage shape: ${st.cases} validator cases + renderer output (${cards.length} cards) pass`);
