#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * uscis-authority-grounding-coverage
 *
 * WHY THIS EXISTS
 *
 * uscis-medical is a high-stakes vertical. validate_html_fix_acceptance_compiler.js
 * requires authority_grounded, authority_source_ids and authority_urls on every
 * semantic entry under uscis-medical/, and only authorityGroundedEntryForSpec() can
 * supply them. So every uscis-medical route that agent rows resolve to is in one of
 * two states: GROUNDED, or a NAMED STOP. A route in neither state is a silent hole -
 * the compiler refuses it, the trace demands a marker nothing carries, and the
 * release lane goes red on a route nobody ever decided about.
 *
 * semantic-acceptance-refusal-legibility already proves that a refusal the compiler
 * makes THIS RUN is recorded. It is scoped to PLANNED specs in the current plan, so
 * it is structurally unable to see a route that is ungrounded but was not planned
 * today - which is most of them, most days. That is precisely how 22 ungrounded
 * routes accumulated while every run stayed green: each was invisible until the day
 * it was drawn, and then it took the whole batch red.
 *
 * This validator asks the question that is true on every run regardless of what was
 * planned: over the WHOLE backlog, is every uscis route either genuinely grounded or
 * deliberately stopped with a reason?
 *
 * WHAT IT PROVES
 *
 *  1. COVERAGE. Every uscis-medical route the fix ledger and the normalized agent
 *     runs resolve to is either grounded or named in the register as a stop.
 *  2. GROUNDING IS REAL. A route recorded as grounded actually RESOLVES to grounding:
 *     authority_grounded true, non-empty authority_source_ids and authority_urls,
 *     every URL on the primary-source allowlist, a source_block artifact, and a
 *     non-empty answer. "Recorded as grounded" and "is grounded" are re-derived from
 *     the same function the compiler calls, so they cannot drift.
 *  3. NO NEAR-IDENTICAL COPY. The owner's constraint - never spray one template
 *     across the backlog, because near-identical copy on cited pages is worse than
 *     named stops - is MEASURED, not merely asserted. Every pair of grounded uscis
 *     entries is compared on required_strings and on answer text, and convergence
 *     past a threshold fails by name.
 *  4. STOPS STAY HONEST. Every named stop still carries a reason, a detail, why
 *     grounding is the wrong repair, and the correct repair. A stop that has since
 *     been grounded is stale and fails, so the register cannot rot into an excuse
 *     list.
 *  5. DECISIONS ARE NOT RE-LITIGATED. A durable ledger entry may not promise, in
 *     required_strings, a phrase its own landed fix_recommendations ask to remove.
 *     That is the promised-and-retired contradiction; a route with one must carry a
 *     decision in landed_directive_decisions.json.
 *
 * It hard-fails when it examines zero routes while routes were available: an empty
 * loop must never pass as coverage.
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

const { authorityGroundedEntryForSpec } = require('../lib/authority_grounded_repairs');
const { resolveTargetPath } = require('../lib/citation_route_resolver');
const { phrasesTheFixAsksToRemove, normalizeForbidden } = require('../lib/html_fix_acceptance_parser');
const { zeroExaminationVerdict } = require('../lib/zero_item_examination');

const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const REGISTER_PATH = 'data/report_fixes/uscis_authority_grounding_register.json';
const DECISIONS_PATH = 'data/report_fixes/landed_directive_decisions.json';
const FIX_LEDGER_PATH = 'data/report_fixes/agent_fix_ledger.json';
const EXACT_LEDGER_PATH = 'data/report_fixes/agent_exact_implementation_ledger.json';
const NORMALIZED_DIR = 'data/report_fixes/normalized_agent_runs';
const REPORT_PATH = 'artifacts/validation/uscis-authority-grounding-coverage.json';

// Primary sources only. Immigration guidance may not be grounded in a blog, an
// aggregator, or a law-firm marketing page, so the allowlist is the government
// hosts that publish the controlling instructions.
const ALLOWED_AUTHORITY_HOSTS = ['www.uscis.gov', 'uscis.gov', 'www.cdc.gov', 'cdc.gov', 'content.govdelivery.com'];

// Two grounded entries this similar are the same page written twice.
const DUPLICATE_STRING_JACCARD = 0.7;
const DUPLICATE_ANSWER_JACCARD = 0.7;

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }
function writeJson(p, value) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(value, null, 2) + '\n'); }

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const value of setA) if (setB.has(value)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}
function words(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
}

const errors = [];

// ---------------------------------------------------------------------------
// Re-derive the universe. Never read it from the register: a register that
// declared its own scope could always shrink to the routes it happens to cover.
// ---------------------------------------------------------------------------
const universe = new Map();
function considerRow(row) {
  if (!row) return;
  const resolved = resolveTargetPath({
    value: row.intended_winner_path || row.intended_winner_page || row.target_route || '',
    query: row.query || '',
    family: row.vertical || ''
  });
  const implementationPath = resolved && resolved.implementation_path;
  if (!implementationPath || resolved.block_reason) return;
  if (!String(implementationPath).startsWith('uscis-medical/')) return;
  const current = universe.get(implementationPath) || { rows: 0, record_ids: new Set() };
  current.rows += 1;
  if (row.id) current.record_ids.add(String(row.id));
  universe.set(implementationPath, current);
}

for (const fix of (readJson(FIX_LEDGER_PATH, { fixes: [] }).fixes || [])) considerRow(fix);
const normalizedDir = rel(NORMALIZED_DIR);
if (fs.existsSync(normalizedDir)) {
  for (const name of fs.readdirSync(normalizedDir).sort()) {
    if (!name.endsWith('.json')) continue;
    for (const record of (readJson(`${NORMALIZED_DIR}/${name}`, { records: [] }).records || [])) considerRow(record);
  }
}

const routes = [...universe.keys()].sort();

const register = readJson(REGISTER_PATH, null);
if (!register) {
  errors.push(`register_missing:${REGISTER_PATH} - without it a named stop has no reason on record and an ungrounded route is indistinguishable from a forgotten one.`);
}
const namedStops = new Map();
for (const stop of (register && register.named_stops) || []) {
  const key = String(stop && stop.implementation_path || '');
  if (!key) { errors.push('named_stop_without_implementation_path'); continue; }
  namedStops.set(key, stop);
  for (const field of ['reason', 'detail', 'why_grounding_is_the_wrong_repair', 'correct_repair']) {
    if (!String(stop[field] || '').trim()) {
      errors.push(`named_stop_missing_${field}:${key} - a stop without this is a silent skip, not a named stop.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 1 + 2. Coverage, and grounding that is actually grounding.
// ---------------------------------------------------------------------------
const grounded = [];
for (const implementationPath of routes) {
  const entry = authorityGroundedEntryForSpec({ implementation_path: implementationPath });
  if (!entry) {
    if (!namedStops.has(implementationPath)) {
      errors.push(`uscis_route_neither_grounded_nor_named_stop:${implementationPath} - the compiler will refuse it, nothing will carry its marker, and the trace will demand one. Author a grounded template in scripts/lib/authority_grounded_repairs.js, or record it as a named stop with its reason in ${REGISTER_PATH}.`);
    }
    continue;
  }
  if (namedStops.has(implementationPath)) {
    errors.push(`named_stop_is_now_grounded:${implementationPath} - the stop is stale and must be removed from the register, otherwise the register reads as an excuse for work that is done.`);
  }
  grounded.push({ implementationPath, entry });

  if (entry.authority_grounded !== true) errors.push(`grounded_entry_not_flagged_authority_grounded:${implementationPath}`);
  if (!(entry.authority_source_ids || []).length) errors.push(`grounded_entry_without_authority_source_ids:${implementationPath}`);
  if (!(entry.authority_urls || []).length) errors.push(`grounded_entry_without_authority_urls:${implementationPath}`);
  if (!String(entry.answer || '').trim()) errors.push(`grounded_entry_without_answer:${implementationPath}`);
  for (const url of entry.authority_urls || []) {
    let host = '';
    try { host = new URL(String(url)).host; } catch { host = ''; }
    if (!ALLOWED_AUTHORITY_HOSTS.includes(host)) {
      errors.push(`grounded_entry_cites_non_primary_source:${implementationPath}:${url} - immigration guidance must be grounded in USCIS or CDC primary sources.`);
    }
  }
  if (!(entry.artifacts || []).some((artifact) => artifact && artifact.type === 'source_block')) {
    errors.push(`grounded_entry_without_source_block:${implementationPath} - the page must show the reader which primary sources the answer rests on.`);
  }
}

// ---------------------------------------------------------------------------
// 3. The owner's constraint, measured. Never one template sprayed across routes.
// ---------------------------------------------------------------------------
for (let i = 0; i < grounded.length; i += 1) {
  for (let j = i + 1; j < grounded.length; j += 1) {
    const a = grounded[i];
    const b = grounded[j];
    const stringOverlap = jaccard(a.entry.required_strings || [], b.entry.required_strings || []);
    const answerOverlap = jaccard(words(a.entry.answer), words(b.entry.answer));
    if (stringOverlap >= DUPLICATE_STRING_JACCARD || answerOverlap >= DUPLICATE_ANSWER_JACCARD) {
      errors.push(`grounded_uscis_routes_are_near_identical:${a.implementationPath}:${b.implementationPath}:strings=${stringOverlap.toFixed(2)}:answer=${answerOverlap.toFixed(2)} - these are distinct long-tail pages whose purpose is being cited. Near-identical copy across cited pages is worse than a named stop. Write each route to its own question, or make one of them a named stop.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. A decision, once made, is not re-litigated.
// ---------------------------------------------------------------------------
const decisions = readJson(DECISIONS_PATH, null);
if (!decisions) {
  errors.push(`decision_register_missing:${DECISIONS_PATH} - a contradiction between landed directives must be settled in the repo, not re-argued every run.`);
}
const decidedRoutes = new Set();
for (const decision of (decisions && decisions.decisions) || []) {
  if (decision && decision.route) decidedRoutes.add(String(decision.route));
  for (const affected of (decision && decision.affected_routes) || []) {
    if (affected && affected.route) decidedRoutes.add(String(affected.route));
  }
}

let contradictionsExamined = 0;
for (const entry of (readJson(EXACT_LEDGER_PATH, { entries: [] }).entries || [])) {
  const forbidden = new Set();
  for (const recommendation of entry.fix_recommendations || []) {
    for (const phrase of phrasesTheFixAsksToRemove(recommendation)) forbidden.add(normalizeForbidden(phrase));
  }
  if (!forbidden.size) continue;
  contradictionsExamined += 1;
  const promisedAndRetired = (entry.required_strings || []).filter((value) => forbidden.has(normalizeForbidden(value)));
  if (promisedAndRetired.length && !decidedRoutes.has(String(entry.implementation_path))) {
    errors.push(`artifact_promised_and_retired:${entry.implementation_path}:${JSON.stringify(promisedAndRetired)} - a landed directive asks for this phrase to be removed while the durable contract promises the page must publish it. The page cannot be both. Retire the promise, or record a decision in ${DECISIONS_PATH}.`);
  }
}

// ---------------------------------------------------------------------------
// An empty loop must never pass as coverage.
// ---------------------------------------------------------------------------
const verdict = zeroExaminationVerdict({
  validator: 'uscis-authority-grounding-coverage',
  unit: 'uscis-medical route(s) with agent rows',
  examined: routes.length,
  available: routes.length,
  stopReason: 'no agent row in the fix ledger or the normalized runs resolves to a uscis-medical route, so there is no grounding coverage question to answer',
  inputs: [FIX_LEDGER_PATH, NORMALIZED_DIR, REGISTER_PATH]
});
if (verdict.error) errors.push(verdict.error);
if (routes.length && !contradictionsExamined) {
  errors.push('zero_ledger_entries_examined_for_directive_contradictions - the promised-and-retired check ran over nothing, which means it proved nothing.');
}

const report = {
  schema_version: '1.0',
  guard: 'uscis-authority-grounding-coverage',
  status: errors.length ? 'FAIL' : 'PASS',
  checked_at: DATE,
  inputs: [FIX_LEDGER_PATH, NORMALIZED_DIR, EXACT_LEDGER_PATH, REGISTER_PATH, DECISIONS_PATH],
  routes_examined: routes.length,
  grounded_count: grounded.length,
  named_stop_count: namedStops.size,
  ledger_entries_examined_for_contradictions: contradictionsExamined,
  named_stop: verdict.named_stop,
  grounded_routes: grounded.map((row) => row.implementationPath),
  named_stop_routes: [...namedStops.keys()].sort(),
  errors
};
writeJson(REPORT_PATH, report);

if (errors.length) {
  console.error('USCIS AUTHORITY GROUNDING COVERAGE FAIL');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`USCIS AUTHORITY GROUNDING COVERAGE PASS: ${routes.length} uscis route(s) examined; ${grounded.length} grounded against primary sources; ${namedStops.size} named stop(s) with reasons; ${contradictionsExamined} ledger entry(ies) checked for promised-and-retired contradictions`);
