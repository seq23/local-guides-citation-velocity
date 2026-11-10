#!/usr/bin/env node
'use strict';
/**
 * Copy hygiene (legal-copy screen): REPORTED, never blocking.
 *
 * LAWYER COPY OFF A LAWYER PAGE. A "What to verify" row filled from the
 * personal-injury table ("Get the contingency percentage ...") on a dental, TRT,
 * neuro or USCIS page is legal guidance leaking onto a page whose reader has no
 * lawyer in view. The cells come from scripts/lib/vertical_rows.js, the SAME list
 * the compiler offers only on personal-injury routes and the render-time screen
 * rewrites everywhere else. This is the only check that reads the rendered pages
 * for it.
 *
 * Registered as STRONG_WARNING (owner's call 2026-09-22: it may not turn main red).
 * It exits non-zero when it finds something only so the runner records the warning.
 * Trimmed 10 Nov 2026 to this screen (hostile review of the validator cut); the
 * model-label half was cut.
 *
 * Rule 0: examining zero pages is a failure, not a clean result.
 */
const fs = require('fs');
const path = require('path');
const { PERSONAL_INJURY_GUIDANCE_CELLS, isPersonalInjuryRoute } = require('../lib/vertical_rows');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/copy-hygiene.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates', 'docs', 'releases', 'content-bank', 'proofs', 'outputs', 'dist']);
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const LAWYER_CELLS = PERSONAL_INJURY_GUIDANCE_CELLS.map(escapeHtml);
if (!LAWYER_CELLS.length) {
  console.error('COPY HYGIENE: scripts/lib/vertical_rows.js exports no personal-injury guidance cells, so the cross-vertical check would pass blind.');
  process.exit(2);
}

const lawyerPages = [];
let scanned = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(abs); continue; }
    if (!entry.name.endsWith('.html')) continue;
    scanned += 1;
    if (isPersonalInjuryRoute(rel)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    const cells = LAWYER_CELLS.filter((cell) => html.includes(cell));
    if (cells.length) lawyerPages.push({ path: rel, cells: cells.length });
  }
})(ROOT);

const report = { schema_version: '1.1', validator: 'copy-hygiene', severity: 'STRONG_WARNING', scanned_pages: scanned, lawyer_copy_off_vertical_pages: lawyerPages.length, status: 'PASS', lawyer_copy_offenders: lawyerPages.slice(0, 200) };
const emit = () => { fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true }); fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`); };

if (scanned === 0) {
  report.status = 'FAIL'; report.failure = 'examined_zero_pages'; emit();
  console.error('COPY HYGIENE: examined 0 pages. Run `npm run build` first.');
  process.exit(1);
}
if (lawyerPages.length) {
  report.status = 'WARN'; emit();
  console.error(`COPY HYGIENE WARNING: ${lawyerPages.length} non-personal-injury page(s) print personal-injury legal copy (${scanned} examined). Reported, not blocking.`);
  for (const page of lawyerPages.slice(0, 15)) console.error(`  lawyer copy  ${page.path}: ${page.cells} cell(s)`);
  console.error(`  Full list: ${path.relative(ROOT, EVIDENCE)}. Fix at the source (vertical_rows.js), never on the page.`);
  process.exit(1);
}
emit();
console.log(`COPY HYGIENE PASS: ${scanned} page(s) examined; no off-vertical personal-injury legal copy.`);
