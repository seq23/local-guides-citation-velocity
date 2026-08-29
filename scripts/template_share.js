#!/usr/bin/env node
'use strict';
/**
 * Template share contract.
 *
 * Programmatic pages fail as citation sources when most of the page is the same
 * on every page. Word count does not catch this: a 1,000-word page can be 450
 * words of identical scaffolding, which reads as substantial to a human and as a
 * near-duplicate to a retrieval system. The published floor for programmatic
 * content is 500 unique words and no more than 40% template share, and this
 * repo's pages were measured at 43-45% median share before this check existed.
 *
 * Method: sample rendered pages, take 7-word shingles of visible text, and treat
 * a shingle appearing on at least 60% of sampled pages as scaffolding. A page's
 * template share is the fraction of its shingles that are scaffolding.
 *
 * Reported, not blocking. The remedy is editorial - vary the prose or carry more
 * per-page substance - and a gate that fails the build cannot make that decision.
 * What it can do is stop the number being invisible.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SKIP = /(^|\/)(node_modules|\.git|dist|\.pages-output|artifacts|coverage|_site|\.build|\.validation-cache)(\/|$)/;
const SAMPLE = Number(process.env.TEMPLATE_SHARE_SAMPLE || 140);
const CEILING = Number(process.env.TEMPLATE_SHARE_CEILING || 0.40);
const EVIDENCE = 'reports/cadence/template-share.json';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP.test(path.relative(ROOT, full))) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function words(file) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const body = html.replace(/<(script|style|nav|footer|head|svg)\b[\s\S]*?<\/\1>/gi, '');
  return body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

const files = walk(ROOT);
if (!files.length) { console.log('[template-share] no pages found'); process.exit(0); }

// Deterministic sample: every Nth page, so the number is comparable run to run.
const step = Math.max(1, Math.floor(files.length / SAMPLE));
const sampled = files.filter((_, i) => i % step === 0).slice(0, SAMPLE);

const docs = [];
for (const f of sampled) {
  const w = words(f);
  if (w.length < 60) continue;
  const set = new Set();
  for (let i = 0; i + 7 <= w.length; i++) set.add(w.slice(i, i + 7).join(' '));
  docs.push({ file: path.relative(ROOT, f), set });
}
if (docs.length < 12) { console.log(`[template-share] too few pages to measure (${docs.length})`); process.exit(0); }

const df = new Map();
for (const d of docs) for (const s of d.set) df.set(s, (df.get(s) || 0) + 1);
const threshold = 0.6 * docs.length;
const boiler = new Set([...df].filter(([, c]) => c >= threshold).map(([s]) => s));

const shares = docs.map(d => {
  let hit = 0;
  for (const s of d.set) if (boiler.has(s)) hit++;
  return { file: d.file, share: d.set.size ? hit / d.set.size : 0 };
}).sort((a, b) => a.share - b.share);

const median = shares[Math.floor(shares.length / 2)].share;
const over = shares.filter(s => s.share > CEILING).length;

/**
 * The census.
 *
 * `pages_over_ceiling` used to be `over` - a count that can never exceed the
 * 140-page sample - published in the JSON right next to `pages_total`, the
 * whole population. The console line was honest ("X of N sampled pages"); the
 * JSON field was not, and the JSON is what gets read later. Lowering the
 * ceiling until the condition bites showed the gap: the sampled field reported
 * 75 over where the population had 1,254. At the shipped ceiling of 0.40 both
 * are 0 today, so nothing was being misstated live - the defect fires the
 * moment the metric degrades, which is exactly when someone reads it.
 *
 * The scaffolding vocabulary still comes from the sample (that is what makes
 * the measure stable run to run), but every page is then scored against it, so
 * the population figure is measured rather than extrapolated. It costs a few
 * seconds on ~2,400 pages.
 */
let censusMeasured = 0;
let censusOver = 0;
const censusShares = [];
for (const f of files) {
  const w = words(f);
  if (w.length < 60) continue;
  const set = new Set();
  for (let i = 0; i + 7 <= w.length; i++) set.add(w.slice(i, i + 7).join(' '));
  if (!set.size) continue;
  let hit = 0;
  for (const s of set) if (boiler.has(s)) hit++;
  const share = hit / set.size;
  censusMeasured += 1;
  censusShares.push(share);
  if (share > CEILING) censusOver += 1;
}
censusShares.sort((a, b) => a - b);
const censusMedian = censusShares.length ? censusShares[Math.floor(censusShares.length / 2)] : null;

fs.mkdirSync(path.join(ROOT, path.dirname(EVIDENCE)), { recursive: true });
fs.writeFileSync(path.join(ROOT, EVIDENCE), `${JSON.stringify({
  measured_at: new Date().toISOString().slice(0, 10),
  pages_total: files.length, sampled: docs.length,
  ceiling: CEILING,
  // Sample-scoped figures, named as such. A sample count must never sit beside
  // pages_total under a population name.
  sampled_median_template_share: Number(median.toFixed(4)),
  sampled_pages_over_ceiling: over,
  // Population figures, measured over every page with enough text to score.
  pages_measured_census: censusMeasured,
  pages_over_ceiling_census: censusOver,
  median_template_share_census: censusMedian === null ? null : Number(censusMedian.toFixed(4)),
  scaffolding_vocabulary_basis: 'shingles appearing on >=60% of the deterministic sample; every page scored against it',
  worst: shares.slice(-5).reverse().map(s => ({ file: s.file, share: Number(s.share.toFixed(3)) })),
}, null, 2)}\n`);

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`TEMPLATE SHARE: ${files.length} pages; sampled ${docs.length}; sampled median ${pct(median)}; census median ${censusMedian === null ? 'n/a' : pct(censusMedian)}; ceiling ${pct(CEILING)}`);
console.log(`  CENSUS ${censusOver} of ${censusMeasured} measured pages are over the ceiling (population, not sample).`);
if (censusMedian !== null && censusMedian > CEILING) {
  console.log(`  WARN  template_share_over_ceiling: ${censusOver} of ${censusMeasured} pages are more than ${pct(CEILING)} scaffolding.`);
  console.log('        These pages are long enough to look substantial and similar enough to read as');
  console.log('        near-duplicates. The remedy is editorial: carry more per-page substance, or emit');
  console.log('        fewer fixed paragraphs. Reported rather than blocking - a build cannot make that call.');
} else {
  console.log('  CLEAR template share is inside the programmatic floor.');
}
