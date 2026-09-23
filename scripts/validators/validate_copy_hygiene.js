#!/usr/bin/env node
'use strict';
/**
 * Copy hygiene: two reader-facing copy defects, REPORTED, never blocking.
 *
 * Registered as STRONG_WARNING with no hard_fail_basis. Both defects are cosmetic in
 * the sense the registry uses: the page still resolves, still answers, still carries
 * its evidence. The owner's call (2026-09-22) is that neither may turn main red, so
 * this reports every offender and the release profile, which does not promote
 * warnings, carries on. It exits non-zero when it finds something only so the runner
 * can record the warning.
 *
 * 1. MODEL LABEL IN COPY. An answer-panel label such as "(Gemini 1.5 Flash)" or
 *    "OpenAI GPT-4o" printed as part of the page. It arrived through the agent's query
 *    field: the fix ledger copies the query into required_markers, so the rebuild was
 *    obliged to keep printing it. The source now strips it where agent rows become
 *    records (scripts/lib/agent_artifact_source_parser.js questionFrom, which
 *    prepare_velocity_intake_release.js reads CSV rows through). The pattern is the
 *    parser's own ENGINE_LABEL_IN_COPY, imported, so this check and the strip cannot
 *    drift apart.
 *
 * 2. LAWYER COPY OFF A LAWYER PAGE. A "What to verify" row filled from the
 *    personal-injury table ("Get the contingency percentage ...") on a dental, TRT,
 *    neuro or USCIS page. The cells come from scripts/lib/vertical_rows.js, the SAME
 *    list the compiler offers only on personal-injury routes and the render-time
 *    screen rewrites everywhere else. Moved here from rendered-template-scaffolding
 *    (a blocker) so it reports instead of blocking.
 *
 * Rule 0: examining zero pages is a failure, not a clean result.
 */

const fs = require('fs');
const path = require('path');
const { ENGINE_LABEL_IN_COPY } = require('../lib/agent_artifact_source_parser');
const { PERSONAL_INJURY_GUIDANCE_CELLS, isPersonalInjuryRoute } = require('../lib/vertical_rows');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/copy-hygiene.json');
// Same exclusions as rendered-template-scaffolding: data/ holds the agent's raw reports
// (evidence that is supposed to name the model), the rest are not published routes.
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates', 'docs', 'releases', 'content-bank', 'proofs', 'outputs', 'dist']);

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const LAWYER_CELLS = PERSONAL_INJURY_GUIDANCE_CELLS.map(escapeHtml);
if (!LAWYER_CELLS.length) {
  console.error('COPY HYGIENE: scripts/lib/vertical_rows.js exports no personal-injury guidance cells, so the cross-vertical check would pass blind.');
  process.exit(2);
}
if (!(ENGINE_LABEL_IN_COPY instanceof RegExp) || !ENGINE_LABEL_IN_COPY.global) {
  console.error('COPY HYGIENE: agent_artifact_source_parser.js exports no global ENGINE_LABEL_IN_COPY pattern, so the model-label check would pass blind.');
  process.exit(2);
}

function visibleText(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

const modelPages = [];
const lawyerPages = [];
let scanned = 0;

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(abs);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    scanned += 1;
    const html = fs.readFileSync(abs, 'utf8');
    ENGINE_LABEL_IN_COPY.lastIndex = 0;
    const labels = [...new Set([...visibleText(html).matchAll(ENGINE_LABEL_IN_COPY)].map((m) => m[0].trim()))];
    if (labels.length) modelPages.push({ path: rel, labels });
    if (!isPersonalInjuryRoute(rel)) {
      const cells = LAWYER_CELLS.filter((cell) => html.includes(cell));
      if (cells.length) lawyerPages.push({ path: rel, cells: cells.length });
    }
  }
})(ROOT);

const report = {
  schema_version: '1.0',
  validator: 'copy-hygiene',
  severity: 'STRONG_WARNING',
  scanned_pages: scanned,
  model_label_pages: modelPages.length,
  lawyer_copy_off_vertical_pages: lawyerPages.length,
  status: 'PASS',
  model_label_offenders: modelPages.slice(0, 200),
  lawyer_copy_offenders: lawyerPages.slice(0, 200)
};

function emit() {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`);
}

if (scanned === 0) {
  report.status = 'FAIL';
  report.failure = 'examined_zero_pages';
  emit();
  console.error('COPY HYGIENE: examined 0 pages. "No page carries a model label" and "no page was read" are not the same answer. Run `npm run build` first.');
  process.exit(1);
}

if (modelPages.length || lawyerPages.length) {
  report.status = 'WARN';
  emit();
  console.error(`COPY HYGIENE WARNING: ${modelPages.length} page(s) print an answer-engine label, ${lawyerPages.length} non-personal-injury page(s) print personal-injury row copy (${scanned} examined). Reported, not blocking.`);
  for (const page of modelPages.slice(0, 15)) console.error(`  model label  ${page.path}: ${page.labels.join(', ')}`);
  if (modelPages.length > 15) console.error(`  ... and ${modelPages.length - 15} more model-label page(s)`);
  for (const page of lawyerPages.slice(0, 15)) console.error(`  lawyer copy  ${page.path}: ${page.cells} cell(s)`);
  if (lawyerPages.length > 15) console.error(`  ... and ${lawyerPages.length - 15} more lawyer-copy page(s)`);
  console.error(`  Full list: ${path.relative(ROOT, EVIDENCE)}. Fix at the source (agent_artifact_source_parser.js questionFrom; vertical_rows.js), never on the page.`);
  process.exit(1);
}

emit();
console.log(`COPY HYGIENE PASS: ${scanned} page(s) examined; no answer-engine label and no off-vertical lawyer copy.`);
