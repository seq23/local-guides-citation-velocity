#!/usr/bin/env node
'use strict';
/**
 * Fails the build when a page ships without a topic.
 *
 * WHY THIS EXISTS
 *
 * 190 pages in this repo render from verbatim scraped forum-post titles. Their
 * routes are the scraped sentence, truncated mid-word at ~90 characters, filed
 * under whichever vertical the scraper happened to be pointed at. A sample:
 *
 *   /personal-injury/community-questions/26-should-i-go-for-an-it-degree-what-should-i-know/
 *   /personal-injury/community-questions/and-please-don-t-recommend-respite-care-what-should-i-know/
 *   /personal-injury/community-questions/advanced-hair-clinic-athens-what-should-i-know/
 *
 * None of those is a personal-injury page. The first is about an IT degree, the
 * second is half a sentence with no subject at all, the third is a hair clinic
 * in Athens. A page cannot be improved into answering "and please don't
 * recommend respite care", because there is no question there to answer. This
 * class of defect is not fixable downstream by writing better content; it has
 * to be stopped at the point a route is minted.
 *
 * A second, narrower defect in the same family: seven routes carry the name of
 * the language model that produced the observation, because a query/model
 * observation record was flattened into a title.
 *
 *   can i sue for pain and suffering after a car accident Gemini 1.5 Flash
 *   what are the requirements for the I-693 medical exam (Perplexity)
 *
 * Those underlying queries are good - they are exactly the open, question-shaped
 * queries that measure best - and they were ruined by string concatenation.
 *
 * HOW IT BEHAVES
 *
 * Like validate:demand-backed-pages in local-guides-generator, this seals the
 * existing damage in a baseline and blocks the next one. Failing on all 190
 * today would produce a validator someone switches off rather than one that
 * holds. What it blocks is the 191st.
 *
 * The baseline is data/content/route_topic_quality_baseline.json. Do NOT add
 * entries to it to get a build green. Fix the route, or take the owner decision
 * the baseline's own notes describe.
 *
 * Usage:
 *   node scripts/validators/validate_route_topic_quality.js
 *   node scripts/validators/validate_route_topic_quality.js --seed-baseline
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'data', 'content', 'route_topic_quality_baseline.json');
const OUT = path.join(ROOT, 'artifacts', 'validation', 'route-topic-quality.json');

// Directories that never ship as public pages.
const INTERNAL = new Set([
  '.build', '.cache', '.git', '.github', '.wrangler', 'artifacts', 'content', 'data',
  'dist', 'distribution_scripts', 'docs', 'logs', 'node_modules', 'releases', 'reports',
  'scripts', 'staging', 'templates', 'tmp', 'goldens', 'proofs', 'reference',
]);

// Named models leak in when a {query, model} observation row is flattened into
// a title. The trailing anchors keep "Claude" in an ordinary sentence, or a
// person named Gemini, from matching.
// Note: no outer \b - several alternatives start or end with "(" or ")", and a
// word boundary cannot sit next to a paren. Each alternative carries its own
// anchoring instead.
const MODEL = new RegExp([
  '\\bGemini[\\s-]+[0-9][^\\s/]*(?:[\\s-]+(?:Flash|Pro|Ultra|Nano))?',
  '\\bOpenAI[\\s-]+GPT-?[0-9a-z.-]+',
  '\\bGPT-?[0-9]o?\\b',
  '\\(\\s*Perplexity\\s*\\)',
  '[-\\s]perplexity(?:$|/)',
  '\\bPerplexity[\\s-]+(?:Pro|Sonar)\\b',
  '\\bClaude[\\s-]+[0-9][^\\s/]*',
  '\\bAnthropic[\\s-]+Claude\\b',
  '\\bCopilot\\b',
  '\\bLlama[\\s-]+[0-9][^\\s/]*',
  '\\bMistral[\\s-]+(?:Large|Medium|Small|7B)\\b',
].join('|'), 'i');

// Raw scrape residue that should never reach a title.
const ARTIFACT = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\*\*|https?:\/\/|username removed|\bsubmitted by\b|\b\d+\s+comments\b|\[deleted\]|\[removed\]|&#x[0-9a-f]+;/iu;

// A title that begins as the continuation of a sentence we do not have.
const CONTINUATION = /^(and|also|but|so|then|plus|however|though|yet|still|even|because|anyway|anyways|besides|at this point|at the same time|anything else|any advice)\b/i;

// An unexpanded template slot that reached a page.
const PLACEHOLDER = /\{\{[^}]*\}\}|\{[a-z_][a-z0-9_]*\}|%\{[^}]*\}/i;

// The generator appends this to scraped fragments; it is not part of the topic.
const FILLER_SUFFIX = /\s*[—-]\s*what should i know\??\s*$/i;

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (dir === ROOT && INTERNAL.has(ent.name)) continue;
      walk(p, out);
    } else if (ent.name.endsWith('.html')) {
      out.push(p);
    }
  }
  return out;
}

function routeFor(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  if (rel === 'index.html') return '/';
  return '/' + rel;
}

function titleOf(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  return m[1]
    .replace(/&amp;/g, '&').replace(/&#8212;/g, '—').replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every defect this route carries. Empty array means clean. */
function defectsFor(route, title) {
  const d = [];
  const core = title.replace(FILLER_SUFFIX, '').trim();
  const hay = `${route} ${title}`;

  if (MODEL.test(hay)) d.push('leaked_model_name');
  if (ARTIFACT.test(title)) d.push('scrape_artifact');
  if (PLACEHOLDER.test(hay)) d.push('unexpanded_placeholder');
  if (CONTINUATION.test(core)) d.push('sentence_continuation');
  // A long title that stops without terminal punctuation was cut, not written.
  if (core.length >= 100 && !/[.?!"')\]]$/.test(core)) d.push('truncated_midsentence');
  // A route segment at the generator's hard cap is a truncated slug even when
  // the title was repaired.
  const seg = route.replace(/\/$/, '').split('/').pop() || '';
  if (seg.length >= 88) d.push('truncated_route_slug');

  return d;
}

function scan() {
  const files = walk(ROOT);
  const found = new Map();
  for (const f of files) {
    let html;
    try { html = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const route = routeFor(f);
    const title = titleOf(html);
    const d = defectsFor(route, title);
    if (d.length) found.set(route, { route, title, defects: d });
  }
  return { scanned: files.length, found };
}

const { scanned, found } = scan();

if (process.argv.includes('--seed-baseline')) {
  const routes = [...found.values()].sort((a, b) => a.route.localeCompare(b.route));
  const byDefect = {};
  for (const r of routes) for (const d of r.defects) byDefect[d] = (byDefect[d] || 0) + 1;
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: 'Routes that already carried a topic-quality defect when this gate was installed. '
      + 'Exempt from the gate so that it blocks the next one rather than the existing pile. '
      + 'DO NOT add entries here to get a build green - fix the route, or take the owner decision below.',
    owner_decision_required: 'These routes are verbatim scraped forum-post titles. Most cannot be '
      + 'given real content because they have no topic: "and please don\'t recommend respite care" '
      + 'is half a sentence, not a question. They are NOT admitted to '
      + 'data/content/page_admission_registry.json, so build_pages_dist.js excludes them from dist '
      + 'and they are not currently live. Nothing here has been retired or deleted. The decision '
      + 'is the owner\'s: leave them unadmitted and inert, give the salvageable minority real '
      + 'routes and real content, or retire the rest.',
    sealed_at: new Date().toISOString().slice(0, 10),
    scanned_pages: scanned,
    count: routes.length,
    by_defect: byDefect,
    routes,
  }, null, 2) + '\n');
  console.log(`Sealed route topic-quality baseline: ${routes.length} routes across ${scanned} pages.`);
  process.exit(0);
}

const errors = [];
const notes = [];

if (!fs.existsSync(BASELINE)) {
  notes.push('no baseline; run this validator once with --seed-baseline');
} else {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const known = new Map((base.routes || []).map((r) => [r.route, new Set(r.defects || [])]));
  const newlyBroken = [];
  for (const rec of found.values()) {
    const prior = known.get(rec.route);
    if (!prior) { newlyBroken.push({ ...rec, why: 'new route with a topic-quality defect' }); continue; }
    const added = rec.defects.filter((d) => !prior.has(d));
    if (added.length) newlyBroken.push({ ...rec, defects: added, why: 'existing route gained a new defect' });
  }
  if (newlyBroken.length) {
    errors.push(
      `${newlyBroken.length} route(s) carry a topic-quality defect and are not in the sealed baseline:\n  `
      + newlyBroken.slice(0, 20).map((r) => `${r.route}\n      defects: ${r.defects.join(', ')}\n      title: ${r.title.slice(0, 120)}`).join('\n  ')
    );
  }
  // Report repairs so the baseline can be re-sealed downward, never upward.
  const repaired = [...known.keys()].filter((r) => !found.has(r));
  notes.push(`baseline: ${known.size} sealed routes; ${found.size} routes currently carry a defect; ${repaired.length} baseline route(s) now clean`);
  if (repaired.length) notes.push(`repaired since sealing: ${repaired.slice(0, 10).join(', ')}${repaired.length > 10 ? ` (+${repaired.length - 10} more)` : ''}`);
}

const report = {
  validator: 'route-topic-quality',
  ok: errors.length === 0,
  scanned_pages: scanned,
  routes_with_defects: found.size,
  errors,
  notes,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  console.error('ROUTE TOPIC QUALITY FAIL');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`ROUTE TOPIC QUALITY PASS (${scanned} pages scanned; ${found.size} sealed pre-existing defects; 0 new)`);
