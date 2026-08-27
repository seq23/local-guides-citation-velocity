#!/usr/bin/env node
'use strict';
// No published page may contain internal build instructions.
//
// Agent recommendations arrive as build directives shaped like
//   "FILEPATH: x || CURRENT: ... || MISSING: ... || EDIT: ..."
// Two generator paths were rendering them as reader-facing copy: a fallback
// "acceptance checklist" card, and target.answer via "Citation-ready update: ".
// 163 published pages carried the first and 100 the second - the second inside
// the direct-answer block, which is the exact text answer engines extract.
//
// It also explains a reported symptom: the external agent kept re-flagging
// pages marked released, because it was reading its own instruction back off
// the page instead of the content it asked for.
//
// data/report_fixes/** is exempt: those are the agent's own raw reports and are
// supposed to contain this text. They are not part of the published surface.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/internal-instruction-leak.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates']);

const PATTERNS = [
  [/FILEPATH:/, 'raw agent recommendation (FILEPATH:)'],
  [/\|\|\s*(CURRENT|MISSING|EDIT)\s*:/i, 'raw agent recommendation field separator'],
  [/Citation-ready update:/i, 'instruction appended to the answer block'],
  [/Marker-only framework cards/i, 'build policy text rendered as page copy'],
  [/Required semantic acceptance:/i, 'build policy text rendered as page copy'],
  // Found inside direct-answer blocks on 14 pages - the exact text answer
  // engines quote. Different phrasing from the FILEPATH form, so the original
  // pattern set missed it.
  [/citation-agent source patch/i, 'build text inside the answer block'],
  [/artifact-required decision support markers/i, 'build text inside the answer block'],
  // Imperative shapes, found on 148 published pages on 2026-08-27. Every pattern
  // above is a noun phrase from the build vocabulary; these read like prose,
  // which is why they survived. See scripts/lib/internal_instruction_text.js.
  // "acceptance block" is deliberately absent even though 28 pages render it -
  // the compiler emits it as its own heading_exact. See the note in
  // scripts/lib/internal_instruction_text.js.
  [/\bDirectly answer\s*:/i, 'instruction to write the answer, printed instead of the answer'],
  [/\bAnswer directly\s*:/i, 'instruction to write the answer, printed instead of the answer'],
  [/does not include the exact requested (?:heading|table|checklist|script|callout)/i, "a validator's own failure message rendered as reader-facing advice"],
];

// The 148 pages already carrying one of the four imperative shapes above.
//
// A zero-tolerance gate that fails on 148 pages the moment it learns to see them
// is a gate someone switches off. This seals what exists so the gate blocks the
// 149th, exactly as data/content/route_topic_quality_baseline.json does for
// routes. It is NOT an allowlist to edit: the entries are recorded defects, and
// the remedy note below is the work they are waiting on.
//
// Removing them is not a text edit. The same strings are required_strings inside
// the agent acceptance manifests, so deleting them from a page fails
// validate_agent_exact_implementation on frozen routes. Repairing them means
// reworking that contract, which is its own transaction and its own review.
const BASELINE = path.join(ROOT, 'data/content/internal_instruction_leak_baseline.json');
const baseline = fs.existsSync(BASELINE)
  ? new Set((JSON.parse(fs.readFileSync(BASELINE, 'utf8')).pages || []).map((p) => p.path))
  : new Set();

const offenders = [];
const sealed = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    const html = fs.readFileSync(abs, 'utf8');
    for (const [re, why] of PATTERNS) {
      if (re.test(html)) {
        if (baseline.has(rel)) { sealed.push({ path: rel, reason: why }); break; }
        offenders.push({ path: rel, reason: why });
        break;
      }
    }
  }
})(ROOT);

if (process.argv.includes('--seed-baseline')) {
  const pages = [...offenders, ...sealed].sort((a, b) => a.path.localeCompare(b.path));
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify({
    note: 'Published pages already rendering an internal build instruction as visible copy when the four imperative patterns were added to the gate. Sealed so the gate blocks the next one rather than the existing pile. DO NOT add entries here to get a build green.',
    remedy: 'These strings are also required_strings in the agent acceptance manifests, so deleting them from a page fails validate_agent_exact_implementation on frozen routes. Repairing them means reworking that contract; it is its own transaction.',
    sealed_at: new Date().toISOString().slice(0, 10),
    count: pages.length,
    pages,
  }, null, 2)}\n`);
  console.log(`Sealed internal-instruction-leak baseline: ${pages.length} pages.`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'no-internal-instruction-leak',
  status: offenders.length ? 'FAIL' : 'PASS',
  offender_count: offenders.length,
  sealed_pre_existing: sealed.length,
  offenders: offenders.slice(0, 200),
}, null, 2)}\n`);

if (offenders.length) {
  console.error(`INTERNAL INSTRUCTION LEAK FAIL: ${offenders.length} published page(s) contain build instructions`);
  for (const o of offenders.slice(0, 15)) console.error(`  ${o.path} :: ${o.reason}`);
  if (offenders.length > 15) console.error(`  ...and ${offenders.length - 15} more`);
  console.error('  remedy: the generator must not render recommendation text; see scripts/lib/agent_exact_repairs.js');
  process.exit(1);
}
console.log(`NO INTERNAL INSTRUCTION LEAK: 0 new; ${sealed.length} sealed pre-existing page(s) still carry one (see data/content/internal_instruction_leak_baseline.json)`);
