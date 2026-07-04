#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel, fallback=null) => { const abs=path.join(ROOT,rel); return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs,'utf8')) : fallback; };
const write = (rel, payload) => { const abs=path.join(ROOT,rel); fs.mkdirSync(path.dirname(abs),{recursive:true}); fs.writeFileSync(abs, JSON.stringify(payload,null,2)+'\n'); };
const strategy = read('data/strategy/citation_strategy_profile.json', {});
const backlog = read('data/strategy/strategy_gap_fill_backlog.json', {candidates: []});
const approval = read('data/community/approval_queue.json', []);
const queue = Array.isArray(approval) ? approval : [];
const dailyTarget = Number(strategy.cadence?.daily_target_units || 5);
const maxNewPages = Number(strategy.cadence?.max_new_pages_per_day || 2);
const readyCount = queue.filter(x => ['APPROVED','READY_TO_PUBLISH'].includes(String(x.status || '').toUpperCase()) && !String(x.operation || '').toUpperCase().startsWith('BLOCKED')).length;
const existingIds = new Set(queue.map(x => x.id));
const existingRoutes = new Set(queue.map(x => x.target_route).filter(Boolean));
const shortfall = Math.max(0, dailyTarget - readyCount);
const addCount = Math.min(maxNewPages, shortfall);
const selected = [];
for (const candidate of backlog.candidates || []) {
  if (selected.length >= addCount) break;
  if (existingIds.has(candidate.id) || existingRoutes.has(candidate.target_route)) continue;
  selected.push({
    ...candidate,
    status: 'READY_TO_PUBLISH',
    queued_by: 'strategy_gap_fill_release_gap',
    queued_at: `${process.env.SOURCE_DATE || '2026-07-03'}T00:00:00.000Z`
  });
}
if (selected.length) write('data/community/approval_queue.json', [...queue, ...selected]);
const report = {schema_version:'1.0', status:'PASS', daily_target_units:dailyTarget, ready_before:readyCount, shortfall, max_new_pages_per_day:maxNewPages, added_count:selected.length, added:selected.map(x => ({id:x.id, route:x.target_route, query:x.query}))};
write('artifacts/validation/strategy-gap-fill-release-gap.json', report);
console.log(`STRATEGY GAP RELEASE GAP PASS: ready_before=${readyCount}; shortfall=${shortfall}; added=${selected.length}`);
