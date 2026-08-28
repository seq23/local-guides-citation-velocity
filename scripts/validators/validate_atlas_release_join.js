#!/usr/bin/env node
'use strict';
// HARD GATE on the measured-demand -> publishing join.
//
// Two defects this exists to stop coming back.
//
//   1. The placebo. weak_incumbent_score defaulted to a hardcoded 0.5 on 64 of 68
//      rows. A constant factor multiplied into every score decides nothing - it
//      admitted no page and blocked none - while the file read as though
//      winnability had been judged. Anything that reintroduces a fabricated
//      constant in that position fails here.
//   2. The unmeasured candidate. Ranking is not admission. A query may only
//      become a page candidate once an answer engine has actually been observed
//      citing something for it, so every emitted candidate must carry a real
//      citation_occupancy reading traceable to the occupancy probe.
//
// It also enforces Rule 0 on the join itself: a run with no candidates must carry
// a named stop_reason, never an empty list and silence.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const errors = [];
const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } };

const CONTRACT = 'data/queries/atlas_release_join_contract.json';
const CANDIDATES = 'data/queries/measured_demand_candidates.json';
const ATLAS = 'data/authority_scale/query_atlas.json';
const OCCUPANCY = 'data/signals/query_class_occupancy.json';

const contract = read(CONTRACT);
if (!contract) errors.push(`missing ${CONTRACT} - the join has no declared admission rules`);
const rules = contract?.admission_rules || {};
const REQUIRED_BASIS = rules.required_winnability_basis;
if (!REQUIRED_BASIS) errors.push(`${CONTRACT}: admission_rules.required_winnability_basis must be declared`);
if (typeof rules.minimum_citation_occupancy !== 'number') errors.push(`${CONTRACT}: admission_rules.minimum_citation_occupancy must be a number`);

// 1. no fabricated winnability constant may return to the atlas builder
const builderPath = 'scripts/atlas/build_query_atlas.mjs';
const builder = (() => { try { return fs.readFileSync(path.join(ROOT, builderPath), 'utf8'); } catch { return null; } })();
if (builder === null) errors.push(`missing ${builderPath}`);
else {
  const placebo = /weak_incumbent_score\s*\?\?\s*0?\.\d+/;
  builder.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (placebo.test(line)) errors.push(`${builderPath}:${i + 1}: winnability defaulted to a fabricated constant -> ${t}`);
  });
}

const atlas = read(ATLAS);
if (!atlas) errors.push(`missing ${ATLAS} - run npm run atlas:build first`);
else {
  const BASES = new Set(['measured_answer_engine_citation_occupancy', 'keyword_tool_supplied_weak_incumbent_score', 'unmeasured_neutral']);
  for (const q of atlas.queries || []) {
    if (!BASES.has(q.winnability_basis)) { errors.push(`${ATLAS}: row has no declared winnability_basis: ${q.query}`); continue; }
    if (q.winnability_basis === 'measured_answer_engine_citation_occupancy' && typeof q.citation_occupancy !== 'number') {
      errors.push(`${ATLAS}: row claims a measured citation occupancy but carries no number: ${q.query}`);
    }
    if (q.winnability_basis === 'unmeasured_neutral' && q.winnability_factor !== 1) {
      errors.push(`${ATLAS}: unmeasured row must carry a neutral winnability_factor of 1, found ${q.winnability_factor}: ${q.query}`);
    }
    if (q.winnability_basis !== 'measured_answer_engine_citation_occupancy' && q.citation_occupancy !== null) {
      errors.push(`${ATLAS}: row records a citation_occupancy without a measured basis: ${q.query}`);
    }
  }
}

const candidates = read(CANDIDATES);
if (!candidates) {
  // Absent is legitimate before the join has ever run; empty-with-no-reason is not.
  console.log(`atlas release join: ${CANDIDATES} not present yet - the join has not run. Nothing to check.`);
} else {
  const list = candidates.candidates || [];
  const measured = read(OCCUPANCY);
  const measuredQueries = new Set((measured?.probes || []).map((p) => String(p.query).toLowerCase().trim()));
  if (!list.length && !candidates.stop_reason) {
    errors.push(`${CANDIDATES}: no candidates and no stop_reason. A stage may not produce nothing without naming why.`);
  }
  for (const c of list) {
    if (c.source !== contract?.candidate_source) errors.push(`${CANDIDATES}: candidate ${c.query} has source=${c.source}, expected ${contract?.candidate_source}`);
    if (c.winnability_basis !== REQUIRED_BASIS) errors.push(`${CANDIDATES}: candidate admitted without a measured winnability basis (${c.winnability_basis}): ${c.query}`);
    if (typeof c.citation_occupancy !== 'number') errors.push(`${CANDIDATES}: candidate carries no citation_occupancy number: ${c.query}`);
    else if (c.citation_occupancy < Number(rules.minimum_citation_occupancy)) errors.push(`${CANDIDATES}: candidate below the declared occupancy floor (${c.citation_occupancy} < ${rules.minimum_citation_occupancy}): ${c.query}`);
    if (measured && !measuredQueries.has(String(c.query).toLowerCase().trim())) {
      errors.push(`${CANDIDATES}: candidate has no matching probe in ${OCCUPANCY}; its occupancy is not traceable to a measurement: ${c.query}`);
    }
    if (!Array.isArray(c.source_records) || !c.source_records.length) errors.push(`${CANDIDATES}: candidate carries no source_records: ${c.query}`);
    if (c.operation !== 'CREATE_NEW_TARGET_PAGE') errors.push(`${CANDIDATES}: candidate operation must be CREATE_NEW_TARGET_PAGE, found ${c.operation}: ${c.query}`);
  }
  if (list.length > Number(rules.maximum_candidates_per_run || Infinity)) {
    errors.push(`${CANDIDATES}: ${list.length} candidates exceeds the declared per-run cap of ${rules.maximum_candidates_per_run}`);
  }
}

// The occupancy signal itself must never carry a discarded probe as a zero.
const occupancy = read(OCCUPANCY);
if (occupancy) {
  const discardedQueries = new Set((occupancy.discarded_probes || []).map((d) => String(d.query).toLowerCase().trim()));
  for (const p of occupancy.probes || []) {
    if (discardedQueries.has(String(p.query).toLowerCase().trim())) errors.push(`${OCCUPANCY}: ${p.query} appears as both measured and discarded`);
    if (!Array.isArray(p.cited_hosts_in_order) || !p.cited_hosts_in_order.length) errors.push(`${OCCUPANCY}: measured probe with no cited hosts recorded, so its shares cannot be re-derived: ${p.query}`);
    if (p.slots_read !== (p.cited_hosts_in_order || []).length) errors.push(`${OCCUPANCY}: slots_read disagrees with the recorded host list: ${p.query}`);
  }
  if (!(occupancy.probes || []).length && !(occupancy.discarded_probes || []).length) {
    errors.push(`${OCCUPANCY}: file exists but records neither a measurement nor a discard`);
  }
}

const report = {
  validator: 'atlas-release-join',
  status: errors.length ? 'FAIL' : 'PASS',
  atlas_rows: (atlas?.queries || []).length,
  measured_rows: (atlas?.queries || []).filter((q) => q.winnability_basis === 'measured_answer_engine_citation_occupancy').length,
  candidates: (candidates?.candidates || []).length,
  stop_reason: candidates?.stop_reason ?? null,
  occupancy_measured: (occupancy?.probes || []).length,
  occupancy_discarded: (occupancy?.discarded_probes || []).length,
  errors,
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/atlas-release-join.json'), JSON.stringify(report, null, 2) + '\n');

if (errors.length) {
  console.error('ATLAS RELEASE JOIN: HARD_FAIL');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`atlas release join: PASS (${report.atlas_rows} atlas rows, ${report.measured_rows} with measured citation occupancy, ${report.candidates} candidate(s)${report.stop_reason ? `, stop: ${report.stop_reason}` : ''}; occupancy signal ${report.occupancy_measured} measured / ${report.occupancy_discarded} discarded)`);
