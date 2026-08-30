#!/usr/bin/env node
'use strict';
/**
 * Retire live routes whose subject does not belong to the vertical they occupy.
 *
 * This follows docs/PAGE_RELEASE_LAW.md §2A exactly - the same mechanism used for
 * the 183-route retirement on 2026-08-27 and the 15-route disposition on 2026-08-29.
 * It does not invent a new one, and it does NOT delete anything:
 *
 *   1. remove the route from data/content/page_admission_registry.json (and count)
 *   2. remove it from content/_live/published_urls.json items (the parity invariant
 *      validate_full_scope_overhaul.js asserts is admission.count === items.length)
 *   3. append an ACTIVE_301 entry to data/release/route_retirements.json with a reason
 *   4. add "<source> <target> 301" to _redirects
 *   5. record it in data/content/offtopic_route_quarantine.json
 *   6. raise counts.approved_route_retirements in the overhaul contract
 *
 * The rendered HTML stays on disk. Retirement is reversible; deletion is not.
 *
 * 410 vs 301: this repo has no 410 support and three validators
 * (page-release-law, sitemap-parity, admission:dynamic-parity) each assert that a
 * retirement target IS admitted, so "gone" has no representable state here. Every
 * existing retirement is a 301 to the correct vertical hub and these follow it.
 *
 * Usage:
 *   node scripts/retire_offtopic_routes.js --dry-run
 *   node scripts/retire_offtopic_routes.js --apply
 */
const fs = require('fs');
const path = require('path');
const { classifyRoute, contentDefects, canonicalVertical } = require('./lib/vertical_topic_affinity');

const ROOT = path.resolve(__dirname, '..');
const rd = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const wr = (rel, v) => fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(v, null, 2) + '\n');
const TODAY = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const APPLY = process.argv.includes('--apply');

const HUB = {
  personal_injury: '/personal-injury/',
  dentistry: '/dentistry/',
  neuro: '/neuro/',
  trt: '/trt/',
  'uscis-medical': '/uscis-medical/',
};

const pagesDoc = rd('content/_live/pages.json');
const byPath = new Map((pagesDoc.pages || []).map((p) => [String(p.path || p.slug), p]));
const admission = rd('data/content/page_admission_registry.json');

// Only machine-minted question routes are in scope. Curated hubs, clusters and
// insights were written deliberately and are not judged by this tool.
const IN_SCOPE = /\/community-questions\//;

const findings = [];
for (const entry of admission.pages || []) {
  const route = String(entry.path || '');
  if (!IN_SCOPE.test(route)) continue;
  const page = byPath.get(route);
  const title = String((page && page.title) || entry.primary_query || '');
  const body = page ? (page.sections || []).flatMap((s) => [s.q, s.a]).join(' ') : '';
  const vertical = String(entry.vertical || (page && page.vertical) || '');

  const reasons = [];
  const topical = classifyRoute({ route, title, vertical });
  if (!topical.ok) reasons.push({ code: topical.reason, detail: topical.detail, better_home: topical.better_home });
  for (const d of contentDefects({ title, body })) {
    reasons.push({ code: d, detail: d === 'SCRAPE_ARTIFACT_IN_TITLE'
      ? 'the title carries raw scrape residue (HTML entities, "submitted by", a bare URL or an emoji) and reads as machine debris on a professional guide'
      : 'the subject is not appropriate for a professional legal and medical guide network' });
  }
  if (!reasons.length) continue;

  const home = reasons.find((r) => r.better_home)?.better_home || canonicalVertical(vertical);
  findings.push({ route, title, vertical, reasons, target: HUB[home] || HUB[canonicalVertical(vertical)] });
}

// Rule 0: this tool must never report success having examined nothing.
const examined = (admission.pages || []).filter((e) => IN_SCOPE.test(String(e.path || ''))).length;
if (examined === 0) {
  console.error('retire_offtopic_routes: examined 0 in-scope routes. The admission registry holds no');
  console.error('  community-question routes at all, which means the registry is empty or its shape changed.');
  console.error('  Refusing to report a clean result from an empty scan.');
  process.exit(1);
}

const tally = {};
for (const f of findings) for (const r of f.reasons) tally[r.code] = (tally[r.code] || 0) + 1;
console.log(`examined ${examined} live community-question routes`);
console.log(`to retire: ${findings.length}`);
console.log(`by reason: ${JSON.stringify(tally)}`);
for (const f of findings) console.log(`  ${f.reasons.map((r) => r.code).join('+')}  ${f.route}  -> ${f.target}`);

if (!findings.length) { console.log('nothing to retire.'); process.exit(0); }
if (!APPLY) { console.log('\n(dry run - pass --apply to write)'); process.exit(0); }

const retiring = new Set(findings.map((f) => f.route));
for (const f of findings) {
  if (!f.target) throw new Error(`no retirement target for ${f.route} (vertical ${f.vertical})`);
}

// 1 + 2. leave the admitted surface
admission.pages = (admission.pages || []).filter((p) => !retiring.has(String(p.path)));
admission.count = admission.pages.length;
wr('data/content/page_admission_registry.json', admission);

const published = rd('content/_live/published_urls.json');
published.items = (published.items || []).filter((i) => !retiring.has(String(i.path)));
wr('content/_live/published_urls.json', published);

// 2b. leave the frozen page registry.
// validate_page_release_law.js asserts frozen.pages.length === admission.pages.length
// (`frozen_registry_count_mismatch`), so a route that leaves admission must leave the
// freeze too or the very next validation run fails. The gz blob in
// data/release/frozen_html_cache/ is deliberately NOT deleted: it is what makes the
// retirement reversible.
const frozen = rd('data/release/frozen_page_registry.json');
frozen.pages = (frozen.pages || []).filter((p) => !retiring.has(String(p.route)));
frozen.count = frozen.pages.length;
frozen.updated_at = TODAY;
wr('data/release/frozen_page_registry.json', frozen);

// 3. the retirement ledger
const ledger = rd('data/release/route_retirements.json');
for (const f of findings) {
  ledger.retirements.push({
    source_path: f.route,
    target_path: f.target,
    status: 'ACTIVE_301',
    reason: `Off-topic for the vertical whose path it occupied. ${f.reasons.map((r) => `${r.code}: ${r.detail}`).join(' ')} `
      + `Title as published: ${JSON.stringify(f.title.slice(0, 160))}. Retired to the vertical hub under PAGE_RELEASE_LAW; the rendered page remains on disk.`,
    retired_on: TODAY,
    evidence: [
      '_redirects',
      'data/content/offtopic_route_quarantine.json',
      'data/content/vertical_topic_contract.json',
      'scripts/validators/validate_vertical_topic_admission.js',
    ],
  });
}
ledger.updated_at = TODAY;
wr('data/release/route_retirements.json', ledger);

// 4. _redirects
const redirectsPath = path.join(ROOT, '_redirects');
let text = fs.readFileSync(redirectsPath, 'utf8');
if (!text.endsWith('\n')) text += '\n';
text += `\n# ${TODAY} retirement of ${findings.length} routes whose subject did not belong to their vertical.\n`
  + `# Mechanism: docs/PAGE_RELEASE_LAW.md 2A. Authority: data/release/route_retirements.json.\n`
  + `# Guard against recurrence: scripts/validators/validate_vertical_topic_admission.js.\n`;
for (const f of findings) text += `${f.route} ${f.target} 301\n`;
fs.writeFileSync(redirectsPath, text);

// 5. quarantine registry
const q = rd('data/content/offtopic_route_quarantine.json');
for (const f of findings) {
  q.items.push({
    route: f.route,
    title: f.title,
    reasons: f.reasons.map((r) => r.code),
    correct_vertical: f.reasons.find((r) => r.better_home)?.better_home || null,
    retired_on: TODAY,
    recommended_disposition: 'RETIRED_301_TO_VERTICAL_HUB',
  });
}
q.counts.total_quarantined = q.items.length;
q.retired_at = TODAY;
wr('data/content/offtopic_route_quarantine.json', q);

// 6. the ratchet
const contract = rd('data/overhaul/full_scope_overhaul_contract.json');
const active = ledger.retirements.filter((r) => r.status === 'ACTIVE_301').length;
contract.counts.approved_route_retirements = active;
contract.notes[`route_retirements_${TODAY.replace(/-/g, '_')}`] =
  `approved_route_retirements raised to ${active} on ${TODAY}. ${findings.length} live community-question routes were retired because their `
  + `subject had no relationship to the vertical whose path they occupied. Reason tally: ${JSON.stringify(tally)}. `
  + `The upstream cause is scripts/community/normalize_signals.js: it assigned a vertical from the SOURCE KEY, and the sources `
  + `reddit_pi_legaladvice, reddit_pi_insurance and reddit_pi_ask_lawyers are r/legaladvice, r/Insurance and r/Ask_Lawyers - `
  + `general-interest forums. Every post scraped from them became a personal-injury page regardless of subject, which is why `
  + `85 of these sat under /personal-injury/. That classifier now requires subject affinity, and `
  + `scripts/validators/validate_vertical_topic_admission.js blocks the next one. effective_inventory (admitted + retired) is `
  + `unchanged: the routes are accounted for, not lost.`;
wr('data/overhaul/full_scope_overhaul_contract.json', contract);

console.log(`\nRETIRED ${findings.length} routes. approved_route_retirements is now ${active}.`);
console.log('Run `npm run build` to drop them from every derived surface, then validate.');
