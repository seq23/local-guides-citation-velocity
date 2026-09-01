#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A phrase an agent report asked to DELETE must not be on the page.
 *
 * The 2026-09-01 dentistry run said, of dentistry/choosing-a-dentist/index.html:
 *
 *   "Fix the table artifact: replace 'Use the same questions with every lawyer on your
 *    shortlist' with dentist-specific language throughout."
 *
 * The quoted span is personal-injury boilerplate that had leaked across verticals. The
 * acceptance compiler read the quote as COPY: requiredStringsForArtifact promised it,
 * and titleFromFix made it the artifact title - so it rendered as a visible <h2> on two
 * dentistry pages under a "Cost table" badge, telling a reader to ask the same
 * questions of every lawyer on their shortlist. The report asked for it to go and the
 * pipeline guaranteed it stayed.
 *
 * Both compiler halves are fixed. This validator is the proof that they stay fixed,
 * and it checks the only thing that actually matters: the RENDERED PAGE.
 *
 * Two independent checks, because either one alone can pass while the site is wrong:
 *
 *   1. ENUMERATED. Every phrase named in data/release/withheld_page_phrases.json must
 *      be absent from the route it names. These are the known leaks; this is the
 *      ratchet that stops them returning.
 *   2. DERIVED. For every landed fix in the implementation ledger, any phrase that fix
 *      asks to remove is checked against what the acceptance compiler AUTHORED for the
 *      same route - artifact titles, required_blocks[].heading_exact, and
 *      required_strings. That is exactly the defect: the compiler taking a quoted
 *      deletion order and re-publishing it as its own copy. A NEW removal directive
 *      that the pipeline turns into a heading fails on the run it lands, with nobody
 *      having to add it to a list first.
 *
 *      This deliberately does NOT assert the phrase is absent from the rendered page.
 *      Most removal directives read "replace the current 'Direct answer' with a real
 *      checklist": the phrase names a BLOCK to improve and stays on the page as a
 *      badge or a title. Asserting rendered absence flagged 31 pages, 29 of them
 *      wrongly, and acting on that would have stripped delivered copy - the same harm
 *      in the opposite direction. Rendered absence is asserted only for the
 *      enumerated list, where a human has confirmed the phrase must go.
 *
 * Rule 0: examining zero pages, or zero removal directives, is a hard failure.
 */

const fs = require('fs');
const path = require('path');
const { phrasesTheFixAsksToRemove, normalizeForbidden } = require('../lib/html_fix_acceptance_parser');
const { stripContentAtomBlocks } = require('../lib/rendered_artifact_recovery');

const ROOT = path.resolve(__dirname, '../..');
const WITHHOLD = 'data/release/withheld_page_phrases.json';
const LEDGER = 'data/report_fixes/agent_exact_implementation_ledger.json';
const MANIFEST = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const OUT = 'artifacts/validation/removal-directive-not-published.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

// Compared the way a reader sees it: markup stripped, entities decoded, whitespace and
// punctuation flattened. A leak that renders as "…every&nbsp;lawyer…" is the same leak.
function readableText(html) {
  return String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function main() {
  const withholdDoc = readJson(WITHHOLD, null);
  const ledger = readJson(LEDGER, null);
  if (!withholdDoc || !Array.isArray(withholdDoc.withheld)) {
    console.error(`REMOVAL DIRECTIVE GUARD FAIL: ${WITHHOLD} is missing or has no withheld array.`);
    process.exit(1);
  }
  if (!ledger || !Array.isArray(ledger.entries)) {
    console.error(`REMOVAL DIRECTIVE GUARD FAIL: ${LEDGER} is missing or has no entries array; no removal directive can be derived.`);
    process.exit(1);
  }

  // route -> Set of phrases that must not appear, with where each came from
  const required = new Map();
  const addPhrase = (implementationPath, phrase, origin) => {
    const key = String(implementationPath || '');
    const norm = normalizeForbidden(phrase);
    if (!key || !norm) return;
    if (!required.has(key)) required.set(key, new Map());
    if (!required.get(key).has(norm)) required.get(key).set(norm, { phrase, origin });
  };

  let enumerated = 0;
  for (const item of withholdDoc.withheld) { addPhrase(item.implementation_path, item.phrase, `enumerated:${WITHHOLD}`); enumerated += 1; }

  // Derived directives are held separately: they gate what the COMPILER authored, not
  // what the page says.
  const authored = new Map();
  let derived = 0;
  for (const entry of ledger.entries) {
    const target = String(entry.implementation_path || '');
    if (!target) continue;
    for (const recommendation of entry.fix_recommendations || []) {
      for (const phrase of phrasesTheFixAsksToRemove(recommendation)) {
        if (!authored.has(target)) authored.set(target, new Map());
        if (!authored.get(target).has(phrase)) { authored.get(target).set(phrase, recommendation); derived += 1; }
      }
    }
  }

  if (!required.size && !authored.size) {
    console.error('REMOVAL DIRECTIVE GUARD FAIL: zero removal directives found across the withhold list and the implementation ledger. Nothing was checked, which is not the same as nothing being wrong.');
    process.exit(1);
  }

  const leaks = [];
  const sourceLeaks = [];
  let pagesChecked = 0;
  let phrasesChecked = 0;
  const notOnDisk = [];

  for (const [implementationPath, phrases] of required) {
    const abs = rel(implementationPath);
    if (!fs.existsSync(abs)) { notOnDisk.push(implementationPath); continue; }
    pagesChecked += 1;
    const text = readableText(stripContentAtomBlocks(fs.readFileSync(abs, 'utf8')));
    for (const [norm, meta] of phrases) {
      phrasesChecked += 1;
      if (text.includes(norm)) leaks.push({ implementation_path: implementationPath, phrase: meta.phrase, origin: meta.origin });
    }
  }

  // What the compiler AUTHORED for the route. Each of these is a string the pipeline
  // chose to publish itself - a visible <h2>, the heading the trace enforces, or a
  // required_string. A deletion order appearing in any of them is the defect.
  const manifest = readJson(MANIFEST, { entries: [] });
  let authoredChecks = 0;
  for (const entry of manifest.entries || []) {
    const route = String(entry.implementation_path || '');
    const enumeratedPhrases = required.get(route);
    const derivedPhrases = authored.get(route);
    if (!enumeratedPhrases && !derivedPhrases) continue;
    const surfaces = [
      ['title', entry.title],
      ...(entry.artifacts || []).map((a) => ['artifact_title', a && a.title]),
      ...(entry.checklist || []).map((c) => ['checklist', c]),
      ...(entry.required_strings || []).map((c) => ['required_string', c]),
      ...(entry.row_requirements || []).flatMap((row) => [
        ...(row.required_blocks || []).map((b) => ['heading_exact', b && b.heading_exact]),
        ...(row.required_strings || []).map((c) => ['row_required_string', c])
      ])
    ].filter(([, value]) => value);
    const check = (phrases, origin) => {
      if (!phrases) return;
      for (const key of phrases.keys()) {
        const norm = typeof key === 'string' ? key : '';
        if (!norm) continue;
        for (const [surface, value] of surfaces) {
          authoredChecks += 1;
          if (normalizeForbidden(value) === norm) {
            sourceLeaks.push({ implementation_path: route, phrase: norm, surface, origin });
          }
        }
      }
    };
    check(enumeratedPhrases, `enumerated:${WITHHOLD}`);
    check(derivedPhrases, 'derived:ledger_fix_recommendation');
  }

  if (pagesChecked === 0) {
    console.error(`REMOVAL DIRECTIVE GUARD FAIL: ${required.size} route(s) carry a removal directive and not one of them is on disk. Build the site, then re-run.`);
    process.exit(1);
  }

  const status = (leaks.length || sourceLeaks.length) ? 'FAIL' : 'PASS';
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify({
    schema_version: '1.0', validator: 'removal-directive-not-published', status,
    checked_at: new Date().toISOString(),
    enumerated_directives: enumerated, derived_directives: derived,
    routes_with_directives: required.size, routes_with_derived_directives: authored.size, pages_checked: pagesChecked, phrase_checks: phrasesChecked, authored_surface_checks: authoredChecks,
    routes_not_on_disk: notOnDisk, rendered_leaks: leaks, source_leaks: sourceLeaks
  }, null, 2)}\n`);

  if (leaks.length || sourceLeaks.length) {
    console.error(`REMOVAL DIRECTIVE GUARD FAIL: ${leaks.length} rendered page(s) and ${sourceLeaks.length} source record(s) still carry a phrase a landed report asked to remove.`);
    for (const l of leaks.slice(0, 20)) console.error(`  RENDERED ${l.implementation_path} :: ${l.phrase} (${l.origin})`);
    for (const l of sourceLeaks.slice(0, 20)) console.error(`  SOURCE   ${l.implementation_path} :: ${l.phrase}`);
    process.exit(1);
  }
  console.log(`REMOVAL DIRECTIVE GUARD PASS: ${phrasesChecked} rendered phrase check(s) across ${pagesChecked} page(s), ${authoredChecks} authored-surface check(s) across ${authored.size} route(s); ${enumerated} enumerated and ${derived} ledger-derived directive(s); no removal directive is published.`);
}

main();
