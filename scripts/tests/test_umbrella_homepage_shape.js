#!/usr/bin/env node
'use strict';
// Proves validate_umbrella_homepage_shape.js passes the approved homepage shape
// and fails each way it can break (the same cases the validator self-tests on
// every run), and that the homepage renderer's cards resolve against the
// canonical guide inventories (no invented question links).
const assert = require('assert');
const path = require('path');
const { selfTest, checkHtml } = require('../validators/validate_umbrella_homepage_shape');
const { resolveCards, renderBody, HERO_SUBLINE, footer } = require('../lib/umbrella_homepage');
const { loadInventories } = require('../lib/canonical_guide_links');
const { canonicalVerticalIds } = require('../lib/canonical_vertical');

const ROOT = path.resolve(__dirname, '..', '..');
const st = selfTest();
assert.deepStrictEqual(st.failures, [], st.failures.join('\n'));
assert.ok(st.cases >= 15, 'self-test must cover at least 15 cases');

const ids = canonicalVerticalIds(ROOT);
const cards = resolveCards(ROOT);
assert.deepStrictEqual(cards.map((c) => c.vertical).sort(), [...ids].sort(), 'one card per canonical vertical');
for (const c of cards) assert.strictEqual(c.questions.length, 3, `${c.vertical}: three question links`);

// The renderer's own output, wrapped as the layout wraps it, passes the guard.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const body = renderBody({ esc, definition: 'The Industry Guides is a test.', faq: [{ q: 'Q?', a: 'A.' }], root: ROOT });
// The footer goes in too: it carries the contact mailto, and the guard requires that link to be
// wrapped in Cloudflare's <!--email_off--> markers. Checking <main> alone left the only page
// element the mailto rule governs outside the test.
const published = `<html><body><main>${body}</main>${footer(2026)}</body></html>`;
const errs = checkHtml(published, { inventories: loadInventories(ROOT), ids });
assert.deepStrictEqual(errs, [], errs.join('\n'));
// Named here as well as in the validator's self-test, because this is the renderer's real output:
// without the markers Cloudflare rewrites the mailto into /cdn-cgi/l/email-protection, which 404s
// for every crawler — Ahrefs found exactly that on the live homepage on 16 Oct 2026.
assert.ok(/<!--email_off--><a href="mailto:[^"]+"/.test(published), 'the contact mailto is wrapped in <!--email_off-->');
assert.deepStrictEqual(
  checkHtml(published.replace(/<!--\/?email_off-->/g, ''), { inventories: loadInventories(ROOT), ids }).length > 0,
  true,
  'unwrapping the contact mailto in the renderer output must fail the guard');
// The hero is H1 + the approved subline; the definition renders once, in About.
const hero = body.slice(body.indexOf('<section class="uh-hero"'), body.indexOf('</section>') + 10);
assert.ok(hero.includes(HERO_SUBLINE.split('.')[0]), 'hero carries the approved subline');
assert.ok(!hero.includes('data-site-definition'), 'the definition is not in the hero');
assert.strictEqual((body.match(/data-site-definition="true"/g) || []).length, 1, 'exactly one definition paragraph');
assert.ok(/<section id="about"[^>]*>[\s\S]*data-site-definition="true"/.test(body), 'the definition sits in the About block');
console.log(`umbrella homepage shape: ${st.cases} validator cases + renderer output (${cards.length} cards) pass`);
