#!/usr/bin/env node
'use strict';
/**
 * The planning-only backlog of fan-out opportunities.
 *
 * Two defects lived in the loop below, both of them the same shape as the
 * suppressed-backlog defect corrected elsewhere in this repo (reported 68
 * against a true depth of 389), here at 40x the scale:
 *
 *   1. The reported figure was the CAP, not the depth. The emitted field was
 *      `count: selected.length` - 2,500 - in both
 *      data/strategy/page_opportunity_backlog.json and
 *      artifacts/validation/page-opportunity-backlog.json, and it propagated
 *      into a human-readable note in validate_demand_backed_pages.js. The true
 *      distinct depth is 100,000. A capacity-limited slice was carrying a
 *      population name.
 *
 *   2. `if (candidates.length >= LIMIT * 3) break;` stopped the scan at 7,500
 *      records, so "top 2,500 by priority" was the top 2,500 of the FIRST 7,500
 *      in shard order, not of the population. Measured: the global top-2,500
 *      cutoff is priority_score 68; the truncated window's cutoff was 58, and
 *      40,000 records in the full set scored at or above the worst thing the
 *      window admitted, having never been looked at.
 *
 * Now: every shard is streamed, the true distinct depth is counted and
 * published as `backlog_depth_total` beside `selected_count`, and the selection
 * is a bounded top-K over the whole stream so the ranking is global. The cap on
 * what is SELECTED stays - that is a legitimate working-set limit. What stopped
 * is reporting the cap as the depth.
 */
const fs = require('fs');
const path = require('path');
const { iterateShardedRecords } = require('../lib/sharded_json');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'data/strategy/page_opportunity_backlog.json');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const LIMIT = Number(process.env.PAGE_OPPORTUNITY_BACKLOG_LIMIT || 2500);

function toCandidate(record) {
  return {
    opportunity_id: record.opportunity_id,
    publication_state: 'OPPORTUNITY_ONLY',
    vertical: record.vertical,
    state: record.state,
    intent: record.intent,
    query: record.query,
    page_family_hint: record.page_family,
    route_candidate: record.route_candidate,
    supporting_existing_route: record.supporting_existing_route,
    direct_owned_surface_exists: Boolean(record.direct_owned_surface_exists),
    priority_score: Number(record.priority_score || 0),
    decision_hint: record.direct_owned_surface_exists ? 'REPAIR_EXISTING_OR_ADD_ATOM' : 'EVALUATE_DISTINCT_PAGE_OR_NON_PAGE_ACTION',
    admission_rule: 'must pass page_strategy_registry Safe Harbor gate before any public page can be staged'
  };
}

// Highest priority first, ties broken by id so the ranking is deterministic.
// This is the same comparator the truncation uses, which is what makes a
// bounded top-K exact rather than approximate.
const byPriority = (a, b) => (b.priority_score - a.priority_score) || a.opportunity_id.localeCompare(b.opportunity_id);

let recordsExamined = 0;
let distinctDepth = 0;
const seen = new Set();
let heap = [];
const HEAP_CAP = Math.max(LIMIT * 2, LIMIT + 1);

for (const record of iterateShardedRecords('data/queries/citation_fanout_opportunities_100k')) {
  recordsExamined += 1;
  const key = `${record.vertical}|${record.state}|${record.intent}|${record.entity}|${record.situation}|${record.page_family}`;
  if (seen.has(key)) continue;
  seen.add(key);
  distinctDepth += 1;
  heap.push(toCandidate(record));
  if (heap.length >= HEAP_CAP) {
    heap.sort(byPriority);
    heap = heap.slice(0, LIMIT);
  }
}
heap.sort(byPriority);
const selected = heap.slice(0, LIMIT);

// A run that looked at nothing is a stop, not an empty backlog.
if (recordsExamined === 0) {
  console.error('PAGE OPPORTUNITY BACKLOG FAIL: zero fan-out records examined; the shard dataset is missing or empty.');
  process.exit(1);
}

const payload = {
  schema_version: '1.1',
  generated_at: `${DATE}T00:00:00.000Z`,
  source: 'data/queries/citation_fanout_opportunities_100k/index.json',
  publication_policy: 'PLANNING_ONLY_NO_AUTO_PUBLICATION',
  // The population, and the slice, named as what each one is. There is
  // deliberately no field called `count`: that name is what let a 2,500-record
  // cap be read as a 100,000-record depth.
  backlog_depth_total: distinctDepth,
  records_examined: recordsExamined,
  selected_count: selected.length,
  selection_limit: LIMIT,
  selection_basis: 'global_top_k_by_priority_score_over_all_shards',
  lowest_selected_priority_score: selected.length ? selected[selected.length - 1].priority_score : null,
  candidates: selected
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/page-opportunity-backlog.json'), JSON.stringify({
  status: 'PASS',
  backlog_depth_total: distinctDepth,
  records_examined: recordsExamined,
  selected_count: selected.length,
  selection_limit: LIMIT,
  publication_policy: payload.publication_policy
}, null, 2) + '\n');
console.log(`PAGE OPPORTUNITY BACKLOG PASS: ${selected.length} planning-only candidates selected of ${distinctDepth} distinct opportunities (${recordsExamined} records examined)`);
