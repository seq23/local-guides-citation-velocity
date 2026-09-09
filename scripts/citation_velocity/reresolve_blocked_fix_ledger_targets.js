#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A ROW BLOCKED ON A TARGET THE RESOLVER CAN NOW FIND IS NOT BLOCKED. IT IS STALE.
 *
 * scripts/lib/citation_route_resolver.js learned, over several passes, that a
 * filesystem path never contains "|" or "&bull;" - so a separator followed by a short
 * "Word:" field label is report metadata, not part of the path. That fixed the shapes
 * the agent's scorecard sections emit:
 *
 *   "personal-injury/index.html | LEVEL: L1 | DELTA: L1 vs. 2026-07-20 (7d ago)"
 *   "uscis-medical/index.html &bull; LEVEL: L3"
 *   "dentistry/pediatric-dentistry/index.html | LEVEL: L1 | GAP: medium incumbent"
 *   "uscis-medical/ | Progress: L1 -> L4"
 *
 * The parser fix stopped NEW rows being manufactured against decorated pseudo-paths.
 * It could not repair the rows already written: data/report_fixes/agent_fix_ledger.json
 * still carried 17 rows, over 5 agent runs and 17 distinct source records, marked
 * BLOCKED_MISSING_TARGET / TARGET_NOT_FOUND against paths like
 * "personal-injury/index.html%20|%20LEVEL:%20L1%20|..." while personal-injury/index.html
 * sat in the repo. Measured on 2026-09-09: the current resolver places all 17 on pages
 * that exist, and NOT ONE of those 17 source records had a second, correctly-resolved
 * row anywhere in the ledger - so the work was not duplicated elsewhere, it was simply
 * stranded.
 *
 * The intake cannot recover them on its own: it re-derives implementation_status from
 * the records it absorbs, and these runs are long outside the absorption window, so
 * nothing ever looks at them again. That is the class defect - a resolver improvement
 * has no path back to the rows the old resolver got wrong - and this is the pass that
 * closes it, exactly as reresolve_implementation_ledger.js already does for the
 * exact-implementation ledger.
 *
 * A BAD LEDGER ROW IS A BUG, AND CORRECTING IT IS A REPAIR. It is not the same thing as
 * a page that genuinely does not exist, and the two must not be reported as one list.
 *
 * Safety, mirroring the sibling pass:
 *   - only rows currently marked BLOCKED_MISSING_TARGET are touched;
 *   - a re-resolution is accepted only when the resolver returns a RESOLVED status AND
 *     the file it names exists on disk. Anything else is HELD and the row stands;
 *   - the row's original named target is preserved in resolver_aliases, so the string
 *     the agent actually wrote is never lost;
 *   - every move is written to artifacts/validation/blocked-target-resolvability.json;
 *   - examining zero rows while the ledger has rows is a hard failure.
 *
 *   --check   report and exit non-zero if any blocked row names a findable target.
 */

const fs = require('fs');
const path = require('path');
const { resolveTargetPath, routeFromPath } = require('../lib/citation_route_resolver');
const { zeroExaminationVerdict } = require('../lib/zero_item_examination');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER = 'data/report_fixes/agent_fix_ledger.json';
const OUT = 'artifacts/validation/blocked-target-resolvability.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const CHECK_ONLY = process.argv.includes('--check');

const RESOLVED_STATUSES = new Set([
  'EXACT_EXISTS', 'SLUG_NORMALIZED_EXISTS', 'DESCRIPTIVE_SLUG_RESOLVED',
  'CANONICALIZED_BY_NUMBERED_INSIGHT', 'STEM_ROUTE_RESOLVED', 'SECTION_ROUTE_RESOLVED', 'FUZZY_ROUTE_RESOLVED'
]);

function rel(p) { return path.join(ROOT, p); }
function slugKeyFor(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function main() {
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(rel(LEDGER), 'utf8')); }
  catch { console.error(`BLOCKED TARGET RESOLVABILITY FAIL: cannot read ${LEDGER}.`); process.exit(1); }
  const fixes = Array.isArray(ledger.fixes) ? ledger.fixes : [];
  if (!fixes.length) {
    console.error(`BLOCKED TARGET RESOLVABILITY FAIL: ${LEDGER} has zero rows. Nothing was examined, which is not a pass.`);
    process.exit(1);
  }

  const blocked = fixes.filter((row) => row && row.implementation_status === 'BLOCKED_MISSING_TARGET');
  const moves = [];
  const held = [];

  for (const row of blocked) {
    const named = row.intended_winner_page || row.intended_winner_path || '';
    if (!named) { held.push({ row_id: row.id, named_target: '(none)', reason: 'The row names no target at all, so there is nothing to re-resolve.' }); continue; }
    let verdict;
    try { verdict = resolveTargetPath({ value: named, query: row.query, family: row.vertical }); }
    catch (error) { held.push({ row_id: row.id, named_target: named, reason: `Resolver threw: ${error.message}` }); continue; }
    const resolved = String((verdict && verdict.implementation_path) || '');
    if (!resolved || !RESOLVED_STATUSES.has(verdict.status) || !fs.existsSync(rel(resolved))) {
      held.push({
        row_id: row.id,
        named_target: named,
        would_be: resolved || '(none)',
        resolver_status: (verdict && verdict.status) || 'UNKNOWN',
        reason: 'The resolver still cannot place this target on a page that exists; the row stays blocked and visible.'
      });
      continue;
    }
    moves.push({ row_id: row.id, run_date: row.run_date || '', named_target: named, from: row.intended_winner_path || '', to: resolved, resolver_status: verdict.status });
    if (CHECK_ONLY) continue;
    const aliases = [...new Set([...(row.resolver_aliases || []), row.intended_winner_page, row.intended_winner_path].filter(Boolean))];
    row.resolver_aliases = aliases.sort();
    row.intended_winner_page = resolved;
    row.intended_winner_path = resolved;
    row.renderedPath = resolved;
    row.target_route = routeFromPath(resolved);
    row.operation = 'REPAIR_INTENDED_WINNER_PAGE';
    row.blocked_reason = '';
    row.target_resolution_status = verdict.status;
    // Back into the selectable queue, not straight into a release: the row still has to
    // be planned, compiled and traced like any other. QUEUED_FOR_FUTURE_RELEASE is the
    // status the intake gives an unselected, unblocked row.
    row.implementation_status = 'QUEUED_FOR_FUTURE_RELEASE';
    row.marker_verification = '';
    row.reresolved_at = DATE;
    // The canonical key embeds the target slug, so leaving it alone would keep the
    // decorated pseudo-path as this row's identity forever and let the intake mint a
    // second row for the same source record on the corrected path.
    if (row.source_record_canonical_key) {
      const parts = String(row.source_record_canonical_key).split('|');
      if (parts.length >= 3) { parts[2] = slugKeyFor(resolved); row.source_record_canonical_key = parts.join('|'); }
    }
  }

  const report = {
    schema_version: '1.0',
    validator: 'blocked-target-resolvability',
    status: moves.length && CHECK_ONLY ? 'FAIL' : 'PASS',
    checked_at: DATE,
    mode: CHECK_ONLY ? 'CHECK' : 'APPLY',
    ledger: LEDGER,
    ledger_rows: fixes.length,
    examined_count: blocked.length,
    recovered_count: moves.length,
    held_count: held.length,
    moves,
    held,
    policy: 'A row marked BLOCKED_MISSING_TARGET whose named target the current resolver can place on a page that EXISTS is a stale row, not a blocked one, and is returned to the queue. A row the resolver still cannot place is HELD, stays blocked, and stays visible with its reason.'
  };
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify(report, null, 2)}\n`);

  if (CHECK_ONLY) {
    if (moves.length) {
      console.error(`BLOCKED TARGET RESOLVABILITY FAIL (--check): ${moves.length} of ${blocked.length} blocked row(s) name a target the resolver CAN place on a page that exists:`);
      for (const m of moves) console.error(`  ${m.row_id} (run ${m.run_date})\n    ${m.named_target}\n    -> ${m.to}  [${m.resolver_status}]`);
      console.error('  Run `node scripts/citation_velocity/reresolve_blocked_fix_ledger_targets.js` and commit the result.');
      process.exit(1);
    }
    if (!blocked.length) {
      // Not a silent pass. Zero blocked rows is the state this pass exists to reach,
      // and it has to say so out loud rather than printing the same word as a run that
      // examined nothing because the ledger stopped being read.
      zeroExaminationVerdict({
        validator: 'blocked-target-resolvability',
        unit: 'blocked row(s)',
        examined: 0,
        available: 0,
        stopReason: `${fixes.length} ledger row(s) were read and none is marked BLOCKED_MISSING_TARGET, so no target needed re-resolving`,
        inputs: [LEDGER]
      });
    }
    console.log(`BLOCKED TARGET RESOLVABILITY PASS (--check): ${fixes.length} ledger row(s) read; ${blocked.length} blocked row(s) examined; none names a findable target; ${held.length} genuinely unresolvable.`);
    return;
  }

  ledger.updated_at = DATE;
  fs.writeFileSync(rel(LEDGER), `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`BLOCKED TARGET RESOLVABILITY PASS: ${blocked.length} blocked row(s) examined; ${moves.length} recovered to a real page; ${held.length} held.`);
  for (const m of moves) console.log(`  ${m.row_id}  ${m.from}\n    -> ${m.to}  [${m.resolver_status}]`);
  for (const h of held) console.log(`  HELD ${h.row_id}  ${h.named_target}  (${h.resolver_status || 'no verdict'})`);
}

main();
