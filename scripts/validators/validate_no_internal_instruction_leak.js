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

// Third element is the shape id used by the baseline tally, so a per-shape count
// is derived from the patterns themselves and cannot drift from them by hand.
const PATTERNS = [
  [/FILEPATH:/, 'raw agent recommendation (FILEPATH:)', 'filepath'],
  [/\|\|\s*(CURRENT|MISSING|EDIT)\s*:/i, 'raw agent recommendation field separator', 'field-separator'],
  [/Citation-ready update:/i, 'instruction appended to the answer block', 'citation-ready-update'],
  [/Marker-only framework cards/i, 'build policy text rendered as page copy', 'marker-only-framework-cards'],
  [/Required semantic acceptance:/i, 'build policy text rendered as page copy', 'required-semantic-acceptance'],
  // Found inside direct-answer blocks on 14 pages - the exact text answer
  // engines quote. Different phrasing from the FILEPATH form, so the original
  // pattern set missed it.
  [/citation-agent source patch/i, 'build text inside the answer block', 'citation-agent-source-patch'],
  [/artifact-required decision support markers/i, 'build text inside the answer block', 'artifact-required-markers'],
  // Imperative shapes, found on 148 published pages on 2026-08-27. Every pattern
  // above is a noun phrase from the build vocabulary; these read like prose,
  // which is why they survived. See scripts/lib/internal_instruction_text.js.
  [/\bDirectly answer\s*:/i, 'instruction to write the answer, printed instead of the answer', 'directly-answer'],
  [/\bAnswer directly\s*:/i, 'instruction to write the answer, printed instead of the answer', 'answer-directly'],
  [/does not include the exact requested (?:heading|table|checklist|script|callout)/i, "a validator's own failure message rendered as reader-facing advice", 'validator-failure-message'],
  // Held out until the compiler stopped authoring "<query> - acceptance block 1"
  // as its fallback heading; see scripts/lib/internal_instruction_text.js.
  [/\bacceptance block\b/i, 'the compiler naming its own block, rendered as a heading', 'acceptance-block'],
];

// Pages exempted from the gate because they already carried a directive when the
// pattern that sees it was added.
//
// A zero-tolerance gate that fails on 148 pages the moment it learns to see them
// is a gate someone switches off. Sealing what existed let the gate block the
// 149th, exactly as data/content/route_topic_quality_baseline.json does for
// routes. It was never an allowlist to edit: the entries were recorded defects.
//
// The seal is now empty. All 148 were repaired on 2026-08-27, because removing
// the text was never a text edit: the same strings were required_strings inside
// the agent acceptance manifests and the pages are frozen accepted output, so it
// took one transaction - recompile the manifests, thaw the routes, rebuild,
// refreeze, reseal. The recipe is in the baseline file's remedy field, and
// --reseal below is the last step of it.
//
// Keep the file even at zero. An empty seal is the visible proof that the gate is
// running with no exemptions.
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
    // First match names the page's reason, as it always has. `shapes` records every
    // pattern the page hits, because a page can carry more than one and a tally that
    // counted only the first would under-report the remaining work.
    const hits = PATTERNS.filter(([re]) => re.test(html));
    if (!hits.length) continue;
    const record = { path: rel, reason: hits[0][1], shapes: hits.map(([, , id]) => id) };
    if (baseline.has(rel)) sealed.push(record);
    else offenders.push(record);
  }
})(ROOT);

function shapeTally(pages) {
  const tally = {};
  for (const page of pages) for (const shape of page.shapes || []) tally[shape] = (tally[shape] || 0) + 1;
  return Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]));
}

function writeBaseline(pages, extra) {
  const sourcePages = pages.filter((p) => !p.path.startsWith('dist/'));
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify({
    ...extra,
    count: pages.length,
    count_source_pages: sourcePages.length,
    count_dist_mirrors: pages.length - sourcePages.length,
    shape_tally_source_pages: shapeTally(sourcePages),
    pages,
  }, null, 2)}\n`);
  return sourcePages.length;
}

if (process.argv.includes('--seed-baseline')) {
  const pages = [...offenders, ...sealed].sort((a, b) => a.path.localeCompare(b.path));
  const sourceCount = writeBaseline(pages, {
    note: 'Published pages already rendering an internal build instruction as visible copy when the four imperative patterns were added to the gate. Sealed so the gate blocks the next one rather than the existing pile. Read count_source_pages: the other entries are dist/ build mirrors of the same pages. DO NOT add entries here to get a build green.',
    remedy: 'These strings are also required_strings in the agent acceptance manifests, so deleting them from a page fails validate_agent_exact_implementation on frozen routes. Repairing them means reworking that contract; it is its own transaction.',
    sealed_at: new Date().toISOString().slice(0, 10),
  });
  console.log(`Sealed internal-instruction-leak baseline: ${pages.length} entries; ${sourceCount} source pages.`);
  process.exit(0);
}

// Shrink-only counterpart of --seed-baseline, for the transaction that actually
// repairs the sealed pages.
//
// It drops every baseline entry whose page no longer carries a directive and keeps
// the rest, so the seal shrinks to exactly what is still broken. It can never ADD an
// entry: a page that starts leaking after the seal is a new defect and must fail the
// gate, not quietly join the baseline. That is the whole difference from
// --seed-baseline, which reseals whatever it finds and is therefore only safe to run
// when a pattern is first introduced.
if (process.argv.includes('--reseal')) {
  const prior = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { pages: [] };
  const stillLeaking = new Map(sealed.map((s) => [s.path, s]));
  const kept = (prior.pages || [])
    .filter((p) => stillLeaking.has(p.path))
    .map((p) => stillLeaking.get(p.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const cleared = (prior.pages || []).length - kept.length;
  const sourceCount = writeBaseline(kept, {
    note: kept.length
      ? 'Published pages that STILL render an internal build instruction as visible copy. Read count_source_pages for the size of the remaining work; the other entries are dist/ build mirrors of the same pages. Written by --reseal, which only removes entries, so this file shrinks as pages are repaired and never grows. DO NOT add entries here to get a build green.'
      : 'Empty: every sealed page has been repaired and the gate is enforcing with no exemptions. Keep the file. An empty seal is the proof that nothing is exempt; deleting it would make the next --reseal look like it started from nothing. DO NOT add entries here to get a build green.',
    remedy: 'A sealed page is repaired by one transaction, not by editing it: recompile the acceptance manifests (scripts/citation_velocity/compile_html_fix_acceptance_manifest.js) so the required_string is reader copy, then scripts/frozen_pages.js begin <release-id> <routes> -> npm run build -> accept -> npm run build (the second build settles the post-accept lastmod, or deterministic-build fails on feed/sitemaps) -> this validator with --reseal.',
    sealed_at: prior.sealed_at,
    resealed_at: new Date().toISOString().slice(0, 10),
    originally_sealed_source_pages: prior.originally_sealed_source_pages || prior.count_source_pages || null,
    cleared_since_seal: (prior.cleared_since_seal || 0) + cleared,
  });
  console.log(`Resealed internal-instruction-leak baseline: cleared ${cleared} entr(ies); ${kept.length} remain (${sourceCount} source pages); ${offenders.length} unsealed offender(s).`);
  process.exit(offenders.length ? 1 : 0);
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
