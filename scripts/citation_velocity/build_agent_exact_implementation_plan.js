#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveTargetPath, normalizeImplementationPath: normalizeRoutePath, routeFromPath, routeFamilyForPath } = require('../lib/citation_route_resolver');
const { routePage } = require('../lib/page_family_router');
const { demandBackingPredicate, DEMAND_REL } = require('../lib/demand_backing');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const POLICY_PATH = 'data/report_fixes/agent_exact_implementation_policy.json';
function rel(p){ return path.join(ROOT,p); }
function readJson(p, f=null){ try { return JSON.parse(fs.readFileSync(rel(p),'utf8')); } catch { return f; } }
function writeJson(p, v){ const out=rel(p); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out, JSON.stringify(v,null,2)+'\n'); }
function fileHash(p){ return fs.existsSync(rel(p)) ? crypto.createHash('sha256').update(fs.readFileSync(rel(p))).digest('hex') : null; }

function normalizeImplementationPath(value) {
  return normalizeRoutePath(value);
}
function resolveMissingTarget(row) {
  return resolveTargetPath(row.intended_winner_path || row.intended_winner_page || row.target_route || '');
}

function collectNormalizedRecords(){
  const dir=rel('data/report_fixes/normalized_agent_runs');
  const out=[];
  if(!fs.existsSync(dir)) return out;
  for(const name of fs.readdirSync(dir).sort()){
    if(!name.endsWith('.json')) continue;
    const p=`data/report_fixes/normalized_agent_runs/${name}`;
    const payload=readJson(p,{records:[]});
    for(const row of payload.records||[]) out.push({...row, normalized_path:p});
  }
  return out;
}
function compactSourceFields(row){
  const sourceRecordIds = [...new Set([...(row.source_record_ids || []), row.source_record_id].filter(Boolean).map(String))];
  return {
    source: row.source || 'twin_agent_artifact',
    source_artifacts: row.source_artifacts || {},
    normalized_path: row.normalized_path || '',
    source_record_id: row.source_record_id || sourceRecordIds[0] || '',
    source_record_ids: sourceRecordIds,
    route_authority: row.route_authority || 'artifact_admitted',
    admission_basis: row.admission_basis || 'AGENT_EXACT_IMPLEMENTATION_PLAN'
  };
}
function mergeSourceArtifactObject(target, source) {
  const out = target || {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!value) continue;
    if (!out[key]) out[key] = value;
    else if (Array.isArray(out[key])) {
      if (!out[key].includes(value)) out[key].push(value);
    } else if (out[key] !== value) out[key] = [...new Set([out[key], value])];
  }
  return out;
}
function latestReleasePlan(){ return readJson('artifacts/validation/velocity-intake-release-plan.json',{selected_ids:[], selected_units:[]}); }
function main(){
  const policy=readJson(POLICY_PATH,{effective_from:'9999-12-31'});
  // An unreadable or empty demand corpus must stop the planner, never default. If it
  // read as "nothing is backed" every create would be blocked and the run would look
  // like a quiet success with no pages planned; if it read as "everything passes" the
  // release lane would refuse them all downstream again. Both are worse than stopping.
  let demandBacked;
  try { demandBacked = demandBackingPredicate(ROOT); }
  catch (e) {
    console.error(`AGENT EXACT IMPLEMENTATION PLAN HALTED: ${DEMAND_REL} could not be read (${e.message}). Demand backing is unknown, and unknown demand holds - it does not wave creates through.`);
    process.exit(1);
  }
  if (!demandBacked.slugCount) {
    console.error(`AGENT EXACT IMPLEMENTATION PLAN HALTED: ${DEMAND_REL} yielded zero measured queries, so every new-page spec would be blocked against no evidence at all.`);
    process.exit(1);
  }
  const release=latestReleasePlan();
  const selectedIds=new Set(release.selected_ids||[]);
  const allRows=collectNormalizedRecords().filter(row=>row.source==='twin_agent_artifact');
  const selectedRows=allRows.filter(row=>selectedIds.has(row.id));
  const blockedRows=allRows.filter(row=>String(row.status||'').startsWith('BLOCKED_') || String(row.operation||'').startsWith('BLOCKED_'));
  const selectedRepairTargets=new Set(selectedRows
    .filter(row=>row.operation==='REPAIR_INTENDED_WINNER_PAGE' && row.intended_winner_path)
    .map(row=>row.intended_winner_path));
  const siblingRepairRows=allRows.filter(row=>
    row.operation==='REPAIR_INTENDED_WINNER_PAGE'
    && row.intended_winner_path
    && selectedRepairTargets.has(row.intended_winner_path)
  );
  const rows=[];
  const rowIds=new Set();
  for(const row of [...selectedRows, ...siblingRepairRows, ...blockedRows]){
    if(rowIds.has(row.id)) continue;
    rowIds.add(row.id);
    rows.push(row);
  }
  // A row that is neither selected, nor a sibling of a selected repair target, nor
  // blocked used to enter no set at all: not planned, not blocked, not ledgered, and
  // nowhere recorded. That silent drop is the single largest accounting hole in this
  // pipeline. Carry those rows into the plan as an explicitly unworked state so the
  // processing budget still bounds what gets applied, but nothing vanishes unrecorded.
  const isPreCutover=(row)=>policy.retroactive_processing===false && row.run_date && policy.effective_from && row.run_date < policy.effective_from;
  // Rows already proven by a previous pass live in the durable exact-implementation
  // ledger and are done, not pending. Only rows still awaiting work are carried.
  const exactLedger=readJson('data/report_fixes/agent_exact_implementation_ledger.json',{entries:[]});
  const ledgeredIds=new Set();
  for(const entry of exactLedger.entries||[]){
    for(const key of ['record_ids','source_record_ids']){
      for(const id of entry[key]||[]) if(id) ledgeredIds.add(String(id));
    }
    if(entry.record_id) ledgeredIds.add(String(entry.record_id));
  }
  const isCarryable=(row)=>!rowIds.has(row.id)
    && !isPreCutover(row)
    && String(row.status||'')==='READY_TO_RELEASE'
    && !ledgeredIds.has(String(row.id));
  const carriedRows=allRows.filter(isCarryable);
  const specs=[];
  const groupedRepairs=new Map();
  for(const row of rows){
    if(policy.retroactive_processing===false && row.run_date && policy.effective_from && row.run_date < policy.effective_from) continue;
    let effectiveRow = row;
    if(String(row.status||'').startsWith('BLOCKED_')){
      const resolved = resolveMissingTarget(row);
      if (!resolved || !resolved.implementation_path) {
        specs.push({record_id:row.id, run_date:row.run_date, query:row.query, operation:row.operation||row.status, intended_winner_page:row.intended_winner_page||'', intended_winner_path:row.intended_winner_path||'', target_route:row.target_route||'', status:'BLOCKED', blocked_reason:resolved?.status || row.blocked_reason||row.status, target_resolution: resolved || null});
        continue;
      }
      effectiveRow = {
        ...row,
        operation: 'REPAIR_INTENDED_WINNER_PAGE',
        status: 'READY_TO_RELEASE',
        intended_winner_path: resolved.implementation_path,
        target_route: `/${resolved.implementation_path}`,
        canonicalized_from: resolved.canonicalized_from || [],
        target_resolution_status: resolved.status,
        blocked_reason: ''
      };
    }
    if(effectiveRow.operation==='REPAIR_INTENDED_WINNER_PAGE'){
      const resolvedTarget = resolveTargetPath(effectiveRow.intended_winner_path || effectiveRow.target_route);
      if (resolvedTarget.block_reason) {
        specs.push({record_id:effectiveRow.id, run_date:effectiveRow.run_date, query:effectiveRow.query, operation:effectiveRow.operation, intended_winner_page:effectiveRow.intended_winner_page||'', intended_winner_path:effectiveRow.intended_winner_path||'', target_route:effectiveRow.target_route||'', implementation_path:resolvedTarget.implementation_path||'', status:'BLOCKED', blocked_reason:resolvedTarget.block_reason, target_resolution:resolvedTarget});
        continue;
      }
      effectiveRow = {...effectiveRow, intended_winner_path: resolvedTarget.implementation_path, target_route: routeFromPath(resolvedTarget.implementation_path), target_resolution_status: resolvedTarget.status, canonicalized_from: resolvedTarget.canonicalized_from || []};
      const key=normalizeImplementationPath(effectiveRow.intended_winner_path);
      const current=groupedRepairs.get(key)||{record_ids:[], queries:[], recommendations:[], canonicalized_from:[], target_resolution_status:'', row:effectiveRow};
      current.record_ids.push(effectiveRow.id);
      current.source_record_ids = current.source_record_ids || [];
      current.source_record_ids.push(...(effectiveRow.source_record_ids || [effectiveRow.source_record_id]).filter(Boolean));
      current.source_artifacts = mergeSourceArtifactObject(current.source_artifacts || {}, effectiveRow.source_artifacts || {});
      current.normalized_paths = current.normalized_paths || [];
      if (effectiveRow.normalized_path) current.normalized_paths.push(effectiveRow.normalized_path);
      if(effectiveRow.query) current.queries.push(effectiveRow.query);
      if(effectiveRow.recommendation) current.recommendations.push(effectiveRow.recommendation);
      current.canonicalized_from.push(...(effectiveRow.canonicalized_from || []));
      current.target_resolution_status = effectiveRow.target_resolution_status || current.target_resolution_status || 'EXACT_EXISTS';
      groupedRepairs.set(key,current);
    } else if(row.operation==='CREATE_NEW_TARGET_PAGE'){
      const routeDecision = routePage(row);
      if (String(routeDecision.status || '').startsWith('BLOCKED_')) {
        specs.push({record_id:row.id, run_date:row.run_date, query:row.query, intended_winner_page:row.intended_winner_page||'', intended_winner_path:row.intended_winner_path||'', target_route:row.target_route||'', implementation_path:'', operation:'CREATE_NEW_TARGET_PAGE', before_hash:null, after_hash:null, status:'BLOCKED', blocked_reason:routeDecision.blocked_reason || routeDecision.status, route_family:routeDecision.family, target_resolution_status:routeDecision.status});
        continue;
      }
      const targetPath=String(routeDecision.renderedPath||row.target_route||'').replace(/^\//,'').replace(/\/$/,'/index.html');
      // Do not plan a create the release lane is guaranteed to refuse.
      //
      // velocity_content_release.js applies the shared demand predicate and will not
      // stage a route matching no query in data/demand/measured_demand.json. Planning
      // it anyway produced a spec that could never be satisfied, and every downstream
      // validator in turn reported it as unproven work - new_page_not_proven, then
      // staged_missing_route, then live_missing_route - so one evidence refusal read
      // as a broken pipeline in three different places.
      //
      // scripts/lib/demand_backing.js exists precisely so the producer and the gate
      // share one predicate instead of each keeping a list; the planner is a producer
      // and belongs on the same predicate. The corpus is on disk at plan time (the
      // release QUEUE is not, which is why queue refusals are still reconciled
      // downstream). A refused row becomes BLOCKED with a named reason, so it stays
      // counted and legible rather than vanishing.
      if (demandBacked && !demandBacked(routeDecision.target_route || row.target_route || '')) {
        specs.push({record_id:row.id, run_date:row.run_date, query:row.query, intended_winner_page:row.intended_winner_page||'', intended_winner_path:row.intended_winner_path||'', target_route:routeDecision.target_route||row.target_route||'', implementation_path:targetPath, operation:'CREATE_NEW_TARGET_PAGE', ...compactSourceFields(row), before_hash:null, after_hash:null, status:'BLOCKED', blocked_reason:'BLOCKED_NO_MEASURED_DEMAND_FOR_ROUTE', route_family:routeDecision.family, route_reason:routeDecision.reason});
        continue;
      }
      specs.push({record_id:row.id, run_date:row.run_date, query:row.query, intended_winner_page:row.intended_winner_page||'', intended_winner_path:row.intended_winner_path||'', target_route:routeDecision.target_route||row.target_route||'', implementation_path:targetPath, operation:'CREATE_NEW_TARGET_PAGE', ...compactSourceFields(row), before_hash:fileHash(targetPath), after_hash:null, status:'PLANNED', blocked_reason:'', route_family:routeDecision.family, route_reason:routeDecision.reason});
    }
  }
  for(const [implementationPath, group] of groupedRepairs){
    const row=group.row;
    specs.push({record_id:group.record_ids[0], record_ids:group.record_ids, run_date:row.run_date, query:group.queries[0], queries:[...new Set(group.queries)], intended_winner_page:row.intended_winner_page||'', intended_winner_path:implementationPath, target_route:row.target_route||`/${implementationPath}`, implementation_path:implementationPath, supporting_route:row.supporting_route||'', operation:'REPAIR_INTENDED_WINNER_PAGE', ...compactSourceFields({...row, source_record_ids: group.source_record_ids || [], source_artifacts: group.source_artifacts || {}, normalized_path: [...new Set(group.normalized_paths || [])].join('|')}), before_hash:fileHash(implementationPath), after_hash:null, status:'PLANNED', blocked_reason:'', target_resolution_status:group.target_resolution_status || 'EXACT_EXISTS', route_family: routeFamilyForPath(implementationPath), canonicalized_from:[...new Set(group.canonicalized_from || [])], fix_recommendations:[...new Set(group.recommendations)]});
  }
  for(const row of carriedRows){
    specs.push({
      record_id:row.id,
      run_date:row.run_date,
      vertical:row.vertical||'',
      query:row.query||'',
      operation:row.operation||'',
      intended_winner_page:row.intended_winner_page||'',
      intended_winner_path:row.intended_winner_path||'',
      target_route:row.target_route||'',
      implementation_path:'',
      status:'CARRIED',
      carried_reason:'UNSELECTED_READY_ROW_OUTSIDE_PROCESSING_BUDGET',
      source_status:row.status||'',
      normalized_path:row.normalized_path||''
    });
  }
  const carriedCount=specs.filter((x)=>x.status==='CARRIED').length;
  const report={schema_version:'1.2', status:'PASS', generated_at:DATE, policy_path:POLICY_PATH, release_plan:'artifacts/validation/velocity-intake-release-plan.json', selected_agent_rows:selectedRows.length, considered_agent_rows:rows.length, selected_repair_targets:selectedRepairTargets.size, blocked_agent_rows_carried:specs.filter(x=>x.status==='BLOCKED').length, repair_count:specs.filter(x=>x.operation==='REPAIR_INTENDED_WINNER_PAGE' && x.status!=='CARRIED').length, new_page_count:specs.filter(x=>x.operation==='CREATE_NEW_TARGET_PAGE' && x.status!=='CARRIED').length, blocked_count:specs.filter(x=>x.status==='BLOCKED').length, carried_count:carriedCount, carried_policy:'CARRIED rows are recorded but never applied; the processing budget still bounds worked rows', post_cutover_row_accounting:{total_rows:allRows.filter((row)=>!isPreCutover(row)).length, worked_rows:rows.filter((row)=>!isPreCutover(row)).length, carried_rows:carriedCount, previously_ledgered_rows:allRows.filter((row)=>!isPreCutover(row) && !rowIds.has(row.id) && ledgeredIds.has(String(row.id))).length, unaccounted_rows:allRows.filter((row)=>!isPreCutover(row) && !rowIds.has(row.id) && !ledgeredIds.has(String(row.id)) && !isCarryable(row)).length}, specs:specs.sort((a,b)=>String(a.implementation_path||a.target_route).localeCompare(String(b.implementation_path||b.target_route)))};
  writeJson('artifacts/validation/agent-exact-implementation-plan.json', report);
  writeJson('data/report_fixes/agent_exact_implementation_plan.json', report);
  console.log(`AGENT EXACT IMPLEMENTATION PLAN PASS: repairs=${report.repair_count}; new_pages=${report.new_page_count}; blocked=${report.blocked_count}; carried=${report.carried_count}; unaccounted=${report.post_cutover_row_accounting.unaccounted_rows}`);
}
main();
