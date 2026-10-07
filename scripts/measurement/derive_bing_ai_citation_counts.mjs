#!/usr/bin/env node
/**
 * Re-derive the portfolio's Bing AI citation figures ("uscisexam.com: 13 citations,
 * 13 of the portfolio's 33") from the raw record, so the number is reproducible
 * rather than quoted.
 *
 * Raw input: data/signals/bing_webmaster_baseline.json
 *   ai_performance.citations   per-domain "Total Citations", 3-month window to
 *                              2026-08-26, source "Microsoft Copilots and Partners",
 *                              read from the signed-in Bing Webmaster Tools console
 *                              (the AI Performance report has no export or API).
 *   orphan_correlation.rows    an independent second transcription of the same
 *                              per-domain citation column, used as a cross-check.
 *
 * Method:
 *   1. per-domain count = ai_performance.citations[domain]
 *   2. portfolio total  = sum over every recorded domain (zeros included)
 *   3. FAIL if the sum differs from the recorded total_observed, or if any domain
 *      in orphan_correlation.rows carries a different count - two transcriptions
 *      that disagree mean neither can be quoted.
 *   4. share = count / total; rank by count, ties broken by domain name.
 *
 *   node scripts/measurement/derive_bing_ai_citation_counts.mjs          # write the derivation
 *   node scripts/measurement/derive_bing_ai_citation_counts.mjs --check  # exit 1 if it drifted
 *
 * Output: data/measurement/bing_ai_citation_derivation.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RAW = 'data/signals/bing_webmaster_baseline.json';
const OUT = 'data/measurement/bing_ai_citation_derivation.json';
const check = process.argv.includes('--check');
const die = (m) => { console.error(`bing citation derivation: ${m}`); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, RAW), 'utf8'));
const ai = raw.ai_performance || die(`${RAW} has no ai_performance block`);
const counts = ai.citations || {};
const domains = Object.keys(counts);
if (!domains.length) die('zero domains recorded - nothing to derive');
for (const d of domains) if (!Number.isInteger(counts[d]) || counts[d] < 0) die(`${d}: citation count ${counts[d]} is not a non-negative integer`);

const total = domains.reduce((s, d) => s + counts[d], 0);
const problems = [];
if (typeof ai.total_observed === 'number' && ai.total_observed !== total) problems.push(`recorded total_observed ${ai.total_observed} != derived sum ${total}`);
const cross = (raw.orphan_correlation && raw.orphan_correlation.rows) || [];
let crossChecked = 0;
for (const row of cross) {
  if (!(row.domain in counts) || typeof row.citations !== 'number') continue;
  crossChecked += 1;
  if (row.citations !== counts[row.domain]) problems.push(`${row.domain}: orphan_correlation says ${row.citations}, ai_performance says ${counts[row.domain]}`);
}
if (problems.length) die(`the raw record disagrees with itself: ${problems.join('; ')}`);

const ranked = domains
  .map((d) => ({ domain: d, citations: counts[d], share: total ? +(counts[d] / total).toFixed(3) : 0 }))
  .sort((a, b) => (b.citations - a.citations) || a.domain.localeCompare(b.domain))
  .map((r, i) => ({ rank: i + 1, ...r }));
const top = ranked[0];
const derivation = {
  schema_version: '1.0',
  derived_from: RAW,
  script: 'scripts/measurement/derive_bing_ai_citation_counts.mjs',
  window: ai.window || null,
  measured_at: ai.measured_at || raw.measured_at || null,
  source: 'Bing Webmaster Tools > AI Performance > Total Citations, "Microsoft Copilots and Partners" (console read; no export or API exists for this report)',
  method: 'per-domain count read from ai_performance.citations; portfolio total = sum over all recorded domains (zeros included); cross-checked against the independent orphan_correlation transcription and the recorded total_observed; share = count / total.',
  domains_recorded: domains.length,
  domains_cross_checked: crossChecked,
  portfolio_total: total,
  most_cited: { domain: top.domain, citations: top.citations, share: top.share },
  headline: `${top.domain}: ${top.citations} of the portfolio's ${total} Bing AI citations (${(top.share * 100).toFixed(1)}%), ${ai.window || 'recorded window'}`,
  ranked,
  caveat: 'A 3-month console total. Bing returns "No data available" for grounding-query detail at this volume, so which queries produced the citations is not knowable from this report. It is a different retrieval surface from the grounded probe in data/signals/llm_citation_observations.json and the two disagree. Re-read the console and update the raw file to move the figure; never edit this output by hand.',
};
const text = `${JSON.stringify(derivation, null, 2)}\n`;
if (check) {
  const current = fs.existsSync(path.join(ROOT, OUT)) ? fs.readFileSync(path.join(ROOT, OUT), 'utf8') : '';
  if (current !== text) die(`${OUT} is not what ${RAW} derives - re-run without --check`);
  console.log(`bing citation derivation --check: ${derivation.headline}`);
} else {
  fs.writeFileSync(path.join(ROOT, OUT), text);
  console.log(`bing citation derivation: ${derivation.headline}; ${crossChecked} domain(s) cross-checked.`);
}
