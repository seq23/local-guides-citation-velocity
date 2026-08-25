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
];

const offenders = [];
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
      if (re.test(html)) { offenders.push({ path: rel, reason: why }); break; }
    }
  }
})(ROOT);

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'no-internal-instruction-leak',
  status: offenders.length ? 'FAIL' : 'PASS',
  offender_count: offenders.length,
  offenders: offenders.slice(0, 200),
}, null, 2)}\n`);

if (offenders.length) {
  console.error(`INTERNAL INSTRUCTION LEAK FAIL: ${offenders.length} published page(s) contain build instructions`);
  for (const o of offenders.slice(0, 15)) console.error(`  ${o.path} :: ${o.reason}`);
  if (offenders.length > 15) console.error(`  ...and ${offenders.length - 15} more`);
  console.error('  remedy: the generator must not render recommendation text; see scripts/lib/agent_exact_repairs.js');
  process.exit(1);
}
console.log('NO INTERNAL INSTRUCTION LEAK: published pages contain no build directives');
