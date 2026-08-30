#!/usr/bin/env node
'use strict';
/**
 * Blocks a route from being ADMITTED when its subject does not belong to the vertical
 * whose path it occupies.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-27, 183 routes were retired for exactly this defect. On 2026-08-30, 98 more
 * were found still live and retired. The first cleanup did not hold because nothing
 * guarded the result: data/content/offtopic_route_quarantine.json was written, and
 * scripts/build_site.js read it to skip those routes when planning internal links, but NO
 * validator asserted that the admitted corpus stays on topic. A one-time cleanup with no
 * guard is a cleanup that runs again in a month.
 *
 * THE UPSTREAM CAUSE, which this validator only NETS
 *
 * scripts/community/normalize_signals.js assigned a vertical from the SOURCE KEY:
 *
 *     if (source.vertical) return source.vertical;
 *     ...
 *     if (key.includes('pi') || /...injury|hospital.../.test(text)) return 'pi';
 *
 * The three `pi` sources are r/legaladvice, r/Insurance and r/Ask_Lawyers - general-interest
 * forums, not personal-injury ones. Every post scraped from them became a personal-injury
 * page regardless of subject, which is why 85 of the 98 sat under /personal-injury/ and why
 * the corpus contained an IT-degree question, an IRS/unemployment question, a mobile-home
 * dispute and a car-dealership question filed as personal injury. That classifier now
 * requires subject affinity (same shared predicate as this file). This validator is the net
 * under it, not the fix.
 *
 * HOW IT BEHAVES
 *
 * It reads the admission registry - the surface that actually governs what renders, what
 * enters the sitemap and what appears in feeds - and judges every machine-minted question
 * route against data/content/vertical_topic_contract.json.
 *
 * Pre-existing violations that are NOT being fixed in the same change are recorded in
 * data/content/vertical_topic_admission_debt.json, a ratchet that MAY SHRINK BUT NEVER GROW.
 * Adding a route to the debt file to make CI green is the one thing this file exists to
 * prevent, so the debt count is asserted against a declared ceiling and a new violation
 * fails the build whether or not someone lists it.
 *
 * Usage:
 *   node scripts/validators/validate_vertical_topic_admission.js
 *   node scripts/validators/validate_vertical_topic_admission.js --seed-debt
 */
const fs = require('fs');
const path = require('path');
const { classifyRoute, contentDefects, CONTRACT_REL } = require('../lib/vertical_topic_affinity');

const ROOT = path.resolve(__dirname, '..', '..');
const DEBT_REL = 'data/content/vertical_topic_admission_debt.json';
const OUT_REL = 'artifacts/validation/vertical-topic-admission.json';
const rd = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Machine-minted question routes. Hubs, clusters, comparisons and insights are
// editorial pages, written deliberately, and are not judged here.
const IN_SCOPE = /\/(community-questions|guides)\//;

const admission = rd('data/content/page_admission_registry.json');
const pages = new Map((rd('content/_live/pages.json').pages || []).map((p) => [String(p.path || p.slug), p]));

const inScope = (admission.pages || []).filter((e) => IN_SCOPE.test(String(e.path || '')));
const violations = [];
for (const entry of inScope) {
  const route = String(entry.path || '');
  const page = pages.get(route);
  const title = String((page && page.title) || entry.primary_query || '');
  const body = page ? (page.sections || []).flatMap((s) => [s.q, s.a]).join(' ') : '';
  const codes = [];
  const topical = classifyRoute({ route, title, vertical: entry.vertical });
  if (!topical.ok) codes.push({ code: topical.reason, detail: topical.detail });
  for (const d of contentDefects({ title, body })) codes.push({ code: d, detail: 'non-topical content defect' });
  if (codes.length) violations.push({ route, vertical: entry.vertical, title: title.slice(0, 160), codes });
}

// ---------------------------------------------------------------------------
// Rule 0: an empty loop must never pass.
//
// Every check above iterates `inScope`. If the admission registry were empty, renamed,
// or its route shape changed so IN_SCOPE matched nothing, this file would find zero
// violations and print a clean PASS while asserting nothing whatsoever. That is the
// exact failure mode that let the first cleanup rot. Examining nothing is a FAIL.
// ---------------------------------------------------------------------------
if (inScope.length === 0) {
  console.error('VERTICAL TOPIC ADMISSION FAILED: examined 0 routes.');
  console.error(`  data/content/page_admission_registry.json holds ${(admission.pages || []).length} page(s),`);
  console.error(`  none matching ${IN_SCOPE}. Either the registry is empty or the route shape changed.`);
  console.error('  Nothing was measured, so nothing can be attested.');
  process.exit(1);
}

if (process.argv.includes('--seed-debt')) {
  fs.mkdirSync(path.join(ROOT, 'data/content'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, DEBT_REL), JSON.stringify({
    note: 'Admitted routes whose subject does not match their vertical and that were NOT retired in the change '
      + 'that installed this guard. This is a RATCHET: it may shrink, never grow. Do NOT add a route here to make '
      + 'CI green - that inverts the guard into a rubber stamp. Retire the route (scripts/retire_offtopic_routes.js) '
      + 'or correct the vertical contract if the route is genuinely on topic.',
    authority: CONTRACT_REL,
    guard: 'scripts/validators/validate_vertical_topic_admission.js',
    sealed_at: new Date().toISOString().slice(0, 10),
    examined_routes: inScope.length,
    ceiling: violations.length,
    routes: violations.map((v) => v.route).sort(),
  }, null, 2) + '\n');
  console.log(`Sealed vertical-topic admission debt: ${violations.length} route(s) across ${inScope.length} examined.`);
  process.exit(0);
}

let debt = { ceiling: 0, routes: [] };
if (fs.existsSync(path.join(ROOT, DEBT_REL))) debt = rd(DEBT_REL);
const allowed = new Set(debt.routes || []);
const ceiling = Number(debt.ceiling || 0);

const unlisted = violations.filter((v) => !allowed.has(v.route));

fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), JSON.stringify({
  schema_version: '1.0',
  generated_at: new Date().toISOString(),
  examined_routes: inScope.length,
  violations: violations.length,
  declared_debt_ceiling: ceiling,
  unlisted_violations: unlisted.length,
  detail: violations,
}, null, 2) + '\n');

const errors = [];
for (const v of unlisted) {
  errors.push(`${v.codes.map((c) => c.code).join('+')}  ${v.route}\n      vertical: ${v.vertical}\n      title: ${JSON.stringify(v.title)}\n      ${v.codes.map((c) => c.detail).join(' ')}`);
}
// The ratchet. Listing a new route in the debt file does not buy a pass: the count
// itself may never exceed what was sealed.
if (violations.length > ceiling) {
  errors.push(`the debt ratchet moved the wrong way: ${violations.length} violation(s) against a declared ceiling of ${ceiling}. `
    + `This ratchet may shrink, never grow. Retire the new route or fix its vertical; do not raise the ceiling.`);
}

console.log(`VERTICAL TOPIC ADMISSION: examined ${inScope.length} admitted question route(s).`);
console.log(`  violations: ${violations.length}  (declared debt ceiling ${ceiling}, unlisted ${unlisted.length})`);

if (errors.length) {
  console.error('\nVERTICAL TOPIC ADMISSION FAILED');
  console.error('  A route was admitted under a vertical its subject does not belong to.');
  console.error(`  The vertical definitions are in ${CONTRACT_REL}.`);
  console.error('  Fix by retiring the route (node scripts/retire_offtopic_routes.js --apply), not by');
  console.error(`  adding it to ${DEBT_REL}.`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('PASS: every admitted question route belongs to the vertical it occupies.');
