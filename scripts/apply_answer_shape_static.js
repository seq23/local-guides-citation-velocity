#!/usr/bin/env node
/**
 * Apply answer shape in place, to pages the generator cannot reach.
 *
 * Most of this property is regenerated from content/_live on every build, so
 * shaping it means changing the generators - which is where the h1 and direct
 * answer now come from. Three sets of pages are not covered by that:
 *
 *   - Cluster hub routes whose accepted bytes carry citation-velocity artifacts
 *     that no longer exist in the content source. Rebuilding one deletes about
 *     15KB of real content per page, so they are excluded from the rebuild
 *     scopes entirely and their frozen bytes are the only copy.
 *   - Medium article pages, which the build patches (fanout, canonical, network
 *     identity) but never re-renders from a source record.
 *   - Legacy standalone comparison routes that sit outside both the page
 *     inventory and the frozen registry.
 *
 * For those, the page's own rendered bytes are the source. This edits two spans
 * and nothing else: the h1, and the paragraph inside the direct-answer block.
 * Every other byte is left alone, and a file whose edit would drop a link or a
 * block of visible text is reported and skipped rather than written.
 *
 * Nothing here writes a claim. The answer is re-assembled from sentences already
 * rendered on the same page; where the page cannot supply 40 words, the shorter
 * answer stands and the page is reported.
 *
 * Usage:
 *   node scripts/apply_answer_shape_static.js [--apply] [file...]
 * With no files, every tracked page still carrying a query echo in its direct
 * answer is treated as a target.
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { headingFor, planHeadings, setHeadingPlan, shapeAnswer, stripScaffold, wordCount } = require('./lib/answer_shape');
const { applyToHtml: applyRecommendationSummary } = require('./retrofit_recommendation_summary');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const explicit = argv.filter((a) => !a.startsWith('--'));

const trackedHtml = () => cp.execSync("git ls-files '*.html'", { cwd: ROOT, maxBuffer: 1 << 28 })
  .toString().split('\n')
  .filter((f) => f && !f.startsWith('dist/') && !f.startsWith('data/') && !f.startsWith('templates/'));

const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#8217;|&rsquo;/g, '’')
  .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const escape = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const text = (h) => decode(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const ANSWER_RE = /(<section\b[^>]*\bdata-direct-answer=["']true["'][^>]*>[\s\S]*?<p[^>]*>)([\s\S]*?)(<\/p>)/i;
const FANOUT_RE = /<section\b[^>]*class="[^"]*\bfanout-block\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi;

// Strings the build injects on many pages. They are real content but they say
// nothing about this page, so they cannot be lifted into its answer.
const BOILERPLATE = [
  /^these are nearby ways people describe/i,
  /^use this (table|section|page|hub|archive|checklist)/i,
  /^compare each option against the same concrete criteria/i,
  /^the industry guides publishes/i,
  /^this page is one literal question/i,
  /^source records are listed/i,
  /^primary[- ]sources? (set )?reviewed/i,
  /^open the visible primary sources/i,
  /^read the source-backed answer/i,
  /^browse (published|the full)/i,
  /^continue to the matching provider/i,
  /^last updated/i,
  /^scan the topic list/i
];
const isBoilerplate = (value) => BOILERPLATE.some((re) => re.test(String(value || '').trim()));

/** Sentences from the page's own prose after the answer block, for extension. */
function extensionSentences(html, answerText) {
  const at = html.search(/data-direct-answer=["']true["']/i);
  if (at < 0) return [];
  const tail = html.slice(at).replace(FANOUT_RE, ' ');
  const out = [];
  for (const m of [...tail.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 12)) {
    const value = text(m[1]);
    if (!value || isBoilerplate(value)) continue;
    for (const sentence of value.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.split(/\s+/).length < 5) continue;
      if (answerText.toLowerCase().includes(s.toLowerCase())) continue;
      if (out.includes(s)) continue;
      out.push(s);
    }
    if (out.length >= 6) break;
  }
  return out;
}

const links = (h) => [...String(h || '').matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => m[1]);
const norm = (s) => String(s || '').toLowerCase().replace(/[“”‘’]/g, '"')
  .replace(/[^a-z0-9 "%$.,:;()-]/g, ' ').replace(/\s+/g, ' ').trim();
function blocks(html) {
  const out = [];
  const re = /<(p|li|td|th|h1|h2|h3|h4|dt|dd|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) { const t = text(m[2]); if (t.split(/\s+/).filter(Boolean).length >= 6) out.push(t); }
  return out;
}

/**
 * Parity gate. A file is only written when every link survives and every block of
 * visible text survives, ignoring the two spans this pass is allowed to rewrite.
 */
function safeToWrite(before, after) {
  const afterLinks = new Set(links(after));
  if ([...new Set(links(before))].some((href) => !afterLinks.has(href))) return 'lost_link';
  const oldH1 = norm(text((before.match(H1_RE) || [])[1] || ''));
  const oldAnswer = norm(text((before.match(ANSWER_RE) || [])[2] || ''));
  const afterBlocks = new Set(blocks(after).map(norm));
  const afterFlat = norm(text(after));
  const dropped = blocks(before).map(norm)
    .filter((t) => t && t !== oldH1 && t !== oldAnswer && !oldAnswer.includes(t))
    .filter((t) => !afterBlocks.has(t) && !afterFlat.includes(t));
  return dropped.length ? `lost_text:${dropped.length}` : '';
}

const files = trackedHtml();

// Headings are decided across the whole rendered corpus, not just the targets,
// so an in-place re-shape cannot collide with a heading another page already has.
setHeadingPlan(planHeadings(files.map((file) => ({
  route: file,
  title: text((fs.readFileSync(path.join(ROOT, file), 'utf8').match(H1_RE) || [])[1] || '')
}))));

const targets = explicit.length ? explicit : files.filter((file) => {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = html.match(ANSWER_RE);
  return m && /^for\s+["'“‘]/i.test(text(m[2]));
});

const report = { shaped: 0, heading_changed: 0, answer_changed: 0, skipped_unsafe: [], short_answer: [], no_answer_block: [] };

for (const file of targets) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) { report.no_answer_block.push(file); continue; }
  const before = fs.readFileSync(abs, 'utf8');
  let after = before;

  const h1Match = before.match(H1_RE);
  if (h1Match) {
    const current = text(h1Match[1]);
    const next = headingFor(file, current);
    if (next && next !== current) {
      after = after.replace(H1_RE, (whole, inner) => whole.replace(inner, escape(next)));
      report.heading_changed += 1;
    }
  }

  const answerMatch = after.match(ANSWER_RE);
  if (!answerMatch) { report.no_answer_block.push(file); continue; }
  const currentAnswer = text(answerMatch[2]);
  const topic = text((after.match(H1_RE) || [])[1] || '');
  const shaped = shapeAnswer({
    raw: stripScaffold(currentAnswer),
    topic,
    extend: extensionSentences(after, currentAnswer),
    min: 40,
    max: 60
  });
  if (shaped.answer && shaped.answer !== currentAnswer) {
    after = after.replace(ANSWER_RE, (whole, open, body, close) => `${open}${escape(shaped.answer)}${close}`);
    report.answer_changed += 1;
  }
  if (shaped.answer && wordCount(shaped.answer) < 40) report.short_answer.push(`${file}:${wordCount(shaped.answer)}`);

  after = applyRecommendationSummary(after, 'card');

  if (after === before) continue;
  const unsafe = safeToWrite(before, after);
  if (unsafe) { report.skipped_unsafe.push(`${file}:${unsafe}`); continue; }
  if (APPLY) fs.writeFileSync(abs, after);
  report.shaped += 1;
}

console.log(JSON.stringify({
  mode: APPLY ? 'APPLIED' : 'dry run',
  targets: targets.length,
  ...report,
  short_answer: report.short_answer.length,
  short_answer_pages: report.short_answer
}, null, 2));
