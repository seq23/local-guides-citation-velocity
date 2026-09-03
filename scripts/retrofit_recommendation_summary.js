#!/usr/bin/env node
/**
 * Retrofit a recommendation_summary block onto already-published pages.
 *
 * recommendation_summary is the single most-requested block in the agent data:
 * asked for on 913 of 913 recommendations, across every run and every repo. It
 * is a short statement of what the page actually recommends, placed where an
 * answer engine will reach it.
 *
 * Everything this emits is lifted from the page's own existing content. Nothing
 * is generated, inferred, or filled in. A page whose recommendation cannot be
 * located is reported and skipped rather than given a placeholder - the same
 * rule the local-guides applier follows, and for the same reason: a block that
 * announces a gap is worse than no block, because it is filler for readers and
 * noise for extraction.
 *
 * Idempotent: an existing block is replaced, so re-running never stacks.
 *
 * Usage: node retrofit_recommendation_summary.js [--apply] [--root DIR] [dirs...]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
const dirs = argv.filter((a, i) => !a.startsWith('--') && (rootIdx < 0 || i !== rootIdx + 1));

// data/ holds inputs, not pages. In a sibling repo this script walked
// data/report_fixes/agent_runs/ and injected a summary block into four raw agent
// reports - rewriting the evidence the pipeline reads from. Never walk inputs.
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|\.pages-output|artifacts|coverage|_site|build|data|reports|content|\.build-cache)(\/|$)/;
const MARK = 'data-content-block="recommendation_summary"';

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One sentence, kept whole. Truncating mid-sentence produces exactly the kind of
// fragment that reads as broken when an answer engine quotes it.
const LABEL_PREFIX = /^(short answer|quick answer|direct answer|answer|bottom line|summary|tl;?dr)\s*[:\u2014-]\s*/i;
// This repo's generator opens most direct answers by quoting the searcher's own
// query back at them - `For "how to find a dentist near me": start with ...`.
// That prefix is template scaffolding, not the recommendation; the words after
// the colon are the page's own. Same class of fix as LABEL_PREFIX above.
const QUERY_PREFIX = /^for\s+["'\u201c\u2018][^"'\u201d\u2019]{8,}["'\u201d\u2019]\s*[:,\u2014-]\s*/i;
function firstSentence(text, max = 320) {
  // Strip until stable: the generator nests them - `For "<query>": direct
  // answer: ...` - so one pass in a fixed order leaves the inner label behind.
  let t = String(text || '').trim();
  for (let i = 0; i < 4; i += 1) {
    const before = t;
    t = t.replace(LABEL_PREFIX, '').replace(QUERY_PREFIX, '').trim();
    if (t === before) break;
  }
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  // A terminator may be followed by a closing quote or bracket. This repo writes
  // curly quotes (`instead of the word "best."`), and without allowing them the
  // first sentence boundary is missed, the whole paragraph overflows `max`, and
  // the extractor falls through to whatever paragraph comes next - which on 370
  // pages was the navigational lede of the related-searches block.
  const m = t.match(/^(.{40,}?[.!?]["'\u201d\u2019\)\]]?)(\s|$)/);
  const s = m ? m[1] : t;
  return s.length <= max ? s : '';
}

// Strings this repo's build injects verbatim on many pages. They are real page
// content, but they are chrome - they state nothing about what THIS page
// recommends. Quoting one as the recommendation would put the same sentence at
// the top of hundreds of pages, which is worse than no block at all. A page left
// with only these is reported and skipped, per the no-placeholder rule.
const BOILERPLATE = [
  /^these are nearby ways people describe the same decision/i,
  /^this page gives a short educational framework/i,
  /^before booking, hiring, filing, or comparing real local options/i,
  /^the industry guides publishes this (insight|page)/i,
  /^use the canonical local guide before/i,
  /^understand the decision, compare the relevant questions/i,
  /^verify the local workflow, provider fit/i,
  /^general educational information only/i,
  /^this page is one literal question in a structured coverage system/i,
  /^source records are listed in the repository evidence registry/i,
  /^primary[- ]source set reviewed/i,
  /^open the visible primary sources/i,
  /^service area focus/i,
  /^this page is intentionally/i,
  // The canon block sits above the article on every medium page and is the first
  // paragraph the extractor reaches. Quoting it as the recommendation puts the
  // same routing sentence at the top of fourteen pages and buries each article's
  // actual lede, which is the sentence directly below it.
  /^(the (full|definitive) local (guide|rules)|this article is a summary)/i,
  /^read the source-backed answer/i,
  /^browse (published|the full)/i,
];
const isBoilerplate = (s) => BOILERPLATE.some((re) => re.test(String(s || '').trim()));

/** Find a panel by its heading text and return the prose inside it. */
function panelByHeading(html, patterns) {
  const re = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>([\s\S]*?)(?=<h2|<h3|<\/section|<\/div>\s*<div class="info-panel"|$)/gi;
  let m;
  while ((m = re.exec(html))) {
    const heading = strip(m[2]).toLowerCase();
    if (!patterns.some((p) => p.test(heading))) continue;
    const body = m[3];
    const para = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const item = body.match(/<li[^>]*>([\s\S]*?)<\/li>/i);
    const text = strip(para ? para[1] : (item ? item[1] : body));
    if (text) return text;
  }
  return '';
}

const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A restatement of the title is not a summary - it tells the reader nothing. */
function informative(candidate, title) {
  const c = norm(candidate);
  if (!c) return false;
  const t = norm(title);
  if (!t) return true;
  if (c === t) return false;
  // Title plus a couple of filler words is still the title.
  return !(c.startsWith(t) && c.length - t.length < 24);
}

/**
 * This repo labels its answer panel with a `.badge` div rather than a heading,
 * so panelByHeading cannot see it - and that panel is the page's own stated
 * answer, authored for exactly this purpose. Read it first.
 */
function answerPanel(html) {
  const m = html.match(/<section\b[^>]*\bdata-direct-answer=["']true["'][^>]*>([\s\S]*?)<\/section>/i)
    || html.match(/<section\b[^>]*class="[^"]*\banswer-box\b[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
  if (!m) return '';
  const body = m[1];
  const para = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const item = body.match(/<li[^>]*>([\s\S]*?)<\/li>/i);
  return strip(para ? para[1] : (item ? item[1] : ''));
}

/** The recommendation itself, in the page's own words. */
function recommendationOf(html) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const title = strip(h1 || '');
  const named = panelByHeading(html, [/^quick answer/, /^direct answer/, /^the short answer/, /^short answer/, /^bottom line/, /^answer\b/]);
  if (named && !isBoilerplate(named)) { const s = firstSentence(named); if (s && informative(s, title)) return s; }
  const panel = answerPanel(html);
  if (panel && !isBoilerplate(panel)) { const s = firstSentence(panel); if (s && informative(s, title)) return s; }
  // The intro often carries the answer as its final sentence, after the framing.
  const intro = html.match(/<div class="page-intro">([\s\S]*?)<\/div>/i)
    || html.match(/<(?:header|section)[^>]*class="[^"]*(?:hero|intro|lede)[^"]*"[^>]*>([\s\S]*?)<\/(?:header|section)>/i);
  if (intro) {
    const paras = [...intro[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => strip(p[1])).filter(Boolean);
    for (const p of paras) { if (isBoilerplate(p)) continue; const s = firstSentence(p); if (s && informative(s, title) && !isBoilerplate(s)) return s; }
  }
  // Some templates open with a long machine-composed sentence that runs past the
  // length a summary can carry. Rather than truncate it mid-clause - which is
  // exactly the kind of fragment that reads as broken when quoted - try the
  // paragraphs that follow and take the first that stands on its own.
  const afterH1 = html.split(/<\/h1>/i)[1] || '';
  for (const m of [...afterH1.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 4)) {
    const text = strip(m[1]);
    if (/^(last updated|published)/i.test(text) || isBoilerplate(text)) continue;
    const s = firstSentence(text);
    if (s && informative(s, title) && !isBoilerplate(s)) return s;
  }
  return '';
}

function primaryCta(html) {
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1]; const label = strip(m[2]);
    // `class="primary"` inside a `.cta` and the label "Find a Provider" are this
    // repo's conversion link; the generic detector below does not recognise
    // either, so the block would carry no next step at all.
    if (!/class="[^"]*\b(?:btn|primary)\b/i.test(attrs)
      && !/^(request|book|get|start|contact|download|buy|schedule|find a provider)/i.test(label)) continue;
    const href = (attrs.match(/href="([^"]+)"/i) || [])[1];
    if (!href || href.startsWith('#')) continue;
    // Carry the original link's rel. Copying an affiliated link into a summary
    // block without its rel="sponsored nofollow" silently drops a disclosure the
    // repo requires, and the link audit is right to fail on it.
    const rel = (attrs.match(/rel="([^"]+)"/i) || [])[1];
    if (label) return { href, label, rel };
  }
  return null;
}

function buildBlock(html, cls) {
  const rec = recommendationOf(html);
  if (!rec) return null;
  const best = firstSentence(panelByHeading(html, [/^who this is for/, /^best fit/, /^who it'?s for/, /^ideal for/, /^good fit/]));
  const not = firstSentence(panelByHeading(html, [/^not for/, /^who this is not for/, /^when not to/, /^not a fit/]));
  const cta = primaryCta(html);
  const points = [];
  if (best) points.push(`<li><strong>Best for:</strong> ${esc(best)}</li>`);
  if (not) points.push(`<li><strong>Not for:</strong> ${esc(not)}</li>`);
  if (cta) {
    const relAttr = cta.rel ? ` rel="${esc(cta.rel)}"` : '';
    points.push(`<li><strong>Next step:</strong> <a href="${cta.href}"${relAttr}>${esc(cta.label)}</a></li>`);
  }
  // Where a repo identifies its blocks with its own attribute, carry that too, so
  // a block filled from the page's own content satisfies the same contract that
  // the generator's placeholder used to satisfy with the string "n/a".
  const agentAttr = process.env.RS_AGENT_ATTR ? ` data-bhpc-agent-block="recommendation_summary"` : '';
  return `<div class="${cls} recommendation-summary"${agentAttr} ${MARK} id="recommendation-summary">`
    + `<h2>What this page recommends</h2>`
    + `<p class="recommendation-summary__answer">${esc(rec)}</p>`
    + (points.length ? `<ul class="recommendation-summary__points">${points.join('')}</ul>` : '')
    + `</div>`;
}

/** Insert high on the page: 55% of AI Overview citations come from the first 30%. */
// The block contains no nested div, so the first closing div after it is its
// own. The previous pattern matched to the next "</ul></div>" anywhere in the
// document, which on a page whose block had no list swallowed everything up to
// the next list - deleting real content, including 30 disclosed affiliate links.
const BLOCK_RE = /<div class="[^"]*recommendation-summary[^"]*"[^>]*>(?:(?!<div\b)[\s\S])*?<\/div>/i;
function insert(html, block) {
  // Remove any block already present before choosing a position, so a change of
  // placement rule actually moves the block instead of rewriting it where it is.
  html = html.replace(BLOCK_RE, '');
  // The opening sentences are load-bearing here: the citation contract requires
  // the page's named framework inside the first 60 words, and the bold
  // definition to be the first paragraph after the H1. Seat the summary after
  // that opening rather than in front of it - it is still well inside the first
  // third, and it leaves the contract's opening intact.
  const h1 = html.search(/<\/h1>/i);
  if (h1 >= 0) {
    const opening = html.slice(h1).match(/^[\s\S]{0,80}?<p class="(?:citation-definition|answer-first)"[\s\S]*?<\/p>/i);
    if (opening) return html.slice(0, h1 + opening[0].length) + block + html.slice(h1 + opening[0].length);
  }
  const existing = new RegExp(`<div class="[^"]*recommendation-summary[^"]*"[^>]*${MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?<\\/div>\\s*(?:<\\/div>)?`, 'i');
  const already = html.match(/<div class="[^"]*recommendation-summary[^"]*"[\s\S]*?<\/ul><\/div>|<div class="[^"]*recommendation-summary[^"]*"[\s\S]*?<\/p><\/div>/i);
  if (already) return html.replace(already[0], block);
  // Generic placement: immediately before the first h2 of the body. An h2 is a
  // block-level sibling in every one of these templates, so inserting there is
  // structurally safe without knowing the markup, and it lands the block right
  // after the lede - inside the opening third of the page.
  // Never land inside a section the page's own pipeline strips and rebuilds. On
  // pages whose only h2 sits inside that section, "before the first h2" put the
  // block there, and the next apply removed the section - taking the block and
  // every real block after it. Four insight pages lost their trust, source and
  // definition blocks that way. Sit in front of the section instead.
  const rebuilt = html.search(/<section\b[^>]*class=["'][^"']*(?:bhpc-agent-semantic-repair|agent-exact-citation-repair)[^"']*["']/i);
  if (rebuilt >= 0) return html.slice(0, rebuilt) + block + html.slice(rebuilt);
  // This repo's own opening is the direct-answer panel, and the first h2 after
  // the h1 usually sits INSIDE the next section (the related-searches block
  // labels itself with a badge div, then an h2). Landing "before the first h2"
  // would seat the summary between that section's badge and its heading. Sit
  // immediately after the answer panel instead: a sibling of it, still well
  // inside the opening third, and directly beneath the answer it summarises.
  const answerEnd = (() => {
    const m = html.match(/<section\b[^>]*\bdata-direct-answer=["']true["'][^>]*>[\s\S]*?<\/section>/i)
      || html.match(/<section\b[^>]*class="[^"]*\banswer-box\b[^"]*"[^>]*>[\s\S]*?<\/section>/i);
    if (!m) return -1;
    const at = html.indexOf(m[0]);
    const h1at = html.search(/<\/h1>/i);
    if (at < 0 || (h1at >= 0 && at < h1at)) return -1;
    return at + m[0].length;
  })();
  if (answerEnd >= 0) return html.slice(0, answerEnd) + block + html.slice(answerEnd);
  if (process.env.RS_INSERT === 'before-first-h2') {
    const body = html.search(/<\/h1>/i);
    if (body >= 0) {
      const h2 = html.slice(body).search(/<h2[\s>]/i);
      if (h2 >= 0) return html.slice(0, body + h2) + block + html.slice(body + h2);
    }
  }
  const anchor = html.match(/<div class="content-stack">/i) || html.match(/<div class="info-panel">/i)
    || html.match(/<section class="section section-soft">/i);
  if (anchor) {
    const at = html.indexOf(anchor[0]);
    const insertAt = /content-stack/.test(anchor[0]) ? at + anchor[0].length : at;
    return html.slice(0, insertAt) + block + html.slice(insertAt);
  }
  const h1end = html.search(/<\/h1>/i);
  if (h1end < 0) return null;
  const close = html.indexOf('</div>', h1end);
  if (close >= 0) return html.slice(0, close + 6) + block + html.slice(close + 6);
  // Last resort: directly after the h1. The medium article pages wrap their body
  // in <article> and <section> with no div after the heading, and their answer
  // panel sits ABOVE the h1 - so every anchor above missed and the block was
  // dropped entirely on all fourteen of them. An h1 is a block-level sibling in
  // any of these templates, so following it is structurally safe.
  const afterH1 = h1end + '</h1>'.length;
  return html.slice(0, afterH1) + block + html.slice(afterH1);
}

function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (SKIP_DIR.test(full.replace(ROOT, ''))) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const defaultClass = () => process.env.RS_PANEL_CLASS || 'info-panel';

/**
 * Retrofit one page's HTML. Returns the HTML unchanged when the page's own
 * recommendation cannot be located - callers must not substitute a placeholder.
 * Exported so the site generator seats the same block at build time, which is
 * what stops a regenerated page from losing it again.
 */
function applyToHtml(html, cls) {
  if (!/<h1[\s>]/i.test(html)) return html;
  // Strip any block from a previous run before reading the page. Otherwise the
  // extractor sees its own output - which sits above the real content - and
  // re-derives the summary and the CTA from the block it wrote last time. That
  // is how a copied CTA lost the rel it originally carried and kept it lost.
  const source = html.replace(BLOCK_RE, '');
  const block = buildBlock(source, cls || defaultClass());
  if (!block) return html;
  return insert(html, block) || html;
}

module.exports = { applyToHtml, buildBlock, insert, recommendationOf, MARK, BLOCK_RE };

if (require.main === module) {
  const CLS = defaultClass();
  const targets = (dirs.length ? dirs : ['.']).flatMap((d) => walk(path.resolve(ROOT, d)));
  let added = 0, replaced = 0; const skipped = [];
  // Some files are under a protected baseline (a page that has produced revenue,
  // for example). Their hashes are asserted elsewhere, so leave them alone.
  const EXCLUDE = process.env.RS_EXCLUDE ? new RegExp(process.env.RS_EXCLUDE) : null;
  for (const file of targets) {
    if (EXCLUDE && EXCLUDE.test(path.relative(ROOT, file))) continue;
    const html = fs.readFileSync(file, 'utf8');
    if (!/<h1[\s>]/i.test(html)) continue;
    const had = html.includes(MARK);
    const source = html.replace(BLOCK_RE, '');
    const block = buildBlock(source, CLS);
    if (!block) { skipped.push(path.relative(ROOT, file)); continue; }
    const next = insert(html, block);
    if (!next || next === html) { if (!had) skipped.push(path.relative(ROOT, file)); continue; }
    if (APPLY) fs.writeFileSync(file, next);
    had ? replaced++ : added++;
  }
  console.log(`recommendation_summary: added=${added} replaced=${replaced} skipped=${skipped.length} (${APPLY ? 'APPLIED' : 'dry run'})`);
  if (skipped.length) {
    console.log('no recommendation found on page - left unchanged rather than filled:');
    for (const s of skipped.slice(0, 25)) console.log('  ' + s);
    if (skipped.length > 25) console.log(`  ... and ${skipped.length - 25} more`);
  }
}
