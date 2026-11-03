#!/usr/bin/env node
'use strict';
/**
 * `sayOnce` is the template-layer half of the Search Readiness q1 repair (3 Nov
 * 2026): no 8-word window more than three times in one <main>. These cases are the
 * shapes that actually shipped, plus the two ways a pass like this does damage --
 * cutting through an inline link, and emptying a slot that has to stay.
 *
 * It asserts against the SAMPLER's own measure, recomputed here from the rendered
 * output, so the test cannot drift from what Monday's audit will say.
 */
const assert = require('assert');
const { sayOnce, plain, wordsIn, windowsOf, SLOT_MAX } = require('../lib/say_once');

/** The sampler's count: the most-repeated 8-word window in <main>. */
function worstPhrase(html) {
  const main = (String(html).match(/<main\b[^>]*>([\s\S]*)<\/main>/i) || [, ''])[1];
  const counts = new Map();
  for (const w of windowsOf(wordsIn(plain(main)))) counts.set(w, (counts.get(w) || 0) + 1);
  let worst = ['', 0];
  for (const row of counts) if (row[1] > worst[1]) worst = row;
  return worst;
}

const ANSWER = 'A settlement demand is a negotiation document; filing a lawsuit starts formal court proceedings and invokes procedural deadlines.';
const page = (extra = '') => `<main id="content">
  <h1>Settlement demand vs lawsuit filing</h1>
  <p class="definition" data-definition="true">${ANSWER}</p>
  <section class="quick-answer"><h2>Quick answer</h2><p>${ANSWER} Use this page to get the framework fast.</p></section>
  <p class="muted">${ANSWER}</p>
  <div class="card recommendation-summary"><p class="recommendation-summary__answer">${ANSWER}</p></div>
  <section class="qa-block"><h3>What is the difference?</h3><p>${ANSWER}</p></section>
  <div class="acc-panel"><p>${ANSWER}</p><ul><li>${ANSWER}</li></ul></div>
  ${extra}
</main>`;

// 1. The shape that shipped: eight copies of one answer come down to the cap.
{
  const before = worstPhrase(page());
  assert.ok(before[1] > SLOT_MAX, `fixture must start over the cap, got ${before[1]}`);
  const after = worstPhrase(sayOnce(page()));
  assert.ok(after[1] <= SLOT_MAX, `sayOnce left "${after[0]}" ${after[1]} times (cap ${SLOT_MAX})`);
}

// 2. The slots that own their words keep them; the decorative copies go.
{
  const out = sayOnce(page());
  assert.ok(/data-definition="true">A settlement demand is a negotiation document/.test(out), 'the definition must keep its answer');
  assert.ok(/<section class="qa-block"><h3>What is the difference\?<\/h3><p>A settlement demand/.test(out), 'the visible FAQ must keep its answer');
  assert.ok(!/class="recommendation-summary__answer"/.test(out), 'the recommendation restatement must go');
  assert.ok(!/<p class="muted">A settlement demand/.test(out), 'the muted restatement must go');
}

// 3. The Quick answer is not a home: it loses the restatement and keeps its own
//    sentence, and the section around it survives so `.quick-answer` still resolves
//    for the speakable selector.
{
  const out = sayOnce(page());
  assert.ok(/class="quick-answer"/.test(out), '.quick-answer section must survive');
  assert.ok(/Use this page to get the framework fast\./.test(out), 'the Quick answer must keep what it alone said');
  const qa = out.match(/<section class="quick-answer">[\s\S]*?<\/section>/)[0];
  assert.ok(!/negotiation document/.test(qa), 'the Quick answer must not restate the definition');
}

// 4. A sentence carrying an inline link is never cut through.
{
  const linked = `<p>${ANSWER.replace('lawsuit', '<a href="https://theaccidentguides.com/">lawsuit</a>')}</p>`;
  const out = sayOnce(page(linked));
  assert.ok(out.includes('<a href="https://theaccidentguides.com/">lawsuit</a>'), 'an inline link must survive intact');
  assert.ok(!/>[^<]*<a href="https:\/\/theaccidentguides\.com\/">lawsuit<\/a>[^<]*<\/p>\s*<\/p>/.test(out), 'no orphaned close tag');
}

// 5. Idempotent: a page already under the cap is returned untouched.
{
  const once = sayOnce(page());
  assert.strictEqual(sayOnce(once), once, 'sayOnce must be idempotent');
}

// 6. A page with nothing repeated is not touched at all.
{
  const clean = '<main><h1>T</h1><p>One sentence that is long enough to form an eight word window here.</p></main>';
  assert.strictEqual(sayOnce(clean), clean, 'a clean page must be returned unchanged');
}

// 7. No <main>, no change -- the pass never throws on a fragment.
{
  assert.strictEqual(sayOnce('<div><p>no main here at all</p></div>'), '<div><p>no main here at all</p></div>');
}

console.log(`say-once: PASS (7 cases; worst window ${worstPhrase(sayOnce(page()))[1]}x, cap ${SLOT_MAX})`);
