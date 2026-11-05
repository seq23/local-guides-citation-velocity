#!/usr/bin/env node
'use strict';
/**
 * Behaviour pins for scripts/search_loop/fold_in.js and seed_topics.js (the search
 * loop's fold-in for this repo). Each pin is a decision the lane makes on a page:
 *   - the PI rules drop an accident page with ranking words or no "do not endorse"
 *     line, and drop any page that calls something a lawyer referral service;
 *   - a search is classified to its vertical and matched to a canonical guide only on a
 *     specific word, never on the vertical's vocabulary alone (else: missing guide);
 *   - the page's one action is re-pointed, and related links come back out cleanly;
 *   - no question-page action pushes a capped canonical URL past its sitewide cap (G3);
 *   - topics put Memphis senior care first and take measured seeds per vertical.
 * Every pin is also proven against a broken input (a check that cannot fail is not one).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classify, matchGuide, chooseAction, piProblems, setAction, withoutRelatedLink, withRedirectsResolved } = require('../search_loop/fold_in');
const { topicsFor } = require('../search_loop/seed_topics');

const ROOT = path.resolve(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-loop.config.json'), 'utf8'));
const V = cfg.velocity.verticals;
const byId = Object.fromEntries(V.map((v) => [v.id, v]));
let n = 0;
const pin = (name, fn) => { fn(); n += 1; };

const FOOT = '<footer><p>We do not endorse or recommend any lawyer, and we do not endorse or recommend any doctor.</p></footer>';
const page = (title, body, foot = FOOT) => `<html><head><title>${title} — The Industry Guides</title></head><body><main><h1>${title}</h1><p>${body}</p><p class="site-action"><a class="button" href="https://theindustryguides.com/">Read the full guide</a></p></main>${foot}</body></html>`;

pin('a clean accident page passes the PI rules', () => assert.deepStrictEqual(piProblems(page('How long does a car accident claim take', 'Most claims follow the same steps.'), 'personal-injury'), []));
pin('ranking words on an accident page are refused', () => {
  assert.ok(piProblems(page('Best way to file a car accident claim', 'x'), 'personal-injury').some((p) => /ranking word "Best"/.test(p)));
  assert.ok(piProblems(page('Claims', 'Ask an expert before you sign.'), 'personal-injury').some((p) => /expert/.test(p)));
  assert.ok(piProblems(page('Claims', 'Our top picks.'), 'personal-injury').some((p) => /top/.test(p)));
});
pin('ranking words are a PI rule, not a health rule', () => assert.deepStrictEqual(piProblems(page('Best time to book a dental cleaning', 'x'), 'dentistry'), []));
pin('an accident page without the do-not-endorse line is refused', () => assert.ok(piProblems(page('Claims', 'x', '<footer></footer>'), 'personal-injury').some((p) => /do not endorse/.test(p))));
pin('"lawyer referral service" is refused on any page', () => assert.ok(piProblems(page('Senior care', 'Call a lawyer referral service.'), 'senior-living').length));

pin('searches land in their vertical, senior care included', () => {
  assert.strictEqual(classify('how much does assisted living cost in memphis', V).id, 'senior-living');
  assert.strictEqual(classify('root canal vs extraction', V).id, 'dentistry');
  assert.strictEqual(classify('car accident settlement timeline', V).id, 'personal-injury');
  assert.strictEqual(classify('adhd evaluation for adults', V).id, 'neuro');
  assert.strictEqual(classify('low testosterone symptoms', V).id, 'trt');
  assert.strictEqual(classify('i-693 civil surgeon cost', V).id, 'uscis-medical');
  assert.strictEqual(classify('weather tomorrow', V), null);
});

const snapshot = { domains: { 'memphisseniorcarehomes.com': ['/', '/guides/', '/guides/assisted-living-cost-memphis/', '/germantown-tn/'], 'uscisexam.com': ['/guides/uscis-medical-exam-cost/', '/guides/vaccination-requirements/'] } };
pin('a guide matches on a specific shared word', () => assert.strictEqual(matchGuide('how much does assisted living cost in memphis', byId['senior-living'], snapshot).route, '/guides/assisted-living-cost-memphis/'));
pin('the vertical vocabulary alone never matches (it is a missing guide)', () => assert.strictEqual(matchGuide('what happens at a uscis medical exam', byId['uscis-medical'], snapshot), null));
pin('city pages are not guides', () => assert.strictEqual(matchGuide('germantown tn senior care', byId['senior-living'], snapshot), null));

pin('the one action is re-pointed to the guide', () => {
  const out = setAction(page('Q', 'x'), 'https://memphisseniorcarehomes.com/guides/assisted-living-cost-memphis/', 'Read the full guide on memphisseniorcarehomes.com');
  assert.ok(out.includes('href="https://memphisseniorcarehomes.com/guides/assisted-living-cost-memphis/">Read the full guide on memphisseniorcarehomes.com</a></p></main>'));
  assert.strictEqual(setAction('<main><p>no action</p></main>', 'https://x/', 'y'), null);
});
pin('a related link comes back out and an empty block goes with it', () => {
  const block = '<!-- search-loop:related --><section class="search-loop-related"><h2>Related questions</h2><ul><li><a href="/questions/a/">A</a></li></ul></section><!-- /search-loop:related -->';
  assert.strictEqual(withoutRelatedLink(`<main>x${block}</main>`, '/questions/a/'), '<main>x</main>');
  assert.ok(withoutRelatedLink(`<main>x${block}</main>`, '/questions/b/').includes('/questions/a/'));
});

pin('topics: senior care first, measured seeds per vertical, excluded words never seeded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-topics-'));
  const week = path.join(dir, 'data', 'discovery', '2026-W44');
  fs.mkdirSync(week, { recursive: true });
  fs.writeFileSync(path.join(week, 'memphisseniorcarehomes.com.json'), JSON.stringify({ seeds: [{ query: 'memory care germantown', impressions: 9 }, { query: 'memory care near me', impressions: 99 }, { query: 'x', impressions: 50 }] }));
  const { topics, discovery_week } = topicsFor(cfg, dir);
  assert.strictEqual(discovery_week, '2026-W44');
  assert.strictEqual(topics[0], V[0].base_topics[0]);
  assert.strictEqual(V[0].id, 'senior-living');
  assert.ok(topics.includes('memory care germantown'));
  assert.ok(!topics.includes('memory care near me'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// G3 cap (run 41456376345): the senior home was already linked 10 times sitewide, and
// unmatched senior questions all pointed at it, so the release profile counted 13.
const realSnap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'canonical_route_snapshot.json'), 'utf8'));
const SENIOR_HOME = 'https://memphisseniorcarehomes.com/';
const unmatched = ['assisted living memphis tn', 'senior living memphis tn', 'senior care memphis tn', 'memory care memphis tn', 'senior services memphis tn', 'assisted living memphis area', 'senior care germantown tn', 'assisted living bartlett tn', 'nursing home memphis', 'elder care memphis', 'senior care cordova', 'aging parent memphis', 'dementia care memphis tn'];
pin('unmatched senior questions never push a canonical URL past its sitewide cap', () => {
  const cap = 10;
  const caps = { 'memphisseniorcarehomes.com': cap };
  const atCap = () => new Map([[SENIOR_HOME, cap]]);
  // Fixture proof: these searches have no matching guide, so the old rule sent every one home.
  const homeBound = unmatched.filter((q) => !matchGuide(q, byId['senior-living'], realSnap));
  assert.ok(homeBound.length >= 3, `fixture lost its unmatched searches (${homeBound.length})`);
  const used = atCap();
  const picks = homeBound.map((q) => chooseAction(q, byId['senior-living'], realSnap, cfg, used, caps));
  assert.strictEqual(picks.length, homeBound.length);
  assert.ok(picks.every((p) => p.href !== SENIOR_HOME), 'a question still points at the full home URL');
  for (const [u, k] of used) assert.ok(k <= cap, `${u} linked ${k} times, cap ${cap}`);
  assert.strictEqual(chooseAction('assisted living memphis tn', byId['senior-living'], realSnap, cfg, atCap(), caps).href, 'https://memphisseniorcarehomes.com/memphis-tn/');
  // Negative proof: with the cap off, the same searches go home and break it.
  const naive = atCap();
  for (const q of homeBound) chooseAction(q, byId['senior-living'], realSnap, cfg, naive, {});
  assert.ok(naive.get(SENIOR_HOME) > cap, 'the uncapped rule should have pushed the home over the cap');
});
pin('under the cap the first choice is unchanged, and when every URL is full the page stays on this site', () => {
  assert.strictEqual(chooseAction('assisted living memphis tn', byId['senior-living'], realSnap, cfg, new Map()).href, SENIOR_HOME);
  assert.strictEqual(chooseAction('how much does assisted living cost in memphis', byId['senior-living'], snapshot, cfg, new Map()).href, 'https://memphisseniorcarehomes.com/guides/assisted-living-cost-memphis/');
  const full = new Map((realSnap.domains['memphisseniorcarehomes.com'] || []).map((r) => [new URL(`https://memphisseniorcarehomes.com${r}`).href, 10]));
  const p = chooseAction('assisted living memphis tn', byId['senior-living'], realSnap, cfg, full);
  assert.ok(p.capped && p.href === `${cfg.base_url}/senior-living/`, p.href);
  // Uncapped hosts keep their first choice however often it is linked.
  assert.strictEqual(chooseAction('what happens at a uscis medical exam', byId['uscis-medical'], snapshot, cfg, new Map([['https://uscisexam.com/', 5000]])).href, 'https://uscisexam.com/');
});

if (n < 14) { console.error(`search-loop fold-in tests: only ${n} pins ran`); process.exit(1); }
// Search Loop run 41537218641: a new question page linked a 301 source and
// rendered-internal-hrefs failed the release. Fold-in re-points it at the final target.
pin('a question-page link to a 301 source is re-pointed at its final destination', () => {
  const redirects = new Map([
    ['/dentistry/guides/dallas-dental-implant-cost/', '/dentistry/community-questions/all-on-4-dental-implants-price-2026/'],
    ['/old-a/', '/old-b/'], ['/old-b/', '/final/'], ['/loop-x/', '/loop-y/'], ['/loop-y/', '/loop-x/'],
  ]);
  const html = '<a href="/dentistry/guides/dallas-dental-implant-cost/#cost">x</a><a href="https://theindustryguides.com/old-a/">y</a><a href="/dentistry/">z</a><a href="https://other.example/old-a/">w</a><a href="/loop-x/">v</a>';
  const out = withRedirectsResolved(html, redirects, 'https://theindustryguides.com');
  assert.ok(out.includes('href="/dentistry/community-questions/all-on-4-dental-implants-price-2026/#cost"'), out);
  assert.ok(out.includes('href="https://theindustryguides.com/final/"'), 'chains followed to the end');
  assert.ok(out.includes('href="/dentistry/"') && out.includes('href="https://other.example/old-a/"'), 'non-redirecting and foreign links untouched');
  assert.ok(!out.includes('dallas-dental-implant-cost'));
  // Negative proof: without the redirect table the 301 source survives, which is the failure.
  assert.ok(withRedirectsResolved(html, new Map(), 'https://theindustryguides.com').includes('href="/dentistry/guides/dallas-dental-implant-cost/#cost"'));
  assert.strictEqual(withRedirectsResolved(out, redirects, 'https://theindustryguides.com'), out, 'idempotent');
});


/**
 * Search Readiness f8 (the outcome-gated cap) and f11 (AI-referral visits and
 * AI-bot reads), both measured failing 3 Nov 2026 and both read from the WEEK
 * REPORT, which only exists if the engine runs.
 *
 * The cause was not the engine's age (seq23/search-loop@v1 resolves to v1.4.0,
 * which emits cap, held_by_cap and redirected on every report). It was this repo:
 * the caller sat behind `if: ${ false }` for the search rescue, so no report had
 * been written since 2026-W45, and the config still carried the `pace` key that
 * v1.3.0 retired, with analytics switched off. A paused job was being reported as
 * a site defect.
 *
 * These pins hold the three decisions that fix it. Each is proven against a broken
 * input, because a check that cannot fail is not one.
 */
pin('f8/f11: the search loop stays measure-only, capped, and measuring', () => {

  // f8: the cap exists and the run guard stays inside the owner's 10-a-day.
  assert.ok(cfg.cap, 'search-loop.config.json must carry a cap (f8)');
  assert.ok(Number.isInteger(cfg.cap.max_live_pages) && cfg.cap.max_live_pages >= 10,
    `f8 wants max_live_pages as a whole number of at least 10, got ${JSON.stringify(cfg.cap.max_live_pages)}`);
  assert.ok(cfg.cap.max_per_day <= 10,
    `f8 caps the run guard at 10 a day, got ${cfg.cap.max_per_day}`);
  assert.ok(!('pace' in cfg), 'pace is retired in engine v1.3.0; the cap replaces it');

  // f11: a free analytics source is named, or there is no number to report.
  assert.ok(cfg.analytics && cfg.analytics.ai_referrals !== 'none' && cfg.analytics.ai_bot_hits !== 'none',
    'f11 needs analytics.ai_referrals and ai_bot_hits set to a reader, not "none"');
  assert.equal(cfg.analytics.zone, 'theindustryguides.com', 'the Cloudflare reader needs this site\'s zone');

  // The caller must still RUN, and must not publish while the rescue is on. Pinned
  // as text because the two failure shapes are both one line of YAML: `if: false`
  // (measures nothing) and a default stage of `auto` (publishes during a rescue).
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/search-loop.yml'), 'utf8');
  assert.ok(!/^\s*if:\s*\$\{\{\s*false\s*\}\}/m.test(wf),
    'the search-loop caller is disabled again: the week report stops and f8/f11 fail for want of a number');
  assert.match(wf, /stage:\s*\$\{\{\s*inputs\.stage\s*\|\|\s*'check'\s*\}\}/,
    'the schedule must run stage=check (measure-only) while the search rescue is on');

  // The old usage token locates the zone but cannot read analytics. Keep the
  // live-proven reader on the analytics input; model execution stays separate.
  const analyticsSecret = /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.SEARCH_LOOP_CF_ANALYTICS_TOKEN\s*\}\}/;
  assert.match(wf, analyticsSecret, 'AI measurement must use the analytics reader');
  assert.throws(() => assert.match(wf.replaceAll('secrets.SEARCH_LOOP_CF_ANALYTICS_TOKEN', 'secrets.SEARCH_LOOP_CF_USAGE_TOKEN'), analyticsSecret), /AssertionError/);

  // Negative proofs: each pin rejects the exact shape it exists to catch.
  assert.throws(() => {
    const broken = { ...cfg, cap: { ...cfg.cap, max_per_day: 11 } };
    assert.ok(broken.cap.max_per_day <= 10);
  }, /AssertionError/, 'max_per_day over 10 must fail');
  assert.throws(() => {
    const broken = { ...cfg, analytics: { ai_referrals: 'none', ai_bot_hits: 'none' } };
    assert.ok(broken.analytics.ai_referrals !== 'none' && broken.analytics.ai_bot_hits !== 'none');
  }, /AssertionError/, 'analytics switched back to none must fail');
  assert.throws(() => {
    assert.ok(!/^\s*if:\s*\$\{\{\s*false\s*\}\}/m.test('jobs:\n  x:\n    if: ${{ false }}\n'));
  }, /AssertionError/, 're-disabling the caller must fail');
  assert.throws(() => {
    assert.match("stage: ${{ inputs.stage || 'auto' }}", /stage:\s*\$\{\{\s*inputs\.stage\s*\|\|\s*'check'\s*\}\}/);
  }, /AssertionError/, 'a default stage of auto must fail');
});

console.log(`search-loop fold-in tests: ${n} pins passed`);
