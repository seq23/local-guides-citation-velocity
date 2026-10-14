#!/usr/bin/env node
'use strict';
// Proves validate_umbrella_homepage_shape.js passes the approved homepage shape
// and fails each way it can break (the same cases the validator self-tests on
// every run), and that the homepage renderer's cards resolve against the
// canonical guide inventories (no invented question links).
const assert = require('assert');
const path = require('path');
const { selfTest, checkHtml } = require('../validators/validate_umbrella_homepage_shape');
const { resolveCards, renderBody } = require('../lib/umbrella_homepage');
const { loadInventories } = require('../lib/canonical_guide_links');
const { canonicalVerticalIds } = require('../lib/canonical_vertical');

const ROOT = path.resolve(__dirname, '..', '..');
const st = selfTest();
assert.deepStrictEqual(st.failures, [], st.failures.join('\n'));
assert.ok(st.cases >= 9, 'self-test must cover at least 9 cases');

const ids = canonicalVerticalIds(ROOT);
const cards = resolveCards(ROOT);
assert.deepStrictEqual(cards.map((c) => c.vertical).sort(), [...ids].sort(), 'one card per canonical vertical');
for (const c of cards) assert.strictEqual(c.questions.length, 3, `${c.vertical}: three question links`);

// The renderer's own output, wrapped as the layout wraps it, passes the guard.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const body = renderBody({ esc, definition: 'The Industry Guides is a test.', faq: [{ q: 'Q?', a: 'A.' }], root: ROOT });
const errs = checkHtml(`<html><body><main>${body}</main></body></html>`, { inventories: loadInventories(ROOT), ids });
assert.deepStrictEqual(errs, [], errs.join('\n'));
console.log(`umbrella homepage shape: ${st.cases} validator cases + renderer output (${cards.length} cards) pass`);
