#!/usr/bin/env node
'use strict';
/**
 * The 20 comparison pages (full_scope_program VELOCITY_DISAMBIGUATOR_20) get words only they can say.
 *
 * WHY: Search Readiness q1, 17 Nov 2026 — 4 of 5 sampled theindustryguides.com pages were template
 * filler, and all 20 comparison pages failed the same test locally. The retired program that wrote
 * them filled four of five decision sections ("Which option fits the first category in <title>",
 * "Choose it only when its governing purpose ... match your situation") and the whole comparison
 * table ("Use <A> only when its defined purpose and setting match") with identical words, so any two
 * of them were more than half the same page, and the full title echoed in every question heading.
 *
 * The ledger is the source now (that program no longer exists), so the fix is to the ledger records,
 * from one data file: data/content/disambiguator_specifics.json. This script rewrites, per page,
 * the question headings (short, no title echo), the four generic answers and their checklists, the
 * comparison table (content_atom + citation_velocity_artifacts), and drops the boilerplate routing
 * sentence from the opening answer and description. Idempotent; run with --check to fail when any
 * record is out of step with the data file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SPEC = path.join(ROOT, 'data/content/disambiguator_specifics.json');
const LEDGERS = ['content/_live/pages.json', 'content/_staged/pages.json'];
const STORE = 'data/release/accepted_page_artifacts.json';
const WITHHOLD = 'data/release/withheld_page_phrases.json';
const OLD_TABLE = /: Source-First Comparison Table$/;
const PROGRAM = 'VELOCITY_DISAMBIGUATOR_20';
const TODAY = '2026-11-17';

const hash = (v, n) => crypto.createHash('sha256').update(String(v), 'utf8').digest('hex').slice(0, n);
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function stripBoilerplate(text) {
  return clean(String(text || '').replace(/\s*The table below compares [^.]*\./g, '').replace(/\s*Compare the categories, verify the current source, and continue to [a-z0-9.-]+ for the complete canonical next step\./gi, ''));
}

function sectionAtom(slug, index, section) {
  const steps = [
    { label: 'Ask', action: section.visible_q },
    ...section.checklist.map((item, i) => ({ label: i === 0 ? 'Verify' : 'Act', action: item }))
  ];
  const signature = hash(JSON.stringify({ slug, index, steps }), 24);
  return {
    type: 'named_framework',
    title: `${section.visible_q.replace(/[?]$/, '')}: checks before acting`,
    steps,
    source_basis: {
      method: 'page_specific_editorial_synthesis',
      source_route: `${slug}#faq-${index + 1}`,
      source_fields: ['sections', 'source_records'],
      factual_claim_scope: 'Category comparison and routing. No figures, prices or individual outcome claims.'
    },
    uniqueness_key: signature,
    atom_id: `ATOM-${hash(`${slug}|${index}|${signature}`, 18).toUpperCase()}`
  };
}

function tableAtom(slug, spec) {
  const [a, b] = spec.options;
  const headers = ['Decision factor', a, b];
  const title = `${a} vs ${b}: side-by-side comparison`;
  const signature = hash(JSON.stringify({ slug, headers, rows: spec.rows }), 24);
  return {
    type: 'original_comparison_table',
    title,
    headers,
    rows: spec.rows,
    source_basis: {
      method: 'page_specific_editorial_synthesis',
      source_route: slug,
      source_fields: ['title', 'description', 'sections', 'source_records'],
      factual_claim_scope: 'Category comparison and routing; no individualized conclusion.'
    },
    uniqueness_key: signature,
    atom_id: `ATOM-${hash(`${slug}|table|${signature}`, 18).toUpperCase()}`
  };
}

function applyToPage(page, spec) {
  const sections = page.sections || [];
  if (sections.length !== 5) throw new Error(`${page.slug}: expected 5 sections, found ${sections.length}`);
  const next = { ...page };
  const factors = spec.rows.map((row) => row[0].toLowerCase());
  const closing = `The table below compares ${spec.options[0]} and ${spec.options[1].charAt(0).toLowerCase()}${spec.options[1].slice(1)} on ${factors.slice(0, -1).join(', ')} and ${factors[factors.length - 1]}.`;
  next.description = `${stripBoilerplate(page.description)} ${closing}`;
  const core = { ...sections[0] };
  core.q = core.visible_q = spec.core_q;
  core.a = stripBoilerplate(core.a);
  core.checklist = spec.rows.slice(0, 2).map((row) => `${row[0]}: ${spec.options[0]}, ${row[1].charAt(0).toLowerCase()}${row[1].slice(1)}; ${spec.options[1]}, ${row[2].charAt(0).toLowerCase()}${row[2].slice(1)}.`);
  core.content_atom = sectionAtom(page.slug, 0, core);
  core.date_modified = TODAY;
  const rest = spec.sections.map((s, i) => {
    const out = { ...sections[i + 1], q: s.q, visible_q: s.q, a: s.a, checklist: s.checklist.slice(), date_modified: TODAY };
    out.content_atom = sectionAtom(page.slug, i + 1, out);
    return out;
  });
  next.sections = [core, ...rest];
  const table = tableAtom(page.slug, spec);
  next.content_atom = table;
  next.citation_velocity_artifacts = [{ type: 'comparison_table', title: table.title, headers: table.headers, rows: table.rows, id: table.atom_id }];
  next.date_modified = TODAY;
  return next;
}

function main() {
  const check = process.argv.includes('--check');
  const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  const wanted = Object.keys(spec.pages);
  let drift = 0;
  for (const rel of LEDGERS) {
    const file = path.join(ROOT, rel);
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pages = ledger.pages;
    const program = pages.filter((p) => p.full_scope_program === PROGRAM && !p.status);
    const missing = program.map((p) => p.slug).filter((s) => !spec.pages[s]);
    if (missing.length) throw new Error(`${rel}: ${PROGRAM} pages with no specifics: ${missing.join(', ')}`);
    let changed = 0;
    ledger.pages = pages.map((p) => {
      if (!spec.pages[p.slug] || p.full_scope_program !== PROGRAM) return p;
      const next = applyToPage(p, spec.pages[p.slug]);
      const same = JSON.stringify({ ...next, date_modified: 0, sections: next.sections.map((s) => ({ ...s, date_modified: 0 })) })
        === JSON.stringify({ ...p, date_modified: 0, sections: (p.sections || []).map((s) => ({ ...s, date_modified: 0 })) });
      if (same) return p;
      changed += 1;
      return next;
    });
    const seen = ledger.pages.filter((p) => spec.pages[p.slug] && p.full_scope_program === PROGRAM).length;
    if (seen !== wanted.length) throw new Error(`${rel}: found ${seen} of ${wanted.length} comparison pages`);
    if (check) { drift += changed; console.log(`${rel}: ${changed} record(s) out of step`); continue; }
    if (changed) fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(`OUTPUT disambiguator-specifics ${rel}: ${changed} of ${seen} rewritten`);
  }
  drift += retireOldTables(wanted, check);
  if (check && drift) process.exit(1);
}

/**
 * The old generic table survives in the accepted-artifact store, which merges it back on every
 * build. Content may leave a page only as a NAMED withhold (data/release/withheld_page_phrases.json),
 * so each old table is named there, and dropped from the store, which recovery would also do.
 */
function retireOldTables(slugs, check) {
  const storeFile = path.join(ROOT, STORE);
  const withholdFile = path.join(ROOT, WITHHOLD);
  const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  const withhold = JSON.parse(fs.readFileSync(withholdFile, 'utf8'));
  const named = new Set(withhold.withheld.map((w) => `${w.implementation_path}|${w.phrase}`));
  let changed = 0;
  for (const slug of slugs) {
    const rel = `${slug.replace(/^\/+/, '')}index.html`;
    const record = store.routes[rel];
    for (const artifact of (record && record.artifacts) || []) {
      if (!OLD_TABLE.test(artifact.title) || named.has(`${rel}|${artifact.title}`)) continue;
      withhold.withheld.push({
        implementation_path: rel,
        phrase: artifact.title,
        reason: 'Template filler: every one of the 20 VELOCITY_DISAMBIGUATOR_20 comparison pages carried this same five-row table ("Use <A> only when its defined purpose and setting match", "Verify the governing agency, professional type, or plan rules"), so any two of them were more than half the same page. Replaced by the page-specific table in data/content/disambiguator_specifics.json.',
        source_fix: 'Search Readiness q1 brief so-theindustryguides.com-quality: "A template-filler note means rewrite the slot text so each page says something only it can say, or fold the near-duplicates into one hub."',
        source_run: 'search-readiness fix-queue 2026-11-17',
        named_at: TODAY
      });
      named.add(`${rel}|${artifact.title}`);
      changed += 1;
    }
    if (record) {
      const kept = record.artifacts.filter((a) => !named.has(`${rel}|${a.title}`));
      if (kept.length !== record.artifacts.length) {
        if (!changed) changed += 1;
        store.artifact_count -= record.artifacts.length - kept.length;
        record.artifacts = kept;
        record.artifact_count = kept.length;
        if (!kept.length) { delete store.routes[rel]; store.route_count -= 1; }
      }
    }
  }
  if (check) { console.log(`${STORE}: ${changed} old table(s) still stored`); return changed; }
  if (changed) {
    fs.writeFileSync(withholdFile, `${JSON.stringify(withhold, null, 2)}\n`);
    fs.writeFileSync(storeFile, `${JSON.stringify(store, null, 2)}\n`);
  }
  console.log(`OUTPUT disambiguator-specifics ${STORE}: ${changed} old table(s) withheld`);
  return 0;
}

if (require.main === module) main();
module.exports = { applyToPage, stripBoilerplate };
