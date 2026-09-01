#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Re-run every ledger entry through the route resolver, and show what moved.
 *
 * The exact-implementation ledger records, per entry, the page the agent NAMED
 * (`intended_winner_page`) and the page this repo actually repaired
 * (`implementation_path`). The second is produced by scripts/lib/citation_route_resolver.js.
 * Change the resolver and the two can silently disagree: the ledger keeps pointing at
 * whatever the resolver said on the day the entry landed.
 *
 * Three findings sat in the absorption ratchet because of exactly that, the worst being
 * insights/trt-003-trt-injections-vs-gel-how-to-decide.html, resolved on its serial
 * alone onto a page about comparing local options. The resolver now prefers the
 * descriptive slug, and this re-points the ledger to match.
 *
 * A resolver that quietly re-points 175 entries is more dangerous than three known-bad
 * ones, so:
 *
 *   - the run is a no-op unless a target actually moves, and every move is written to
 *     artifacts/validation/ledger-reresolution.json with the named target, the old
 *     path, the new path and the resolver status that decided it;
 *   - a re-resolution that comes back TARGET_NOT_FOUND or blocked NEVER overwrites a
 *     path that is already resolved. Losing a good answer to a worse one is not a
 *     correction. (One entry names a page TITLE rather than a path; the resolver
 *     cannot place it, and its existing community-questions target stands.)
 *   - entries that collide on a new path are merged through mergeLedgerEntries, so a
 *     move never drops record ids, queries or recommendations.
 *
 * Rule 0: examining zero ledger entries is a hard failure.
 *
 *   --check   report and exit non-zero if the ledger disagrees with the resolver.
 */

const fs = require('fs');
const path = require('path');
const { resolveTargetPath } = require('../lib/citation_route_resolver');
const { LEDGER_PATH, mergeLedgerEntries, normalizeImplementationPath } = require('../lib/agent_exact_repairs');

const ROOT = path.resolve(__dirname, '../..');
const OUT = 'artifacts/validation/ledger-reresolution.json';
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const CHECK_ONLY = process.argv.includes('--check');

function rel(p) { return path.join(ROOT, p); }
const RESOLVED_STATUSES = new Set([
  'EXACT_EXISTS', 'SLUG_NORMALIZED_EXISTS', 'DESCRIPTIVE_SLUG_RESOLVED',
  'CANONICALIZED_BY_NUMBERED_INSIGHT', 'STEM_ROUTE_RESOLVED', 'SECTION_ROUTE_RESOLVED', 'FUZZY_ROUTE_RESOLVED'
]);

function main() {
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(rel(LEDGER_PATH), 'utf8')); }
  catch { console.error(`LEDGER RE-RESOLUTION FAIL: cannot read ${LEDGER_PATH}.`); process.exit(1); }
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  if (!entries.length) {
    console.error(`LEDGER RE-RESOLUTION FAIL: ${LEDGER_PATH} has zero entries. Nothing was examined, which is not a pass.`);
    process.exit(1);
  }

  const moves = [];
  const held = [];
  const next = [];
  for (const entry of entries) {
    const named = entry.intended_winner_page || entry.intended_winner_path || '';
    const current = normalizeImplementationPath(entry.implementation_path || '');
    if (!named) { next.push(entry); continue; }
    const verdict = resolveTargetPath({ value: named, query: (entry.queries || [])[0], title: entry.target_identity });
    const resolved = normalizeImplementationPath(verdict.implementation_path || '');
    if (!resolved || resolved === current) { next.push(entry); continue; }
    if (!RESOLVED_STATUSES.has(verdict.status) || !fs.existsSync(rel(resolved))) {
      held.push({ named_target: named, kept: current, would_be: resolved || '(none)', resolver_status: verdict.status, reason: 'Re-resolution did not produce a published page; the existing target stands.' });
      next.push(entry);
      continue;
    }
    // AN ENTRY THAT NAMES BOTH PAGES MAY NOT BE MOVED OFF EITHER.
    //
    // A ledger entry accumulates every name its records used. When one of those other
    // names still resolves to the target the entry currently sits on, the entry is
    // covering two real pages and re-pointing it abandons one of them: the 2026-08-17
    // personal-injury row named `personal-injury/index.html &bull; INTENT: ...`, and
    // once the bullet shape parsed, this moved the whole 44-record entry there - off
    // insights/personal-injury-042-..., which the 2026-08-03 and 2026-08-10 runs had
    // named outright. Three runs went unaccounted for a repair that had been made.
    // Splitting the entry is the intake's job, from the per-record resolution; here the
    // only safe move is none.
    const otherNames = [...new Set([...(entry.resolver_aliases || []), entry.intended_winner_path, entry.intended_winner_page].filter(Boolean))]
      .filter((value) => String(value) !== String(named));
    const stillNamesCurrent = otherNames.some((value) => {
      try { return normalizeImplementationPath(resolveTargetPath({ value, query: (entry.queries || [])[0] }).implementation_path || '') === current; }
      catch { return false; }
    });
    if (stillNamesCurrent) {
      held.push({ named_target: named, kept: current, would_be: resolved, resolver_status: verdict.status, reason: 'Another name on this entry still resolves to the current target; moving it would abandon that page.' });
      next.push({ ...entry, resolver_aliases: [...new Set([...(entry.resolver_aliases || []), named])] });
      continue;
    }
    moves.push({
      named_target: named,
      from: current,
      to: resolved,
      resolver_status: verdict.status,
      record_ids: (entry.record_ids || []).length,
      why: 'The agent named this page by its descriptive slug; the previous target matched only its serial number.'
    });
    // The URL the agent tested has to survive the move, or the alias lane cannot
    // emit a 301 for it. mergeLedgerEntries collapses colliding entries with a plain
    // spread, so intended_winner_page from one of them is simply overwritten - which
    // is how /insights/trt-003-trt-injections-vs-gel-how-to-decide.html lost its only
    // record of ever having been named. resolver_aliases is re-merged below.
    next.push({
      ...entry,
      implementation_path: resolved,
      target_route: `/${resolved}`,
      resolver_aliases: [...new Set([...(entry.resolver_aliases || []), named])]
    });
  }

  const report = {
    schema_version: '1.0',
    validator: 'ledger-reresolution',
    status: 'PASS',
    checked_at: DATE,
    mode: CHECK_ONLY ? 'CHECK' : 'APPLY',
    entries_examined: entries.length,
    entries_moved: moves.length,
    entries_held: held.length,
    moves,
    held
  };
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify(report, null, 2)}\n`);

  if (CHECK_ONLY) {
    if (moves.length) {
      console.error(`LEDGER RE-RESOLUTION FAIL (--check): ${moves.length} of ${entries.length} entr(ies) point somewhere the resolver no longer agrees with:`);
      for (const m of moves) console.error(`  ${m.named_target}\n    ${m.from}\n    -> ${m.to}  [${m.resolver_status}]`);
      console.error('  Run `node scripts/citation_velocity/reresolve_implementation_ledger.js` and commit the result.');
      process.exit(1);
    }
    console.log(`LEDGER RE-RESOLUTION PASS (--check): ${entries.length} entr(ies) examined; every target agrees with the resolver; ${held.length} held.`);
    return;
  }

  const merged = mergeLedgerEntries([], next);
  // Re-attach every alias each contributing entry carried; the merge keeps only one.
  const aliasesByPath = new Map();
  for (const entry of next) {
    const key = normalizeImplementationPath(entry.implementation_path || '');
    if (!key) continue;
    if (!aliasesByPath.has(key)) aliasesByPath.set(key, new Set());
    for (const alias of entry.resolver_aliases || []) aliasesByPath.get(key).add(alias);
  }
  for (const entry of merged) {
    const aliases = aliasesByPath.get(normalizeImplementationPath(entry.implementation_path || ''));
    if (aliases && aliases.size) entry.resolver_aliases = [...aliases].sort();
  }
  ledger.entries = merged;
  ledger.entry_count = merged.length;
  ledger.updated_at = DATE;
  fs.writeFileSync(rel(LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`LEDGER RE-RESOLUTION PASS: ${entries.length} entr(ies) examined; ${moves.length} re-pointed; ${held.length} held; ${entries.length} -> ${merged.length} after merging collisions.`);
  for (const m of moves) console.log(`  ${m.from}\n    -> ${m.to}  [${m.resolver_status}]  (${m.record_ids} record id(s))`);
  for (const h of held) console.log(`  HELD ${h.kept}  (${h.resolver_status})`);
}

main();
