#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { iterateShardedRecords } = require('../lib/sharded_json');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'data/strategy/page_opportunity_backlog.json');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const LIMIT = Number(process.env.PAGE_OPPORTUNITY_BACKLOG_LIMIT || 2500);

const candidates = [];
const seen = new Set();
for (const record of iterateShardedRecords('data/queries/citation_fanout_opportunities_100k')) {
  const key = `${record.vertical}|${record.state}|${record.intent}|${record.entity}|${record.situation}|${record.page_family}`;
  if (seen.has(key)) continue;
  seen.add(key);
  candidates.push({
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
  });
  if (candidates.length >= LIMIT * 3) break;
}
candidates.sort((a,b) => (b.priority_score - a.priority_score) || a.opportunity_id.localeCompare(b.opportunity_id));
const selected = candidates.slice(0, LIMIT);
const payload = {
  schema_version: '1.0',
  generated_at: `${DATE}T00:00:00.000Z`,
  source: 'data/queries/citation_fanout_opportunities_100k/index.json',
  publication_policy: 'PLANNING_ONLY_NO_AUTO_PUBLICATION',
  count: selected.length,
  candidates: selected
};
fs.mkdirSync(path.dirname(OUT), {recursive:true});
fs.writeFileSync(OUT, JSON.stringify(payload,null,2)+'\n');
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/page-opportunity-backlog.json'), JSON.stringify({status:'PASS', count:selected.length, publication_policy:payload.publication_policy},null,2)+'\n');
console.log(`PAGE OPPORTUNITY BACKLOG PASS: ${selected.length} planning-only candidates`);
