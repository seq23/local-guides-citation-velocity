#!/usr/bin/env node
/* eslint-disable no-console */
// ONE BAD ROW MUST NOT REJECT 649 GOOD ONES.
//
// The release is all-or-nothing. A single unprovable repair failed all 85 units in
// Velocity Content Release run 34409865197, and the same shape recurred three more
// times on 2026-09-09 with a different validator each time. At 648 outstanding
// recommendations that property alone makes the backlog undrainable, because there is
// always one more bad row.
//
// This charges a failure to the UNIT that caused it. The unit is HELD - named, counted,
// left unapplied in the ledger, its route restored to the bytes it was already
// delivering - and every other unit publishes.
//
// IT IS NOT A BYPASS, AND THE DIFFERENCE IS ONE RULE
// --------------------------------------------------
// A failure may be charged to a unit ONLY when it names a route this release actually
// touched. That rule comes from a measured property of the validators themselves:
// rendered-output-shrink-guard is TREE-LEVEL in what it scans - all 2,067 accepted
// floors, whether or not the release touched them - and per-route only in what it
// REPORTS. So "the evidence file names a route" is not sufficient. The route must be in
// this release's mutation scope.
//
// Everything else is SYSTEMIC and fails the whole run:
//   - a blocking validator that declares no unit_attribution at all (the default, so an
//     unmapped validator can never be silently routed around);
//   - a failure naming a route outside the mutation scope - a page nobody thawed that
//     shrank is a build fault, not a bad row;
//   - a validator that could not run, a build error, a git failure - none of which
//     produce a route at all.
//
// Turning a systemic fault into a quietly held row is the one way this change goes
// wrong, so the default for anything unrecognised is to fail loudly.
//
// AND A RUN THAT HOLDS EVERYTHING FAILS
// -------------------------------------
// "0 published, 85 held" exiting 0 is the runs-but-inert defect this repository names by
// name: a green lane that ships nothing. If nothing is publishable this exits 1 and says
// so.
//
// VALIDATOR SEMANTICS DO NOT CHANGE. Nothing here re-runs a validator, rewrites a
// verdict, or lowers a severity. A held unit is still a failure; it is attributed to
// itself instead of to the batch, and the held set is the honest backlog.
//
// Usage: node scripts/release/hold_failing_units.mjs --profile release
// Exit 0 = the surviving units are publishable. Exit 1 = systemic, or nothing survived.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ISOLATION_ROOT ? path.resolve(process.env.ISOLATION_ROOT) : path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const PROFILE = flag('--profile', 'release');
const DRY_RUN = argv.includes('--dry-run');
const HELD_REL = 'artifacts/validation/release-held-units.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);

const rel = (p) => path.join(ROOT, p);
const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fb; } };

function normalizeRoute(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
  if (!out.startsWith('/')) out = `/${out}`;
  out = out.replace(/\/index\.html$/, '/');
  return out.replace(/\/{2,}/g, '/');
}

// "unjustified_shrinks[].implementation_path" -> every implementation_path under that array.
// Deliberately dumb and literal: a pointer either resolves or it does not, and a pointer
// that resolves to nothing on a FAILING validator is itself systemic - the evidence did
// not say which unit is at fault, so no unit may be charged.
function resolvePointer(doc, pointer) {
  const parts = String(pointer || '').split('.').filter(Boolean);
  let cursor = [doc];
  for (const partRaw of parts) {
    const isArray = partRaw.endsWith('[]');
    const key = isArray ? partRaw.slice(0, -2) : partRaw;
    const next = [];
    for (const node of cursor) {
      if (node === null || node === undefined) continue;
      const value = key ? node[key] : node;
      if (value === undefined || value === null) continue;
      if (isArray) { if (Array.isArray(value)) next.push(...value); }
      else next.push(value);
    }
    cursor = next;
  }
  return cursor.filter((v) => typeof v === 'string' && v.trim());
}

const registry = readJson('_validation_registry.json', { validators: [] });
const byId = new Map((registry.validators || []).map((v) => [v.id, v]));

function summary() {
  for (const p of [`artifacts/validation/validation-summary-${PROFILE}.json`, 'artifacts/validation/validation-summary.json']) {
    const doc = readJson(p, null);
    if (doc && Array.isArray(doc.results)) return { doc, path: p };
  }
  return { doc: null, path: '' };
}

const { doc, path: summaryPath } = summary();
if (!doc) {
  console.error(`RELEASE ISOLATION FAIL: no readable validation summary for profile "${PROFILE}". Which validators failed is UNKNOWN, and UNKNOWN is never publishable.`);
  process.exit(1);
}

const failures = doc.results.filter((r) => r && r.status === 'FAIL');
const acceptance = readJson('artifacts/validation/mutation-scope-acceptance.json', null);
// The routes THIS release touched. Both halves count: a route the freeze transaction
// accepted and one it already rejected were each in scope for this run.
const scope = new Set();
for (const route of (acceptance && acceptance.accepted_routes) || []) scope.add(normalizeRoute(route));
for (const row of (acceptance && acceptance.rejected) || []) scope.add(normalizeRoute(row.route || row.rendered_file || ''));

const systemic = [];
const held = new Map();

for (const failure of failures) {
  const entry = byId.get(failure.id) || {};
  const pointers = Array.isArray(entry.unit_attribution) ? entry.unit_attribution : [];
  if (!pointers.length) {
    systemic.push(`${failure.id}: declares no unit_attribution in _validation_registry.json, so this failure cannot be charged to any unit. An unmapped blocking validator always fails the whole run - that default is what stops isolation becoming suppression.`);
    continue;
  }
  // evidence_file is optional in the registry; produces_files[0] is the same document for
  // every validator that writes one, so a mapping is not defeated by which field was used.
  const evidenceRel = entry.evidence_file || (entry.produces_files || [])[0] || failure.evidence_file;
  const evidence = evidenceRel ? readJson(evidenceRel, null) : null;
  if (!evidence) {
    systemic.push(`${failure.id}: failed and its evidence file ${evidenceRel || '(none declared)'} could not be read, so which unit is at fault is UNKNOWN.`);
    continue;
  }
  const routes = [...new Set(pointers.flatMap((pointer) => resolvePointer(evidence, pointer)).map(normalizeRoute).filter(Boolean))];
  if (!routes.length) {
    systemic.push(`${failure.id}: failed but ${pointers.join(', ')} named no route in ${evidenceRel}. The evidence did not say which unit is at fault, so no unit may be charged.`);
    continue;
  }
  const outside = routes.filter((route) => !scope.has(route));
  if (outside.length) {
    systemic.push(`${failure.id}: names ${outside.length} route(s) this release never touched - ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', …' : ''}. A page nobody thawed cannot have been broken by a unit in this batch, so this is a build fault and the whole run fails.`);
    continue;
  }
  for (const route of routes) {
    if (!held.has(route)) held.set(route, new Set());
    held.get(route).add(failure.id);
  }
}

if (systemic.length) {
  console.error('RELEASE ISOLATION FAIL: systemic failure(s) that cannot be charged to any unit.');
  for (const line of systemic) console.error(`  - ${line}`);
  console.error('  Nothing was held and nothing was published: a systemic fault must never be recorded as a per-unit hold.');
  process.exit(1);
}

const totalUnits = scope.size;
const heldRoutes = [...held.keys()].sort();
const publishedCount = totalUnits - heldRoutes.length;

const report = {
  schema_version: '1.0',
  guard: 'release-held-units',
  checked_at: DATE,
  profile: PROFILE,
  summary_read: summaryPath,
  units_in_scope: totalUnits,
  published_count: publishedCount,
  held_count: heldRoutes.length,
  held: heldRoutes.map((route) => ({ route, held_by: [...held.get(route)].sort() })),
  policy: 'A held unit is still a failure. It is charged to its own route rather than to the batch, stays unapplied in the ledger, and remains eligible for a later release. Validator semantics are unchanged; nothing here re-runs a validator or rewrites a verdict.'
};
if (!DRY_RUN) {
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(HELD_REL), `${JSON.stringify(report, null, 2)}\n`);
}

for (const row of report.held) console.error(`  HELD ${row.route} - ${row.held_by.join(', ')}`);

if (publishedCount <= 0) {
  console.error(`RELEASE ISOLATION FAIL: 0 unit(s) publishable - ${heldRoutes.length} of ${totalUnits} held. A run that publishes nothing is not a green run; it is a lane that ships nothing while reporting success.`);
  process.exit(1);
}

console.error(`RELEASE ISOLATION: ${publishedCount} unit(s) publishable, ${heldRoutes.length} held and named in ${HELD_REL}. Held units stay failures and stay eligible; the rest of the release lands.`);
process.exit(0);
