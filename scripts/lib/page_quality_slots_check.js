#!/usr/bin/env node
'use strict';
/**
 * PAGE QUALITY RATCHET — template filler never comes back.
 *
 * Folded into the site-hygiene blocker, with a `page_quality_slots` block in
 * data/seo/site_hygiene_registry.json, because the release profile is capped at 40
 * HARD_FAIL blockers on purpose: every blocker is another way for main to go red.
 * validate_site_hygiene.js calls `check` and replays `selfTest`'s hostile fixtures
 * on every run, so a guard that stopped catching a repeat fails here rather than
 * passing quietly.
 *
 * Search Readiness q1 failed 5 of 5 sampled pages on theindustryguides.com on 3 Nov
 * 2026, and the repair is in the render layer (scripts/lib/say_once.js and the
 * selection in pickFanoutQuestions). scripts/tests/test_say_once.js pins what that
 * pass DOES on fixtures. This guards the served tree, which is the thing the Monday
 * sampler actually reads, against the one way the repair quietly dies: a new template
 * slot, or a new copy of an old one, printing the same words again.
 *
 * It applies the sampler's own measure -- no 8-word window more than three times in
 * one <main> -- to every page in data/content/page_admission_registry.json that the
 * sampler can pick (`pickSample` skips the home page and utility routes), and
 * compares each page with the recorded baseline beside it.
 *
 * A RATCHET, NOT A FLOOR, on purpose. Fifteen served pages are still over the cap for
 * reasons this repair does not reach -- one guidance sentence fills 268 table cells on
 * /personal-injury/ and 117 on /dentistry/, and the row cannot simply be dropped
 * because its first cell is the only place some ledgered markers appear (see
 * tableRowForRequirement in scripts/lib/html_fix_acceptance_parser.js). Failing the
 * build on those today would mean either reverting a measured improvement or weakening
 * the check to something that passes while seeing nothing. So the baseline records
 * where each page stands and nothing is allowed to get worse: a page over its recorded
 * worst count fails, a page with filler that the baseline does not know about fails,
 * and a page that improves is reported so the baseline can be tightened.
 *
 * RULE 0: examining nothing is a failure. Zero pages read, a missing registry, or a
 * baseline with no entries all exit non-zero -- this check cannot pass by being blind.
 *
 * Refresh the baseline after an intended improvement:
 *   node scripts/validators/check_page_quality_sample.js --update
 *
 * Self-test (hostile fixtures, run on every invocation unless --no-self-test):
 *   a page with one phrase four times must fail; the same page with it three times
 *   must pass; an empty page set must fail.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_REL = 'data/content/page_admission_registry.json';
const BASELINE_REL = 'data/seo/page_quality_baseline.json';

// The sampler's own constants and tokenizer (boss-os page-quality-sample.mjs, QUALITY).
const SLOT_WORDS = 8;
const SLOT_MAX = 3;
const UTILITY = /\/(privacy|terms|legal|cookie|disclaimer|accessibility|contact|thank|thanks|login|signin|404|search|unsubscribe|sitemap)/i;
const SKIP_EXT = /\.(xml|pdf|txt|jpg|jpeg|png|webp|svg|zip)$/i;

const wordsOf = (text) => String(text).toLowerCase().match(/[a-z0-9][\w'’-]*/g) || [];

/** The sampler's bodyText: <main>, else <article>, else the page without nav/header/footer. */
function bodyText(html) {
  const h = String(html);
  const main = (h.match(/<main\b[\s\S]*?<\/main>/i) || [])[0] || (h.match(/<article\b[\s\S]*?<\/article>/i) || [])[0];
  const scope = main || h.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  return scope
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The most-repeated 8-word window in a page's body, as { phrase, times }. */
function worstSlot(html) {
  const words = wordsOf(bodyText(html));
  const counts = new Map();
  for (let i = 0; i + SLOT_WORDS <= words.length; i++) {
    const key = words.slice(i, i + SLOT_WORDS).join(' ');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let worst = { phrase: '', times: 0 };
  for (const [phrase, times] of counts) if (times > worst.times) worst = { phrase, times };
  return worst;
}

/** Can the Monday sampler pick this route? Mirrors pickSample's filter. */
function sampleable(route) {
  const p = String(route);
  return p !== '/' && p !== '' && !SKIP_EXT.test(p) && !UTILITY.test(p);
}

function routeToFile(route, root = ROOT) {
  if (route.endsWith('.html')) return path.join(root, route.replace(/^\/+/, ''));
  return path.join(root, route.replace(/^\/+/, '').replace(/\/+$/, ''), 'index.html');
}

/** Score every sampleable admitted route: [{ route, times, phrase }]. */
function scoreServedPages(root = ROOT) {
  const registryPath = path.join(root, REGISTRY_REL);
  if (!fs.existsSync(registryPath)) {
    throw new Error(`NAMED STOP [PAGE_QUALITY_NOTHING_CHECKED]: ${REGISTRY_REL} is missing, so no page could be read`);
  }
  const pages = JSON.parse(fs.readFileSync(registryPath, 'utf8')).pages || [];
  const out = [];
  for (const page of pages) {
    const route = page.path;
    if (!sampleable(route)) continue;
    const file = routeToFile(route, root);
    if (!fs.existsSync(file)) continue;
    const { phrase, times } = worstSlot(fs.readFileSync(file, 'utf8'));
    out.push({ route, phrase, times });
  }
  return out;
}

/** Compare a scored set with a baseline. → { problems[], improved[], examined } */
function judge(scored, baseline) {
  const problems = [];
  const improved = [];
  for (const row of scored) {
    const allowed = Object.prototype.hasOwnProperty.call(baseline, row.route) ? baseline[row.route] : SLOT_MAX;
    if (row.times > allowed) {
      problems.push(`${row.route}: "${row.phrase}" ${row.times} times (allowed ${allowed})`);
    } else if (row.times < allowed && allowed > SLOT_MAX) {
      improved.push(`${row.route}: ${allowed} -> ${row.times}`);
    }
  }
  return { problems, improved, examined: scored.length };
}

/**
 * The site-hygiene interface: { failures[], warnings[], stats }.
 * Rule 0 lives here too -- zero pages examined is a failure, never a pass.
 */
function check(root = ROOT, { reg } = {}) {
  const failures = [];
  const warnings = [];
  const baselineRel = (reg && reg.baseline) || BASELINE_REL;
  const baselinePath = path.join(root, baselineRel);
  let scored = [];
  try { scored = scoreServedPages(root); } catch (err) { return { failures: [err.message], warnings, stats: { examined: 0 } }; }
  if (!scored.length) return { failures: ['NAMED STOP [PAGE_QUALITY_NOTHING_CHECKED]: no admitted, sampleable page was read'], warnings, stats: { examined: 0 } };
  if (!fs.existsSync(baselinePath)) {
    return { failures: [`NAMED STOP [PAGE_QUALITY_NOTHING_CHECKED]: ${baselineRel} is missing; run npm run ratchet:page-quality`], warnings, stats: { examined: scored.length } };
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).pages || {};
  if (!Object.keys(baseline).length && scored.some((r) => r.times > SLOT_MAX)) {
    failures.push('the baseline records no page while the served tree has pages over the cap');
  }
  const { problems, improved } = judge(scored, baseline);
  for (const p of problems) failures.push(p);
  for (const i of improved) warnings.push(`licence is loose, tighten with npm run ratchet:page-quality: ${i}`);
  return { failures, warnings, stats: { examined: scored.length, over_cap: scored.filter((r) => r.times > SLOT_MAX).length } };
}

/** Hostile fixtures. -> { cases, missed[] } so a guard that stopped guarding fails. */
function selfTest() {
  const cases = [];
  const missed = [];
  const line = 'the same eight word slot phrase repeated again here. ';
  const page = (times) => `<main>${`<p>${line}</p>`.repeat(times)}</main>`;
  cases.push('a phrase rendered four times exceeds the cap');
  if (worstSlot(page(4)).times <= SLOT_MAX) missed.push('a phrase rendered four times was not seen as over the cap');
  cases.push('a phrase rendered three times is within the cap');
  if (worstSlot(page(3)).times > SLOT_MAX) missed.push('a phrase rendered three times was wrongly over the cap');
  cases.push('an unrecorded page over the cap fails');
  if (!judge([{ route: '/x/', phrase: 'p', times: 9 }], {}).problems.length) missed.push('an unrecorded page over the cap did not fail');
  cases.push('a page worse than its baseline fails');
  if (!judge([{ route: '/x/', phrase: 'p', times: 12 }], { '/x/': 9 }).problems.length) missed.push('a page worse than its baseline did not fail');
  cases.push('a page at its baseline passes');
  if (judge([{ route: '/x/', phrase: 'p', times: 9 }], { '/x/': 9 }).problems.length) missed.push('a page at its baseline wrongly failed');
  cases.push('the home page and utility routes are out of scope');
  if (sampleable('/') || sampleable('/privacy.html')) missed.push('an unsampleable route was treated as in scope');
  return { cases: cases.length, missed };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--no-self-test')) {
    const proof = selfTest();
    if (proof.missed.length) { console.error(`self-test FAILED: ${proof.missed.join('; ')}`); process.exit(2); }
  }

  const scored = scoreServedPages();
  if (!scored.length) {
    console.error('NAMED STOP [PAGE_QUALITY_NOTHING_CHECKED]: no admitted, sampleable page was read');
    process.exit(2);
  }

  const baselinePath = path.join(ROOT, BASELINE_REL);
  if (args.includes('--update')) {
    const next = {};
    for (const row of scored) if (row.times > SLOT_MAX) next[row.route] = row.times;
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify({
      note: 'Worst repeated 8-word slot phrase per served page. A ratchet: nothing may get worse. See scripts/validators/check_page_quality_sample.js.',
      slot_words: SLOT_WORDS,
      slot_max: SLOT_MAX,
      pages: next
    }, null, 2)}\n`);
    console.log(`page-quality baseline written: ${scored.length} pages examined, ${Object.keys(next).length} over the cap`);
    return;
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(`NAMED STOP [PAGE_QUALITY_NOTHING_CHECKED]: ${BASELINE_REL} is missing; run with --update to record one`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).pages || {};
  const { problems, improved, examined } = judge(scored, baseline);
  const overCap = scored.filter((r) => r.times > SLOT_MAX).length;

  if (problems.length) {
    console.error(`page-quality ratchet FAILED: ${problems.length} page(s) repeat a slot phrase more than before`);
    for (const line of problems) console.error(`  ${line}`);
    console.error('If the change is intended, refresh the baseline: node scripts/validators/check_page_quality_sample.js --update');
    process.exit(1);
  }
  console.log(`page-quality ratchet: PASS (${examined} served pages examined, ${overCap} still over the cap, none worse than baseline)`);
  if (improved.length) {
    console.log(`  improved, baseline can be tightened: ${improved.length}`);
    for (const line of improved.slice(0, 10)) console.log(`    ${line}`);
  }
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(err.message); process.exit(2); }
}
module.exports = { check, selfTest, worstSlot, judge, sampleable, scoreServedPages, BASELINE_REL, SLOT_WORDS, SLOT_MAX };
